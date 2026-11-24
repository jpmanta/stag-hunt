import { test } from "node:test";
import assert from "node:assert/strict";
import { videoPart } from "./video-part.js";

// A made-up "video": 1000 bytes that count 0, 1, 2 ... so every part can be checked exactly.
const FILE = new Uint8Array(1000).map((_, i) => i % 251);
const URL_ = "https://staghunts.com/learn/how-it-works/investors.mp4";
function store({ status = 200, seen = [] } = {}) {
  return { seen, ASSETS: { fetch: async (req) => { seen.push(req); return status === 200
    ? new Response(FILE, { status: 200, headers: { "content-type": "video/mp4", etag: '"abc"', "cache-control": "public, max-age=0, must-revalidate" } })
    : new Response("Not found", { status }); } } };
}
const ask = (range, extra = {}, method = "GET") => new Request(URL_, { method, headers: { range, ...extra } });
const body = async (res) => new Uint8Array(await res.arrayBuffer());

test("the first two bytes, as Safari asks before it plays anything", async () => {
  const res = await videoPart(ask("bytes=0-1"), store());
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), "bytes 0-1/1000");
  assert.equal(res.headers.get("content-length"), "2");
  assert.equal(res.headers.get("accept-ranges"), "bytes");
  assert.equal(res.headers.get("content-type"), "video/mp4");
  assert.equal(res.headers.get("etag"), '"abc"');
  assert.deepEqual([...await body(res)], [0, 1]);
});

test("a part from the middle is exactly those bytes", async () => {
  const res = await videoPart(ask("bytes=100-199"), store());
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), "bytes 100-199/1000");
  assert.deepEqual([...await body(res)], [...FILE.subarray(100, 200)]);
});

test("from a point to the end, as Chrome asks", async () => {
  const res = await videoPart(ask("bytes=0-"), store());
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), "bytes 0-999/1000");
  assert.equal((await body(res)).length, 1000);
  const tail = await videoPart(ask("bytes=990-"), store());
  assert.equal(tail.headers.get("content-range"), "bytes 990-999/1000");
  assert.deepEqual([...await body(tail)], [...FILE.subarray(990)]);
});

test("the last N bytes", async () => {
  const res = await videoPart(ask("bytes=-10"), store());
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), "bytes 990-999/1000");
  assert.deepEqual([...await body(res)], [...FILE.subarray(990)]);
});

test("an end past the file is cut to the file", async () => {
  const res = await videoPart(ask("bytes=900-5000"), store());
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), "bytes 900-999/1000");
  assert.equal(res.headers.get("content-length"), "100");
});

test("a start past the file is refused with 416 and the file's size", async () => {
  for (const r of ["bytes=1000-", "bytes=5000-6000", "bytes=10-5", "bytes=-0"]) {
    const res = await videoPart(ask(r), store());
    assert.equal(res.status, 416, r);
    assert.equal(res.headers.get("content-range"), "bytes */1000", r);
  }
});

test("a range it does not understand gets the whole file, as before", async () => {
  for (const r of ["bytes=0-1,5-6", "items=0-1", "bytes=-", "bytes=a-b"]) {
    const res = await videoPart(ask(r), store());
    assert.equal(res.status, 200, r);
    assert.equal((await body(res)).length, 1000, r);
  }
});

test("a missing file stays missing", async () => {
  const res = await videoPart(ask("bytes=0-1"), store({ status: 404 }));
  assert.equal(res.status, 404);
});

test("the store is asked for the whole file once, without the Range or the cache questions", async () => {
  const s = store();
  await videoPart(ask("bytes=0-1", { "if-none-match": '"abc"', cookie: "x=1" }), s);
  assert.equal(s.seen.length, 1);
  assert.equal(s.seen[0].headers.get("range"), null);
  assert.equal(s.seen[0].headers.get("if-none-match"), null);
  assert.equal(s.seen[0].url, URL_);
});

test("If-Range: the part when the file is unchanged, the whole file when it changed", async () => {
  const same = await videoPart(ask("bytes=0-1", { "if-range": '"abc"' }), store());
  assert.equal(same.status, 206);
  const changed = await videoPart(ask("bytes=0-1", { "if-range": '"old"' }), store());
  assert.equal(changed.status, 200);
  assert.equal((await body(changed)).length, 1000);
});

test("HEAD gets the headers of the part and no body", async () => {
  const res = await videoPart(ask("bytes=0-99", {}, "HEAD"), store());
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), "bytes 0-99/1000");
  assert.equal((await body(res)).length, 0);
});

test("if cutting fails, the plain file is served instead", async () => {
  let calls = 0;
  const env = { ASSETS: { fetch: async () => { calls++; if (calls === 1) throw new Error("boom"); return new Response(FILE, { status: 200 }); } } };
  const quiet = console.error; console.error = () => {};
  try {
    const res = await videoPart(ask("bytes=0-1"), env);
    assert.equal(res.status, 200);
    assert.equal(calls, 2);
  } finally { console.error = quiet; }
});
