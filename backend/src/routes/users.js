const express = require("express");
const bcrypt = require("bcryptjs");
const prisma = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const ROLES = ["admin", "manager", "contributor", "approver", "viewer"];

// The pages an admin can grant per user. "users" and "overview" are always
// kept on for the current admin so they can never lock themselves out.
const PAGE_KEYS = ["overview", "pipelines", "approvals", "reports", "users", "new_project"];

function normalizePageAccess(raw, role) {
  if (role === "admin") return null; // admins always see everything
  if (!Array.isArray(raw)) return raw === null || raw === undefined ? null : [];
  const set = new Set(raw.filter((k) => PAGE_KEYS.includes(k)));
  return set.size === PAGE_KEYS.length ? null : [...set];
}

// POST /users — add a new user to the current admin's organization, with an
// initial role. Password is hashed the same way as POST /auth/register, so
// the new member can log in immediately. Only org admins may add users.
router.post("/", requireAuth, async (req, res) => {
  try {
    const { email, password, role } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }
    const nextRole = role || "viewer";
    if (!ROLES.includes(nextRole)) {
      return res.status(400).json({ error: "invalid role" });
    }

    const admin = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, role: true, organizationId: true },
    });
    if (!admin) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (admin.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: "email already registered" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const created = await prisma.user.create({
      data: {
        email,
        passwordHash,
        role: nextRole,
        tier: "free",
        // Default: every page is granted.
        pageAccess: null,
        organizationId: admin.organizationId,
      },
      select: { id: true, email: true, role: true, tier: true, pageAccess: true },
    });
    // The temporary password is returned once so the admin can share it with
    // the new member. It is never stored in plaintext and cannot be retrieved
    // later — the user changes it on first login (POST /auth/change-password).
    return res.status(201).json({ user: created, temporaryPassword: password });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// GET /users — list users in the current user's organization (for manager /
// assignee pickers). Any authenticated user may list org members.
router.get("/", requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { organizationId: true },
    });
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const users = await prisma.user.findMany({
      where: { organizationId: user.organizationId },
      select: { id: true, email: true, role: true, tier: true, pageAccess: true },
      orderBy: { email: "asc" },
    });
    return res.json({ users, pageKeys: PAGE_KEYS });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// PATCH /users/:id — change a user's role and/or page access. Only org admins
// may change these; the target must belong to the same organization, and the
// last admin of an organization can never be demoted (prevents lockout).
router.patch("/:id", requireAuth, async (req, res) => {
  try {
    const { role, pageAccess } = req.body || {};
    if (role === undefined && pageAccess === undefined) {
      return res.status(400).json({ error: "role or pageAccess is required" });
    }
    if (role !== undefined && !ROLES.includes(role)) {
      return res.status(400).json({ error: "invalid role" });
    }
    if (
      pageAccess !== undefined &&
      pageAccess !== null &&
      (!Array.isArray(pageAccess) || pageAccess.some((k) => typeof k !== "string"))
    ) {
      return res.status(400).json({ error: "pageAccess must be an array of page keys" });
    }

    const admin = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, role: true, organizationId: true },
    });
    if (!admin) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (admin.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const target = await prisma.user.findFirst({
      where: { id: req.params.id, organizationId: admin.organizationId },
    });
    if (!target) {
      return res.status(404).json({ error: "not found" });
    }

    // An admin can never change their own role — the UI freezes the row and
    // the API rejects the request so it can't be bypassed.
    if (target.id === admin.id) {
      return res.status(400).json({ error: "cannot change your own role" });
    }

    // Never let an org end up with zero admins.
    if (target.role === "admin" && role !== undefined && role !== "admin") {
      const adminCount = await prisma.user.count({
        where: { organizationId: admin.organizationId, role: "admin" },
      });
      if (adminCount <= 1) {
        return res.status(400).json({ error: "cannot demote the last admin" });
      }
    }

    const nextRole = role !== undefined ? role : target.role;
    const nextAccess =
      pageAccess !== undefined ? normalizePageAccess(pageAccess, nextRole) : target.pageAccess;

    const updated = await prisma.user.update({
      where: { id: target.id },
      data: { role: nextRole, pageAccess: nextAccess },
      select: { id: true, email: true, role: true, tier: true, pageAccess: true },
    });
    return res.json({ user: updated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

module.exports = router;
