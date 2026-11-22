import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

import { dealDrafter } from "./drafter.ts";
import { DEAL_FIELD_NAMES, DEAL_FIELDS, ROUND_TYPES, type DealField } from "./fields.ts";

const MIN_TRANSCRIPT = 80;
const MAX_TRANSCRIPT = 60_000; // about 24k tokens, as on the live site

const modelAnswers = z.object(
  Object.fromEntries(DEAL_FIELD_NAMES.map((name) => [name, z.string()])),
);
const dealDraft = modelAnswers.partial();
export type DealDraft = Partial<Record<DealField, string>>;

const NOT_SAID = /^(n\/?a|none|unknown|not (mentioned|stated|said|discussed|specified)|empty)\.?$/i;

// Keeps only real answers: drops "n/a" and the like, unknown round types, and trims to length.
export function cleanDraft(raw: Partial<Record<DealField, unknown>>): DealDraft {
  const draft: DealDraft = {};
  for (const name of DEAL_FIELD_NAMES) {
    const value = typeof raw[name] === "string" ? raw[name].trim() : "";
    if (!value || NOT_SAID.test(value)) continue;
    if (name === "round_type" && !(ROUND_TYPES as readonly string[]).includes(value)) continue;
    draft[name] = value.slice(0, DEAL_FIELDS[name].max);
  }
  return draft;
}

const readTranscript = createStep({
  id: "read-transcript",
  description: "Tidies the transcript and checks there is enough of it to draft from.",
  inputSchema: z.object({ transcript: z.string() }),
  outputSchema: z.object({ prompt: z.string() }),
  execute: async ({ inputData }) => {
    const transcript = inputData.transcript.replaceAll(/\s+/g, " ").trim();
    if (transcript.length < MIN_TRANSCRIPT) {
      throw new Error("Not enough of the conversation to draft anything.");
    }
    return { prompt: `Transcript:\n${transcript.slice(0, MAX_TRANSCRIPT)}` };
  },
});

const draft = createStep(dealDrafter, { structuredOutput: { schema: modelAnswers } });

const keepWhatWasSaid = createStep({
  id: "keep-what-was-said",
  description: "Drops empty or made-up answers and trims each to its length.",
  inputSchema: modelAnswers,
  outputSchema: dealDraft,
  execute: async ({ inputData }) => cleanDraft(inputData),
});

export const draftDeal = createWorkflow({
  id: "draft-deal",
  description: "Turns the transcript of a founder call into a draft deal for the member to check.",
  inputSchema: z.object({ transcript: z.string() }),
  outputSchema: dealDraft,
  // Call transcripts and drafts are private member data: never store a run snapshot,
  // whether the run succeeds or fails. The caller gets the draft back from the run itself.
  options: { shouldPersistSnapshot: () => false },
})
  .then(readTranscript)
  .then(draft)
  .then(keepWhatWasSaid)
  .commit();
