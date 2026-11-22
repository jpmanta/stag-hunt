import { Agent } from "@mastra/core/agent";

import { FILL_RULES } from "./fields.ts";

// Reads a recorded founder call and fills in the rest of the deal, including the investor's
// own side, from only what was said. It never scores or judges.
export const dealFiller = new Agent({
  id: "deal-filler",
  name: "Deal filler",
  description:
    "Fills the rest of a deal, including how the investor found the company and any connection to it, from the transcript of the investor's call with a founder, using only what was said.",
  instructions: FILL_RULES,
  model: "mastra/anthropic/claude-sonnet-5-5",
});
