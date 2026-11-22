import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { draftApplication, draftDeal } from "./draft-via-mastra.js";

// Invented conversations and drafts only.
const FLOWS = [
  {
    name: "deal",
    draft: draftDeal,
    switchVar: "DRAFT_VIA_MASTRA",
    workflow: "draftDeal",
    label: "rec draft",
    transcript: "Founder: We are Pinecone Bakery Robots and we sell dough-folding arms to bakeries for 900 dollars a month. Investor: how many customers?",
    mastraDraft: { company: "Pinecone Bakery Robots", one_liner: "Dough-folding arms for bakeries." },
  },
  {
    name: "application",
    draft: draftApplication,
    switchVar: "APPLY_VIA_MASTRA",
    workflow: "draftApplication",
    label: "apply draft",
    transcript: "Interviewer: What's your name and what are you building?\nFounder: I'm Robin Testperson, and Pinecone Bakery Robots sells dough-folding arms to bakeries.\nInterviewer: Why you?\nFounder: I ran a bakery for ten years.",
    mastraDraft: { company: "Pinecone Bakery Robots", one_liner: "Dough-folding arms for bakeries.", founder_name: "Robin Testperson", why_you: "Ran a bakery for ten years." },
  },
];
const LLAMA_DRAFT = { company: "Llama Guess Co" };
const TOKEN = "t0ken-for-tests-only-0123456789abcdef";
const URL_ = "https://mastra.example.test";
const FIELDS = { company: 80, one_liner: 10, founder_name: 80, why_you: 600 };
const clean = (f) => {
  const got = {};
  for (const [k, max] of Object.entries(FIELDS)) if (typeof f[k] === "string" && f[k].trim()) got[k] = f[k].trim().slice(0, max);
  return got;
};
const reply = (status, body) => async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

for (const flow of FLOWS) {
  const { draft, switchVar, workflow, label, transcript: TRANSCRIPT, mastraDraft: MASTRA_DRAFT } = flow;
  const ON = { [switchVar]: "on", MASTRA_URL: URL_, MASTRA_SERVER_TOKEN: TOKEN };
  const SECRETS = [TRANSCRIPT, TRANSCRIPT.slice(10, 50), TOKEN, URL_, "mastra.example.test", ...Object.values(MASTRA_DRAFT), "Dough-fold", ...Object.values(LLAMA_DRAFT)];
  const t = (name, fn) => test(`${flow.name}: ${name}`, fn);

  function setup(fetchImpl) {
    const logs = [];
    const llama = mock.fn(async () => ({ ...LLAMA_DRAFT }));
    const fetch = mock.fn(fetchImpl);
    const cLog = mock.method(console, "log", () => {});
    const cErr = mock.method(console, "error", () => {});
    return {
      llama, fetch, logs,
      deps: { fetch, log: (...a) => logs.push(a) },
      noPrivateText() {
        const all = JSON.stringify([logs, cLog.mock.calls.map((c) => c.arguments), cErr.mock.calls.map((c) => c.arguments)]);
        cLog.mock.restore(); cErr.mock.restore();
        for (const s of SECRETS) assert.ok(!all.includes(s), "log contains private text: " + s);
      },
    };
  }

  t("switch off: Llama drafts and Mastra is never called", async () => {
    const s = setup(reply(200, { status: "success", result: MASTRA_DRAFT }));
    const got = await draft({ ...ON, [switchVar]: "off" }, TRANSCRIPT, { llama: s.llama, clean }, s.deps);
    assert.deepEqual(got, LLAMA_DRAFT);
    assert.equal(s.fetch.mock.callCount(), 0);
    assert.equal(s.logs.length, 0);
    s.noPrivateText();
  });

  t("switch unset: Llama drafts and Mastra is never called", async () => {
    const s = setup(reply(200, { status: "success", result: MASTRA_DRAFT }));
    const got = await draft({ ...ON, [switchVar]: undefined }, TRANSCRIPT, { llama: s.llama, clean }, s.deps);
    assert.deepEqual(got, LLAMA_DRAFT);
    assert.equal(s.fetch.mock.callCount(), 0);
    s.noPrivateText();
  });

  for (const missing of ["MASTRA_URL", "MASTRA_SERVER_TOKEN"]) {
    t(`switch on without ${missing}: Llama drafts, reason not_configured`, async () => {
      const s = setup(reply(200, { status: "success", result: MASTRA_DRAFT }));
      const got = await draft({ ...ON, [missing]: undefined }, TRANSCRIPT, { llama: s.llama, clean }, s.deps);
      assert.deepEqual(got, LLAMA_DRAFT);
      assert.equal(s.fetch.mock.callCount(), 0);
      assert.equal(s.logs[0][1].reason, "not_configured");
      s.noPrivateText();
    });
  }

  t("Mastra path: posts the transcript, cleans the draft, skips Llama", async () => {
    const s = setup(reply(200, { status: "success", runId: "r1", result: { ...MASTRA_DRAFT, scores: "9/10", sector: "" } }));
    const got = await draft(ON, TRANSCRIPT, { llama: s.llama, clean }, s.deps);
    assert.deepEqual(got, clean(MASTRA_DRAFT));
    assert.equal(got.one_liner, "Dough-fold");
    assert.equal(s.llama.mock.callCount(), 0);
    const [url, init] = s.fetch.mock.calls[0].arguments;
    assert.equal(String(url), URL_ + `/api/workflows/${workflow}/start-async`);
    assert.equal(init.method, "POST");
    assert.equal(init.headers.Authorization, "Bearer " + TOKEN);
    assert.equal(init.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(init.body), { inputData: { transcript: TRANSCRIPT } });
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(s.logs.length, 1);
    assert.equal(s.logs[0][0], label);
    assert.deepEqual(Object.keys(s.logs[0][1]).sort(), ["ms", "path"]);
    assert.equal(s.logs[0][1].path, "mastra");
    assert.equal(typeof s.logs[0][1].ms, "number");
    s.noPrivateText();
  });

  t("MASTRA_URL keeps its path and loses a trailing slash", async () => {
    const s = setup(reply(200, { status: "success", result: MASTRA_DRAFT }));
    await draft({ ...ON, MASTRA_URL: URL_ + "/core/" }, TRANSCRIPT, { llama: s.llama, clean }, s.deps);
    assert.equal(s.fetch.mock.calls[0].arguments[0], URL_ + `/core/api/workflows/${workflow}/start-async`);
    s.noPrivateText();
  });

  const timeoutErr = () => Object.assign(new Error("timed out reading " + TRANSCRIPT), { name: "TimeoutError" });
  const fallbacks = [
    ["fetch times out", async () => { throw timeoutErr(); }, "timeout"],
    ["Mastra unreachable", async () => { throw new TypeError("fetch failed for " + URL_ + " " + TRANSCRIPT); }, "error"],
    ["HTTP 500", reply(500, { error: TRANSCRIPT }), "http_500"],
    ["HTTP 401", reply(401, { error: "Unauthorized" }), "http_401"],
    ["HTTP 404 (workflow not deployed)", reply(404, { error: "Workflow not found" }), "http_404"],
    ["workflow failed", reply(200, { status: "failed", error: { message: TRANSCRIPT } }), "status_failed"],
    ["unknown status text", reply(200, { status: TRANSCRIPT }), "status_other"],
    ["no result", reply(200, { status: "success" }), "no_draft"],
    ["empty result", reply(200, { status: "success", result: {} }), "no_draft"],
    ["array result", reply(200, { status: "success", result: [MASTRA_DRAFT] }), "no_draft"],
    ["nothing left after cleaning", reply(200, { status: "success", result: { scores: "high", company: "  " } }), "no_draft"],
    ["body is not JSON", reply(200, "<html>" + TRANSCRIPT), "error"],
  ];
  for (const [name, impl, reason] of fallbacks) {
    t(`falls back to Llama when ${name}`, async () => {
      const s = setup(impl);
      const got = await draft(ON, TRANSCRIPT, { llama: s.llama, clean }, s.deps);
      assert.deepEqual(got, LLAMA_DRAFT);
      assert.equal(s.llama.mock.callCount(), 1);
      assert.equal(s.logs.length, 1);
      const [msg, info] = s.logs[0];
      assert.equal(msg, label);
      assert.deepEqual(Object.keys(info).sort(), ["mastra_ms", "ms", "path", "reason"]);
      assert.equal(info.path, "llama");
      assert.equal(info.reason, reason);
      s.noPrivateText();
    });
  }

  t("a Mastra call that never answers is cut off by the timeout", async () => {
    const s = setup((_url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))));
    const got = await draft(ON, TRANSCRIPT, { llama: s.llama, clean }, { ...s.deps, timeoutMs: 20 });
    assert.deepEqual(got, LLAMA_DRAFT);
    assert.equal(s.logs[0][1].reason, "timeout");
    s.noPrivateText();
  });

  t("the default timeout is 30 seconds", async () => {
    const seen = [];
    const orig = AbortSignal.timeout;
    AbortSignal.timeout = (ms) => { seen.push(ms); return orig.call(AbortSignal, ms); };
    try {
      const s = setup(reply(200, { status: "success", result: MASTRA_DRAFT }));
      await draft(ON, TRANSCRIPT, { llama: s.llama, clean }, s.deps);
      s.noPrivateText();
    } finally { AbortSignal.timeout = orig; }
    assert.deepEqual(seen, [30_000]);
  });

  t("a Llama error after a Mastra failure is thrown, as today", async () => {
    const s = setup(reply(503, {}));
    s.llama.mock.mockImplementation(async () => { throw new Error("ai down"); });
    await assert.rejects(draft(ON, TRANSCRIPT, { llama: s.llama, clean }, s.deps), /ai down/);
    assert.equal(s.logs[0][1].path, "llama");
    assert.equal(s.logs[0][1].reason, "http_503");
    s.noPrivateText();
  });
}

test("each flow listens only to its own switch", async () => {
  const fetch = mock.fn(reply(200, { status: "success", result: { company: "Pinecone Bakery Robots" } }));
  const llama = mock.fn(async () => ({ ...LLAMA_DRAFT }));
  const deps = { fetch, log: () => {} };
  const base = { MASTRA_URL: URL_, MASTRA_SERVER_TOKEN: TOKEN };

  // As shipped: deals on, applications off.
  const shipped = { ...base, DRAFT_VIA_MASTRA: "on", APPLY_VIA_MASTRA: "off" };
  assert.deepEqual(await draftApplication(shipped, FLOWS[1].transcript, { llama, clean }, deps), LLAMA_DRAFT);
  assert.equal(fetch.mock.callCount(), 0);
  assert.deepEqual(await draftDeal(shipped, FLOWS[0].transcript, { llama, clean }, deps), { company: "Pinecone Bakery Robots" });
  assert.equal(fetch.mock.calls.at(-1).arguments[0], URL_ + "/api/workflows/draftDeal/start-async");

  const flipped = { ...base, DRAFT_VIA_MASTRA: "off", APPLY_VIA_MASTRA: "on" };
  assert.deepEqual(await draftDeal(flipped, FLOWS[0].transcript, { llama, clean }, deps), LLAMA_DRAFT);
  assert.equal(fetch.mock.callCount(), 1);
  await draftApplication(flipped, FLOWS[1].transcript, { llama, clean }, deps);
  assert.equal(fetch.mock.calls.at(-1).arguments[0], URL_ + "/api/workflows/draftApplication/start-async");
});
