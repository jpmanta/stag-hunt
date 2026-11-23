import { afterAll } from "bun:test";

import { checksSettled } from "./mastra/deals/answer-check.ts";
import { mastra } from "./mastra/index.ts";

// One Mastra and one database pool for the whole run, closed once at the end,
// after any answer checks still running in the background.
afterAll(async () => {
  await checksSettled();
  await mastra.shutdown();
});
