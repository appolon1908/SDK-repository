import { defineConfig } from "prisma/config";

// Client generation needs only the schema. Database commands still require an
// explicit URL; never fall back to an ambient or default database connection.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  ...(process.env.DATABASE_URL ? { datasource: { url: process.env.DATABASE_URL } } : {}),
});
