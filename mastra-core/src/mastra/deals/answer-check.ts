import { Agent } from "@mastra/core/agent";
import { createScorer } from "@mastra/core/evals";
import type { Mastra } from "@mastra/core/mastra";
import { z } from "zod";

export const CHECK_RULES = `You check a draft written from a transcript of a conversation.
You get the transcript and the draft's filled answers, each under its field name.
Flag a field when its answer states anything the transcript does not clearly say,
or when it gives an opinion, rating, score or verdict on the company or its founders.
Do not flag an answer only for being shorter or worded differently from what was said.
Return only the names of flagged fields, exactly as given. Return an empty list when every answer is supported.`;

// Reads a draft beside its transcript and names the answers the conversation does not support.
export const answerChecker = new Agent({
  id: "answer-checker",
  name: "Answer checker",
  description:
    "Names the drafted answers the transcript does not support, or that judge the company.",
  instructions: CHECK_RULES,
  model: "mastra/anthropic/claude-sonnet-5-5",
});

const flaggedSchema = z.object({ flagged: z.array(z.string()) });

// Score = share of filled answers the transcript supports. Only field names leave the judge:
// anything it returns that is not a filled field is dropped, and no reason is written.
export const answerCheck = createScorer({
  id: "answer-check",
  name: "Answer check",
  description: "Share of drafted answers the transcript supports; flags the rest by field name.",
  type: {
    input: z.object({ transcript: z.string() }),
    output: z.record(z.string(), z.string()),
  },
})
  .analyze(async ({ run, tracingContext }) => {
    const filled = Object.keys(run.output);
    if (filled.length === 0) return { filled, flagged: [] as string[] };
    const answers = filled.map((name) => `${name}: ${run.output[name]}`).join("\n");
    const { object } = await answerChecker.generate(
      `${run.input?.transcript ?? ""}\n\nDraft answers:\n${answers}`,
      { structuredOutput: { schema: flaggedSchema }, tracingContext },
    );
    const flagged = filled.filter((name) => object.flagged.includes(name));
    return { filled, flagged };
  })
  .generateScore(({ results }) => {
    const { filled, flagged } = results.analyzeStepResult;
    return filled.length === 0 ? 1 : (filled.length - flagged.length) / filled.length;
  });

const pending = new Set<Promise<void>>();

// Lets tests and shutdown wait for checks still running in the background.
export async function checksSettled(): Promise<void> {
  await Promise.allSettled(pending);
}

// Scores a finished draft and attaches the score to the draft run's trace. Keeps only the score,
// the flagged field names and ids, never the transcript, the answers or a reason.
// Never throws, so a failed check cannot touch the draft.
export function checkAnswers(check: {
  mastra: Mastra;
  workflowId: string;
  agentId: string;
  transcript: string;
  answers: Partial<Record<string, string>>;
  traceId?: string;
}): Promise<void> {
  const { mastra, workflowId, agentId, traceId } = check;
  const done = (async () => {
    const answers = Object.fromEntries(
      Object.entries(check.answers).filter((entry): entry is [string, string] => !!entry[1]),
    );
    const result = await answerCheck.run({
      input: { transcript: check.transcript },
      output: answers,
      scoreSource: "live",
      _internal: { hideInput: true, hideOutput: true, emitObservabilityScore: false },
    });
    const flaggedFields = result.analyzeStepResult?.flagged;
    if (!traceId || typeof result.score !== "number" || !flaggedFields) return;
    await mastra.observability.addScore?.({
      traceId,
      score: {
        scorerId: answerCheck.id,
        scorerName: answerCheck.name,
        scoreSource: "live",
        score: result.score,
        metadata: { flaggedFields, workflowId, agentId },
      },
    });
  })().catch(() => {
    // The error can echo the transcript or answers, so only ids are logged.
    mastra.getLogger().warn("Answer check failed", { workflowId, agentId });
  });
  pending.add(done);
  void done.finally(() => pending.delete(done));
  return done;
}
