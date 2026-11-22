// Drafts from a transcript through a Mastra workflow (Anthropic via Mastra Gateway)
// when that flow's switch is "on", falling back to the Workers AI drafter on any
// problem. No imports, so Node can test it.
// Logs only which path ran, how long it took and a fixed reason: never the
// transcript, the draft, the response body, error messages, the URL or the token.
const KNOWN_STATUSES = ["failed", "suspended", "tripwire", "canceled", "bailed", "running", "waiting", "pending"];

// A deal from a recorded founder call.
export const draftDeal = (env, transcript, drafters, deps) =>
  draftViaMastra(env, transcript, { switchVar: "DRAFT_VIA_MASTRA", workflow: "draftDeal", label: "rec draft", ...drafters }, deps);

// A founder's application from their AI interview.
export const draftApplication = (env, transcript, drafters, deps) =>
  draftViaMastra(env, transcript, { switchVar: "APPLY_VIA_MASTRA", workflow: "draftApplication", label: "apply draft", ...drafters }, deps);

async function draftViaMastra(env, transcript, { switchVar, workflow, label, llama, clean }, { fetch = globalThis.fetch, log = console.log, timeoutMs = 30_000 } = {}) {
  if (env[switchVar] !== "on") return llama();
  const started = Date.now();
  const reason = await viaMastra(env, workflow, transcript, clean, fetch, timeoutMs);
  const mastraMs = Date.now() - started;
  if (typeof reason === "object") {
    log(label, { path: "mastra", ms: mastraMs });
    return reason;
  }
  const t = Date.now();
  try {
    return await llama();
  } finally {
    log(label, { path: "llama", ms: Date.now() - t, reason, mastra_ms: mastraMs });
  }
}

// Returns the cleaned draft, or a short reason string when Llama should take over.
async function viaMastra(env, workflow, transcript, clean, fetch, timeoutMs) {
  if (!env.MASTRA_URL || !env.MASTRA_SERVER_TOKEN) return "not_configured";
  try {
    const res = await fetch(env.MASTRA_URL.replace(/\/+$/, "") + `/api/workflows/${workflow}/start-async`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.MASTRA_SERVER_TOKEN },
      body: JSON.stringify({ inputData: { transcript } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return "http_" + res.status;
    const body = await res.json();
    if (body?.status !== "success") return "status_" + (KNOWN_STATUSES.includes(body?.status) ? body.status : "other");
    const r = body.result;
    if (!r || typeof r !== "object" || Array.isArray(r)) return "no_draft";
    const draft = clean(r);
    return Object.keys(draft).length ? draft : "no_draft";
  } catch (err) {
    return err?.name === "TimeoutError" || err?.name === "AbortError" ? "timeout" : "error";
  }
}
