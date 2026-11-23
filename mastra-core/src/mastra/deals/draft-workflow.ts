import type { Agent } from "@mastra/core/agent";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

import { checkAnswers } from "./answer-check.ts";
import { fieldNames, ROUND_TYPES, type Fields } from "./fields.ts";

const MIN_TRANSCRIPT = 80;
const MAX_TRANSCRIPT = 60_000; // about 24k tokens, as on the live site

const NOT_SAID = /^(n\/?a|none|unknown|not (mentioned|stated|said|discussed|specified)|empty)\.?$/i;

// Keeps only real answers: drops "n/a" and the like, unknown round types, and trims to length.
export function cleanAnswers(
  raw: Partial<Record<string, unknown>>,
  fields: Fields,
): Partial<Record<string, string>> {
  const draft: Record<string, string> = {};
  for (const [name, { max }] of Object.entries(fields)) {
    const value = raw[name];
    const answer = typeof value === "string" ? value.trim() : "";
    if (!answer || NOT_SAID.test(answer)) continue;
    if (name === "round_type" && !(ROUND_TYPES as readonly string[]).includes(answer)) continue;
    draft[name] = answer.slice(0, max);
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

// Transcript in, cleaned answers out: the agent fills every field, then only what was said is kept.
export function draftWorkflow(spec: {
  id: string;
  description: string;
  agent: Agent;
  fields: Fields;
}) {
  const modelAnswers = z.object(
    Object.fromEntries(fieldNames(spec.fields).map((name) => [name, z.string()])),
  );
  const draft = modelAnswers.partial();

  return createWorkflow({
    id: spec.id,
    description: spec.description,
    inputSchema: z.object({ transcript: z.string() }),
    outputSchema: draft,
    // Transcripts and drafts are private founder and member data: never store a run snapshot,
    // whether the run succeeds or fails. The caller gets the draft back from the run itself.
    options: { shouldPersistSnapshot: () => false },
  })
    .then(readTranscript)
    .then(createStep(spec.agent, { structuredOutput: { schema: modelAnswers } }))
    .then(
      createStep({
        id: "keep-what-was-said",
        description: "Drops empty or made-up answers and trims each to its length.",
        inputSchema: modelAnswers,
        outputSchema: draft,
        execute: async (context) => {
          const { inputData, mastra, tracingContext } = context;
          const answers = cleanAnswers(inputData, spec.fields);
          // Checked in the background: the draft goes back now, whatever the check does.
          void checkAnswers({
            mastra,
            workflowId: spec.id,
            agentId: spec.agent.id,
            transcript: context.getStepResult(readTranscript).prompt,
            answers,
            traceId: tracingContext?.currentSpan?.traceId,
          });
          return answers;
        },
      }),
    )
    .commit();
}
