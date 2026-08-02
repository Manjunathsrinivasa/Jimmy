const express = require("express");
const authRoutes = require("./routes/auth");
const pipelineRoutes = require("./routes/pipelines");
const projectRoutes = require("./routes/projects");
const userRoutes = require("./routes/users");
const developerRoutes = require("./routes/developers");
const reportRoutes = require("./routes/reports");
const settingsRoutes = require("./routes/settings");
const { requireAuth } = require("./middleware/auth");

const app = express();
app.use(express.json());

// CORS — the frontend (Vercel) and backend (Render) are different origins, so
// the browser needs explicit permission to call the API from the browser.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  return next();
});

app.use("/auth", authRoutes);
app.use("/pipelines", pipelineRoutes);
app.use("/projects", projectRoutes);
app.use("/users", userRoutes);
app.use("/developers", developerRoutes);
app.use("/reports", reportRoutes);
app.use("/settings", settingsRoutes);

app.get("/ping", (req, res) => res.json({ ok: true }));

app.get("/protected", requireAuth, (req, res) => {
  res.json({ userId: req.userId });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "internal server error" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`YoJan backend listening on http://localhost:${PORT}`);
});
