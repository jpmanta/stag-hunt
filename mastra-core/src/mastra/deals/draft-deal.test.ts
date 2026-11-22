import { describe, expect, it } from "bun:test";

import { cleanDraft, draftDeal } from "./draft-deal.ts";

describe("cleanDraft", () => {
  it("keeps what was said and trims it", () => {
    expect(cleanDraft({ company: "  Acme Grid  ", sector: "climate" })).toEqual({
      company: "Acme Grid",
      sector: "climate",
    });
  });

  it("drops empty and not-said answers", () => {
    expect(cleanDraft({ company: "", traction: "n/a", blocker: "Not mentioned." })).toEqual({});
  });

  it("keeps only known round types", () => {
    expect(cleanDraft({ round_type: "SAFE" })).toEqual({ round_type: "SAFE" });
    expect(cleanDraft({ round_type: "Series Z" })).toEqual({});
  });

  it("cuts each answer to its longest length", () => {
    expect(cleanDraft({ company: "x".repeat(200) }).company).toHaveLength(80);
  });
});

describe("draftDeal", () => {
  it("refuses a transcript too short to draft from", async () => {
    const run = await draftDeal.createRun();
    const result = await run.start({ inputData: { transcript: "hello there" } });
    expect(result.status).toBe("failed");
  });
});
