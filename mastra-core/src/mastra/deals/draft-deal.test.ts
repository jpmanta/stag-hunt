import { describe, expect, it } from "bun:test";

import { draftDeal } from "./draft-deal.ts";
import { cleanAnswers } from "./draft-workflow.ts";
import { DEAL_FIELDS } from "./fields.ts";

describe("cleanAnswers", () => {
  it("keeps what was said and trims it", () => {
    expect(cleanAnswers({ company: "  Acme Grid  ", sector: "climate" }, DEAL_FIELDS)).toEqual({
      company: "Acme Grid",
      sector: "climate",
    });
  });

  it("drops empty and not-said answers", () => {
    expect(
      cleanAnswers({ company: "", traction: "n/a", blocker: "Not mentioned." }, DEAL_FIELDS),
    ).toEqual({});
  });

  it("keeps only known round types", () => {
    expect(cleanAnswers({ round_type: "SAFE" }, DEAL_FIELDS)).toEqual({ round_type: "SAFE" });
    expect(cleanAnswers({ round_type: "Series Z" }, DEAL_FIELDS)).toEqual({});
  });

  it("cuts each answer to its longest length", () => {
    expect(cleanAnswers({ company: "x".repeat(200) }, DEAL_FIELDS).company).toHaveLength(80);
  });
});

describe("draftDeal", () => {
  it("refuses a transcript too short to draft from", async () => {
    const run = await draftDeal.createRun();
    const result = await run.start({ inputData: { transcript: "hello there" } });
    expect(result.status).toBe("failed");
  });
});
