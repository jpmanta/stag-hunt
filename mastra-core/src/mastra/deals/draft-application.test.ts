import { describe, expect, it } from "bun:test";

import { draftApplication } from "./draft-application.ts";
import { cleanAnswers } from "./draft-workflow.ts";
import { APPLICATION_FIELD_NAMES, APPLICATION_FIELDS, DEAL_FIELD_NAMES } from "./fields.ts";

describe("APPLICATION_FIELDS", () => {
  it("are the deal fields without the discount, plus the founder's own", () => {
    expect(APPLICATION_FIELD_NAMES).toEqual([
      "founder_name",
      "why_you",
      ...DEAL_FIELD_NAMES.filter((name) => name !== "discount"),
      "heard_from",
    ]);
  });
});

describe("cleanAnswers for an application", () => {
  it("keeps the founder's answers and drops fields an application doesn't have", () => {
    expect(
      cleanAnswers(
        {
          founder_name: " Sam Example ",
          why_you: "Ran clinic logistics for six years.",
          heard_from: "A friend.",
          discount: "20%",
          traction: "n/a",
        },
        APPLICATION_FIELDS,
      ),
    ).toEqual({
      founder_name: "Sam Example",
      why_you: "Ran clinic logistics for six years.",
      heard_from: "A friend.",
    });
  });

  it("cuts each answer to its longest length", () => {
    expect(cleanAnswers({ why_you: "x".repeat(900) }, APPLICATION_FIELDS).why_you).toHaveLength(
      600,
    );
  });
});

describe("draftApplication", () => {
  it("refuses a transcript too short to draft from", async () => {
    const run = await draftApplication.createRun();
    const result = await run.start({ inputData: { transcript: "Interviewer: Hi.\nFounder: Hi." } });
    expect(result.status).toBe("failed");
  });
});
