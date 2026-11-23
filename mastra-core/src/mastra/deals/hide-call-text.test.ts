import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { Mastra } from "@mastra/core/mastra";
import { SpanType, type SpanOutputProcessor } from "@mastra/core/observability";
import {
  MastraLanguageModelV2Mock,
  simulateReadableStream,
} from "@mastra/core/test-utils/llm-mock";
import { Observability, TestExporter } from "@mastra/observability";

import { answerCheck, answerChecker, checksSettled } from "./answer-check.ts";
import { applicationDrafter } from "./application-drafter.ts";
import { dealFiller } from "./deal-filler.ts";
import { draftApplication } from "./draft-application.ts";
import { draftDeal } from "./draft-deal.ts";
import { dealDrafter } from "./drafter.ts";
import { APPLICATION_FIELD_NAMES, DEAL_FIELD_NAMES, FILL_FIELD_NAMES } from "./fields.ts";
import { fillDeal } from "./fill-deal.ts";
import { HideCallText } from "./hide-call-text.ts";

// Made-up markers: if either shows up in an exported event, founder text leaked.
const CALL_MARKER = "ZEBRAQUARTZCALL";
const DRAFT_MARKER = "PLUMKITEDRAFT";

// Every drafting flow, with an invented conversation and the field the model's marker goes in.
const FLOWS = [
  {
    workflow: "draftDeal",
    workflowId: "draft-deal",
    agent: "dealDrafter",
    fields: DEAL_FIELD_NAMES,
    markerField: "company",
    transcript: `${CALL_MARKER} The founder said they sell solar kits to rural clinics and already run three paid pilots with two more planned.`,
  },
  {
    workflow: "draftApplication",
    workflowId: "draft-application",
    agent: "applicationDrafter",
    fields: APPLICATION_FIELD_NAMES,
    markerField: "founder_name",
    transcript: `Interviewer: What are you building?\nFounder: ${CALL_MARKER} We sell solar kits to rural clinics.\nInterviewer: Any customers yet?\nFounder: Three paid pilots, with two more planned.`,
  },
  {
    workflow: "fillDeal",
    workflowId: "fill-deal",
    agent: "dealFiller",
    fields: FILL_FIELD_NAMES,
    markerField: "how_found",
    transcript: `Investor: We met through a friend from my old job.\nFounder: ${CALL_MARKER} Right, and we sell solar kits to rural clinics with three paid pilots.`,
  },
] as const;
type Flow = (typeof FLOWS)[number];

const goodAnswer = (flow: Flow) =>
  JSON.stringify(
    Object.fromEntries(
      flow.fields.map((name) => [name, name === flow.markerField ? DRAFT_MARKER : "n/a"]),
    ),
  );
const badAnswer = (flow: Flow) => JSON.stringify({ [flow.markerField]: DRAFT_MARKER });
let answer = "";
let checkerAnswer = "";

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

// The answer checker flags the marker field, so its reply names a field but holds no founder text.
const checkerModel = new MastraLanguageModelV2Mock({
  doGenerate: async () => ({
    content: [{ type: "text", text: checkerAnswer }],
    finishReason: "stop",
    usage,
    warnings: [],
  }),
});

async function traced(processors: SpanOutputProcessor[], work: (mastra: Mastra) => Promise<void>) {
  const exporter = new TestExporter();
  const mastra = new Mastra({
    agents: { dealDrafter, applicationDrafter, dealFiller, answerChecker },
    workflows: { draftDeal, draftApplication, fillDeal },
    scorers: { answerCheck },
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
    await checksSettled();
    await mastra.observability.getDefaultInstance()?.flush();
    return {
      exported: JSON.stringify([exporter.events, exporter.getScoreEvents()]),
      spans: exporter.getCompletedSpans(),
      scores: exporter.getAllScores(),
    };
  } finally {
    await mastra.shutdown();
  }
}

async function runDraft(mastra: Mastra, flow: Flow) {
  const run = await mastra.getWorkflow(flow.workflow).createRun();
  return run.start({ inputData: { transcript: flow.transcript } });
}

describe.each(FLOWS)("founder text in traces: $workflow", (flow) => {
  // Mastra has no public way to swap in a mock model, so these tests use its internal one.
  beforeAll(() => {
    // oxlint-disable-next-line no-underscore-dangle
    dealDrafter.__updateModel({ model });
    // oxlint-disable-next-line no-underscore-dangle
    applicationDrafter.__updateModel({ model });
    // oxlint-disable-next-line no-underscore-dangle
    dealFiller.__updateModel({ model });
    // oxlint-disable-next-line no-underscore-dangle
    answerChecker.__updateModel({ model: checkerModel });
    checkerAnswer = JSON.stringify({ flagged: [flow.markerField] });
  });
  afterAll(() => {
    // oxlint-disable-next-line no-underscore-dangle
    dealDrafter.__resetToOriginalModel();
    // oxlint-disable-next-line no-underscore-dangle
    applicationDrafter.__resetToOriginalModel();
    // oxlint-disable-next-line no-underscore-dangle
    dealFiller.__resetToOriginalModel();
    // oxlint-disable-next-line no-underscore-dangle
    answerChecker.__resetToOriginalModel();
  });

  test("leaks without the filter, so the checks below can catch a leak", async () => {
    answer = goodAnswer(flow);
    const { exported } = await traced([], async (mastra) => {
      await runDraft(mastra, flow);
    });
    expect(exported).toContain(CALL_MARKER);
    expect(exported).toContain(DRAFT_MARKER);
  });

  test("a run exports no transcript or draft text, but keeps timing and usage", async () => {
    answer = goodAnswer(flow);
    let status = "";
    const { exported, spans, scores } = await traced([new HideCallText()], async (mastra) => {
      const result = await runDraft(mastra, flow);
      status = result.status;
      if (result.status === "success") {
        expect(result.result).toMatchObject({ [flow.markerField]: DRAFT_MARKER });
      }
    });
    expect(status).toBe("success");
    expect(exported).not.toContain(CALL_MARKER);
    expect(exported).not.toContain(DRAFT_MARKER);
    const run = spans.find(
      (span) => span.type === SpanType.WORKFLOW_RUN && span.entityId === flow.workflowId,
    );
    expect(run?.endTime).toBeDefined();
    const generation = spans.find((span) => span.type === SpanType.MODEL_GENERATION);
    expect(generation?.attributes).toMatchObject({ usage: { inputTokens: 10, outputTokens: 5 } });
    // The answer check ran, its own spans and model call included, and kept only field names.
    expect(spans.some((span) => span.type === SpanType.SCORER_RUN)).toBe(true);
    expect(spans.some((span) => span.entityId === "answer-checker")).toBe(true);
    expect(scores).toMatchObject([
      { scorerId: "answer-check", score: 0, metadata: { flaggedFields: [flow.markerField] } },
    ]);
  });

  test("calling the agent directly exports no transcript or draft text", async () => {
    answer = goodAnswer(flow);
    const { exported, spans } = await traced([new HideCallText()], async (mastra) => {
      const reply = await mastra.getAgent(flow.agent).generate(flow.transcript);
      expect(reply.text).toContain(DRAFT_MARKER);
    });
    expect(exported).not.toContain(CALL_MARKER);
    expect(exported).not.toContain(DRAFT_MARKER);
    expect(spans.find((span) => span.type === SpanType.AGENT_RUN)?.endTime).toBeDefined();
  });

  test("a failed run hides the model's answer in error details too", async () => {
    answer = badAnswer(flow);
    let status = "";
    const { exported, spans } = await traced([new HideCallText()], async (mastra) => {
      status = (await runDraft(mastra, flow)).status;
    });
    expect(status).toBe("failed");
    expect(exported).not.toContain(CALL_MARKER);
    expect(exported).not.toContain(DRAFT_MARKER);
    expect(spans.some((span) => span.errorInfo?.message === "[hidden]")).toBe(true);
  });
});
