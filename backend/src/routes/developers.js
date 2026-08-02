const express = require("express");
const prisma = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

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

function requireAdminOrManager(req, res, next) {
  if (req.user.role !== "admin" && req.user.role !== "manager") {
    return res.status(403).json({ error: "Forbidden" });
  }
  return next();
}

router.use(requireAuth, loadUser);

// GET /developers — list the org's developer master (any authenticated user
// can read, so project pages can show developer pickers).
router.get("/", async (req, res) => {
  try {
    const developers = await prisma.developer.findMany({
      where: { organizationId: req.user.organizationId },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      select: {
        id: true,
        employeeId: true,
        name: true,
        email: true,
        phone: true,
        department: true,
        designation: true,
        skills: true,
        experience: true,
        costPerHour: true,
        location: true,
        manager: true,
        availability: true,
        notes: true,
        active: true,
        createdAt: true,
        _count: { select: { projects: true } },
      },
    });
    return res.json({ developers });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

const FIELDS = [
  "employeeId",
  "name",
  "email",
  "phone",
  "department",
  "designation",
  "skills",
  "experience",
  "costPerHour",
  "location",
  "manager",
  "availability",
  "notes",
  "active",
];

function pickFields(body) {
  const out = {};
  for (const f of FIELDS) {
    if (body && body[f] !== undefined) out[f] = body[f];
  }
  return out;
}

// POST /developers — create a developer in the master list (admin/manager).
router.post("/", requireAdminOrManager, async (req, res) => {
  try {
    const { employeeId, name, email } = req.body || {};
    if (!employeeId || !name || !email) {
      return res.status(400).json({ error: "employeeId, name and email are required" });
    }
    const developer = await prisma.developer.create({
      data: {
        organizationId: req.user.organizationId,
        ...pickFields(req.body),
      },
    });
    return res.status(201).json({ developer });
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(409).json({ error: "a developer with that email or employee id already exists" });
    }
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// PATCH /developers/:id — edit a developer, or disable/activate (active).
router.patch("/:id", requireAdminOrManager, async (req, res) => {
  try {
    const developer = await prisma.developer.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
    });
    if (!developer) {
      return res.status(404).json({ error: "not found" });
    }
    const updated = await prisma.developer.update({
      where: { id: developer.id },
      data: pickFields(req.body),
    });
    return res.json({ developer: updated });
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(409).json({ error: "a developer with that email or employee id already exists" });
    }
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// DELETE /developers/:id — remove from the master list (and from projects).
router.delete("/:id", requireAdminOrManager, async (req, res) => {
  try {
    const developer = await prisma.developer.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
    });
    if (!developer) {
      return res.status(404).json({ error: "not found" });
    }
    await prisma.$transaction(async (tx) => {
      await tx.projectDeveloper.deleteMany({ where: { developerId: developer.id } });
      await tx.developer.delete({ where: { id: developer.id } });
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

module.exports = router;
