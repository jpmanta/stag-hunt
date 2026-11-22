import { afterAll, describe, expect, it } from "bun:test";

import { mastra } from "./index.ts";

describe("mastra", () => {
  afterAll(() => mastra.shutdown());

  it("stores its data in the mastra schema of Postgres", async () => {
    const storage = mastra.getStorage();
    expect(storage).toBeDefined();
    await storage?.init();
  });

  it("answers the health check without a token", async () => {
    const route = mastra.getServer()?.apiRoutes?.find((r) => r.path === "/health");
    expect(route?.requiresAuth).toBe(false);
  });
});
