import { describe, expect, it } from "bun:test";

import { mastra } from "./index.ts";
import { seedKnowledge } from "./knowledge.ts";

describe("mastra", () => {
  it("stores its data in the mastra schema of Postgres", async () => {
    await mastra.getStorage()?.init();
  });

  it("registers the deal drafter and its workflow", () => {
    expect(mastra.getAgent("dealDrafter").id).toBe("deal-drafter");
    expect(mastra.getWorkflow("draftDeal").id).toBe("draft-deal");
  });

  it("seeds the public rules into Knowledge, twice without changes", async () => {
    const first = await seedKnowledge();
    expect(first.find((r) => r.page.key === "principles")?.page.body).toContain("I16");
    const again = await seedKnowledge();
    expect(again.map((r) => r.status)).toEqual(["unchanged", "unchanged"]);
  });

  it("answers the health check without a token", () => {
    const route = mastra.getServer()?.apiRoutes?.find((r) => r.path === "/health");
    expect(route?.requiresAuth).toBe(false);
  });
});
