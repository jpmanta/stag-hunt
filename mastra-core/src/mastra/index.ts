import { Mastra } from "@mastra/core/mastra";
import { registerApiRoute, SimpleAuth } from "@mastra/core/server";
import { MastraPlatformExporter, Observability } from "@mastra/observability";
import { PostgresStore } from "@mastra/pg";

import { env } from "./env.ts";

type Caller = { id: string };

export const mastra = new Mastra({
  // Mastra keeps its own tables in the "mastra" schema, apart from Stag Hunt's.
  storage: new PostgresStore({
    id: "stag-hunt",
    connectionString: env.DATABASE_URL,
    schemaName: "mastra",
  }),

  // Traces go to the Mastra platform only when it supplies an access token.
  observability: new Observability({
    configs: {
      default: {
        serviceName: "stag-hunt",
        exporters: [new MastraPlatformExporter()],
      },
    },
  }),

  server: {
    // Only callers holding the server token reach the API. Hosted Studio uses
    // the platform's own sign-in, limited to the Stag Hunt organization.
    auth: new SimpleAuth<Caller>({
      tokens: { [env.MASTRA_SERVER_TOKEN]: { id: "stag-hunt-site" } },
    }),
    apiRoutes: [
      registerApiRoute("/health", {
        method: "GET",
        requiresAuth: false,
        handler: (c) => c.json({ ok: true }),
      }),
    ],
  },
});
