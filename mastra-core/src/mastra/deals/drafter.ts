import { Agent } from "@mastra/core/agent";

import { DRAFTING_RULES } from "./fields.ts";

// Reads a founder call and writes down only what was said. It never scores or judges.
export const dealDrafter = new Agent({
  id: "deal-drafter",
  name: "Deal drafter",
  description:
    "Drafts a deal from the transcript of an investor's call with a founder, using only what was said.",
  instructions: DRAFTING_RULES,
  model: "mastra/anthropic/claude-sonnet-5-5",
});
