import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  MastraLanguageModelV2Mock,
  simulateReadableStream,
} from "@mastra/core/test-utils/llm-mock";

import { mastra } from "../index.ts";
import { storage } from "../storage.ts";
import { applicationDrafter } from "./application-drafter.ts";
import { dealFiller } from "./deal-filler.ts";
import { dealDrafter } from "./drafter.ts";
import { APPLICATION_FIELD_NAMES, DEAL_FIELD_NAMES, FILL_FIELD_NAMES } from "./fields.ts";

// Made-up markers, new each test run, so rows left by earlier runs can't hide or fake a leak.
const CALL_MARKER = `ZEBRAQUARTZCALL${crypto.randomUUID().replaceAll("-", "")}`;
const DRAFT_MARKER = `PLUMKITEDRAFT${crypto.randomUUID().replaceAll("-", "")}`;

// Every drafting flow, with an invented conversation and the field the model's marker goes in.
const FLOWS = [
  {
    workflow: "draftDeal",
    fields: DEAL_FIELD_NAMES,
    markerField: "company",
    transcript: `${CALL_MARKER} The founder said they sell solar kits to rural clinics and already run three paid pilots with two more planned.`,
  },
  {
    workflow: "draftApplication",
    fields: APPLICATION_FIELD_NAMES,
    markerField: "founder_name",
    transcript: `Interviewer: What are you building?\nFounder: ${CALL_MARKER} We sell solar kits to rural clinics.\nInterviewer: Any customers yet?\nFounder: Three paid pilots, with two more planned.`,
  },
  {
    workflow: "fillDeal",
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

// Names every table in the Mastra schema that holds either marker anywhere in a row.
async function storedCallText() {
  const tables = await storage.db.any<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'mastra'",
  );
  const counts = await Promise.all(
    tables.map(async ({ table_name }) => {
      const { n } = await storage.db.one<{ n: number }>(
        `SELECT count(*)::int AS n FROM mastra."${table_name.replaceAll('"', '""')}" t WHERE t::text LIKE $1 OR t::text LIKE $2`,
        [`%${CALL_MARKER}%`, `%${DRAFT_MARKER}%`],
      );
      return { table_name, n };
    }),
  );
  return counts.filter(({ n }) => n > 0).map(({ table_name }) => table_name);
}

async function runDraft(flow: Flow) {
  const run = await mastra.getWorkflow(flow.workflow).createRun();
  const result = await run.start({ inputData: { transcript: flow.transcript } });
  return { runId: run.runId, result };
}

describe.each(FLOWS)("founder text in storage: $workflow", (flow) => {
  // Mastra has no public way to swap in a mock model, so these tests use its internal one.
  beforeAll(() => {
    // oxlint-disable-next-line no-underscore-dangle
    dealDrafter.__updateModel({ model });
    // oxlint-disable-next-line no-underscore-dangle
    applicationDrafter.__updateModel({ model });
    // oxlint-disable-next-line no-underscore-dangle
    dealFiller.__updateModel({ model });
  });
  afterAll(() => {
    // oxlint-disable-next-line no-underscore-dangle
    dealDrafter.__resetToOriginalModel();
    // oxlint-disable-next-line no-underscore-dangle
    applicationDrafter.__resetToOriginalModel();
    // oxlint-disable-next-line no-underscore-dangle
    dealFiller.__resetToOriginalModel();
  });

  test("a finished draft is returned but leaves no founder text in storage", async () => {
    answer = goodAnswer(flow);
    const { runId, result } = await runDraft(flow);
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.result).toMatchObject({ [flow.markerField]: DRAFT_MARKER });
    }
    expect(await storedCallText()).toEqual([]);
    expect(await mastra.getWorkflow(flow.workflow).getWorkflowRunById(runId)).toBeNull();
  });

  test("a failed draft leaves no founder text in storage", async () => {
    answer = badAnswer(flow);
    const { runId, result } = await runDraft(flow);
    expect(result.status).toBe("failed");
    expect(await storedCallText()).toEqual([]);
    expect(await mastra.getWorkflow(flow.workflow).getWorkflowRunById(runId)).toBeNull();
  });
});
