import { sql } from "drizzle-orm";
import { config } from "dotenv";
import { createDatabase } from "@/db/client";

config({ path: ".env.local" });
config({ path: ".env" });

interface RuntimeVerificationRow extends Record<string, unknown> {
  currentUser: string;
  defaultReadOnly: string;
  canInsertInventory: boolean;
  locationCount: number;
}

async function verifyRuntimeRole() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required to verify the runtime role");

  const db = createDatabase(connectionString);
  const result = await db.execute<RuntimeVerificationRow>(sql`
    select
      current_user as "currentUser",
      current_setting('default_transaction_read_only') as "defaultReadOnly",
      has_table_privilege(current_user, 'public.inventory_meta', 'INSERT') as "canInsertInventory",
      (select count(*)::int from public.locations) as "locationCount"
  `);
  const row = result.rows[0];

  if (row.currentUser !== "inventory_reader") {
    throw new Error(`Expected inventory_reader, connected as ${row.currentUser}`);
  }
  if (row.defaultReadOnly !== "on") throw new Error("Runtime role is not transaction-read-only");
  if (row.canInsertInventory) throw new Error("Runtime role unexpectedly has INSERT privilege");
  if (row.locationCount !== 8) throw new Error(`Expected 8 locations, found ${row.locationCount}`);

  return row;
}

verifyRuntimeRole()
  .then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const cause =
      error instanceof Error && error.cause instanceof Error ? `\nCause: ${error.cause.message}` : "";
    process.stderr.write(`${message}${cause}\n`);
    process.exitCode = 1;
  });
