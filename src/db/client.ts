import { drizzle } from "drizzle-orm/neon-http";
import { neonConfig } from "@neondatabase/serverless";
import * as schema from "@/db/schema";

// Cell-based Neon hosts (for example, hosts containing `.c-3.`) are already
// valid HTTPS SQL endpoints. The driver's generic hostname rewrite drops the
// compute prefix and currently resolves to a non-existent regional API host.
neonConfig.fetchEndpoint = (host) => `https://${host}/sql`;

export function createDatabase(connectionString: string) {
  return drizzle(connectionString, { schema });
}

let runtimeDatabase: ReturnType<typeof createDatabase> | undefined;

export function getRuntimeDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for inventory access");
  }

  runtimeDatabase ??= createDatabase(connectionString);
  return runtimeDatabase;
}
