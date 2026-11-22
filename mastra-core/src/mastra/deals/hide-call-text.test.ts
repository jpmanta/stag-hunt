import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { Mastra } from "@mastra/core/mastra";
import { SpanType, type SpanOutputProcessor } from "@mastra/core/observability";
import {
  MastraLanguageModelV2Mock,
  simulateReadableStream,
} from "@mastra/core/test-utils/llm-mock";
import { Observability, TestExporter } from "@mastra/observability";

import { draftDeal } from "./draft-deal.ts";
import { dealDrafter } from "./drafter.ts";
import { DEAL_FIELD_NAMES } from "./fields.ts";
import { HideCallText } from "./hide-call-text.ts";

// Made-up markers: if either shows up in an exported event, call text leaked.
const CALL_MARKER = "ZEBRAQUARTZCALL";
const DRAFT_MARKER = "PLUMKITEDRAFT";
const TRANSCRIPT = `${CALL_MARKER} The founder said they sell solar kits to rural clinics and already run three paid pilots with two more planned.`;

const goodAnswer = JSON.stringify(
  Object.fromEntries(
    DEAL_FIELD_NAMES.map((name) => [name, name === "company" ? DRAFT_MARKER : "n/a"]),
  ),
);
const badAnswer = JSON.stringify({ company: DRAFT_MARKER });
let answer = goodAnswer;

const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
const model = new MastraLanguageModelV2Mock({
  doGenerate: async () => ({
    content: [{ type: "text", text: answer }],
    finishReason: "stop",
    usage,
    warnings: [],
  }),
  doStream: async () => ({
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: answer },
        { type: "text-end", id: "t1" },
        { type: "finish", finishReason: "stop", usage },
      ],
    }),
  }),
});

async function traced(processors: SpanOutputProcessor[], work: (mastra: Mastra) => Promise<void>) {
  const exporter = new TestExporter();
  const mastra = new Mastra({
    agents: { dealDrafter },
    workflows: { draftDeal },
    observability: new Observability({
      configs: {
        default: {
          serviceName: "stag-hunt-test",
          exporters: [exporter],
          spanOutputProcessors: processors,
        },
      },
    }),
  });
  try {
    await work(mastra);
    await mastra.observability.getDefaultInstance()?.flush();
    return { exported: JSON.stringify(exporter.events), spans: exporter.getCompletedSpans() };
  } finally {
    await mastra.shutdown();
  }
}

async function runDraftDeal(mastra: Mastra) {
  const run = await mastra.getWorkflow("draftDeal").createRun();
  return run.start({ inputData: { transcript: TRANSCRIPT } });
}

describe("founder call text in traces", () => {
  // Mastra has no public way to swap in a mock model, so these tests use its internal one.
  // oxlint-disable-next-line no-underscore-dangle
  beforeAll(() => dealDrafter.__updateModel({ model }));
  afterAll(() => {
    answer = goodAnswer;
    // oxlint-disable-next-line no-underscore-dangle
    dealDrafter.__resetToOriginalModel();
  });

  test("leaks without the filter, so the checks below can catch a leak", async () => {
    answer = goodAnswer;
    const { exported } = await traced([], async (mastra) => {
      await runDraftDeal(mastra);
    });
    expect(exported).toContain(CALL_MARKER);
    expect(exported).toContain(DRAFT_MARKER);
  });

  test("a draftDeal run exports no transcript or draft text, but keeps timing and usage", async () => {
    answer = goodAnswer;
    let status = "";
    const { exported, spans } = await traced([new HideCallText()], async (mastra) => {
      const result = await runDraftDeal(mastra);
      status = result.status;
      if (result.status === "success") expect(result.result.company).toBe(DRAFT_MARKER);
    });
    expect(status).toBe("success");
    expect(exported).not.toContain(CALL_MARKER);
    expect(exported).not.toContain(DRAFT_MARKER);
    const run = spans.find(
      (span) => span.type === SpanType.WORKFLOW_RUN && span.entityId === "draft-deal",
    );
    expect(run?.endTime).toBeDefined();
    const generation = spans.find((span) => span.type === SpanType.MODEL_GENERATION);
    expect(generation?.attributes).toMatchObject({ usage: { inputTokens: 10, outputTokens: 5 } });
  });

  test("calling the agent directly exports no transcript or draft text", async () => {
    answer = goodAnswer;
    const { exported, spans } = await traced([new HideCallText()], async (mastra) => {
      const reply = await mastra.getAgent("dealDrafter").generate(TRANSCRIPT);
      expect(reply.text).toContain(DRAFT_MARKER);
    });
    expect(exported).not.toContain(CALL_MARKER);
    expect(exported).not.toContain(DRAFT_MARKER);
    expect(spans.find((span) => span.type === SpanType.AGENT_RUN)?.endTime).toBeDefined();
  });

  test("a failed run hides the model's answer in error details too", async () => {
    answer = badAnswer;
    let status = "";
    const { exported, spans } = await traced([new HideCallText()], async (mastra) => {
      status = (await runDraftDeal(mastra)).status;
    });
    expect(status).toBe("failed");
    expect(exported).not.toContain(CALL_MARKER);
    expect(exported).not.toContain(DRAFT_MARKER);
    expect(spans.some((span) => span.errorInfo?.message === "[hidden]")).toBe(true);
  });
});
