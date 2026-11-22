import { PostgresStore } from "@mastra/pg";

import { env } from "./env.ts";

// Mastra keeps its own tables in the "mastra" schema, apart from Stag Hunt's.
export const storage = new PostgresStore({
  id: "stag-hunt",
  connectionString: env.DATABASE_URL,
  schemaName: "mastra",
});
