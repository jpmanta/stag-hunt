import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { Mastra } from "@mastra/core/mastra";
import { SpanType, type SpanOutputProcessor } from "@mastra/core/observability";
import {
  MastraLanguageModelV2Mock,
  simulateReadableStream,
} from "@mastra/core/test-utils/llm-mock";
import { Observability, TestExporter } from "@mastra/observability";

import { applicationDrafter } from "./application-drafter.ts";
import { draftApplication } from "./draft-application.ts";
import { draftDeal } from "./draft-deal.ts";
import { dealDrafter } from "./drafter.ts";
import { APPLICATION_FIELD_NAMES, DEAL_FIELD_NAMES } from "./fields.ts";
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
    agents: { dealDrafter, applicationDrafter },
    workflows: { draftDeal, draftApplication },
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
  });
  afterAll(() => {
    // oxlint-disable-next-line no-underscore-dangle
    dealDrafter.__resetToOriginalModel();
    // oxlint-disable-next-line no-underscore-dangle
    applicationDrafter.__resetToOriginalModel();
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
    const { exported, spans } = await traced([new HideCallText()], async (mastra) => {
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
