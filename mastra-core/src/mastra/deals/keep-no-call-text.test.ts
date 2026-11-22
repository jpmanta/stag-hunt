import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  MastraLanguageModelV2Mock,
  simulateReadableStream,
} from "@mastra/core/test-utils/llm-mock";

import { mastra } from "../index.ts";
import { storage } from "../storage.ts";
import { dealDrafter } from "./drafter.ts";
import { DEAL_FIELD_NAMES } from "./fields.ts";

// Made-up markers, new each test run, so rows left by earlier runs can't hide or fake a leak.
const CALL_MARKER = `ZEBRAQUARTZCALL${crypto.randomUUID().replaceAll("-", "")}`;
const DRAFT_MARKER = `PLUMKITEDRAFT${crypto.randomUUID().replaceAll("-", "")}`;
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

async function runDraftDeal() {
  const run = await mastra.getWorkflow("draftDeal").createRun();
  const result = await run.start({ inputData: { transcript: TRANSCRIPT } });
  return { runId: run.runId, result };
}

describe("founder call text in storage", () => {
  // Mastra has no public way to swap in a mock model, so these tests use its internal one.
  // oxlint-disable-next-line no-underscore-dangle
  beforeAll(() => dealDrafter.__updateModel({ model }));
  afterAll(() => {
    answer = goodAnswer;
    // oxlint-disable-next-line no-underscore-dangle
    dealDrafter.__resetToOriginalModel();
  });

  test("a finished draft is returned but leaves no call text in storage", async () => {
    answer = goodAnswer;
    const { runId, result } = await runDraftDeal();
    expect(result.status).toBe("success");
    if (result.status === "success") expect(result.result.company).toBe(DRAFT_MARKER);
    expect(await storedCallText()).toEqual([]);
    expect(await mastra.getWorkflow("draftDeal").getWorkflowRunById(runId)).toBeNull();
  });

  test("a failed draft leaves no call text in storage", async () => {
    answer = badAnswer;
    const { runId, result } = await runDraftDeal();
    expect(result.status).toBe("failed");
    expect(await storedCallText()).toEqual([]);
    expect(await mastra.getWorkflow("draftDeal").getWorkflowRunById(runId)).toBeNull();
  });
});
