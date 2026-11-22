import { afterAll } from "bun:test";

import { mastra } from "./mastra/index.ts";

// One Mastra and one database pool for the whole run, closed once at the end.
afterAll(() => mastra.shutdown());
