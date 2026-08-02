const express = require("express");
const prisma = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Canonical page keys — must stay in sync with the frontend sidebar (AppLayout)
// and users.js PAGE_KEYS. Order is the default when nothing is configured.
const PAGE_KEYS = ["overview", "pipelines", "approvals", "reports", "users", "new_project"];

// Overview stat-card keys — must stay in sync with the frontend Overview page
// (STATS array). Order is the default when nothing is configured.
const OVERVIEW_KEYS = ["tasks", "approvals", "projects", "done"];

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

// GET /settings/nav — the organization's sidebar order. Every member reads the
// same order; null means the client should use its default order.
router.get("/nav", async (req, res) => {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: req.user.organizationId },
      select: { navOrder: true },
    });
    const order = Array.isArray(org && org.navOrder) ? org.navOrder : null;
    return res.json({ order });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// PUT /settings/nav — admins only. Replaces the org-wide order with a cleaned
// array of known page keys (unknown keys and duplicates are dropped; missing
// keys keep their default position client-side).
router.put("/nav", async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { order } = req.body || {};
    if (!Array.isArray(order)) {
      return res.status(400).json({ error: "order must be an array of page keys" });
    }
    const cleaned = [...new Set(order.filter((k) => typeof k === "string" && PAGE_KEYS.includes(k)))];
    await prisma.organization.update({
      where: { id: req.user.organizationId },
      data: { navOrder: cleaned },
    });
    return res.json({ order: cleaned });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// GET /settings/overview — the organization's Overview card order. Every
// member reads the same order; null means use the default.
router.get("/overview", async (req, res) => {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: req.user.organizationId },
      select: { overviewOrder: true },
    });
    const order = Array.isArray(org && org.overviewOrder) ? org.overviewOrder : null;
    return res.json({ order });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// PUT /settings/overview — admins only. Cleans and persists the org-wide
// Overview card order (same validation pattern as /settings/nav).
router.put("/overview", async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { order } = req.body || {};
    if (!Array.isArray(order)) {
      return res.status(400).json({ error: "order must be an array of stat keys" });
    }
    const cleaned = [
      ...new Set(order.filter((k) => typeof k === "string" && OVERVIEW_KEYS.includes(k))),
    ];
    await prisma.organization.update({
      where: { id: req.user.organizationId },
      data: { overviewOrder: cleaned },
    });
    return res.json({ order: cleaned });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

module.exports = router;
