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

// A report's viewers as plain user rows (id, email, role) plus the creator.
const VIEWER_SELECT = {
  select: {
    user: { select: { id: true, email: true, role: true } },
  },
};

function serialize(report) {
  return {
    id: report.id,
    name: report.name,
    description: report.description,
    pipelineId: report.pipelineId,
    pipeline: report.pipeline ? { id: report.pipeline.id, name: report.pipeline.name } : null,
    columns: report.columns,
    createdBy: report.createdBy,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    viewers: (report.viewers || []).map((v) => v.user),
  };
}

// Field definition ids belonging to a pipeline (any version of it).
async function pipelineFieldIds(pipelineId, tx = prisma) {
  const defs = await tx.fieldDefinition.findMany({
    where: { node: { pipelineVersion: { pipelineId } } },
    select: { id: true },
  });
  return new Set(defs.map((d) => d.id));
}

// Validate that every "field" column references a field of `pipelineId`.
// Project columns are always allowed; a report must not mix in fields from
// other pipelines.
async function validateColumnsForPipeline(columns, pipelineId) {
  const fieldKeys = columns.filter((c) => c.kind === "field").map((c) => c.key);
  if (fieldKeys.length === 0) return null;
  const ids = await pipelineFieldIds(pipelineId);
  const missing = fieldKeys.filter((k) => !ids.has(k));
  return missing.length > 0
    ? `columns reference fields that do not belong to the report's pipeline: ${missing.join(", ")}`
    : null;
}

// Admin or manager? Only they may create / edit / delete reports.
function isManager(user) {
  return user.role === "admin" || user.role === "manager";
}

// Validate a columns array: [{ key, label, kind: "project"|"field" }].
// kind "field" means a pipeline fieldDefinitionId.
function validColumns(columns) {
  if (!Array.isArray(columns) || columns.length === 0) return false;
  return columns.every(
    (c) =>
      c &&
      typeof c.key === "string" &&
      typeof c.label === "string" &&
      (c.kind === "project" || c.kind === "field")
  );
}

// GET /reports — reports the user may open: their own, ones shared with them,
// and (for org admins) every report in the organization. Each report carries
// its columns, viewer list and pipeline so the UI can render and manage it.
router.get("/", async (req, res) => {
  try {
    const isAdmin = req.user.role === "admin";
    const reports = await prisma.report.findMany({
      where: {
        organizationId: req.user.organizationId,
        ...(isAdmin
          ? {}
          : {
              OR: [
                { createdById: req.user.id },
                { viewers: { some: { userId: req.user.id } } },
              ],
            }),
      },
      include: {
        createdBy: { select: { id: true, email: true, role: true } },
        pipeline: { select: { id: true, name: true } },
        viewers: VIEWER_SELECT,
      },
      orderBy: [{ pipelineId: "asc" }, { name: "asc" }],
    });
    return res.json({ reports: reports.map(serialize) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// GET /reports/pipelines — pipelines (with report counts) for the Reports
// tree. Managers/admins see every org pipeline; everyone else only pipelines
// they have a report on (own or shared). Each entry carries its report count
// so the sidebar can show "Pipeline (n)" next to each pipeline.
router.get("/pipelines", async (req, res) => {
  try {
    const isManagerRole = req.user.role === "admin" || req.user.role === "manager";
    const pipelines = await prisma.pipeline.findMany({
      where: {
        organizationId: req.user.organizationId,
        ...(isManagerRole
          ? {}
          : {
              reports: { some: { OR: [{ createdById: req.user.id }, { viewers: { some: { userId: req.user.id } } }] } },
            }),
      },
      select: {
        id: true,
        name: true,
        status: true,
        _count: { select: { reports: true } },
      },
      orderBy: { name: "asc" },
    });
    return res.json({
      pipelines: pipelines.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        reportCount: p._count.reports,
      })),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// POST /reports — create a saved report scoped to a pipeline. The creator (or
// a manager) gives it a unique name, picks the pipeline, chooses which of that
// pipeline's fields to show, and selects who may view it.
router.post("/", async (req, res) => {
  try {
    if (!isManager(req.user)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { name, description, columns, viewerIds, pipelineId } = req.body || {};
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name is required" });
    }
    if (!pipelineId || typeof pipelineId !== "string") {
      return res.status(400).json({ error: "pipelineId is required" });
    }
    if (!validColumns(columns)) {
      return res.status(400).json({ error: "columns must be a non-empty array of { key, label, kind }" });
    }
    if (viewerIds !== undefined && !Array.isArray(viewerIds)) {
      return res.status(400).json({ error: "viewerIds must be an array of userIds" });
    }

    const trimmedName = name.trim();
    // Report names are unique within the organization.
    const dup = await prisma.report.findFirst({
      where: { organizationId: req.user.organizationId, name: trimmedName },
      select: { id: true },
    });
    if (dup) {
      return res.status(409).json({ error: "A report with this name already exists" });
    }

    const pipeline = await prisma.pipeline.findFirst({
      where: { id: pipelineId, organizationId: req.user.organizationId },
      select: { id: true },
    });
    if (!pipeline) {
      return res.status(400).json({ error: "pipeline must belong to your organization" });
    }
    const columnErr = await validateColumnsForPipeline(columns, pipelineId);
    if (columnErr) {
      return res.status(400).json({ error: columnErr });
    }

    const ids = viewerIds ? [...new Set(viewerIds)] : [];
    let validViewers = [];
    if (ids.length > 0) {
      validViewers = await prisma.user.findMany({
        where: { id: { in: ids }, organizationId: req.user.organizationId },
        select: { id: true },
      });
      if (validViewers.length !== ids.length) {
        return res.status(400).json({ error: "some viewers do not belong to your organization" });
      }
    }

    const report = await prisma.report.create({
      data: {
        name: trimmedName,
        description: description ? String(description).trim() : null,
        columns,
        pipelineId,
        organizationId: req.user.organizationId,
        createdById: req.user.id,
        viewers: {
          create: validViewers.map((v) => ({ userId: v.id })),
        },
      },
      include: {
        createdBy: { select: { id: true, email: true, role: true } },
        pipeline: { select: { id: true, name: true } },
        viewers: VIEWER_SELECT,
      },
    });
    return res.status(201).json({ report: serialize(report) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// Load a report the caller may open: admins see everything, everyone else
// only reports they created or were granted via ReportViewer. The where
// clause IS the authorization — returning non-null means the caller may view.
async function loadReportWithAccess(reportId, req) {
  const isAdmin = req.user.role === "admin";
  return prisma.report.findFirst({
    where: {
      id: reportId,
      organizationId: req.user.organizationId,
      ...(isAdmin
        ? {}
        : {
            OR: [
              { createdById: req.user.id },
              { viewers: { some: { userId: req.user.id } } },
            ],
          }),
    },
    include: {
      createdBy: { select: { id: true, email: true, role: true } },
      viewers: VIEWER_SELECT,
    },
  });
}

// GET /reports/:id — one report (used to refresh a single report's config).
// Accessible to admins, the creator, and assigned viewers.
router.get("/:id", async (req, res) => {
  try {
    const report = await loadReportWithAccess(req.params.id, req);
    if (!report) {
      return res.status(404).json({ error: "not found" });
    }
    return res.json({ report: serialize(report) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// PATCH /reports/:id — rename, re-describe, change columns, change the
// pipeline, or change who can view the report. Only the creator or an org
// admin may edit.
router.patch("/:id", async (req, res) => {
  try {
    const { name, description, columns, viewerIds, pipelineId } = req.body || {};
    if (
      name === undefined &&
      description === undefined &&
      columns === undefined &&
      viewerIds === undefined &&
      pipelineId === undefined
    ) {
      return res.status(400).json({ error: "nothing to update" });
    }
    if (name !== undefined && (typeof name !== "string" || !name.trim())) {
      return res.status(400).json({ error: "name must be a non-empty string" });
    }
    if (columns !== undefined && !validColumns(columns)) {
      return res.status(400).json({ error: "columns must be a non-empty array of { key, label, kind }" });
    }

    const existing = await prisma.report.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
      // columns is needed to re-validate field columns when the name only
      // changes (existing.columns is used as the fallback columns set).
      select: { id: true, createdById: true, pipelineId: true, columns: true },
    });
    if (!existing) {
      return res.status(404).json({ error: "not found" });
    }
    // Only the creator or an org admin may edit.
    if (req.user.role !== "admin" && existing.createdById !== req.user.id) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Unique names (excluding this report) within the organization.
    if (name !== undefined && name.trim()) {
      const dup = await prisma.report.findFirst({
        where: {
          organizationId: req.user.organizationId,
          name: name.trim(),
          id: { not: existing.id },
        },
        select: { id: true },
      });
      if (dup) {
        return res.status(409).json({ error: "A report with this name already exists" });
      }
    }

    // If the pipeline changes, the field columns must belong to the new one.
    let nextPipelineId = existing.pipelineId;
    if (pipelineId !== undefined) {
      if (pipelineId === null) {
        return res.status(400).json({ error: "a report must belong to a pipeline" });
      }
      const pipeline = await prisma.pipeline.findFirst({
        where: { id: pipelineId, organizationId: req.user.organizationId },
        select: { id: true },
      });
      if (!pipeline) {
        return res.status(400).json({ error: "pipeline must belong to your organization" });
      }
      nextPipelineId = pipelineId;
    }
    const checkColumns = columns !== undefined ? columns : existing.columns;
    const columnErr = await validateColumnsForPipeline(checkColumns, nextPipelineId);
    if (columnErr) {
      return res.status(400).json({ error: columnErr });
    }

    if (viewerIds !== undefined && !Array.isArray(viewerIds)) {
      return res.status(400).json({ error: "viewerIds must be an array of userIds" });
    }
    let validViewers = null;
    if (viewerIds !== undefined) {
      const ids = [...new Set(viewerIds)];
      validViewers = [];
      if (ids.length > 0) {
        validViewers = await prisma.user.findMany({
          where: { id: { in: ids }, organizationId: req.user.organizationId },
          select: { id: true },
        });
        if (validViewers.length !== ids.length) {
          return res.status(400).json({ error: "some viewers do not belong to your organization" });
        }
      }
    }

    const report = await prisma.$transaction(async (tx) => {
      if (viewerIds !== undefined) {
        await tx.reportViewer.deleteMany({ where: { reportId: existing.id } });
        if (validViewers.length > 0) {
          await tx.reportViewer.createMany({
            data: validViewers.map((v) => ({ reportId: existing.id, userId: v.id })),
          });
        }
      }
      return tx.report.update({
        where: { id: existing.id },
        data: {
          ...(name !== undefined ? { name: name.trim() } : {}),
          ...(description !== undefined
            ? { description: description ? String(description).trim() : null }
            : {}),
          ...(columns !== undefined ? { columns } : {}),
          ...(pipelineId !== undefined ? { pipelineId: nextPipelineId } : {}),
        },
        include: {
          createdBy: { select: { id: true, email: true, role: true } },
          pipeline: { select: { id: true, name: true } },
          viewers: VIEWER_SELECT,
        },
      });
    });
    return res.json({ report: serialize(report) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// DELETE /reports/:id — only the creator or an org admin.
router.delete("/:id", async (req, res) => {
  try {
    const existing = await prisma.report.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
      select: { id: true, createdById: true },
    });
    if (!existing) {
      return res.status(404).json({ error: "not found" });
    }
    if (req.user.role !== "admin" && existing.createdById !== req.user.id) {
      return res.status(403).json({ error: "Forbidden" });
    }
    await prisma.reportViewer.deleteMany({ where: { reportId: existing.id } });
    await prisma.report.delete({ where: { id: existing.id } });
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

module.exports = router;
