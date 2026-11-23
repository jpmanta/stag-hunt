import { Mastra } from "@mastra/core/mastra";
import { registerApiRoute, SimpleAuth } from "@mastra/core/server";
import { MastraPlatformExporter, Observability } from "@mastra/observability";
import { KNOWLEDGE_ROUTES, MASTRA_KNOWLEDGE_PRINCIPALS_KEY } from "@mastra/server/server-adapter";

import { answerCheck, answerChecker } from "./deals/answer-check.ts";
import { applicationDrafter } from "./deals/application-drafter.ts";
import { dealFiller } from "./deals/deal-filler.ts";
import { draftApplication } from "./deals/draft-application.ts";
import { draftDeal } from "./deals/draft-deal.ts";
import { dealDrafter } from "./deals/drafter.ts";
import { fillDeal } from "./deals/fill-deal.ts";
import { HideCallText } from "./deals/hide-call-text.ts";
import { env } from "./env.ts";
import { knowledge, ORG, seedKnowledge } from "./knowledge.ts";
import { storage } from "./storage.ts";

type Caller = { id: string };

export const mastra = new Mastra({
  agents: { dealDrafter, applicationDrafter, dealFiller, answerChecker },
  workflows: { draftDeal, draftApplication, fillDeal },
  scorers: { answerCheck },
  knowledge: { stagHunt: knowledge },
  storage,

  // Traces go to the Mastra platform only when it supplies an access token.
  observability: new Observability({
    configs: {
      default: {
        serviceName: "stag-hunt",
        exporters: [new MastraPlatformExporter()],
        spanOutputProcessors: [new HideCallText()],
      },
    },
  }),

  server: {
    // Only callers holding the server token reach the API. Hosted Studio uses
    // the platform's own sign-in, limited to the Stag Hunt organization.
    auth: new SimpleAuth<Caller>({
      tokens: { [env.MASTRA_SERVER_TOKEN]: { id: "stag-hunt-site" } },
    }),
    middleware: [
      {
        // Knowledge holds only public rules, so every signed-in caller may read them.
        path: "/api/knowledge/*",
        handler: async (c, next) => {
          c.get("requestContext").set(MASTRA_KNOWLEDGE_PRINCIPALS_KEY, [ORG]);
          await next();
        },
      },
    ],
    apiRoutes: [
      ...KNOWLEDGE_ROUTES,
      registerApiRoute("/health", {
        method: "GET",
        requiresAuth: false,
        handler: (c) => c.json({ ok: true }),
      }),
    ],
  },
});

if (process.env.NODE_ENV !== "test") {
  seedKnowledge().catch((error: unknown) => {
    mastra.getLogger().error("Could not seed Knowledge", { error });
  });
}
