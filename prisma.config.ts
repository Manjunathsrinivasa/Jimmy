import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "backend/prisma/schema.prisma",
  migrations: {
    path: "backend/prisma/migrations",
    seed: "node backend/prisma/seed.js",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
