import { describe, expect, it } from "bun:test";

import { cleanAnswers } from "./draft-workflow.ts";
import {
  DEAL_FIELD_NAMES,
  DRAFTING_RULES,
  FILL_FIELD_NAMES,
  FILL_FIELDS,
  FILL_RULES,
} from "./fields.ts";
import { fillDeal } from "./fill-deal.ts";

const INVESTOR_RULE =
  "- The investor is the person who recorded the call. For how_found and disclosure, use what either person said about how they know each other.";

describe("FILL_FIELDS", () => {
  it("are the investor's own side first, then the deal fields", () => {
    expect(FILL_FIELD_NAMES).toEqual(["how_found", "disclosure", ...DEAL_FIELD_NAMES]);
    expect(FILL_FIELDS.how_found.max).toBe(1000);
    expect(FILL_FIELDS.disclosure.max).toBe(600);
  });
});

describe("FILL_RULES", () => {
  it("are the drafting rules plus who recorded the call", () => {
    const [rulesPart] = FILL_RULES.split("\nFields:");
    expect(rulesPart).toBe(`${DRAFTING_RULES.split("\nFields:")[0]}\n${INVESTOR_RULE}`);
    expect(FILL_RULES.split(INVESTOR_RULE)).toHaveLength(2);
    expect(FILL_RULES).toContain("\n- how_found: How the investor came to know");
  });

  it("leave the deal drafter's rules unchanged", () => {
    expect(DRAFTING_RULES).not.toContain(INVESTOR_RULE);
    expect(DRAFTING_RULES).toContain(
      "- Keep each answer to one or two short sentences.\nFields:\n- company: ",
    );
  });
});

describe("cleanAnswers for a fill", () => {
  it("keeps how the investor found the company and any connection", () => {
    expect(
      cleanAnswers(
        {
          how_found: " Through a former coworker's introduction. ",
          disclosure: "Friend of the founder.",
          traction: "n/a",
        },
        FILL_FIELDS,
      ),
    ).toEqual({
      how_found: "Through a former coworker's introduction.",
      disclosure: "Friend of the founder.",
    });
  });

  it("cuts each answer to its longest length", () => {
    expect(cleanAnswers({ how_found: "x".repeat(1500) }, FILL_FIELDS).how_found).toHaveLength(1000);
  });
});

describe("fillDeal", () => {
  it("refuses a transcript too short to fill from", async () => {
    const run = await fillDeal.createRun();
    const result = await run.start({ inputData: { transcript: "hello there" } });
    expect(result.status).toBe("failed");
  });
});
