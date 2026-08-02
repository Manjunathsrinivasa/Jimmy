const express = require("express");
const bcrypt = require("bcryptjs");
const prisma = require("../db");
const { signToken, requireAuth } = require("../middleware/auth");

const router = express.Router();

router.post("/register", async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "email already registered" });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const user = await prisma.organization.create({
      data: {
        name: email.split("@")[0] + "'s organization",
        users: {
          create: {
            email,
            passwordHash,
            role: "admin",
            tier: "free",
          },
        },
      },
      select: {
        id: true,
        users: {
          select: { id: true, email: true, role: true, tier: true, organizationId: true },
        },
      },
    });

    const created = user.users[0];
    const token = signToken(created);

    return res.status(201).json({
      token,
      user: {
        id: created.id,
        email: created.email,
        role: created.role,
        tier: created.tier,
        organizationId: created.organizationId,
        pageAccess: null,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal server error" });
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(401).json({ error: "invalid credentials" });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "invalid credentials" });
  }

  const token = signToken(user);

  return res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      tier: user.tier,
      organizationId: user.organizationId,
      pageAccess: user.pageAccess,
    },
  });
});

// POST /auth/change-password — change the current user's own password.
// The user must know their current password; the new one is hashed the same
// way as register so subsequent logins keep working.
router.post("/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "currentPassword and newPassword are required" });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: "new password must be at least 8 characters" });
  }

  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    return res.status(400).json({ error: "current password is incorrect" });
  }

  const passwordHash = await bcrypt.hash(String(newPassword), 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  return res.json({ ok: true });
});

router.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { id: true, email: true, role: true, tier: true, organizationId: true, pageAccess: true },
  });

  if (!user) {
    return res.status(404).json({ error: "user not found" });
  }

  return res.json({ user });
});

module.exports = router;
