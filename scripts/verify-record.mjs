#!/usr/bin/env node
// Check a Stag Hunt record. Anyone can run this; it needs only Node 18 or newer.
//
//   node scripts/verify-record.mjs stag-hunt-record-2026-11-18.json [fingerprint ...]
//
// It checks that:
//   1. each of your entries hashes to the value in the chain,
//   2. every link in the chain covers the one before it, from the first entry to the last,
//   3. every daily fingerprint in the file sits on that chain,
//   4. any fingerprint you pass (say, from a weekly email you kept) sits on it too.
// If someone changed an old call, step 2 or 3 fails, because every later hash would change.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const [file, ...kept] = process.argv.slice(2);
if (!file) { console.error("Usage: node verify-record.mjs <record.json> [fingerprint ...]"); process.exit(2); }

const rec = JSON.parse(readFileSync(file, "utf8"));
const problems = [];
const bySeq = new Map(rec.chain.map((e) => [e.seq, e]));

let prev = "0".repeat(64);
rec.chain.forEach((e, i) => {
  if (e.seq !== i + 1) problems.push(`Entry ${i + 1} is missing or out of order.`);
  if (e.prev !== prev) problems.push(`Entry ${e.seq} does not point to the entry before it.`);
  if (sha256(`${e.seq}|${e.prev}|${e.body_hash}`) !== e.hash) problems.push(`Entry ${e.seq} has the wrong hash.`);
  prev = e.hash;
});

for (const m of rec.mine) {
  const c = bySeq.get(m.seq);
  if (!c) problems.push(`Your entry ${m.seq} is not in the chain.`);
  else if (sha256(m.body) !== c.body_hash) problems.push(`Your entry ${m.seq} was changed: its content no longer matches the chain.`);
}

for (const f of rec.fingerprints) {
  if (bySeq.get(f.seq)?.hash !== f.hash) problems.push(`The fingerprint for ${f.day} is not on this chain.`);
}
const hashes = new Set(rec.chain.map((e) => e.hash));
for (const k of kept) if (!hashes.has(k.trim().toLowerCase())) problems.push(`The fingerprint ${k.slice(0, 12)}... you kept is not on this chain.`);

if (problems.length) {
  console.log("NOT INTACT\n" + problems.map((p) => "- " + p).join("\n"));
  process.exit(1);
}
console.log(`Intact. ${rec.chain.length} entries on the chain, ${rec.mine.length} of them yours, ${rec.fingerprints.length} daily fingerprints${kept.length ? ` and ${kept.length} you kept` : ""} all match.`);
