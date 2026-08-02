const express = require("express");
const prisma = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

async function loadUser(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, role: true, tier: true, organizationId: true, email: true },
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

router.use(requireAuth, loadUser);

// Kahn's algorithm over the version's edges. Nodes not reachable (cycles,
// disconnected) are appended at the end so every node is always included.
function orderNodesByEdges(nodes, edges) {
  const byId = new Set(nodes.map((n) => n.id));
  const indegree = new Map();
  const adj = new Map();
  for (const n of nodes) {
    indegree.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    if (!byId.has(e.sourceNodeId) || !byId.has(e.targetNodeId)) continue;
    adj.get(e.sourceNodeId).push(e.targetNodeId);
    indegree.set(e.targetNodeId, indegree.get(e.targetNodeId) + 1);
  }
  const queue = nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  const ordered = [];
  while (queue.length) {
    const id = queue.shift();
    ordered.push(id);
    for (const next of adj.get(id)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  for (const n of nodes) {
    if (!ordered.includes(n.id)) ordered.push(n.id);
  }
  return ordered;
}

// Nodes that can reach `startNodeId` through edges (reverse reachability) —
// i.e. the connected previous/parent nodes whose variables a decision node
// may read. Disconnected nodes, future nodes and unrelated branches are not
// included, per the decision-variable scoping rule.
function reachableAncestors(edges, startNodeId) {
  const reverse = new Map();
  for (const e of edges) {
    if (!reverse.has(e.targetNodeId)) reverse.set(e.targetNodeId, []);
    reverse.get(e.targetNodeId).push(e.sourceNodeId);
  }
  const seen = new Set([startNodeId]);
  const stack = [startNodeId];
  const ancestors = new Set();
  while (stack.length > 0) {
    const id = stack.pop();
    for (const src of reverse.get(id) || []) {
      if (!seen.has(src)) {
        seen.add(src);
        ancestors.add(src);
        stack.push(src);
      }
    }
  }
  return ancestors;
}

// Numeric comparison that also understands dates: ISO date/time strings
// (e.g. "2026-08-02" or "2026-08-02T09:30") compare by their timestamp, so
// "start date after end date" style rules evaluate correctly instead of
// degrading to NaN. Empty values never match.
function toComparable(v) {
  if (v === null || v === undefined || v === "") return NaN;
  const n = Number(v);
  if (!Number.isNaN(n)) return n;
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? NaN : t;
}

function evalCondition(cond, vars) {
  const { sourceField, operator, compareValue, compareField, formula } = cond || {};
  const value = vars[sourceField];
  const compare = compareField ? vars[compareField] : compareValue;

  if (formula && typeof formula === "string" && formula.trim()) {
    try {
      // eslint-disable-next-line no-new-func
      return !!new Function("v", `with(v){ return (${formula}); }`)(vars);
    } catch {
      return false;
    }
  }

  switch (operator) {
    case "equals":
      return String(value ?? "") === String(compare ?? "");
    case "not_equals":
      return String(value ?? "") !== String(compare ?? "");
    case "greater_than":
      return toComparable(value) > toComparable(compare);
    case "greater_than_or_equal":
      return toComparable(value) >= toComparable(compare);
    case "less_than":
      return toComparable(value) < toComparable(compare);
    case "less_than_or_equal":
      return toComparable(value) <= toComparable(compare);
    case "between": {
      const [lo, hi] = String(compare ?? "").split(",").map((s) => toComparable(s.trim()));
      const v = toComparable(value);
      return !Number.isNaN(lo) && !Number.isNaN(hi) && v >= lo && v <= hi;
    }
    case "contains":
      return String(value ?? "").includes(String(compare ?? ""));
    case "does_not_contain":
      return !String(value ?? "").includes(String(compare ?? ""));
    case "starts_with":
      return String(value ?? "").startsWith(String(compare ?? ""));
    case "ends_with":
      return String(value ?? "").endsWith(String(compare ?? ""));
    case "is_empty":
      return value === null || value === undefined || value === "";
    case "is_not_empty":
      return !(value === null || value === undefined || value === "");
    case "true":
      return value === true || value === "true" || value === 1 || value === "1";
    case "false":
      return value === false || value === "false" || value === 0 || value === "0";
    case "regex": {
      try {
        return new RegExp(String(compare ?? "")).test(String(value ?? ""));
      } catch {
        return false;
      }
    }
    case "in_list": {
      const list = String(compare ?? "")
        .split(",")
        .map((s) => s.trim());
      return list.includes(String(value ?? ""));
    }
    default:
      return true;
  }
}

// Decide whether a decision node takes the YES branch. ALL mode: every
// condition true; ANY mode: at least one. Disabled or empty config falls back
// to defaultOutput.
function decisionTakesYes(config, vars) {
  const dec = config || {};
  const conditions = Array.isArray(dec.conditions) ? dec.conditions : [];
  if (dec.enabled === false || conditions.length === 0) {
    return (dec.defaultOutput || "YES") === "YES";
  }
  const results = conditions.map((c) => evalCondition(c, vars));
  return dec.conditionMode === "ANY" ? results.some(Boolean) : results.every(Boolean);
}

// POST /projects — create a Project with one ProjectStage per node. A
// parallel_fork node gets one stage per listed assignee. Optional metadata
// (client, budget, start/end dates) and developer assignments are stored too.
router.post("/", async (req, res) => {
  try {
    const {
      pipelineVersionId,
      name,
      managerId,
      assignees,
      developerAssignees,
      client,
      budget,
      startDate,
      endDate,
      developers,
      stageValues,
    } = req.body || {};

    if (!pipelineVersionId || !name || !managerId) {
      return res
        .status(400)
        .json({ error: "pipelineVersionId, name and managerId are required" });
    }
    if (budget !== undefined && budget !== null && typeof budget !== "number") {
      return res.status(400).json({ error: "budget must be a number" });
    }
    for (const [key, val] of [
      ["startDate", startDate],
      ["endDate", endDate],
    ]) {
      if (val !== undefined && val !== null && (typeof val !== "string" || Number.isNaN(Date.parse(val)))) {
        return res.status(400).json({ error: `${key} must be an ISO date string or null` });
      }
    }
    if (developers !== undefined && !Array.isArray(developers)) {
      return res.status(400).json({ error: "developers must be an array of developerIds" });
    }
    if (assignees !== undefined && (typeof assignees !== "object" || Array.isArray(assignees))) {
      return res
        .status(400)
        .json({ error: "assignees must be an object mapping nodeId to an array of userIds" });
    }
    if (
      developerAssignees !== undefined &&
      (typeof developerAssignees !== "object" || Array.isArray(developerAssignees))
    ) {
      return res
        .status(400)
        .json({ error: "developerAssignees must be an object mapping nodeId to an array of developerIds" });
    }

    const version = await prisma.pipelineVersion.findFirst({
      where: { id: pipelineVersionId, pipeline: { organizationId: req.user.organizationId } },
      include: { nodes: { include: { fields: true } }, edges: true },
    });
    if (!version) {
      return res.status(404).json({ error: "pipeline version not found" });
    }

    const manager = await prisma.user.findFirst({
      where: { id: managerId, organizationId: req.user.organizationId },
      select: { id: true },
    });
    if (!manager) {
      return res.status(400).json({ error: "manager must belong to your organization" });
    }

    const assigneeMap = assignees || {};
    for (const nodeId of Object.keys(assigneeMap)) {
      const list = assigneeMap[nodeId];
      if (!Array.isArray(list) || !list.every((id) => typeof id === "string")) {
        return res.status(400).json({ error: "assignees values must be arrays of userIds" });
      }
    }
    const developerAssigneeMap = developerAssignees || {};
    for (const nodeId of Object.keys(developerAssigneeMap)) {
      const list = developerAssigneeMap[nodeId];
      if (!Array.isArray(list) || !list.every((id) => typeof id === "string")) {
        return res
          .status(400)
          .json({ error: "developerAssignees values must be arrays of developerIds" });
      }
    }
    const developerList = developers || [];
    let validDevelopers = [];
    if (developerList.length > 0) {
      validDevelopers = await prisma.developer.findMany({
        where: { id: { in: developerList }, organizationId: req.user.organizationId },
        select: { id: true },
      });
      if (validDevelopers.length !== developerList.length) {
        return res
          .status(400)
          .json({ error: "some developers do not belong to your organization" });
      }
    }

    const allAssigneeIds = [...new Set(Object.values(assigneeMap).flat())];
    let validAssignees = [];
    if (allAssigneeIds.length > 0) {
      validAssignees = await prisma.user.findMany({
        where: { id: { in: allAssigneeIds }, organizationId: req.user.organizationId },
        select: { id: true },
      });
      if (validAssignees.length !== allAssigneeIds.length) {
        return res
          .status(400)
          .json({ error: "some assignees do not belong to your organization" });
      }
    }
    const validAssigneeIds = new Set(validAssignees.map((u) => u.id));

    // Developer assignees (fork branches from the developer master) must
    // belong to the org, same as project-level developers.
    const allDeveloperAssigneeIds = [...new Set(Object.values(developerAssigneeMap).flat())];
    let validDeveloperAssignees = [];
    if (allDeveloperAssigneeIds.length > 0) {
      validDeveloperAssignees = await prisma.developer.findMany({
        where: { id: { in: allDeveloperAssigneeIds }, organizationId: req.user.organizationId },
        select: { id: true },
      });
      if (validDeveloperAssignees.length !== allDeveloperAssigneeIds.length) {
        return res
          .status(400)
          .json({ error: "some developer assignees do not belong to your organization" });
      }
    }
    const validDeveloperAssigneeIds = new Set(validDeveloperAssignees.map((d) => d.id));

    const nodeIds = new Set(version.nodes.map((n) => n.id));
    for (const nodeId of Object.keys(assigneeMap)) {
      if (!nodeIds.has(nodeId)) {
        return res.status(400).json({ error: `assignees reference unknown node: ${nodeId}` });
      }
    }
    for (const nodeId of Object.keys(developerAssigneeMap)) {
      if (!nodeIds.has(nodeId)) {
        return res
          .status(400)
          .json({ error: `developerAssignees reference unknown node: ${nodeId}` });
      }
    }

    // stageValues: initial field values for fields marked as "input" in the
    // pipeline — { [nodeId]: [{ fieldDefinitionId, value }] }. Values are
    // attached to every stage created for that node.
    if (stageValues !== undefined && (typeof stageValues !== "object" || Array.isArray(stageValues) || stageValues === null)) {
      return res
        .status(400)
        .json({ error: "stageValues must be an object mapping nodeId to an array of field values" });
    }
    if (stageValues) {
      for (const nodeId of Object.keys(stageValues)) {
        if (!nodeIds.has(nodeId)) {
          return res.status(400).json({ error: `stageValues reference unknown node: ${nodeId}` });
        }
        const list = stageValues[nodeId];
        if (!Array.isArray(list)) {
          return res.status(400).json({ error: `stageValues[${nodeId}] must be an array` });
        }
        const node = version.nodes.find((n) => n.id === nodeId);
        const validFieldIds = new Set((node.fields || []).map((f) => f.id));
        for (const fv of list) {
          if (!fv || typeof fv.fieldDefinitionId !== "string" || !validFieldIds.has(fv.fieldDefinitionId)) {
            return res
              .status(400)
              .json({ error: "fieldDefinitionId must reference a field of the matching node" });
          }
        }
      }
    }

    const orderedNodeIds = orderNodesByEdges(version.nodes, version.edges);

    const project = await prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          name,
          pipelineVersionId: version.id,
          managerId: manager.id,
          organizationId: req.user.organizationId,
          client: client ?? null,
          budget: budget ?? null,
          startDate: startDate ? new Date(startDate) : null,
          endDate: endDate ? new Date(endDate) : null,
          stages: {
            create: orderedNodeIds.flatMap((nodeId) => {
              const node = version.nodes.find((n) => n.id === nodeId);
              const listed = Array.isArray(assigneeMap[nodeId])
                ? assigneeMap[nodeId].filter((id) => validAssigneeIds.has(id))
                : [];
              const listedDevelopers = Array.isArray(developerAssigneeMap[nodeId])
                ? developerAssigneeMap[nodeId].filter((id) => validDeveloperAssigneeIds.has(id))
                : [];
              if (node.type === "parallel_fork") {
                // Prefer developers from the master list (one stage per
                // developer); fall back to user assignees; then a single
                // unassigned stage.
                if (listedDevelopers.length > 0) {
                  return listedDevelopers.map((developerId) => ({ nodeId, developerId }));
                }
                return listed.length > 0
                  ? listed.map((assigneeId) => ({ nodeId, assigneeId }))
                  : [{ nodeId, assigneeId: null }];
              }
              return [{ nodeId, assigneeId: listed[0] || null }];
            }),
          },
        },
        include: { stages: true },
      });

      if (validDevelopers.length > 0) {
        await tx.projectDeveloper.createMany({
          data: validDevelopers.map((d) => ({
            projectId: created.id,
            developerId: d.id,
          })),
        });
      }

      // Initial "input" field values: attach to every stage of the node.
      if (stageValues) {
        for (const [nodeId, list] of Object.entries(stageValues)) {
          if (list.length === 0) continue;
          const stageRows = created.stages.filter((s) => s.nodeId === nodeId);
          for (const stage of stageRows) {
            await tx.fieldValue.createMany({
              data: list.map((fv) => ({
                projectStageId: stage.id,
                fieldDefinitionId: fv.fieldDefinitionId,
                value: fv.value,
              })),
            });
          }
        }
      }

      return created;
    });

    return res.status(201).json({ project });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// GET /projects/mine — projects the user manages, is assigned to, or (for
// organization admins) every project in the org. No connection -> excluded.
// Each project includes its stages with assignee / node / dueDate detail so
// the frontend can build "my tasks" and "pending my approval" lists from
// this single call.
router.get("/mine", async (req, res) => {
  try {
    const isAdmin = req.user.role === "admin";
    const projects = await prisma.project.findMany({
      where: {
        organizationId: req.user.organizationId,
        ...(isAdmin
          ? {}
          : {
              OR: [{ managerId: req.user.id }, { stages: { some: { assigneeId: req.user.id } } }],
            }),
      },
      orderBy: { id: "asc" },
      select: {
        id: true,
        name: true,
        pipelineVersionId: true,
        managerId: true,
        manager: { select: { id: true, email: true } },
        pipelineVersion: {
          select: { versionNumber: true, pipeline: { select: { name: true } } },
        },
        stages: {
          select: {
            id: true,
            status: true,
            dueDate: true,
            assigneeId: true,
            assignee: { select: { id: true, email: true } },
            developer: { select: { id: true, name: true, email: true, designation: true } },
            node: { select: { id: true, type: true, label: true } },
          },
        },
      },
    });

    const mapped = projects.map((p) => {
      const statusCounts = p.stages.reduce((acc, s) => {
        acc[s.status] = (acc[s.status] || 0) + 1;
        return acc;
      }, {});
      return {
        id: p.id,
        name: p.name,
        pipelineVersionId: p.pipelineVersionId,
        manager: p.manager,
        pipelineName: p.pipelineVersion ? p.pipelineVersion.pipeline.name : null,
        versionNumber: p.pipelineVersion ? p.pipelineVersion.versionNumber : null,
        stageCount: p.stages.length,
        statusCounts,
        stages: p.stages.map((s) => ({
          id: s.id,
          status: s.status,
          dueDate: s.dueDate,
          assigneeId: s.assigneeId,
          assignee: s.assignee,
          developer: s.developer,
          node: { id: s.node.id, type: s.node.type, label: s.node.label },
        })),
      };
    });

    return res.json({ projects: mapped });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// GET /projects/report — org-wide reporting rows for the Reports page.
// Admins/managers see every org project; other roles get their connected ones.
// Each row carries the columns the Reports page needs, plus a per-project
// fieldValues map (fieldDefinitionId -> latest value) and a top-level `fields`
// union of every field definition across the org's pipelines so the admin can
// build a fully custom report from all available DB fields.
router.get("/report", async (req, res) => {
  try {
    const isAdmin = req.user.role === "admin";
    const isManager = req.user.role === "manager";
    const projects = await prisma.project.findMany({
      where: {
        organizationId: req.user.organizationId,
        ...(isAdmin || isManager
          ? {}
          : {
              OR: [{ managerId: req.user.id }, { stages: { some: { assigneeId: req.user.id } } }],
            }),
      },
      orderBy: { createdAt: "desc" },
      include: {
        manager: { select: { id: true, email: true } },
        pipelineVersion: {
          select: { versionNumber: true, pipeline: { select: { id: true, name: true } } },
        },
        developers: { include: { developer: { select: { id: true, name: true, email: true } } } },
        stages: {
          select: {
            id: true,
            status: true,
            updatedAt: true,
            node: { select: { label: true, type: true } },
            values: { select: { fieldDefinitionId: true, value: true } },
          },
        },
      },
    });

    // Union of every field definition across the org's pipelines, with the
    // node + pipeline it belongs to, so the custom-report builder can offer
    // them all as columns.
    const fieldDefs = await prisma.fieldDefinition.findMany({
      where: { node: { pipelineVersion: { pipeline: { organizationId: req.user.organizationId } } } },
      select: {
        id: true,
        label: true,
        fieldType: true,
        config: true,
        node: {
          select: {
            label: true,
            pipelineVersion: {
              select: { pipeline: { select: { id: true, name: true } } },
            },
          },
        },
      },
      orderBy: { label: "asc" },
    });
    const fields = fieldDefs.map((f) => ({
      id: f.id,
      label: f.label,
      fieldType: f.fieldType,
      subtype: (f.config && f.config.subtype) || f.fieldType,
      nodeLabel: f.node ? f.node.label : null,
      pipelineId: f.node && f.node.pipelineVersion ? f.node.pipelineVersion.pipeline.id : null,
      pipelineName: f.node && f.node.pipelineVersion ? f.node.pipelineVersion.pipeline.name : null,
    }));

    const rows = projects.map((p) => {
      const stages = p.stages;
      const total = stages.length;
      // "approved" is a completed state for approval stages.
      const done = stages.filter((s) => s.status === "done" || s.status === "approved").length;
      const completion = total > 0 ? Math.round((done / total) * 100) : 0;
      // Current stage: first in_progress, else first not-complete, else last stage.
      const current =
        stages.find((s) => s.status === "in_progress") ||
        stages.find((s) => s.status !== "done" && s.status !== "approved") ||
        stages[stages.length - 1] ||
        null;
      const rejected = stages.some((s) => s.status === "rejected");
      const status =
        total > 0 && stages.every((s) => s.status === "done" || s.status === "approved")
          ? "completed"
          : rejected
            ? "cancelled"
            : "active";
      const lastModified = stages.reduce(
        (max, s) => (s.updatedAt && (!max || s.updatedAt > max) ? s.updatedAt : max),
        null
      );
      // Latest value per field definition across all stages of the project.
      const fieldValues = {};
      for (const s of stages) {
        for (const v of s.values || []) {
          if (v.value !== null && v.value !== undefined && v.value !== "") {
            fieldValues[v.fieldDefinitionId] = v.value;
          }
        }
      }
      return {
        id: p.id,
        name: p.name,
        client: p.client,
        pipelineId: p.pipelineVersion ? p.pipelineVersion.pipeline.id : null,
        pipelineName: p.pipelineVersion ? p.pipelineVersion.pipeline.name : null,
        currentStage: current ? current.node.label : null,
        status,
        manager: p.manager ? p.manager.email : null,
        developers: p.developers.map((d) => d.developer.name),
        budget: p.budget,
        startDate: p.startDate,
        endDate: p.endDate,
        completion,
        lastModified: lastModified ? lastModified : p.createdAt,
        createdAt: p.createdAt,
        fieldValues,
      };
    });

    return res.json({ projects: rows, fields });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// GET /projects/approvals — approval-type stages awaiting (or already
// decided by) the current user. Non-admins see only the approval stages
// assigned to them; org admins see every approval in the org. Each row
// carries the project + node + status + field values so the approver can
// review before approving or rejecting.
router.get("/approvals", async (req, res) => {
  try {
    const isAdmin = req.user.role === "admin";
    const stages = await prisma.projectStage.findMany({
      where: {
        project: { organizationId: req.user.organizationId },
        node: { type: "approval" },
        // Admins see every approval; others see the ones they must send or
        // decide (approver or assignee).
        ...(isAdmin
          ? {}
          : {
              OR: [{ assigneeId: req.user.id }, { approverId: req.user.id }],
            }),
      },
      orderBy: { updatedAt: "desc" },
      include: {
        project: {
          select: { id: true, name: true, client: true, manager: { select: { id: true, email: true } } },
        },
        node: { select: { id: true, label: true, fields: { orderBy: { order: "asc" } } } },
        assignee: { select: { id: true, email: true } },
        approver: { select: { id: true, email: true } },
        developer: { select: { id: true, name: true, email: true, designation: true } },
        values: { include: { fieldDefinition: true } },
      },
    });

    const rows = stages.map((s) => ({
      id: s.id,
      projectId: s.project.id,
      projectName: s.project.name,
      projectClient: s.project.client,
      manager: s.project.manager,
      nodeId: s.node.id,
      stageLabel: s.node.label,
      status: s.status,
      dueDate: s.dueDate,
      updatedAt: s.updatedAt,
      assignee: s.assignee,
      approver: s.approver,
      developer: s.developer,
      fields: s.node.fields.map((f) => {
        const v = s.values.find((fv) => fv.fieldDefinitionId === f.id);
        return {
          id: f.id,
          label: f.label,
          fieldType: f.fieldType,
          config: f.config ?? undefined,
          value: v ? v.value : null,
        };
      }),
    }));

    return res.json({ approvals: rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// GET /projects/:id — one project with its stages in pipeline edge order,
// each stage carrying its field definitions and current field values.
router.get("/:id", async (req, res) => {
  try {
    const project = await prisma.project.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
      include: {
        manager: { select: { id: true, email: true } },
        developers: { include: { developer: { select: { id: true, name: true, email: true } } } },
        pipelineVersion: {
          include: {
            pipeline: { select: { id: true, name: true } },
            nodes: { include: { fields: { orderBy: { order: "asc" } } } },
            edges: true,
          },
        },
        stages: {
          include: {
            assignee: { select: { id: true, email: true } },
            approver: { select: { id: true, email: true } },
            developer: { select: { id: true, name: true, email: true, designation: true } },
            values: { include: { fieldDefinition: true } },
          },
        },
      },
    });
    if (!project) {
      return res.status(404).json({ error: "not found" });
    }

    const { nodes, edges } = project.pipelineVersion;
    const orderedNodeIds = orderNodesByEdges(nodes, edges);

    const stagesByNode = new Map();
    for (const s of project.stages) {
      if (!stagesByNode.has(s.nodeId)) stagesByNode.set(s.nodeId, []);
      stagesByNode.get(s.nodeId).push(s);
    }

    const orderedStages = [];
    for (const nodeId of orderedNodeIds) {
      const list = stagesByNode.get(nodeId) || [];
      // multiple stages share a node only for parallel forks; keep them in
      // creation order (cuid ids sort monotonically)
      list.sort((a, b) => (a.id < b.id ? -1 : 1));
      for (const s of list) {
        const node = nodes.find((n) => n.id === s.nodeId);
        if (!node) continue;
        orderedStages.push({
          id: s.id,
          status: s.status,
          dueDate: s.dueDate,
          assignee: s.assignee,
          approver: s.approver,
          developer: s.developer,
          node: { id: node.id, type: node.type, label: node.label },
          fields: node.fields.map((f) => {
            const value = s.values.find((fv) => fv.fieldDefinitionId === f.id);
            return {
              id: f.id,
              label: f.label,
              fieldType: f.fieldType,
              required: f.required,
              order: f.order,
              config: f.config ?? undefined,
              value: value ? value.value : null,
            };
          }),
        });
      }
    }

    return res.json({
      project: {
        id: project.id,
        name: project.name,
        client: project.client,
        budget: project.budget,
        startDate: project.startDate,
        endDate: project.endDate,
        developers: project.developers.map((d) => d.developer),
        pipelineVersionId: project.pipelineVersionId,
        pipelineName: project.pipelineVersion.pipeline.name,
        manager: project.manager,
        // The full graph so the frontend can render a read-only canvas.
        flow: {
          nodes: nodes.map((n) => ({
            id: n.id,
            type: n.type,
            label: n.label,
            positionX: n.positionX,
            positionY: n.positionY,
          })),
          edges: edges.map((e) => ({
            id: e.id,
            sourceNodeId: e.sourceNodeId,
            targetNodeId: e.targetNodeId,
          })),
        },
        stages: orderedStages,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// PATCH /projects/:id/stages/:stageId — update a stage's status, field
// values, assignee, and/or due date. Status / fieldValues / dueDate may be
// updated by the stage's assignee or an org admin; reassignment (assigneeId)
// is reserved for org admins and the project manager. Completing a stage
// unlocks downstream stages; a parallel_join stage only unlocks when every
// branch feeding it is done, otherwise it stays "blocked".
router.patch("/:id/stages/:stageId", async (req, res) => {
  try {
    const { status, fieldValues, assigneeId, dueDate, approverId } = req.body || {};

    const stage = await prisma.projectStage.findFirst({
      where: {
        id: req.params.stageId,
        project: { id: req.params.id, organizationId: req.user.organizationId },
      },
      include: {
        node: { include: { fields: true } },
        project: {
          include: {
            pipelineVersion: { include: { nodes: true, edges: true } },
          },
        },
      },
    });
    if (!stage) {
      return res.status(404).json({ error: "stage not found" });
    }

    // Reassignment (assigneeId) stays scoped to the project: admin or its
    // manager by id, matching DELETE /projects — not the org-wide role.
    const reassigns = assigneeId !== undefined;
    if (reassigns && req.user.role !== "admin" && stage.project.managerId !== req.user.id) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Choosing the approver ("send for approval" / resend) is done by the
    // stage's assignee, an admin, or the project manager.
    const sendsApproval = approverId !== undefined;
    if (
      sendsApproval &&
      req.user.role !== "admin" &&
      stage.project.managerId !== req.user.id &&
      stage.assigneeId !== req.user.id
    ) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Sending is a routing action, not a decision: it may only reset the
    // stage to an active state. Terminal statuses (done / approved /
    // rejected) are decided by the approver (or an admin) on their own call,
    // so a sender can't smuggle a decision through a combined payload.
    if (
      sendsApproval &&
      status !== undefined &&
      !["pending", "in_progress", "blocked"].includes(status)
    ) {
      return res
        .status(400)
        .json({ error: "cannot set a decision status while sending for approval" });
    }

    // Status / field-value changes: the assignee, the chosen approver of an
    // approval stage (so they can decide), or an admin.
    const isApprover = stage.node.type === "approval" && stage.approverId === req.user.id;
    // "approverActing" = the requester is neither admin, nor assignee, nor
    // doing a reassign/send — the only way they may act is as the approver.
    const approverActing =
      !reassigns && !sendsApproval && req.user.role !== "admin" && stage.assigneeId !== req.user.id;
    if (approverActing && !isApprover) {
      return res.status(403).json({ error: "Forbidden" });
    }
    // The approver's say on an approval stage is a decision: approved or
    // rejected only. Terminal shortcuts like "done" belong to the assignee
    // and admins (admin still has full control via the admin role).
    if (approverActing && isApprover && status !== undefined && !["approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "an approver may only approve or reject" });
    }
    // The decision on an approval stage belongs to the approver (or an
    // admin): the sender/assignee may only reset it to an active state —
    // they can't self-approve or short-circuit the wait with a terminal
    // status. This is the server-side guarantee behind "the block waits
    // until the approver approves" (the UI already hides these controls).
    if (
      stage.node.type === "approval" &&
      !reassigns &&
      !sendsApproval &&
      req.user.role !== "admin" &&
      !isApprover &&
      status !== undefined &&
      !["pending", "in_progress", "blocked"].includes(status)
    ) {
      return res
        .status(400)
        .json({ error: "only the approver or an admin may decide an approval stage" });
    }

    if (assigneeId !== undefined && assigneeId !== null) {
      if (typeof assigneeId !== "string") {
        return res.status(400).json({ error: "assigneeId must be a userId or null" });
      }
      const assignee = await prisma.user.findFirst({
        where: { id: assigneeId, organizationId: req.user.organizationId },
        select: { id: true },
      });
      if (!assignee) {
        return res.status(400).json({ error: "assignee must belong to your organization" });
      }
    }

    if (approverId !== undefined && approverId !== null) {
      if (typeof approverId !== "string") {
        return res.status(400).json({ error: "approverId must be a userId or null" });
      }
      const approver = await prisma.user.findFirst({
        where: { id: approverId, organizationId: req.user.organizationId },
        select: { id: true },
      });
      if (!approver) {
        return res.status(400).json({ error: "approver must belong to your organization" });
      }
    }

    if (dueDate !== undefined && dueDate !== null) {
      if (typeof dueDate !== "string" || Number.isNaN(Date.parse(dueDate))) {
        return res.status(400).json({ error: "dueDate must be an ISO date string or null" });
      }
    }

    const VALID_STATUSES = ["pending", "in_progress", "blocked", "approved", "rejected", "done"];
    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: "invalid status" });
    }

    const validFieldIds = new Set(stage.node.fields.map((f) => f.id));
    if (fieldValues !== undefined) {
      if (!Array.isArray(fieldValues)) {
        return res.status(400).json({ error: "fieldValues must be an array" });
      }
      for (const fv of fieldValues) {
        if (!fv || typeof fv.fieldDefinitionId !== "string" || !validFieldIds.has(fv.fieldDefinitionId)) {
          return res
            .status(400)
            .json({ error: "fieldDefinitionId must reference a field of this stage's node" });
        }
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (fieldValues) {
        for (const fv of fieldValues) {
          const existing = await tx.fieldValue.findFirst({
            where: { projectStageId: stage.id, fieldDefinitionId: fv.fieldDefinitionId },
          });
          if (existing) {
            await tx.fieldValue.update({ where: { id: existing.id }, data: { value: fv.value } });
          } else {
            await tx.fieldValue.create({
              data: {
                projectStageId: stage.id,
                fieldDefinitionId: fv.fieldDefinitionId,
                value: fv.value,
              },
            });
          }
        }
      }

      if (status !== undefined && status !== stage.status) {
        await tx.projectStage.update({ where: { id: stage.id }, data: { status } });
      }
      if (assigneeId !== undefined) {
        await tx.projectStage.update({ where: { id: stage.id }, data: { assigneeId } });
      }
      if (approverId !== undefined) {
        // Sending / resending always puts the stage back in an active,
        // decidable state — a rejected stage must not stay stuck after the
        // sender picks a new approver (guard works for any client).
        const statusAfterSend = stage.status === "rejected" ? "in_progress" : undefined;
        await tx.projectStage.update({
          where: { id: stage.id },
          data: { approverId, ...(statusAfterSend ? { status: statusAfterSend } : {}) },
        });
      }
      if (dueDate !== undefined) {
        await tx.projectStage.update({
          where: { id: stage.id },
          data: { dueDate: dueDate === null ? null : new Date(dueDate) },
        });
      }
      const finalStatus = status !== undefined ? status : stage.status;

      // Flow control: completing (or approving) a stage unlocks what comes
      // next. A decision node evaluates its conditions against variables from
      // connected (ancestor) stages and unlocks exactly one branch (YES/NO).
      // For approval stages: "approved" advances the workflow, "rejected"
      // keeps the workflow on the same step (downstream stages stay locked).
      if (finalStatus === "done" || finalStatus === "approved") {
        const { nodes, edges } = stage.project.pipelineVersion;
        const allStages = await tx.projectStage.findMany({
          where: { projectId: stage.projectId },
          select: { id: true, nodeId: true, status: true },
        });

        // Unlock (or keep blocked) the stages of a single target node.
        const unlockTarget = async (targetNodeId) => {
          const target = nodes.find((n) => n.id === targetNodeId);
          if (!target) return;

          if (target.type === "parallel_join") {
            // Only unlock the join once every branch feeding it is done (an
            // approval branch counts as complete once its stage is approved).
            const joinStages = allStages.filter((s) => s.nodeId === target.id);
            const incoming = edges.filter((e) => e.targetNodeId === target.id);
            let allBranchesDone = true;
            for (const ie of incoming) {
              const branchStages = allStages.filter((s) => s.nodeId === ie.sourceNodeId);
              if (
                branchStages.length === 0 ||
                !branchStages.every((s) => s.status === "done" || s.status === "approved")
              ) {
                allBranchesDone = false;
                break;
              }
            }
            const nextStatus = allBranchesDone ? "in_progress" : "blocked";
            for (const js of joinStages) {
              if (js.status !== nextStatus) {
                await tx.projectStage.update({ where: { id: js.id }, data: { status: nextStatus } });
              }
            }
            return;
          }

          // Regular downstream node: unlock any pending stage(s).
          const targetStages = allStages.filter((s) => s.nodeId === target.id);
          for (const ts of targetStages) {
            if (ts.status === "pending") {
              await tx.projectStage.update({ where: { id: ts.id }, data: { status: "in_progress" } });
            }
          }
        };

        if (stage.node.type === "decision") {
          // Variables = field values from every connected ancestor stage (nodes
          // that can reach the decision through edges) plus this stage's own
          // values. Disconnected / future / other-branch nodes are excluded.
          const ancestors = reachableAncestors(edges, stage.nodeId);
          const ancestorStages = await tx.projectStage.findMany({
            where: { projectId: stage.projectId, nodeId: { in: [...ancestors] } },
            select: { values: { select: { fieldDefinitionId: true, value: true } } },
          });
          const vars = {};
          for (const s of ancestorStages) {
            for (const v of s.values) vars[v.fieldDefinitionId] = v.value;
          }
          const ownValues = await tx.fieldValue.findMany({
            where: { projectStageId: stage.id },
            select: { fieldDefinitionId: true, value: true },
          });
          for (const v of ownValues) vars[v.fieldDefinitionId] = v.value;

          const takeYes = decisionTakesYes(stage.node.config ? stage.node.config.decision : null, vars);
          // A decision branch may fan out to several nodes: unlock every edge
          // carrying the chosen label (YES or NO).
          const branchLabel = takeYes ? "YES" : "NO";
          let chosen = edges.filter(
            (e) => e.sourceNodeId === stage.nodeId && (e.label || "").toUpperCase() === branchLabel
          );
          if (chosen.length === 0) {
            // Backward compat: legacy decision nodes built before edge labels
            // existed have no YES/NO labels at all — treat the first two
            // outgoing edges as YES then NO. Only applies when no edge from
            // this node carries any label.
            const anyLabeled = edges.some(
              (e) => e.sourceNodeId === stage.nodeId && (e.label || "").toUpperCase()
            );
            if (!anyLabeled) {
              const outgoing = edges.filter((e) => e.sourceNodeId === stage.nodeId);
              chosen = takeYes ? outgoing.slice(0, 1) : outgoing.slice(1, 2);
            }
          }
          for (const edge of chosen) {
            await unlockTarget(edge.targetNodeId);
          }
        } else {
          const outgoing = edges.filter((e) => e.sourceNodeId === stage.nodeId);
          for (const edge of outgoing) {
            await unlockTarget(edge.targetNodeId);
          }
        }
      }
      return tx.projectStage.findUnique({
        where: { id: stage.id },
            include: {
              node: { include: { fields: true } },
              values: { include: { fieldDefinition: true } },
              assignee: { select: { id: true, email: true } },
              approver: { select: { id: true, email: true } },
              developer: { select: { id: true, name: true, email: true, designation: true } },
            },
          });
    });

    return res.json({ stage: updated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// Load a stage (org-scoped) plus enough project info to decide whether the
// user is "connected" to the project: org admin, project manager, or assigned
// to at least one of its stages. Returns null when the stage does not exist.
async function loadStageWithConnection(stageId, projectId, organizationId, userId, userRole) {
  const stage = await prisma.projectStage.findFirst({
    where: {
      id: stageId,
      project: { id: projectId, organizationId },
    },
    select: {
      id: true,
      project: {
        select: {
          id: true,
          managerId: true,
          stages: { select: { assigneeId: true } },
        },
      },
    },
  });
  if (!stage) return null;
  const connected =
    userRole === "admin" ||
    stage.project.managerId === userId ||
    stage.project.stages.some((s) => s.assigneeId === userId);
  return { stage, connected };
}

// DELETE /projects/:id — delete a project and everything under it. Only the
// org admin or the project's manager may delete it.
router.delete("/:id", async (req, res) => {
  try {
    const project = await prisma.project.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
      select: { id: true, managerId: true, stages: { select: { id: true } } },
    });
    if (!project) {
      return res.status(404).json({ error: "not found" });
    }
    if (req.user.role !== "admin" && project.managerId !== req.user.id) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const stageIds = project.stages.map((s) => s.id);
    await prisma.$transaction(async (tx) => {
      if (stageIds.length > 0) {
        await tx.comment.deleteMany({ where: { projectStageId: { in: stageIds } } });
        await tx.fieldValue.deleteMany({ where: { projectStageId: { in: stageIds } } });
        await tx.projectStage.deleteMany({ where: { projectId: project.id } });
      }
      await tx.projectDeveloper.deleteMany({ where: { projectId: project.id } });
      await tx.project.delete({ where: { id: project.id } });
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// POST /projects/:id/stages/:stageId/comments — add a comment to a stage.
// Only users connected to the project (admin, manager, or stage assignee)
// may comment.
router.post("/:id/stages/:stageId/comments", async (req, res) => {
  try {
    const { text } = req.body || {};
    if (typeof text !== "string" || text.trim().length === 0) {
      return res.status(400).json({ error: "text is required" });
    }
    if (text.trim().length > 5000) {
      return res.status(400).json({ error: "text must be at most 5000 characters" });
    }

    const ctx = await loadStageWithConnection(
      req.params.stageId,
      req.params.id,
      req.user.organizationId,
      req.user.id,
      req.user.role
    );
    if (!ctx) {
      return res.status(404).json({ error: "stage not found" });
    }
    if (!ctx.connected) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const comment = await prisma.comment.create({
      data: { projectStageId: ctx.stage.id, userId: req.user.id, text: text.trim() },
      include: { user: { select: { id: true, email: true } } },
    });
    return res.status(201).json({ comment });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// GET /projects/:id/stages/:stageId/comments — list a stage's comments,
// oldest first. Visible to users connected to the project.
router.get("/:id/stages/:stageId/comments", async (req, res) => {
  try {
    const ctx = await loadStageWithConnection(
      req.params.stageId,
      req.params.id,
      req.user.organizationId,
      req.user.id,
      req.user.role
    );
    if (!ctx) {
      return res.status(404).json({ error: "stage not found" });
    }
    if (!ctx.connected) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const comments = await prisma.comment.findMany({
      where: { projectStageId: ctx.stage.id },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { id: true, email: true } } },
    });
    return res.json({ comments });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

module.exports = router;
