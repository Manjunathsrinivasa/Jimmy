// Seed script — demo workspace for YoJan.
//
// Creates:
//   1. An organization named "Demo Org"
//   2. An admin user admin@flowpm.dev / demo1234 (hashed with bcrypt,
//      same as POST /auth/register)
//   3. A published pipeline "Leapfrog" whose graph is:
//      Project Initiation (fields: start date, end date, document upload,
//      approver, cost) -> Project Approval -> Project Demonstration ->
//      Developers (parallel fork, 2 branches) -> parallel join -> UAT -> Live
//
// Idempotent: re-running wipes any existing Demo Org data and recreates it.
//
// Run with the project .env loaded:
//   set -a && source .env && set +a && node backend/prisma/seed.js

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const DEMO_ORG = "Demo Org";
const ADMIN_EMAIL = "admin@flowpm.dev";
const ADMIN_PASSWORD = "demo1234";

// Delete every record owned by the org, children first (the schema uses
// ON DELETE RESTRICT everywhere, so Prisma will not cascade).
async function wipeOrg(orgId) {
  const projects = await prisma.project.findMany({
    where: { organizationId: orgId },
    select: { id: true },
  });
  const projectIds = projects.map((p) => p.id);

  if (projectIds.length > 0) {
    const stages = await prisma.projectStage.findMany({
      where: { projectId: { in: projectIds } },
      select: { id: true },
    });
    const stageIds = stages.map((s) => s.id);
    if (stageIds.length > 0) {
      await prisma.comment.deleteMany({ where: { projectStageId: { in: stageIds } } });
      await prisma.fieldValue.deleteMany({ where: { projectStageId: { in: stageIds } } });
    }
    await prisma.projectStage.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.projectDeveloper.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.project.deleteMany({ where: { organizationId: orgId } });
  }

  await prisma.developer.deleteMany({ where: { organizationId: orgId } });

  const pipelines = await prisma.pipeline.findMany({
    where: { organizationId: orgId },
    select: { id: true },
  });
  const pipelineIds = pipelines.map((p) => p.id);

  if (pipelineIds.length > 0) {
    const versions = await prisma.pipelineVersion.findMany({
      where: { pipelineId: { in: pipelineIds } },
      select: { id: true },
    });
    const versionIds = versions.map((v) => v.id);

    if (versionIds.length > 0) {
      const nodes = await prisma.node.findMany({
        where: { pipelineVersionId: { in: versionIds } },
        select: { id: true },
      });
      const nodeIds = nodes.map((n) => n.id);
      if (nodeIds.length > 0) {
        await prisma.fieldDefinition.deleteMany({ where: { nodeId: { in: nodeIds } } });
      }
      await prisma.edge.deleteMany({ where: { pipelineVersionId: { in: versionIds } } });
      await prisma.node.deleteMany({ where: { pipelineVersionId: { in: versionIds } } });
    }
    await prisma.pipelineVersion.deleteMany({ where: { pipelineId: { in: pipelineIds } } });
    await prisma.pipeline.deleteMany({ where: { organizationId: orgId } });
  }

  const reports = await prisma.report.findMany({
    where: { organizationId: orgId },
    select: { id: true },
  });
  const reportIds = reports.map((r) => r.id);
  if (reportIds.length > 0) {
    await prisma.reportViewer.deleteMany({ where: { reportId: { in: reportIds } } });
    await prisma.report.deleteMany({ where: { organizationId: orgId } });
  }

  await prisma.user.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
}

// The Leapfrog graph. Node ids are prefixed with a sequence number so that
// GET /pipelines/:id (which orders nodes by id) returns them in pipeline
// order.
const NODES = [
  {
    key: "lf_01_initiation",
    type: "stage",
    label: "Project Initiation",
    x: 0,
    y: 0,
    fields: [
      { id: "lf_01_f_start", label: "Start Date", fieldType: "date", required: true, order: 1 },
      { id: "lf_01_f_end", label: "End Date", fieldType: "date", required: true, order: 2 },
      { id: "lf_01_f_doc", label: "Document Upload", fieldType: "file", required: false, order: 3 },
      { id: "lf_01_f_approver", label: "Approver", fieldType: "user_picker", required: true, order: 4 },
      { id: "lf_01_f_cost", label: "Cost", fieldType: "currency", required: true, order: 5 },
    ],
  },
  { key: "lf_02_approval", type: "approval", label: "Project Approval", x: 220, y: 0, fields: [] },
  { key: "lf_03_demonstration", type: "stage", label: "Project Demonstration", x: 440, y: 0, fields: [] },
  { key: "lf_04_developers", type: "parallel_fork", label: "Developers", x: 660, y: 0, fields: [] },
  { key: "lf_05_dev_branch_1", type: "stage", label: "Developer 1", x: 880, y: -140, fields: [] },
  { key: "lf_06_dev_branch_2", type: "stage", label: "Developer 2", x: 880, y: 140, fields: [] },
  { key: "lf_07_join", type: "parallel_join", label: "Parallel Join", x: 1100, y: 0, fields: [] },
  { key: "lf_08_uat", type: "stage", label: "UAT", x: 1320, y: 0, fields: [] },
  { key: "lf_09_live", type: "end", label: "Live", x: 1540, y: 0, fields: [] },
];

const EDGES = [
  { id: "lf_e01", source: "lf_01_initiation", target: "lf_02_approval" },
  { id: "lf_e02", source: "lf_02_approval", target: "lf_03_demonstration" },
  { id: "lf_e03", source: "lf_03_demonstration", target: "lf_04_developers" },
  { id: "lf_e04", source: "lf_04_developers", target: "lf_05_dev_branch_1" },
  { id: "lf_e05", source: "lf_04_developers", target: "lf_06_dev_branch_2" },
  { id: "lf_e06", source: "lf_05_dev_branch_1", target: "lf_07_join" },
  { id: "lf_e07", source: "lf_06_dev_branch_2", target: "lf_07_join" },
  { id: "lf_e08", source: "lf_07_join", target: "lf_08_uat" },
  { id: "lf_e09", source: "lf_08_uat", target: "lf_09_live" },
];

async function main() {
  const existing = await prisma.organization.findFirst({ where: { name: DEMO_ORG } });
  if (existing) {
    await wipeOrg(existing.id);
    console.log(`Cleaned up existing "${DEMO_ORG}"`);
  }

  const org = await prisma.organization.create({ data: { name: DEMO_ORG } });

  // Hashed the same way as POST /auth/register (bcrypt, cost 10). Remove any
  // user with this email first (even in a different org) so a partial previous
  // state cannot abort the seed with a unique-constraint error.
  await prisma.user.deleteMany({ where: { email: ADMIN_EMAIL } });
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  await prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      passwordHash,
      role: "admin",
      tier: "free",
      organizationId: org.id,
    },
  });

  // Draft version 1 with the authored graph.
  const pipeline = await prisma.pipeline.create({
    data: {
      name: "Leapfrog",
      organizationId: org.id,
      status: "draft",
      versions: {
        create: {
          versionNumber: 1,
          nodes: {
            create: NODES.map((n) => ({
              id: n.key,
              type: n.type,
              label: n.label,
              positionX: n.x,
              positionY: n.y,
              fields: {
                create: n.fields.map((f) => ({
                  id: f.id,
                  label: f.label,
                  fieldType: f.fieldType,
                  required: f.required,
                  order: f.order,
                })),
              },
            })),
          },
          edges: {
            create: EDGES.map((e) => ({
              id: e.id,
              sourceNodeId: e.source,
              targetNodeId: e.target,
            })),
          },
        },
      },
    },
  });

  // Publish: snapshot the graph as version 2 with fresh ids and mark the
  // pipeline published (mirrors POST /pipelines/:id/publish).
  const snapshot = await prisma.pipelineVersion.create({
    data: { pipelineId: pipeline.id, versionNumber: 2 },
  });

  const nodeIdMap = {};
  const snapshotNodes = NODES.map((n, i) => {
    const suffix = n.key.replace(/^lf_\d+_/, "");
    const nodeId = `lf2_${String(i + 1).padStart(2, "0")}_${suffix}`;
    nodeIdMap[n.key] = nodeId;
    return {
      id: nodeId,
      type: n.type,
      label: n.label,
      positionX: n.x,
      positionY: n.y,
      fields: n.fields.map((f, fi) => ({
        id: `lf2_f_${i + 1}_${fi + 1}`,
        label: f.label,
        fieldType: f.fieldType,
        required: f.required,
        order: f.order,
      })),
    };
  });

  await prisma.node.createMany({
    data: snapshotNodes.map((n) => ({
      id: n.id,
      pipelineVersionId: snapshot.id,
      type: n.type,
      label: n.label,
      positionX: n.positionX,
      positionY: n.positionY,
    })),
  });

  for (const n of snapshotNodes) {
    if (n.fields.length > 0) {
      await prisma.fieldDefinition.createMany({
        data: n.fields.map((f) => ({
          id: f.id,
          nodeId: n.id,
          label: f.label,
          fieldType: f.fieldType,
          required: f.required,
          order: f.order,
        })),
      });
    }
  }

  await prisma.edge.createMany({
    data: EDGES.map((e, i) => ({
      id: `lf2_e_${String(i + 1).padStart(2, "0")}`,
      pipelineVersionId: snapshot.id,
      sourceNodeId: nodeIdMap[e.source],
      targetNodeId: nodeIdMap[e.target],
    })),
  });

  await prisma.pipeline.update({
    where: { id: pipeline.id },
    data: { status: "published" },
  });

  console.log("Seed complete:");
  console.log(`  Org:        ${org.name} (${org.id})`);
  console.log(`  Admin:      ${ADMIN_EMAIL} / ${ADMIN_PASSWORD} (role: admin, tier: free)`);
  console.log(`  Pipeline:   Leapfrog (published, v1 draft + v2 snapshot)`);
  console.log(`  Graph:      ${NODES.length} nodes, ${EDGES.length} edges, 5 fields on Project Initiation`);
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
