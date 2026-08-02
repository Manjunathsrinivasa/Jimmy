const express = require("express");
const crypto = require("crypto");
const prisma = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

function requireAdminOrManager(req, res, next) {
  if (req.user.role !== "admin" && req.user.role !== "manager") {
    return res.status(403).json({ error: "Forbidden" });
  }
  return next();
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

async function loadUser(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, role: true, tier: true, organizationId: true },
    });
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    req.user = user;
    return next();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
}

router.use(requireAuth, loadUser, requireAdminOrManager);

// Free-tier limit: 5 pipelines. Org admins are never capped ("admin must be
// able to create additional pipelines at any time").
async function enforceFreeTierLimit(req, res) {
  if (req.user.tier !== "free" || req.user.role === "admin") return;
  const count = await prisma.pipeline.count({
    where: { organizationId: req.user.organizationId },
  });
  if (count >= 5) {
    return res.status(403).json({ error: "LIMIT_REACHED" });
  }
}

// Node/Edge/FieldDefinition ids are global primary keys, so the server always
// generates fresh ids and remaps client-supplied node references in edges.
// Node config (e.g. decision conditions), edge labels (YES/NO) and field
// config (common field properties) are persisted alongside.
function normalizeGraph(body) {
  const rawNodes = (body && body.nodes) || [];
  const rawEdges = (body && body.edges) || [];

  const idMap = {};
  const fieldIdMap = {}; // client field id -> new server field id
  const nodes = rawNodes.map((n) => {
    const nodeId = newId("node");
    if (n.id) idMap[n.id] = nodeId;
    const fields = (n.fields || []).map((f) => {
      const newFieldId = newId("field");
      if (f.id) fieldIdMap[f.id] = newFieldId;
      return {
        id: newFieldId,
        label: f.label,
        fieldType: f.fieldType,
        required: !!f.required,
        order: f.order ?? 0,
        config: f.config ?? undefined,
      };
    });
    return {
      id: nodeId,
      type: n.type,
      label: n.label,
      positionX: n.positionX ?? 0,
      positionY: n.positionY ?? 0,
      config: n.config ?? undefined,
      fields,
    };
  });

  // Decision-node conditions reference fields by id; remap those references
  // to the fresh ids assigned above so rules survive a save.
  for (const n of nodes) {
    const dec = n.config && n.config.decision;
    if (dec && Array.isArray(dec.conditions)) {
      dec.conditions = dec.conditions.map((c) => ({
        ...c,
        sourceField: fieldIdMap[c.sourceField] ?? c.sourceField,
        compareField: fieldIdMap[c.compareField] ?? c.compareField,
      }));
    }
    // Field-level conditional logic (config.conditions.rules[].sourceField)
    // also references fields by id — remap those too.
    n.fields = n.fields.map((f) => ({
      ...f,
      config: remapFieldConditions(f.config, fieldIdMap),
    }));
  }

  const edges = rawEdges.map((e) => ({
    id: newId("edge"),
    sourceNodeId: idMap[e.sourceNodeId] ?? e.sourceNodeId,
    targetNodeId: idMap[e.targetNodeId] ?? e.targetNodeId,
    label: e.label ?? null,
  }));

  return { nodes, edges };
}

// Create nodes (with fields) + edges for a version from already-prepared
// normalizeGraph-shaped arrays.
async function createGraph(tx, versionId, nodes, edges) {
  if (nodes.length > 0) {
    await tx.node.createMany({
      data: nodes.map((n) => ({
        id: n.id,
        pipelineVersionId: versionId,
        type: n.type,
        label: n.label,
        positionX: n.positionX,
        positionY: n.positionY,
        config: n.config ?? undefined,
      })),
    });

    for (const n of nodes) {
      if (n.fields.length > 0) {
        await tx.fieldDefinition.createMany({
          data: n.fields.map((f) => ({
            id: f.id,
            nodeId: n.id,
            label: f.label,
            fieldType: f.fieldType,
            required: f.required,
            order: f.order,
            config: f.config ?? undefined,
          })),
        });
      }
    }
  }

  if (edges.length > 0) {
    await tx.edge.createMany({
      data: edges.map((e) => ({
        id: e.id,
        pipelineVersionId: versionId,
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
        label: e.label ?? null,
      })),
    });
  }
}

// Rewrite a node's decision-rule field references through a field-id map.
// Field ids are regenerated whenever a graph is copied (publish/clone/
// restore/version-branch), so condition sourceField/compareField must follow.
function remapDecisionConfig(config, fieldIdMap) {
  if (!config || !config.decision || !Array.isArray(config.decision.conditions)) {
    return config;
  }
  return {
    ...config,
    decision: {
      ...config.decision,
      conditions: config.decision.conditions.map((c) => ({
        ...c,
        sourceField: fieldIdMap[c.sourceField] ?? c.sourceField,
        compareField: fieldIdMap[c.compareField] ?? c.compareField,
      })),
    },
  };
}

// Rewrite a field's conditional-logic references through a field-id map.
// config.conditions: { enabled, mode: "ALL"|"ANY", rules: [{ sourceField,
// operator, compareValue | compareField }] }. sourceField and compareField
// (for field-to-field comparisons) point at fields, so both must be remapped
// whenever ids are regenerated.
function remapFieldConditions(config, fieldIdMap) {
  if (!config || !config.conditions || !Array.isArray(config.conditions.rules)) {
    return config;
  }
  return {
    ...config,
    conditions: {
      ...config.conditions,
      rules: config.conditions.rules.map((r) => ({
        ...r,
        sourceField: fieldIdMap[r.sourceField] ?? r.sourceField,
        compareField: fieldIdMap[r.compareField] ?? r.compareField,
      })),
    },
  };
}

// Copy a source version's graph (fresh ids) into a brand-new version of the
// same pipeline, bumping versionNumber. Used for version-safe editing and for
// restoring an old workflow.
async function copyGraphToNewVersion(tx, pipelineId, sourceVersion) {
  const agg = await tx.pipelineVersion.aggregate({
    where: { pipelineId },
    _max: { versionNumber: true },
  });
  const versionNumber = (agg._max.versionNumber || 0) + 1;
  const version = await tx.pipelineVersion.create({
    data: { pipelineId, versionNumber },
  });

  const nodeIdMap = {};
  const fieldIdMap = {};
  const srcNodes = sourceVersion ? sourceVersion.nodes : [];
  // Pass 1: assign fresh ids for every node + field so the field-id map is
  // complete before any decision config is remapped (node order is arbitrary
  // for builder-authored graphs).
  for (const n of srcNodes) {
    nodeIdMap[n.id] = newId("node");
    for (const f of n.fields || []) {
      fieldIdMap[f.id] = newId("field");
    }
  }
  // Pass 2: build the copied nodes with remapped configs.
  const nodes = srcNodes.map((n) => ({
    id: nodeIdMap[n.id],
    type: n.type,
    label: n.label,
    positionX: n.positionX,
    positionY: n.positionY,
    config: remapDecisionConfig(n.config, fieldIdMap),
    fields: (n.fields || []).map((f) => ({
      id: fieldIdMap[f.id],
      label: f.label,
      fieldType: f.fieldType,
      required: f.required,
      order: f.order,
      config: remapFieldConditions(f.config ?? undefined, fieldIdMap),
    })),
  }));
  const edges = (sourceVersion ? sourceVersion.edges : []).map((e) => ({
    id: newId("edge"),
    sourceNodeId: nodeIdMap[e.sourceNodeId],
    targetNodeId: nodeIdMap[e.targetNodeId],
    label: e.label ?? null,
  }));

  await createGraph(tx, version.id, nodes, edges);
  return version;
}

async function getPipelineWithGraph(pipelineId, organizationId) {
  const pipeline = await prisma.pipeline.findFirst({
    where: { id: pipelineId, organizationId },
    include: {
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        include: {
          nodes: {
            orderBy: { id: "asc" },
            include: { fields: { orderBy: { order: "asc" } } },
          },
          edges: true,
        },
      },
    },
  });

  if (!pipeline) return null;

  const version = pipeline.versions[0];
  const { versions, ...rest } = pipeline;
  return {
    ...rest,
    versionId: version ? version.id : null,
    versionNumber: version ? version.versionNumber : null,
    nodes: version ? version.nodes : [],
    edges: version ? version.edges : [],
  };
}

// Validate decision nodes: exactly one input; at least two outputs covering
// both branches (>= 1 edge labeled YES and >= 1 labeled NO). Fan-out is
// allowed — several nodes may share the same branch label.
function validateDecisionNodes(nodes, edges) {
  const errors = [];
  for (const n of nodes) {
    if (n.type !== "decision") continue;
    const incoming = edges.filter((e) => e.targetNodeId === n.id);
    const outgoing = edges.filter((e) => e.sourceNodeId === n.id);
    if (incoming.length !== 1) {
      errors.push(`Decision "${n.label}" must have exactly 1 input (has ${incoming.length})`);
    }
    if (outgoing.length < 2) {
      errors.push(`Decision "${n.label}" must have at least 2 outputs (has ${outgoing.length})`);
    } else {
      const hasYes = outgoing.some((e) => (e.label || "").toUpperCase() === "YES");
      const hasNo = outgoing.some((e) => (e.label || "").toUpperCase() === "NO");
      if (!hasYes || !hasNo) {
        errors.push(`Decision "${n.label}" outputs must include at least one YES and one NO`);
      }
    }
  }
  return errors;
}

// POST /pipelines — create pipeline for current org (free-tier limit unless admin)
router.post("/", async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name) {
      return res.status(400).json({ error: "name is required" });
    }

    const limitReached = await enforceFreeTierLimit(req, res);
    if (limitReached) return;

    const { nodes, edges } = normalizeGraph(req.body);

    const pipeline = await prisma.$transaction(async (tx) => {
      const created = await tx.pipeline.create({
        data: {
          name,
          organizationId: req.user.organizationId,
          status: "draft",
        },
      });
      const version = await tx.pipelineVersion.create({
        data: { pipelineId: created.id, versionNumber: 1 },
      });
      await createGraph(tx, version.id, nodes, edges);
      return created;
    });

    return res.status(201).json({ pipeline });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// GET /pipelines — list all pipelines for current org with per-pipeline
// project stats (total / active / completed / cancelled) and the project
// list that powers the expandable pipeline cards.
router.get("/", async (req, res) => {
  try {
    const pipelines = await prisma.pipeline.findMany({
      where: { organizationId: req.user.organizationId },
      orderBy: { createdAt: "asc" },
      include: {
        versions: {
          orderBy: { versionNumber: "desc" },
          include: {
            projects: {
              select: {
                id: true,
                name: true,
                client: true,
                stages: { select: { status: true } },
              },
            },
          },
        },
      },
    });

    const mapped = pipelines.map((p) => {
      const latest = p.versions[0] || null;
      // A project may appear on more than one version; dedupe by id, keeping
      // the newest stage snapshot (versions are ordered desc, so first wins).
      const seen = new Map();
      for (const v of p.versions) {
        for (const proj of v.projects) {
          if (!seen.has(proj.id)) seen.set(proj.id, proj);
        }
      }
      const projects = [...seen.values()].map((proj) => {
        const stages = proj.stages || [];
        // An approved approval stage is a completed state, same as done.
        const allDone =
          stages.length > 0 && stages.every((s) => s.status === "done" || s.status === "approved");
        const rejected = stages.some((s) => s.status === "rejected");
        const status = allDone ? "completed" : rejected ? "cancelled" : "active";
        return { id: proj.id, name: proj.name, client: proj.client, status };
      });
      const stats = {
        total: projects.length,
        active: projects.filter((x) => x.status === "active").length,
        completed: projects.filter((x) => x.status === "completed").length,
        cancelled: projects.filter((x) => x.status === "cancelled").length,
      };
      return {
        id: p.id,
        name: p.name,
        status: p.status,
        createdAt: p.createdAt,
        versionId: latest ? latest.id : null,
        versionNumber: latest ? latest.versionNumber : null,
        projects,
        stats,
      };
    });

    return res.json({ pipelines: mapped });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// GET /pipelines/:id — one pipeline with nodes, edges, fields (latest version)
router.get("/:id", async (req, res) => {
  try {
    const pipeline = await getPipelineWithGraph(req.params.id, req.user.organizationId);
    if (!pipeline) {
      return res.status(404).json({ error: "not found" });
    }
    return res.json({ pipeline });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// PUT /pipelines/:id — replace nodes/edges/fields of the working version.
// A version referenced by any project is NEVER mutated: a fresh copy version
// is created first, so existing projects keep their workflow intact.
router.put("/:id", async (req, res) => {
  try {
    const existing = await prisma.pipeline.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
      select: { id: true, status: true },
    });
    if (!existing) {
      return res.status(404).json({ error: "not found" });
    }
    if (existing.status !== "draft" && existing.status !== "published") {
      return res.status(400).json({ error: "pipeline is not editable (archived)" });
    }

    const { nodes, edges } = normalizeGraph(req.body);
    // Admins keep working on a published pipeline: saving branches a fresh
    // draft version (the published snapshot stays immutable for existing
    // projects) and moves the pipeline back to draft until it is published
    // again. Unpublishing/publishing never affects existing project data.
    const wasPublished = existing.status === "published";

    await prisma.$transaction(async (tx) => {
      let version = await tx.pipelineVersion.findFirst({
        where: { pipelineId: existing.id },
        orderBy: { versionNumber: "desc" },
        include: { projects: { select: { id: true } } },
      });
      if (!version) throw new Error("no version found");

      let versionId = version.id;
      if (wasPublished || version.projects.length > 0) {
        // Do not touch the published snapshot or any version a project
        // references — branch off a fresh draft version and edit that.
        const copy = await copyGraphToNewVersion(tx, existing.id, version);
        versionId = copy.id;
      }

      const nodeIds = (
        await tx.node.findMany({
          where: { pipelineVersionId: versionId },
          select: { id: true },
        })
      ).map((n) => n.id);

      await tx.fieldDefinition.deleteMany({ where: { nodeId: { in: nodeIds } } });
      await tx.edge.deleteMany({ where: { pipelineVersionId: versionId } });
      await tx.node.deleteMany({ where: { pipelineVersionId: versionId } });

      await createGraph(tx, versionId, nodes, edges);

      if (wasPublished) {
        await tx.pipeline.update({
          where: { id: existing.id },
          data: { status: "draft" },
        });
      }
    });

    const pipeline = await getPipelineWithGraph(req.params.id, req.user.organizationId);
    return res.json({ pipeline });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// PATCH /pipelines/:id — rename a pipeline. Allowed in any status (draft,
// published, archived); renaming never touches versions or project data.
router.patch("/:id", async (req, res) => {
  try {
    const { name } = req.body || {};
    if (typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "name is required" });
    }
    const existing = await prisma.pipeline.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
      select: { id: true },
    });
    if (!existing) {
      return res.status(404).json({ error: "not found" });
    }
    const updated = await prisma.pipeline.update({
      where: { id: existing.id },
      data: { name: name.trim() },
    });
    return res.json({ pipeline: updated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// POST /pipelines/:id/publish — snapshot the working graph as a new version
// and mark the pipeline published. Decision nodes are validated first.
router.post("/:id/publish", async (req, res) => {
  try {
    const existing = await prisma.pipeline.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
      select: { id: true, status: true },
    });
    if (!existing) {
      return res.status(404).json({ error: "not found" });
    }
    if (existing.status === "published") {
      return res.status(400).json({ error: "already published" });
    }
    if (existing.status === "archived") {
      return res.status(400).json({ error: "archived pipelines cannot be published" });
    }

    await prisma.$transaction(async (tx) => {
      const latest = await tx.pipelineVersion.findFirst({
        where: { pipelineId: existing.id },
        orderBy: { versionNumber: "desc" },
        include: { nodes: { include: { fields: true } }, edges: true },
      });
      if (!latest) throw new Error("no version found");

      const errors = validateDecisionNodes(latest.nodes, latest.edges);
      if (errors.length > 0) {
        throw new Error(`VALIDATION: ${errors.join("; ")}`);
      }

      const nodeIdMap = {};
      const fieldIdMap = {};
      for (const n of latest.nodes) {
        nodeIdMap[n.id] = newId("node");
        for (const f of n.fields || []) {
          fieldIdMap[f.id] = newId("field");
        }
      }
      const snapshotNodes = latest.nodes.map((n) => ({
        id: nodeIdMap[n.id],
        pipelineVersionId: "",
        type: n.type,
        label: n.label,
        positionX: n.positionX,
        positionY: n.positionY,
        config: remapDecisionConfig(n.config, fieldIdMap),
        fields: n.fields.map((f) => ({
          id: fieldIdMap[f.id],
          label: f.label,
          fieldType: f.fieldType,
          required: f.required,
          order: f.order,
          config: remapFieldConditions(f.config ?? undefined, fieldIdMap),
        })),
      }));

      const snapshot = await tx.pipelineVersion.create({
        data: {
          pipelineId: existing.id,
          versionNumber: latest.versionNumber + 1,
        },
      });

      await tx.node.createMany({
        data: snapshotNodes.map((n) => ({
          id: n.id,
          pipelineVersionId: snapshot.id,
          type: n.type,
          label: n.label,
          positionX: n.positionX,
          positionY: n.positionY,
          config: n.config ?? undefined,
        })),
      });

      for (const n of snapshotNodes) {
        if (n.fields.length > 0) {
          await tx.fieldDefinition.createMany({
            data: n.fields.map((f) => ({
              id: f.id,
              nodeId: n.id,
              label: f.label,
              fieldType: f.fieldType,
              required: f.required,
              order: f.order,
              config: f.config ?? undefined,
            })),
          });
        }
      }

      if (latest.edges.length > 0) {
        await tx.edge.createMany({
          data: latest.edges.map((e) => ({
            id: newId("edge"),
            pipelineVersionId: snapshot.id,
            sourceNodeId: nodeIdMap[e.sourceNodeId],
            targetNodeId: nodeIdMap[e.targetNodeId],
            label: e.label ?? null,
          })),
        });
      }

      await tx.pipeline.update({
        where: { id: existing.id },
        data: { status: "published" },
      });
    });

    const pipeline = await getPipelineWithGraph(req.params.id, req.user.organizationId);
    return res.json({ pipeline });
  } catch (err) {
    console.error(err);
    if (String(err.message).startsWith("VALIDATION:")) {
      return res.status(400).json({ error: err.message.replace("VALIDATION: ", "") });
    }
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// POST /pipelines/:id/unpublish — flip status back to draft. Versions (and
// the projects referencing them) are untouched.
router.post("/:id/unpublish", async (req, res) => {
  try {
    const existing = await prisma.pipeline.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
      select: { id: true, status: true },
    });
    if (!existing) {
      return res.status(404).json({ error: "not found" });
    }
    if (existing.status !== "published") {
      return res.status(400).json({ error: "pipeline is not published" });
    }
    await prisma.pipeline.update({ where: { id: existing.id }, data: { status: "draft" } });
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// POST /pipelines/:id/archive — archive a pipeline (read-only, kept in list).
router.post("/:id/archive", async (req, res) => {
  try {
    const existing = await prisma.pipeline.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
      select: { id: true, status: true },
    });
    if (!existing) {
      return res.status(404).json({ error: "not found" });
    }
    if (existing.status === "archived") {
      return res.status(400).json({ error: "already archived" });
    }
    await prisma.pipeline.update({ where: { id: existing.id }, data: { status: "archived" } });
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// POST /pipelines/:id/unarchive — bring an archived pipeline back to draft.
router.post("/:id/unarchive", async (req, res) => {
  try {
    const existing = await prisma.pipeline.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
      select: { id: true, status: true },
    });
    if (!existing) {
      return res.status(404).json({ error: "not found" });
    }
    if (existing.status !== "archived") {
      return res.status(400).json({ error: "pipeline is not archived" });
    }
    await prisma.pipeline.update({ where: { id: existing.id }, data: { status: "draft" } });
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// GET /pipelines/:id/versions — version history with per-version project counts.
router.get("/:id/versions", async (req, res) => {
  try {
    const pipeline = await prisma.pipeline.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
      select: { id: true },
    });
    if (!pipeline) {
      return res.status(404).json({ error: "not found" });
    }
    const versions = await prisma.pipelineVersion.findMany({
      where: { pipelineId: pipeline.id },
      orderBy: { versionNumber: "desc" },
      select: {
        id: true,
        versionNumber: true,
        createdAt: true,
        _count: { select: { projects: true } },
      },
    });
    return res.json({ versions });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// POST /pipelines/:id/restore-version — restore an older workflow as a new
// draft version (the latest, editable). Existing projects keep their version.
router.post("/:id/restore-version", async (req, res) => {
  try {
    const { versionId } = req.body || {};
    if (!versionId) {
      return res.status(400).json({ error: "versionId is required" });
    }
    const pipeline = await prisma.pipeline.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
      select: { id: true, status: true },
    });
    if (!pipeline) {
      return res.status(404).json({ error: "not found" });
    }

    const source = await prisma.pipelineVersion.findFirst({
      where: { id: versionId, pipelineId: pipeline.id },
      include: { nodes: { include: { fields: true } }, edges: true },
    });
    if (!source) {
      return res.status(404).json({ error: "version not found" });
    }

    await prisma.$transaction(async (tx) => {
      await copyGraphToNewVersion(tx, pipeline.id, source);
      await tx.pipeline.update({
        where: { id: pipeline.id },
        data: { status: pipeline.status === "archived" ? pipeline.status : "draft" },
      });
    });

    const result = await getPipelineWithGraph(req.params.id, req.user.organizationId);
    return res.json({ pipeline: result });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// DELETE /pipelines/:id — delete a pipeline. Refuses when any project still
// references its versions (archive those instead) so project data survives.
router.delete("/:id", async (req, res) => {
  try {
    const pipeline = await prisma.pipeline.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
      include: { versions: { select: { id: true, projects: { select: { id: true } } } } },
    });
    if (!pipeline) {
      return res.status(404).json({ error: "not found" });
    }
    const hasProjects = pipeline.versions.some((v) => v.projects.length > 0);
    if (hasProjects) {
      return res.status(409).json({ error: "cannot delete: pipeline has projects (archive it instead)" });
    }

    await prisma.$transaction(async (tx) => {
      const versionIds = pipeline.versions.map((v) => v.id);
      if (versionIds.length > 0) {
        const nodes = await tx.node.findMany({
          where: { pipelineVersionId: { in: versionIds } },
          select: { id: true },
        });
        const nodeIds = nodes.map((n) => n.id);
        if (nodeIds.length > 0) {
          await tx.fieldDefinition.deleteMany({ where: { nodeId: { in: nodeIds } } });
        }
        await tx.edge.deleteMany({ where: { pipelineVersionId: { in: versionIds } } });
        await tx.node.deleteMany({ where: { pipelineVersionId: { in: versionIds } } });
        await tx.pipelineVersion.deleteMany({ where: { pipelineId: pipeline.id } });
      }
      await tx.pipeline.delete({ where: { id: pipeline.id } });
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// POST /pipelines/:id/clone — full copy as a new draft pipeline
router.post("/:id/clone", async (req, res) => {
  try {
    const source = await prisma.pipeline.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
      include: {
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          include: { nodes: { include: { fields: true } }, edges: true },
        },
      },
    });
    if (!source) {
      return res.status(404).json({ error: "not found" });
    }

    const limitReached = await enforceFreeTierLimit(req, res);
    if (limitReached) return;

    const srcVersion = source.versions[0];
    const name = (req.body && req.body.name) || source.name + " (copy)";

    const nodeIdMap = {};
    const fieldIdMap = {};
    const srcNodes = srcVersion ? srcVersion.nodes : [];
    for (const n of srcNodes) {
      nodeIdMap[n.id] = newId("node");
      for (const f of n.fields || []) {
        fieldIdMap[f.id] = newId("field");
      }
    }
    const nodes = srcNodes.map((n) => ({
      id: nodeIdMap[n.id],
      type: n.type,
      label: n.label,
      positionX: n.positionX,
      positionY: n.positionY,
      config: remapDecisionConfig(n.config, fieldIdMap),
      fields: (n.fields || []).map((f) => ({
        id: fieldIdMap[f.id],
        label: f.label,
        fieldType: f.fieldType,
        required: f.required,
        order: f.order,
        config: remapFieldConditions(f.config ?? undefined, fieldIdMap),
      })),
    }));

    const edges = (srcVersion ? srcVersion.edges : []).map((e) => ({
      id: newId("edge"),
      sourceNodeId: nodeIdMap[e.sourceNodeId],
      targetNodeId: nodeIdMap[e.targetNodeId],
      label: e.label ?? null,
    }));

    const clone = await prisma.$transaction(async (tx) => {
      const created = await tx.pipeline.create({
        data: {
          name,
          organizationId: req.user.organizationId,
          status: "draft",
        },
      });
      const version = await tx.pipelineVersion.create({
        data: { pipelineId: created.id, versionNumber: 1 },
      });
      await createGraph(tx, version.id, nodes, edges);
      return created;
    });

    return res.status(201).json({ pipeline: clone });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

module.exports = router;
