import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheFor, withCache } from "./asset-cache.js";

const file = (status = 200) => new Response(status === 304 ? null : "x", { status, headers: { "cache-control": "public, max-age=0, must-revalidate", etag: '"abc"' } });

test("fonts are kept for a year", () => {
  assert.equal(cacheFor("/fonts/atkinson-400.woff2"), "public, max-age=31536000, immutable");
});

test("pictures, videos and captions are kept for a day", () => {
  for (const p of ["/og.png", "/learn/how-it-works/investors.jpg", "/learn/how-it-works/investors.mp4", "/learn/how-it-works/investors.vtt"])
    assert.equal(cacheFor(p), "public, max-age=86400", p);
});

test("pages, scripts and styles are checked every time", () => {
  for (const p of ["/", "/app", "/learn/the-group/", "/app.js", "/style.css", "/manifest.webmanifest"])
    assert.equal(cacheFor(p), null, p);
});

test("a video answer gets the day and keeps its other headers", () => {
  const res = withCache(file(), "/learn/how-it-works/investors.mp4");
  assert.equal(res.headers.get("cache-control"), "public, max-age=86400");
  assert.equal(res.headers.get("etag"), '"abc"');
});

test("a page answer is passed through untouched", () => {
  const res = file();
  assert.equal(withCache(res, "/learn/"), res);
});

test("a missing file is never kept", () => {
  const res = withCache(new Response("Not found", { status: 404 }), "/nope.png");
  assert.equal(res.headers.get("cache-control"), null);
});

test("an unchanged answer keeps the same rule", () => {
  assert.equal(withCache(file(304), "/og.png").headers.get("cache-control"), "public, max-age=86400");
});
