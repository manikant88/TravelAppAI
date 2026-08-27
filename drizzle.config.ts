import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });
config({ path: ".env" });

const adminUrl = process.env.DATABASE_ADMIN_URL;

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  strict: true,
  verbose: true,
  ...(adminUrl ? { dbCredentials: { url: adminUrl } } : {}),
});
