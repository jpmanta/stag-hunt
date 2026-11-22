import { Agent } from "@mastra/core/agent";

import { APPLICATION_RULES } from "./fields.ts";

// Reads a founder's AI interview and writes down only what was said. It never scores or judges.
export const applicationDrafter = new Agent({
  id: "application-drafter",
  name: "Application drafter",
  description:
    "Fills a founder's application from their interview with Stag Hunt's AI interviewer, using only what was said.",
  instructions: APPLICATION_RULES,
  model: "mastra/anthropic/claude-sonnet-5-5",
});
