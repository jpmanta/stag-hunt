import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { Mastra } from "@mastra/core/mastra";
import {
  MastraLanguageModelV2Mock,
  simulateReadableStream,
} from "@mastra/core/test-utils/llm-mock";
import { Observability, TestExporter } from "@mastra/observability";

import { answerCheck, answerChecker, checksSettled } from "./answer-check.ts";
import { draftDeal } from "./draft-deal.ts";
import { dealDrafter } from "./drafter.ts";
import { DEAL_FIELD_NAMES } from "./fields.ts";
import { HideCallText } from "./hide-call-text.ts";

// An invented call. The founder never gives a user count, so a "traction" answer is made up.
const TRANSCRIPT =
  "Founder: We are Sunbox. We sell solar kits to rural clinics and run three paid pilots, with two more planned this spring.";

const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
function mockModel(reply: () => string) {
  return new MastraLanguageModelV2Mock({
    doGenerate: async () => ({
      content: [{ type: "text", text: reply() }],
      finishReason: "stop",
      usage,
      warnings: [],
    }),
    doStream: async () => {
      const text = reply();
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: text },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: "stop", usage },
          ],
        }),
      };
    },
  });
}

let draft: Record<string, string> = {};
let flagged: string[] = [];
let checkerFails = false;

const drafterModel = mockModel(() =>
  JSON.stringify(Object.fromEntries(DEAL_FIELD_NAMES.map((name) => [name, draft[name] ?? "n/a"]))),
);
const checkerModel = mockModel(() => {
  if (checkerFails) throw new Error(`checker broke on ${TRANSCRIPT}`);
  return JSON.stringify({ flagged });
});

async function draftAndCheck() {
  const exporter = new TestExporter();
  const mastra = new Mastra({
    agents: { dealDrafter, answerChecker },
    workflows: { draftDeal },
    scorers: { answerCheck },
    observability: new Observability({
      configs: {
        default: {
          serviceName: "stag-hunt-test",
          exporters: [exporter],
          spanOutputProcessors: [new HideCallText()],
        },
      },
    }),
  });
  try {
    const run = await mastra.getWorkflow("draftDeal").createRun();
    const result = await run.start({ inputData: { transcript: TRANSCRIPT } });
    await checksSettled();
    await mastra.observability.getDefaultInstance()?.flush();
    return {
      result: result.status === "success" ? result.result : result.status,
      scores: exporter.getAllScores(),
      exported: JSON.stringify([exporter.events, exporter.getScoreEvents()]),
    };
  } finally {
    await mastra.shutdown();
  }
}

describe("answer check", () => {
  // Mastra has no public way to swap in a mock model, so these tests use its internal one.
  beforeAll(() => {
    // oxlint-disable-next-line no-underscore-dangle
    dealDrafter.__updateModel({ model: drafterModel });
    // oxlint-disable-next-line no-underscore-dangle
    answerChecker.__updateModel({ model: checkerModel });
  });
  afterAll(() => {
    // oxlint-disable-next-line no-underscore-dangle
    dealDrafter.__resetToOriginalModel();
    // oxlint-disable-next-line no-underscore-dangle
    answerChecker.__resetToOriginalModel();
    checkerFails = false;
  });

  test("an invented answer is flagged by field name, and the draft comes back unchanged", async () => {
    draft = { company: "Sunbox", traction: "Ten thousand paying users" };
    flagged = ["traction"];
    checkerFails = false;
    const { result, scores } = await draftAndCheck();
    expect(result).toEqual(draft);
    expect(scores).toHaveLength(1);
    expect(scores[0]).toMatchObject({
      scorerId: "answer-check",
      score: 0.5,
      metadata: { flaggedFields: ["traction"], workflowId: "draft-deal", agentId: "deal-drafter" },
    });
  });

  test("a faithful draft has no flags and a full score", async () => {
    draft = { company: "Sunbox", traction: "Three paid pilots, two more planned" };
    flagged = [];
    checkerFails = false;
    const { scores } = await draftAndCheck();
    expect(scores).toHaveLength(1);
    expect(scores[0]).toMatchObject({ score: 1, metadata: { flaggedFields: [] } });
  });

  test("only filled field names are kept from the checker's reply", async () => {
    draft = { company: "Sunbox", traction: "Ten thousand paying users" };
    flagged = ["traction", "sector", "Sunbox is a weak team", ""];
    checkerFails = false;
    const { scores } = await draftAndCheck();
    expect(scores[0]).toMatchObject({ score: 0.5, metadata: { flaggedFields: ["traction"] } });
  });

  test("a failed check leaves the draft as it was and records no score", async () => {
    draft = { company: "Sunbox", traction: "Ten thousand paying users" };
    checkerFails = true;
    const { result, scores, exported } = await draftAndCheck();
    expect(result).toEqual(draft);
    expect(scores).toEqual([]);
    expect(exported).not.toContain("checker broke");
    expect(exported).not.toContain("solar kits");
  });

  test("the kept score holds only the score, flagged field names, ids and time", async () => {
    draft = { company: "Sunbox", traction: "Ten thousand paying users" };
    flagged = ["traction"];
    checkerFails = false;
    const { scores, exported } = await draftAndCheck();
    const kept = Object.fromEntries(
      Object.entries(scores[0] ?? {}).filter(([, value]) => value !== undefined),
    );
    expect(Object.keys(kept).toSorted()).toEqual(
      [
        "metadata",
        "score",
        "scoreId",
        "scoreSource",
        "scorerId",
        "scorerName",
        "timestamp",
        "traceId",
      ].toSorted(),
    );
    expect(Object.keys(kept.metadata ?? {}).toSorted()).toEqual(
      ["agentId", "flaggedFields", "workflowId"].toSorted(),
    );
    for (const text of ["solar kits", "Sunbox", "Ten thousand", "checker broke"]) {
      expect(exported).not.toContain(text);
    }
  });
});
