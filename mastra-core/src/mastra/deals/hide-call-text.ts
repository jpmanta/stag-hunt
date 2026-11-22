import type { AnySpan, SpanOutputProcessor } from "@mastra/core/observability";

// Founder call transcripts and the drafts made from them are private member data.
const PRIVATE_ENTITIES = new Set(["draft-deal", "deal-drafter"]);
const MAX_TRACKED_TRACES = 1000;

// Clears span input, output and error details in every trace that touches the deal
// drafter, before any exporter sees them. Timing, status and token usage stay.
export class HideCallText implements SpanOutputProcessor {
  name = "hide-call-text";
  #traces = new Set<string>();

  process(span?: AnySpan): AnySpan | undefined {
    if (!span) return span;
    if (span.entityId && PRIVATE_ENTITIES.has(span.entityId)) this.#track(span.traceId);
    if (!this.#traces.has(span.traceId)) return span;

    span.input = undefined;
    span.output = undefined;
    if (span.errorInfo) {
      // Error messages and details can echo the transcript or the model's answer.
      const { id, domain, category } = span.errorInfo;
      span.errorInfo = { id, domain, category, message: "[hidden]" };
    }
    return span;
  }

  async shutdown(): Promise<void> {
    this.#traces.clear();
  }

  #track(traceId: string) {
    if (this.#traces.has(traceId)) return;
    this.#traces.add(traceId);
    if (this.#traces.size > MAX_TRACKED_TRACES) {
      const oldest = this.#traces.values().next().value;
      if (oldest !== undefined) this.#traces.delete(oldest);
    }
  }
}
