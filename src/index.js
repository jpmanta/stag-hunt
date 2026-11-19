// Stag Hunt: a new way to invest, on Cloudflare Workers + D1 + Durable Objects + Email Service.
export { Hub } from "./hub.js";
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";

const RP_ID = "staghunts.com";
const RP_ORIGIN = "https://staghunts.com";
const dealLink = (id) => `${RP_ORIGIN}/app#/deals/${id}`;

const CODE_TTL = 10 * 60;
const RESEND_AFTER = 60;
const MAX_ATTEMPTS = 5;
const REVIEW_WRONG_PER_DAY = 20;   // a million possible codes at 20 a day is over a century of guessing
const SESSION_TTL = 365 * 24 * 3600;
const IP_LIMIT = 10;
const COOKIE = "sh_session";
const STATUSES = ["reviewing", "founder_call", "invested", "passed", "exited", "dead"];
const ROUND_TYPES = ["SAFE", "Convertible note", "Priced round", "Reg CF", "Other"];

// Sent with every page and API answer: HTTPS only, no framing by other sites, no MIME guessing,
// no full URLs leaked to other sites, and only this site may use the microphone.
const SECURITY_HEADERS = [
  ["Strict-Transport-Security", "max-age=31536000; includeSubDomains"],
  ["X-Content-Type-Options", "nosniff"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ["X-Frame-Options", "SAMEORIGIN"],
  ["Content-Security-Policy", "frame-ancestors 'self'; base-uri 'self'; object-src 'none'"],
  ["Permissions-Policy", "microphone=(self), camera=(), geolocation=(), payment=(), usb=()"],
];

export default {
  async fetch(request, env, ctx) {
    const res = await handle(request, env, ctx);
    if (res.status === 101 || res.webSocket) return res;   // live-update sockets pass through untouched
    const out = new Response(res.body, res);
    for (const [k, v] of SECURITY_HEADERS) out.headers.set(k, v);
    return out;
  },

  // Scheduled jobs: weekly digest (Mondays) and monthly backup (1st of the month)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(cleanup(env));
    if (event.cron === "7 13 * * 1") ctx.waitUntil(sendWeeklyDigest(env));
    if (event.cron === "17 14 1 * *") ctx.waitUntil(sendMonthlyBackup(env));
    if (event.cron === "23 4 * * *") ctx.waitUntil(sealLedger(env));
  },
};

async function handle(request, env, ctx) {
  const url = new URL(request.url);
  if (url.hostname === "www.staghunts.com") {
    url.hostname = "staghunts.com";
    return Response.redirect(url.toString(), 301);
  }
  if (url.pathname === "/.well-known/apple-app-site-association") return appleSiteFile(env);
  if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

  try {
    if (request.method !== "GET" && !sameOrigin(request, url)) return json({ error: "bad_origin" }, 403);
    return await route(request, env, ctx, url);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.code, message: err.message }, err.status);
    console.error("api error", err && err.stack || err);
    return json({ error: "server_error", message: "Something went wrong." }, 500);
  }
}

// Tells iPhones the Stag Hunt app may use this site's Face ID sign-in and open its email login links.
// Needs APPLE_TEAM_ID in wrangler.jsonc (from developer.apple.com); until then there is nothing to serve.
function appleSiteFile(env) {
  if (!env.APPLE_TEAM_ID) return new Response("Not found", { status: 404 });
  const app = `${env.APPLE_TEAM_ID}.${env.APPLE_BUNDLE_ID || "com.staghunts.app"}`;
  return json({
    webcredentials: { apps: [app] },
    applinks: { details: [{ appIDs: [app], components: [{ "/": "/api/auth/link*" }] }] },
  });
}

class HttpError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}
const bad = (msg, code = "invalid") => { throw new HttpError(400, code, msg); };
const clientIp = (request) => request.headers.get("CF-Connecting-IP") || "unknown";

// ---------------------------------------------------------------- router

async function route(request, env, ctx, url) {
  const m = request.method;
  const p = url.pathname;
  let mt;

  // Public
  if (m === "POST" && p === "/api/auth/request") { if (Math.random() < 0.05) ctx.waitUntil(cleanup(env)); return requestCode(request, env); }
  if (m === "POST" && p === "/api/auth/verify") return verifyCode(request, env);
  if (m === "GET" && p === "/api/auth/link") return linkPage(url);
  if (m === "POST" && p === "/api/auth/link") return verifyLink(request, env);
  if (m === "GET" && p === "/api/auth/config") return json({ google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) });
  if (m === "GET" && p === "/api/auth/google") return googleStart(env);
  if (m === "GET" && p === "/api/auth/google/callback") return googleCallback(request, env, url);
  if (m === "POST" && p === "/api/passkey/login/options") return passkeyLoginOptions(env);
  if (m === "POST" && p === "/api/passkey/login/verify") return passkeyLoginVerify(request, env);
  if (m === "POST" && p === "/api/auth/logout") return logout(request, env);
  if (m === "POST" && p === "/api/contact") return contactUs(request, env);
  if (m === "POST" && p === "/api/apply") return applyFounder(request, env);
  if (m === "GET" && p === "/api/ledger/fingerprints") return ledgerFingerprints(env);
  if ((mt = p.match(/^\/api\/pitch\/([A-Za-z0-9_-]{40,60})(?:\/(start|done|seg\/(\d{1,3})))?$/))) {
    if (m === "GET" && !mt[2]) return getPitch(env, mt[1]);
    if (m === "POST" && mt[2] === "start") return startPitch(request, env, mt[1]);
    if (m === "POST" && mt[2] === "done") return finishPitch(env, ctx, mt[1]);
    if (m === "POST" && mt[3] != null) return addPitchSegment(request, env, mt[1], Number(mt[3]));
  }
  if (m === "GET" && p === "/api/interview") {
    const available = await interviewAvailable(env);
    if (!available && env.ELEVENLABS_API_KEY && env.INTERVIEW_AGENT_ID) ctx.waitUntil(interviewAlert(env, "budget"));
    return json({ available });
  }
  if (m === "POST" && p === "/api/interview") return startInterview(request, env, ctx);
  if (m === "POST" && (mt = p.match(/^\/api\/interview\/([0-9a-f-]{36})\/failed$/))) return interviewFailed(env, ctx, mt[1]);
  if (m === "POST" && (mt = p.match(/^\/api\/interview\/([0-9a-f-]{36})\/finish$/))) return finishInterview(request, env, mt[1]);
  if (m === "GET" && p === "/api/me") {
    const user = await currentUser(request, env);
    if (!user) return json({ user: null }, 401);
    return json({ user: publicUser(user) });
  }

  if (m === "GET" && (mt = p.match(/^\/api\/track\/([A-Za-z0-9_-]{43})$/))) return publicTrack(env, mt[1]);

  // Your record, read with a personal key instead of a sign-in (for Excel, Google Sheets, scripts)
  if (m === "GET" && (p === "/api/me/history" || p === "/api/me/history.csv")) {
    const key = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "") || url.searchParams.get("key");
    if (key) return myHistory(env, await keyUser(env, key), p.endsWith(".csv") ? "csv" : "json");
  }

  // Members only from here
  const me = await currentUser(request, env);
  if (!me) throw new HttpError(401, "signed_out", "Please sign in.");

  if (me.role === "observer" && m === "POST" && !/^\/api\/(me(\/(photo|notifications|terms))?|passkey\/register\/(options|verify)|passkeys\/[^/]+\/delete|auth\/logout|me\/(delete|test-email|api-key(\/delete)?|record-link(\/delete)?))$/.test(p))
    throw new HttpError(403, "observer", "Observers can read but not post.");
  if (m === "GET" && p === "/api/ws") return connectWs(request, env, me);
  if (m === "POST" && p === "/api/me") return updateMe(request, env, me);
  if (m === "POST" && p === "/api/me/terms") { await env.DB.prepare("UPDATE users SET terms_accepted_at = ? WHERE id = ?").bind(now(), me.id).run(); return json({ ok: true }); }
  if (m === "POST" && p === "/api/me/notifications") return updateNotifications(request, env, me);
  if (m === "POST" && p === "/api/me/test-email") return sendTestEmails(env, me, !!(await request.json().catch(() => ({}))).sample);
  if (m === "GET" && p === "/api/me/history") return myHistory(env, me);
  if (m === "GET" && p === "/api/me/api-key") return json({ key: await env.DB.prepare("SELECT last4, created_at, last_used_at FROM api_keys WHERE user_id = ?").bind(me.id).first() });
  if (m === "POST" && p === "/api/me/api-key") return makeApiKey(env, me);
  if (m === "GET" && p === "/api/me/ledger") return myLedger(env, me);
  if (m === "GET" && p === "/api/me/record-link") return json({ link: me.record_link ? trackLink(me.record_link) : null });
  if (m === "POST" && p === "/api/me/record-link") {
    const t = randomToken();
    await env.DB.prepare("UPDATE users SET record_link = ? WHERE id = ?").bind(t, me.id).run();
    return json({ link: trackLink(t) });
  }
  if (m === "POST" && p === "/api/me/record-link/delete") { await env.DB.prepare("UPDATE users SET record_link = NULL WHERE id = ?").bind(me.id).run(); return json({ ok: true }); }
  if (m === "POST" && p === "/api/me/api-key/delete") { await env.DB.prepare("DELETE FROM api_keys WHERE user_id = ?").bind(me.id).run(); return json({ ok: true }); }
  if (m === "GET" && p === "/api/me/history.csv") return myHistory(env, me, "csv");
  if (m === "POST" && p === "/api/me/delete") return requestDeletion(request, env, me);
  if (m === "GET" && p === "/api/passkeys") return listPasskeys(env, me);
  if (m === "POST" && p === "/api/passkey/register/options") return passkeyRegisterOptions(env, me);
  if (m === "POST" && p === "/api/passkey/register/verify") return passkeyRegisterVerify(request, env, me);
  if (m === "POST" && (mt = p.match(/^\/api\/passkeys\/([A-Za-z0-9_-]{8,512})\/delete$/))) return deletePasskey(env, me, mt[1]);
  if (m === "GET" && p === "/api/overview") return overview(env, me);
  if (m === "GET" && p === "/api/members") return listMembers(env, me);
  if (m === "GET" && p === "/api/cohorts") return listCohorts(env);
  if (m === "GET" && (mt = p.match(/^\/api\/members\/([0-9a-z-]{8,40})$/))) return getMember(env, mt[1], me);
  if (m === "GET" && (mt = p.match(/^\/api\/photo\/([0-9a-z-]{8,40})$/))) return getPhoto(env, mt[1]);
  if (m === "POST" && p === "/api/me/photo") return updatePhoto(request, env, me);
  if (m === "GET" && p === "/api/deals") return listDeals(env, me);
  if (m === "POST" && p === "/api/deals") return createDeal(request, env, me, ctx);
  if (m === "POST" && p === "/api/rec") return startRecording(request, env, me);
  if (m === "GET" && p === "/api/rec/links") return listPitchLinks(env, me);
  if (m === "POST" && p === "/api/rec/links") return createPitchLink(request, env, me);
  if (m === "POST" && (mt = p.match(/^\/api\/rec\/([0-9a-f-]{36})\/seg\/(\d{1,3})$/))) return addSegment(request, env, me, mt[1], Number(mt[2]));
  if (m === "POST" && (mt = p.match(/^\/api\/rec\/([0-9a-f-]{36})\/draft$/))) return draftFromRecording(env, me, mt[1]);
  if (m === "POST" && (mt = p.match(/^\/api\/rec\/([0-9a-f-]{36})\/delete$/))) return deleteRecording(env, me, mt[1]);
  if (m === "POST" && (mt = p.match(/^\/api\/rec\/([0-9a-f-]{36})\/fill$/))) return fillFromRecording(env, me, mt[1]);
  if ((mt = p.match(/^\/api\/deals\/([0-9a-f-]{36})$/))) {
    if (m === "GET") return getDeal(env, me, mt[1]);
    if (m === "POST") return updateDeal(request, env, me, mt[1]);
  }
  if (m === "POST" && (mt = p.match(/^\/api\/deals\/([0-9a-f-]{36})\/score$/))) return scoreDeal(request, env, me, mt[1]);
  if (m === "POST" && (mt = p.match(/^\/api\/deals\/([0-9a-f-]{36})\/invest$/))) return investDeal(request, env, me, mt[1]);
  if (m === "POST" && (mt = p.match(/^\/api\/deals\/([0-9a-f-]{36})\/intro$/))) return requestIntro(env, me, mt[1]);
  if (m === "POST" && (mt = p.match(/^\/api\/deals\/([0-9a-f-]{36})\/invest\/delete$/))) return deleteInvestment(env, me, mt[1]);
  if (m === "POST" && (mt = p.match(/^\/api\/deals\/([0-9a-f-]{36})\/pledge$/))) return pledgeDeal(request, env, me, mt[1], ctx);
  if (m === "POST" && (mt = p.match(/^\/api\/deals\/([0-9a-f-]{36})\/pledge\/withdraw$/))) return withdrawPledge(env, me, mt[1]);
  if (m === "POST" && (mt = p.match(/^\/api\/deals\/([0-9a-f-]{36})\/outcome$/))) return setOutcome(request, env, me, mt[1]);
  if (m === "POST" && (mt = p.match(/^\/api\/deals\/([0-9a-f-]{36})\/updates$/))) return addUpdate(request, env, me, mt[1]);
  if (m === "GET" && p === "/api/inbound") return listInbound(env, me);
  if ((mt = p.match(/^\/api\/inbound\/([0-9a-f-]{36})$/)) && m === "GET") return getApplication(env, me, mt[1]);
  if ((mt = p.match(/^\/api\/inbound\/([0-9a-f-]{36})\/interview$/)) && m === "GET") return interviewAudio(env, mt[1]);
  if (m === "POST" && (mt = p.match(/^\/api\/inbound\/([0-9a-f-]{36})\/(claim|release)$/))) return claimApplication(env, me, mt[1], mt[2]);
  if (m === "GET" && p === "/api/hunts") return listHunts(env, me);
  if (m === "POST" && p === "/api/hunts") return createHunt(request, env, me);
  if ((mt = p.match(/^\/api\/hunts\/([0-9a-f-]{36})$/))) {
    if (m === "GET") return getHunt(env, me, mt[1]);
    if (m === "POST") return renameHunt(request, env, me, mt[1]);
  }
  if (m === "POST" && (mt = p.match(/^\/api\/hunts\/([0-9a-f-]{36})\/(invite|uninvite|join|decline|leave)$/))) return huntAction(request, env, me, mt[1], mt[2]);
  if (m === "GET" && p === "/api/nominations") return listNominations(env, me);
  if (m === "POST" && p === "/api/nominations") return nominate(request, env, me);
  if (m === "POST" && (mt = p.match(/^\/api\/nominations\/([0-9a-f-]{36})\/object$/))) return objectNomination(request, env, me, mt[1]);
  if (m === "GET" && p === "/api/export.csv") return exportCsv(env);

  // Admin
  if (p.startsWith("/api/admin/")) {
    if (me.role !== "admin") throw new HttpError(403, "forbidden", "Admins only.");
    if (m === "POST" && p === "/api/admin/members") return addMember(request, env, me);
    if (m === "POST" && p === "/api/admin/cohorts") return openCohort(request, env);
    if (m === "POST" && (mt = p.match(/^\/api\/admin\/cohorts\/(\d{1,3})$/))) return editCohort(request, env, Number(mt[1]));
    if (m === "POST" && (mt = p.match(/^\/api\/admin\/members\/([0-9a-f-]{32,36})$/))) return editMember(request, env, me, mt[1]);
    if (m === "POST" && (mt = p.match(/^\/api\/admin\/nominations\/([0-9a-f-]{36})$/))) return decideNomination(request, env, me, mt[1]);
    if (m === "POST" && (mt = p.match(/^\/api\/admin\/requests\/([0-9a-f-]{36})$/))) return decideRequest(request, env, me, mt[1]);
    if (m === "POST" && (mt = p.match(/^\/api\/admin\/deals\/([0-9a-f-]{36})\/delete$/))) return deleteDeal(env, mt[1]);
    if (m === "POST" && (mt = p.match(/^\/api\/admin\/inbound\/([0-9a-f-]{36})\/delete$/))) { await env.DB.prepare("DELETE FROM applications WHERE id = ? AND status != 'posted'").bind(mt[1]).run(); return json({ ok: true }); }
  }
  throw new HttpError(404, "not_found", "Not found.");
}

// ---------------------------------------------------------------- auth

async function requestCode(request, env) {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  if (!email) return json({ error: "invalid_email" }, 400);

  const ip = clientIp(request);
  if (!(await allow(env, `ip:${ip}`, IP_LIMIT, 3600))) {
    return json({ error: "rate_limited", message: "Too many requests. Try again later." }, 429);
  }

  // Members only. Answer the same way for members and everyone else so the
  // sign-in form never reveals who is a member.
  const member = await env.DB.prepare("SELECT id FROM users WHERE email = ? AND status = 'active'").bind(email).first();
  if (!member) return json({ ok: true });

  const t = now();
  const existing = await env.DB.prepare("SELECT sent_at FROM login_codes WHERE email = ?").bind(email).first();
  if (existing && t - existing.sent_at < RESEND_AFTER) {
    return json({ error: "too_soon", retry_after: RESEND_AFTER - (t - existing.sent_at) }, 429);
  }

  // Apple's app reviewer can't read email, so their one account takes a fixed code (secret REVIEW_CODE).
  if (env.REVIEW_EMAIL && /^\d{6}$/.test(env.REVIEW_CODE || "") && email === normalizeEmail(env.REVIEW_EMAIL)) {
    await env.DB.prepare(
      `INSERT INTO login_codes (email, code_hash, link_hash, expires_at, sent_at, attempts) VALUES (?, ?, '', ?, ?, 0)
       ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, link_hash = '', expires_at = excluded.expires_at, sent_at = excluded.sent_at, attempts = 0`
    ).bind(email, await sha256(`${env.AUTH_SECRET}:${email}:${env.REVIEW_CODE}`), t + CODE_TTL, t).run();
    return json({ ok: true });
  }

  const code = sixDigits();
  const codeHash = await sha256(`${env.AUTH_SECRET}:${email}:${code}`);
  const linkToken = randomToken();
  const linkHash = await sha256(`${env.AUTH_SECRET}:link:${email}:${linkToken}`);
  const link = `https://staghunts.com/api/auth/link?e=${encodeURIComponent(email)}&t=${linkToken}`;
  try {
    await env.EMAIL.send({
      to: email,
      from: { email: env.MAIL_FROM, name: env.APP_NAME },
      subject: `Sign in to ${env.APP_NAME}`,
      text: `Sign in to ${env.APP_NAME}:\n${link}\n\nOr type this code: ${code}\n\nThe link and code work once, for 10 minutes. Didn't ask for this? You can ignore this email.`,
      html: codeEmailHtml(env.APP_NAME, code, link),
    });
  } catch (err) {
    console.error("email send failed", err && err.message);
    return json({ error: "email_unavailable", message: "We couldn't send the email right now. Please try again shortly." }, 503);
  }
  await env.DB.prepare(
    `INSERT INTO login_codes (email, code_hash, link_hash, expires_at, sent_at, attempts) VALUES (?, ?, ?, ?, ?, 0)
     ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, link_hash = excluded.link_hash, expires_at = excluded.expires_at, sent_at = excluded.sent_at, attempts = 0`
  ).bind(email, codeHash, linkHash, t + CODE_TTL, t).run();
  return json({ ok: true });
}

async function verifyCode(request, env) {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const code = String(body.code || "").replace(/\D/g, "");
  if (!email || code.length !== 6) return json({ error: "invalid_code", message: "Enter the 6-digit code." }, 400);

  const t = now();
  const row = await env.DB.prepare("SELECT code_hash, expires_at, attempts FROM login_codes WHERE email = ?").bind(email).first();
  if (!row || row.expires_at < t || row.attempts >= MAX_ATTEMPTS) {
    return json({ error: "code_expired", message: "That code has expired. Request a new one." }, 400);
  }
  // The reviewer's code never changes, so asking for a new one must not buy more guesses:
  // wrong tries on that account are capped per day, however many times a code is requested.
  const review = env.REVIEW_EMAIL && email === normalizeEmail(env.REVIEW_EMAIL);
  if (review) {
    const w = await env.DB.prepare("SELECT count, window_start FROM rate_limits WHERE key = 'review-wrong'").first();
    if (w && w.window_start >= t - 86400 && w.count >= REVIEW_WRONG_PER_DAY)
      return json({ error: "code_expired", message: "Too many wrong tries today. Try again tomorrow." }, 400);
  }
  const candidate = await sha256(`${env.AUTH_SECRET}:${email}:${code}`);
  if (!timingSafeEqual(candidate, row.code_hash)) {
    if (review) await allow(env, "review-wrong", REVIEW_WRONG_PER_DAY, 86400);
    await env.DB.prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?").bind(email).run();
    const left = MAX_ATTEMPTS - row.attempts - 1;
    return json({ error: "wrong_code", message: left > 0 ? `Wrong code. ${left} tries left.` : "Too many wrong tries. Request a new code." }, 400);
  }

  const user = await env.DB.prepare("SELECT * FROM users WHERE email = ? AND status = 'active'").bind(email).first();
  if (!user) return json({ error: "code_expired", message: "That code has expired. Request a new one." }, 400);
  const s = await newSession(env, user.id, t);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_codes WHERE email = ?").bind(email),
    env.DB.prepare("UPDATE users SET last_login = ? WHERE id = ?").bind(t, user.id),
    s.insert,
  ]);
  return json({ ok: true, first_login: !user.last_login, user: publicUser(user) }, 200, { "Set-Cookie": s.cookie });
}

// Opening the email link shows a page that signs in with one POST, so link scanners in
// email apps (which only fetch the page) can't use up the one-time link.
function linkPage(url) {
  const e = String(url.searchParams.get("e") || "").slice(0, 254), t = String(url.searchParams.get("t") || "").slice(0, 100);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Signing in · Stag Hunt</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#FAF9F6;color:#14244A;font:16px/1.5 Georgia,serif;text-align:center}
button{margin-top:18px;padding:14px 28px;border:0;background:#14244A;color:#FAF9F6;font:500 13px/1 Georgia,serif;letter-spacing:.3em;text-transform:uppercase;cursor:pointer}</style></head>
<body><form method="post" action="/api/auth/link"><input type="hidden" name="e" value="${escHtml(e)}"><input type="hidden" name="t" value="${escHtml(t)}">
<p>Signing you in to Stag Hunt…</p><noscript><button type="submit">Sign in</button></noscript></form>
<script>document.forms[0].submit()</script></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

async function verifyLink(request, env) {
  const form = await request.formData().catch(() => null);
  const email = normalizeEmail(form && form.get("e"));
  const token = String((form && form.get("t")) || "");
  const go = (to, extra = {}) => new Response(null, { status: 303, headers: { Location: to, "Cache-Control": "no-store", ...extra } });
  // Used or expired: if this browser is already signed in, just carry on
  const fail = async () => go((await currentUser(request, env)) ? "/app" : "/login?expired=1");
  if (!email || token.length < 20) return fail();
  const t = now();
  const row = await env.DB.prepare("SELECT link_hash, expires_at FROM login_codes WHERE email = ?").bind(email).first();
  if (!row || !row.link_hash || row.expires_at < t) return fail();
  if (!timingSafeEqual(await sha256(`${env.AUTH_SECRET}:link:${email}:${token}`), row.link_hash)) return fail();
  const user = await env.DB.prepare("SELECT * FROM users WHERE email = ? AND status = 'active'").bind(email).first();
  if (!user) return fail();
  const s = await newSession(env, user.id, t);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_codes WHERE email = ?").bind(email),   // one use only
    env.DB.prepare("UPDATE users SET last_login = ? WHERE id = ?").bind(t, user.id),
    s.insert,
  ]);
  return go(user.last_login ? "/app" : "/app#/profile?welcome=1", { "Set-Cookie": s.cookie });
}

async function logout(request, env) {
  const token = getCookie(request, COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return json({ ok: true }, 200, { "Set-Cookie": SIGNED_OUT });
}

// A member asks to delete their account (Apple requires this in the app). Admins get an email
// and remove the account by hand within 7 days; the member is signed out on every device now.
async function requestDeletion(request, env, me) {
  const name = me.name || me.email;
  await emailAdmins(env, `Stag Hunt: ${name} asked to delete their account`,
    `${name} <${me.email}> asked to delete their Stag Hunt account and data. Please do it within 7 days and reply to confirm.`,
    mailKicker("Account deletion") + mailTitle(escHtml(name)) + mailNote(escHtml(me.email)) +
    `<tr><td align="center" style="padding:0 0 16px;font:16px/1.65 Georgia,serif;color:#2E3445">They asked to delete their account and data. Please do it within 7 days and reply to confirm.</td></tr>` +
    mailBtn(`mailto:${encodeURIComponent(me.email)}`, "Reply"));
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(me.id),
    env.DB.prepare("DELETE FROM api_keys WHERE user_id = ?").bind(me.id),
  ]);
  return json({ ok: true }, 200, { "Set-Cookie": SIGNED_OUT });
}

async function currentUser(request, env) {
  const token = getCookie(request, COOKIE);
  if (!token) return null;
  return env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'active'`
  ).bind(await sha256(token), now()).first();
}

// A new signed-in session: the row to insert alongside the sign-in, and the cookie that carries it.
const sessionCookie = (token, maxAge) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
const SIGNED_OUT = sessionCookie("", 0);
async function newSession(env, userId, t) {
  const token = randomToken();
  return {
    insert: env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").bind(await sha256(token), userId, t, t + SESSION_TTL),
    cookie: sessionCookie(token, SESSION_TTL),
  };
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name || u.email.split("@")[0], role: u.role, network: u.network || "", created_at: u.created_at, last_login: u.last_login ?? null,
    terms_accepted_at: u.terms_accepted_at ?? null, notify_deals: u.notify_deals !== 0, notify_digest: u.notify_digest !== 0,
    headline: u.headline || "", location: u.location || "", bio: u.bio || "", focus: u.focus || "", check_size: u.check_size || "",
    tier: u.tier ?? null, thesis: u.thesis || "", involvement: u.involvement || "",
    linkedin: u.linkedin || "", twitter: u.twitter || "", website: u.website || "", photo_at: u.photo_at ?? null, cohort: u.cohort ?? null };
}

async function updateMe(request, env, me) {
  const b = await readJson(request);
  const name = clean(b.name, 80);
  if (!name) bad("Name is required.");
  if (String(b.tier ?? "").trim() && !dollars(b.tier)) bad("Check size should be an amount, like 25,000.");
  const handle =(v) => { const h = clean(v, 120); if (!h) return null; const m = h.match(/^@?([A-Za-z0-9_]{1,15})$/); return m ? "https://x.com/" + m[1] : cleanUrl(h); };
  const f = { headline: clean(b.headline, 120), location: clean(b.location, 80), bio: clean(b.bio, 1000), focus: clean(b.focus, 200),
    linkedin: cleanUrl(b.linkedin), twitter: handle(b.twitter), website: cleanUrl(b.website),
    tier: dollars(b.tier), thesis: clean(b.thesis, 400),
    involvement: INVOLVEMENT.includes(b.involvement) ? b.involvement : null };
  await env.DB.prepare(`UPDATE users SET name = ?, network = ?, headline = ?, location = ?, bio = ?, focus = ?, tier = ?, thesis = ?, involvement = ?, linkedin = ?, twitter = ?, website = ? WHERE id = ?`)
    .bind(name, clean(b.network, 500), f.headline, f.location, f.bio, f.focus, f.tier, f.thesis, f.involvement, f.linkedin, f.twitter, f.website, me.id).run();
  await notify(env, { type: "changed", what: "members" });
  const u = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(me.id).first();
  return json({ ok: true, user: publicUser(u) });
}

// ---------------------------------------------------------------- realtime

async function connectWs(request, env, me) {
  if (request.headers.get("Upgrade") !== "websocket") return json({ error: "expected_websocket" }, 426);
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "bad_origin" }, 403);
  const headers = new Headers(request.headers);
  headers.set("X-Member", JSON.stringify({ id: me.id, name: me.name || me.email.split("@")[0], observer: me.role === "observer" }));
  return hub(env).fetch("https://hub/connect", { headers });
}

function hub(env) { return env.HUB.get(env.HUB.idFromName("stag-hunt")); }

async function notify(env, payload) {
  try { await hub(env).fetch("https://hub/broadcast", { method: "POST", body: JSON.stringify(payload) }); } catch (e) { console.error("notify", e); }
}

// ---------------------------------------------------------------- stats

async function totals(env) {
  return env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM deals) AS deals_reviewed,
       (SELECT COUNT(DISTINCT deal_id) FROM investments) AS deals_invested,
       (SELECT COALESCE(SUM(amount_cents),0) FROM investments) AS invested_cents,
       (SELECT COALESCE(SUM(realized_cents),0) FROM investments) AS realized_cents,
       (SELECT COALESCE(SUM(COALESCE(paper_cents, amount_cents)),0) FROM investments) AS paper_cents`
  ).first();
}

async function overview(env, me) {
  const t = await totals(env);
  const [members, recent, toScore] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE status = 'active' AND role != 'observer'").first(),
    env.DB.prepare(
      `SELECT d.id, d.company, d.one_liner, d.status, d.created_at, d.poster_id, COALESCE(u.name,u.email) AS poster,
              (SELECT COUNT(*) FROM scores s WHERE s.deal_id = d.id AND s.yes = 1) AS yes_count,
              (SELECT COUNT(*) FROM scores s WHERE s.deal_id = d.id) AS score_count
       FROM deals d JOIN users u ON u.id = d.poster_id WHERE ${fitsSql(me)} ORDER BY d.created_at DESC LIMIT 5`).all(),
    env.DB.prepare(
      `SELECT d.id, d.company FROM deals d WHERE d.status IN ('reviewing','founder_call') AND d.poster_id != ?1 AND ${fitsSql(me)}
       AND NOT EXISTS (SELECT 1 FROM scores s WHERE s.deal_id = d.id AND s.member_id = ?1) ORDER BY d.created_at DESC`).bind(me.id).all(),
  ]);
  const [lockedOpen, lookBack] = await Promise.all([
    env.DB.prepare(`SELECT d.id, d.company FROM pledges p JOIN deals d ON d.id = p.deal_id WHERE p.member_id = ? AND p.locked_at IS NOT NULL
      AND d.status NOT IN ('passed','dead') AND NOT EXISTS (SELECT 1 FROM investments i WHERE i.deal_id = p.deal_id AND i.member_id = p.member_id)`).bind(me.id).all(),
    env.DB.prepare(`SELECT id, company FROM deals WHERE outcome IS NULL AND pending_outcome IS NULL AND created_at < ? AND (poster_id = ? OR ? = 'admin') ORDER BY created_at LIMIT 5`)
      .bind(now() - 180 * 86400, me.id, me.role).all(),
  ]);
  // Outcomes someone else reported on deals you brought or called, waiting for a second member.
  const toConfirm = me.role === "observer" ? { results: [] } : await env.DB.prepare(`SELECT d.id, d.company, d.pending_outcome FROM deals d
    WHERE d.pending_outcome IS NOT NULL AND d.pending_by != ?1
      AND (d.poster_id = ?1 OR EXISTS (SELECT 1 FROM scores s WHERE s.deal_id = d.id AND s.member_id = ?1)) ORDER BY d.pending_at LIMIT 5`).bind(me.id).all();
  const scorecard = await groupScorecard(env);
  const scoredSet = await myScored(env, me);
  return json({ totals: t, members: members.n, recent: recent.results.map((d) => hideScores(d, me, scoredSet)), to_score: toScore.results, scorecard,
    nudges: { locked_open: lockedOpen.results, look_back: lookBack.results, to_confirm: toConfirm.results } });
}


// Where the group stands, in plain numbers. Day 1 = the day the first deal is posted.
async function groupScorecard(env) {
  const first = await env.DB.prepare("SELECT MIN(created_at) AS t FROM deals").first();
  const day1 = first && first.t ? first.t : null;
  const from = day1 || 0;
  const r = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM users WHERE status = 'active' AND role != 'observer') AS members,
       (SELECT COUNT(*) FROM deals WHERE created_at >= ?1) AS deals,
       (SELECT COUNT(DISTINCT d.poster_id) FROM deals d JOIN users u ON u.id = d.poster_id
          WHERE u.status = 'active' AND u.role != 'observer' AND d.created_at >= ?1) AS posters,
       (SELECT COUNT(*) FROM deals d WHERE d.created_at >= ?1 AND
          (SELECT COUNT(*) FROM scores s WHERE s.deal_id = d.id AND s.member_id != d.poster_id) >=
          (SELECT COUNT(*) FROM users u WHERE u.status = 'active' AND u.role != 'observer' AND u.id != d.poster_id
             AND (u.role != 'member' OR u.tier IS NULL OR d.min_tier IS NULL OR d.min_tier <= u.tier))) AS rated_all,
       (SELECT COUNT(*) FROM deals d WHERE d.created_at >= ?1 AND (
          EXISTS (SELECT 1 FROM pledges p WHERE p.deal_id = d.id AND p.member_id != d.poster_id) OR
          EXISTS (SELECT 1 FROM investments i WHERE i.deal_id = d.id AND i.member_id != d.poster_id))) AS live,
       (SELECT COUNT(*) FROM applications WHERE created_at >= ?1) AS applications`
  ).bind(from).first();
  const day = day1 ? Math.floor((now() - day1) / 86400) + 1 : null;
  return { day1, day, ...r };
}

// ---------------------------------------------------------------- members

async function updatePhoto(request, env, me) {
  const b = await readJson(request);
  if (b.remove) await env.DB.prepare("UPDATE users SET photo = NULL, photo_at = NULL WHERE id = ?").bind(me.id).run();
  else {
    const d = String(b.photo || "");
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(d)) bad("That photo didn't upload. Try a JPEG or PNG.");
    if (d.length > 300000) bad("That photo is too large.");
    await env.DB.prepare("UPDATE users SET photo = ?, photo_at = ? WHERE id = ?").bind(d, now(), me.id).run();
  }
  await notify(env, { type: "changed", what: "members" });
  const u = await env.DB.prepare("SELECT photo_at FROM users WHERE id = ?").bind(me.id).first();
  return json({ ok: true, photo_at: u.photo_at });
}

async function getPhoto(env, id) {
  const u = await env.DB.prepare("SELECT photo FROM users WHERE id = ? AND status = 'active'").bind(id).first();
  if (!u || !u.photo) throw new HttpError(404, "not_found", "No photo.");
  const [, type, b64] = u.photo.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Response(bytes, { headers: { "Content-Type": type, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
}

async function getMember(env, id, me) {
  const { results } = await env.DB.prepare(MEMBERS_SQL + " AND u.id = ?").bind(now() - 30 * 86400, id).all();
  if (!results.length || (results[0].role === "observer" && me.role !== "admin")) throw new HttpError(404, "not_found", "Member not found.");
  const deals = (await env.DB.prepare(`SELECT id, company, one_liner, status, created_at FROM deals WHERE poster_id = ? ORDER BY created_at DESC LIMIT 20`).bind(id).all()).results;
  // What they actually back, learned from every yes or no on other members' deals
  const calls = (await env.DB.prepare(`SELECT s.yes, d.sector, d.round_type, d.min_tier FROM scores s JOIN deals d ON d.id = s.deal_id
    WHERE s.member_id = ? AND d.poster_id != ?`).bind(id, id).all()).results;
  const tally = (key) => {
    const m = {};
    for (const c of calls) { const k = (c[key] || "").toString().trim(); if (!k) continue; const t = (m[k.toLowerCase()] ||= { name: k, yes: 0, n: 0 }); t.n++; t.yes += c.yes; }
    return Object.values(m).sort((a, b) => b.yes - a.yes || b.n - a.n).slice(0, 5);
  };
  const taste = { calls: calls.length, yes: calls.filter((c) => c.yes).length, sectors: tally("sector"), rounds: tally("round_type") };
  return json({ member: results[0], deals, taste });
}

const MEMBERS_SQL = `SELECT u.id, u.email, COALESCE(u.name, u.email) AS name, u.role, u.network, u.created_at, u.last_login,
       u.headline, u.location, u.bio, u.focus, u.check_size, u.tier, u.thesis, u.involvement, u.linkedin, u.twitter, u.website, u.photo_at, u.cohort,
       (SELECT COUNT(*) FROM scores s JOIN deals d ON d.id = s.deal_id WHERE s.member_id = u.id AND d.poster_id != u.id AND s.yes = 1) AS yes_on_others,
       (SELECT COUNT(*) FROM deals d WHERE d.poster_id = u.id) AS deals_posted,
       (SELECT COUNT(*) FROM deals d WHERE d.poster_id = u.id AND d.created_at > ?) AS deals_30d,
       (SELECT MAX(created_at) FROM deals d WHERE d.poster_id = u.id) AS last_deal_at,
       (SELECT COUNT(*) FROM scores s WHERE s.member_id = u.id) AS scores_given,
       (SELECT COALESCE(SUM(amount_cents),0) FROM investments i WHERE i.member_id = u.id) AS invested_cents,
       (SELECT COUNT(*) FROM investments i WHERE i.member_id = u.id) AS investments,
       (SELECT COUNT(*) FROM deals d WHERE d.poster_id != u.id AND d.created_at >= u.created_at
          AND (u.role != 'member' OR u.tier IS NULL OR d.min_tier IS NULL OR d.min_tier <= u.tier)) AS scores_possible,
       (SELECT COUNT(*) FROM scores s JOIN deals d ON d.id = s.deal_id WHERE s.member_id = u.id AND d.poster_id != u.id) AS scores_on_others,
       (SELECT COUNT(*) FROM pledges p WHERE p.member_id = u.id AND p.locked_at IS NOT NULL) AS pledges_locked,
       (SELECT COUNT(*) FROM pledges p WHERE p.member_id = u.id AND p.locked_at IS NOT NULL
          AND EXISTS (SELECT 1 FROM investments i WHERE i.deal_id = p.deal_id AND i.member_id = u.id)) AS pledges_kept,
       (SELECT COUNT(*) FROM scores s JOIN deals d ON d.id = s.deal_id WHERE s.member_id = u.id AND d.outcome IS NOT NULL) AS calls,
       (SELECT COUNT(*) FROM scores s JOIN deals d ON d.id = s.deal_id WHERE s.member_id = u.id AND d.outcome IS NOT NULL
          AND s.yes = (d.outcome IN ('breakout','on_track'))) AS calls_right
     FROM users u WHERE u.status = 'active'`;

async function listMembers(env, me) {
  const since = now() - 30 * 86400;
  const { results } = await env.DB.prepare(MEMBERS_SQL + " ORDER BY u.created_at").bind(since).all();
  const observers = results.filter((u) => u.role === "observer");
  return json({ members: me && me.role === "admin" ? results : results.filter((u) => u.role !== "observer"), observers: observers.map((u) => ({ id: u.id, name: u.name })) });
}

async function addMember(request, env, me) {
  const b = await readJson(request);
  const email = normalizeEmail(b.email);
  const name = clean(b.name, 80);
  if (!email) bad("Enter a valid email.");
  if (!name) bad("Name is required.");
  const role = b.role === "admin" ? "admin" : b.role === "observer" ? "observer" : "member";
  if (await env.DB.prepare("SELECT 1 FROM users WHERE email = ? AND status = 'active'").bind(email).first()) bad("That person is already a member.");
  await admit(env, { email, name, role, invitedBy: me.id });
  if (b.send_invite) await sendInvite(env, email, name, me, role === "observer");
  await notify(env, { type: "changed", what: "members" });
  return json({ ok: true });
}

// Lets someone in: brings back a past account with the same email, or creates one.
// Members get the open group's label; observers join no group.
async function admit(env, { email, name, role, invitedBy, keepName = false }) {
  const cohort = role === "observer" ? null : await groupFor(env);
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (existing) await env.DB.prepare(`UPDATE users SET status = 'active', name = ${keepName ? "COALESCE(name, ?)" : "?"}, role = ?, invited_by = ?, cohort = ? WHERE id = ?`)
    .bind(name, role, invitedBy, cohort, existing.id).run();
  else await insertRow(env, "users", { id: crypto.randomUUID(), email, created_at: now(), name, role, status: "active", invited_by: invitedBy, cohort }).run();
  if (role !== "observer") await env.DB.prepare(`INSERT OR IGNORE INTO memberships (person, hunt, role, joined_at)
    SELECT u.id, (SELECT id FROM hunts ORDER BY created_at, id LIMIT 1), 'member', ?1 FROM users u
    WHERE u.email = ?2 AND EXISTS (SELECT 1 FROM hunts) AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.person = u.id)`).bind(now(), email).run();
}

// ---------------------------------------------------------------- hunts
// Architecture, Phase 1. A hunt is a group that shares deals; one account can be in many.
// Joining and leaving are always the person's own choice (I8). A lead only manages settings.

const huntName = (v) => clean(v, 60) || bad("Give the hunt a name.");
const myRole = async (env, me, hunt) => (await env.DB.prepare("SELECT role FROM memberships WHERE person = ? AND hunt = ?").bind(me.id, hunt).first())?.role;

async function listHunts(env, me) {
  const [mine, invites] = await Promise.all([
    env.DB.prepare(`SELECT h.id, h.name, h.is_fund, m.role,
        (SELECT COUNT(*) FROM memberships x JOIN users xu ON xu.id = x.person WHERE x.hunt = h.id AND xu.status = 'active') AS members,
        (SELECT COUNT(*) FROM deals d WHERE d.home_hunt = h.id) AS deals
      FROM memberships m JOIN hunts h ON h.id = m.hunt WHERE m.person = ? ORDER BY m.joined_at, h.id`).bind(me.id).all(),
    env.DB.prepare(`SELECT h.id, h.name, COALESCE(u.name, u.email) AS invited_by,
        (SELECT COUNT(*) FROM memberships x JOIN users xu ON xu.id = x.person WHERE x.hunt = h.id AND xu.status = 'active') AS members
      FROM hunt_invites i JOIN hunts h ON h.id = i.hunt JOIN users u ON u.id = i.invited_by
      WHERE i.email = ? ORDER BY i.created_at DESC`).bind(me.email).all(),
  ]);
  return json({ hunts: mine.results, invites: invites.results });
}

async function createHunt(request, env, me) {
  const name = huntName((await readJson(request)).name);
  const id = crypto.randomUUID(), t = now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO hunts (id, name, created_at) VALUES (?, ?, ?)").bind(id, name, t),
    env.DB.prepare("INSERT INTO memberships (person, hunt, role, joined_at) VALUES (?, ?, 'lead', ?)").bind(me.id, id, t),
  ]);
  return json({ ok: true, id });
}

async function getHunt(env, me, id) {
  const role = await myRole(env, me, id);
  if (!role) throw new HttpError(404, "not_found", "Hunt not found.");
  const [hunt, members, invites] = await Promise.all([
    env.DB.prepare("SELECT id, name, is_fund, created_at, (SELECT COUNT(*) FROM deals d WHERE d.home_hunt = hunts.id) AS deals FROM hunts WHERE id = ?").bind(id).first(),
    env.DB.prepare(`SELECT u.id, COALESCE(u.name, u.email) AS name, u.headline, m.role, m.joined_at
      FROM memberships m JOIN users u ON u.id = m.person WHERE m.hunt = ? AND u.status = 'active' ORDER BY m.joined_at, u.id`).bind(id).all(),
    env.DB.prepare(`SELECT i.email, i.created_at, (SELECT name FROM users u WHERE u.email = i.email AND u.status = 'active') AS name
      FROM hunt_invites i WHERE i.hunt = ? AND i.invited_by = ? ORDER BY i.created_at DESC`).bind(id, me.id).all(),   // you see only the invites you sent
  ]);
  return json({ hunt: { ...hunt, role }, members: members.results, invites: invites.results });
}

async function renameHunt(request, env, me, id) {
  if ((await myRole(env, me, id)) !== "lead") throw new HttpError(403, "forbidden", "Only a lead can rename the hunt.");
  await env.DB.prepare("UPDATE hunts SET name = ? WHERE id = ?").bind(huntName((await readJson(request)).name), id).run();
  await notify(env, { type: "changed", what: "hunts" });
  return json({ ok: true });
}

async function huntAction(request, env, me, id, action) {
  const hunt = await env.DB.prepare("SELECT id, name FROM hunts WHERE id = ?").bind(id).first();
  const role = hunt && await myRole(env, me, id);
  const invited = hunt && await env.DB.prepare("SELECT 1 FROM hunt_invites WHERE hunt = ? AND email = ?").bind(id, me.email).first();
  if (!hunt || (!role && !invited)) throw new HttpError(404, "not_found", "Hunt not found.");   // a hunt you aren't in or invited to doesn't exist to you
  const t = now();

  if (action === "invite" || action === "uninvite") {
    if (!role) throw new HttpError(403, "forbidden", "Only members of a hunt can invite to it.");
    const email = normalizeEmail((await readJson(request)).email);
    if (!email) bad("Enter a valid email.");
    if (action === "uninvite") {
      await env.DB.prepare("DELETE FROM hunt_invites WHERE hunt = ? AND email = ? AND invited_by = ?").bind(id, email, me.id).run();
      return json({ ok: true });
    }
    const them = await env.DB.prepare("SELECT id, name, role FROM users WHERE email = ? AND status = 'active'").bind(email).first();
    if (them && them.role === "observer") bad("Observers can't join hunts.");
    if (them && await env.DB.prepare("SELECT 1 FROM memberships WHERE person = ? AND hunt = ?").bind(them.id, id).first()) bad("They're already in this hunt.");
    const r = await env.DB.prepare("INSERT OR IGNORE INTO hunt_invites (hunt, email, invited_by, created_at) VALUES (?, ?, ?, ?)").bind(id, email, me.id, t).run();
    if (them && r.meta.changes) {
      const who = me.name || me.email, link = `${RP_ORIGIN}/app#/hunts`;
      await sendMail(env, email, `${who} invited you to ${hunt.name}`,
        `${who} invited you to join ${hunt.name}, a hunt on Stag Hunt. Joining is your choice.\n\n${link}`,
        mailLayout(env.APP_NAME, mailKicker("Hunt invite") + mailTitle(escHtml(hunt.name)) +
          mailPara(`${escHtml(who)} invited you to join this hunt. Joining is your choice, and you can leave any time.`, 6) + mailBtn(link, "See the invite")));
      await notify(env, { type: "changed", what: "hunts" });
    }
    return json({ ok: true, member: !!them });
  }

  if (action === "join" || action === "decline") {
    if (!invited) bad("That invite is gone.");
    if (me.role === "observer") throw new HttpError(403, "observer", "Observers can't join hunts.");
    await env.DB.batch([
      ...(action === "join" ? [env.DB.prepare("INSERT OR IGNORE INTO memberships (person, hunt, role, joined_at) VALUES (?, ?, 'member', ?)").bind(me.id, id, t)] : []),
      env.DB.prepare("DELETE FROM hunt_invites WHERE hunt = ? AND email = ?").bind(id, me.email),
    ]);
  }

  if (action === "leave") {
    if (!role) bad("You aren't in this hunt.");
    // The hunt outlives any one person: the longest-standing member leads if the last lead goes,
    // and an empty hunt with no deals is removed.
    await env.DB.batch([
      env.DB.prepare("DELETE FROM memberships WHERE person = ? AND hunt = ?").bind(me.id, id),
      env.DB.prepare(`UPDATE memberships SET role = 'lead' WHERE hunt = ?1 AND NOT EXISTS (SELECT 1 FROM memberships WHERE hunt = ?1 AND role = 'lead')
        AND person = (SELECT person FROM memberships WHERE hunt = ?1 ORDER BY joined_at, person LIMIT 1)`).bind(id),
      env.DB.prepare(`DELETE FROM hunts WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM memberships WHERE hunt = ?1)
        AND NOT EXISTS (SELECT 1 FROM deals WHERE home_hunt = ?1)`).bind(id),
    ]);
  }
  await notify(env, { type: "changed", what: "hunts" });
  return json({ ok: true });
}

// Public contact form: messages go to the admins by email; no address is published
async function contactUs(request, env) {
  const b = await readJson(request);
  if (b.website) return json({ ok: true });                       // honeypot: bots fill hidden fields
  const ip = clientIp(request);
  if (!(await allow(env, `contact:${ip}`, 5, 3600))) return json({ error: "rate_limited", message: "Too many messages. Please try again later." }, 429);
  const name = clean(b.name, 80), email = normalizeEmail(b.email), topic = clean(b.topic, 40) || "General", msg = clean(b.message, 3000);
  if (!name || !email) bad("Add your name and a valid email so we can reply.");
  if (!msg || msg.length < 5) bad("Write a short message.");
  await emailAdmins(env, `Stag Hunt contact: ${topic} from ${name}`,
    `From: ${name} <${email}>\nTopic: ${topic}\n\n${msg}\n\nReply to them at ${email}.`,
    mailKicker(`New message · ${escHtml(topic)}`) + mailTitle(escHtml(name)) + mailNote(escHtml(email)) +
    `<tr><td align="center" style="padding:0 0 16px;font:16px/1.65 Georgia,serif;color:#2E3445;white-space:pre-wrap">${escHtml(msg)}</td></tr>` +
    mailBtn(`mailto:${encodeURIComponent(email)}`, "Reply"));
  return json({ ok: true });
}

// ---------------------------------------------------------------- founder applications
// Founders apply at /apply. Applications sit in the members' Inbound pool.
// A member takes the call, then posts it as their own deal. Nothing reaches
// the Deals list without a member behind it.

async function applyFounder(request, env) {
  const b = await readJson(request);
  if (b.hp) return json({ ok: true });                            // honeypot
  const ip = clientIp(request);
  if (!(await allow(env, `apply:${ip}`, 3, 3600))) return json({ error: "rate_limited", message: "Too many applications from here. Try again in an hour." }, 429);
  const a = {
    founder_name: clean(b.founder_name, 80), founder_email: normalizeEmail(b.founder_email), founder_link: cleanUrl(b.founder_link),
    why_you: clean(b.why_you, 600),
    company: clean(b.company, 120), website: cleanUrl(b.website), sector: clean(b.sector, 80), one_liner: clean(b.one_liner, 400),
    end_state: clean(b.end_state, 300), flywheel: clean(b.flywheel, 300), next_goal: clean(b.next_goal, 300), blocker: clean(b.blocker, 300),
    customers: clean(b.customers, 400), traction: clean(b.traction, 400), acquisition: clean(b.acquisition, 400), competition: clean(b.competition, 400),
    round_type: ROUND_TYPES.includes(b.round_type) ? b.round_type : null,
    raise_amount: clean(b.raise_amount, 80), valuation_cap: clean(b.valuation_cap, 80), min_check: clean(b.min_check, 80), deadline: clean(b.deadline, 40),
    accredited_only: b.accredited_only ? 1 : 0, deck_url: cleanUrl(b.deck_url), video_url: cleanUrl(b.video_url), why_now: clean(b.why_now, 600), heard_from: clean(b.heard_from, 200),
  };
  if (!a.founder_name || !a.founder_email) bad("Add your name and a valid email.");
  if (!a.why_you) bad("Say why you're the one to build this.");
  if (!a.company || !a.one_liner) bad("Add the company name and what it does.");
  if (!a.customers || !a.traction || !a.acquisition || !a.competition) bad("Answer the four questions under Where it is today. \"None yet\" is a fine answer.");
  if (!a.end_state || !a.flywheel || !a.next_goal || !a.blocker) bad("Answer the four questions under Where it's going.");
  if (!a.round_type) bad("Pick how you're raising.");
  if (!a.why_now) bad("Add a line on why now.");
  // A founder who did the spoken interview doesn't need a video: members hear the recording
  const iv = /^[0-9a-f-]{36}$/.test(b.interview_id || "") ? await env.DB.prepare(
    "SELECT id FROM interviews i WHERE id = ? AND transcript IS NOT NULL AND NOT EXISTS (SELECT 1 FROM applications WHERE interview_id = i.id)").bind(b.interview_id).first() : null;
  a.interview_id = iv ? iv.id : null;
  a.min_tier = tierFromCheck(a.min_check);
  if (iv ? a.video_url && !/^https:\/\//i.test(a.video_url) : !a.video_url || !/^https:\/\//i.test(a.video_url)) bad("Add a link to your one-minute video.");
  if (a.deck_url && !/^https:\/\//i.test(a.deck_url)) bad("The deck link should start with https://");
  if (b.meets_standard !== true) bad("Confirm the company meets our standard.");
  const dup = await env.DB.prepare("SELECT 1 FROM applications WHERE founder_email = ? AND lower(company) = lower(?) AND created_at > ?").bind(a.founder_email, a.company, now() - 30 * 86400).first();
  if (dup) return json({ ok: true });                             // already have it
  await insertRow(env, "applications", { id: crypto.randomUUID(), ...a, created_at: now() }).run();
  await sendMail(env, a.founder_email, `We got your application: ${a.company}`,
    `Hi ${a.founder_name.split(" ")[0]},\n\nStag Hunt's members can now see your application for ${a.company}. If one of them wants to talk, they'll email you directly.\n\nIf you don't hear back, it doesn't mean the company is bad. Members only take calls that fit what they invest in. Stag Hunt itself doesn't invest. Each member decides alone, with their own money.\n\nStag Hunt`,
    emailShell(env.APP_NAME,
      mailTitle("We got your application") +
      mailPara(`Hi ${escHtml(a.founder_name.split(" ")[0])}. Stag Hunt's members can now see your application for <b>${escHtml(a.company)}</b>. If one of them wants to talk, they'll email you directly.`) +
      mailNote("If you don't hear back, it doesn't mean the company is bad. Members only take calls that fit what they invest in. Stag Hunt itself doesn't invest. Each member decides alone, with their own money.", 0)));
  await notify(env, { type: "changed", what: "inbound" });
  return json({ ok: true });
}

const APP_SQL = `SELECT a.*, COALESCE(u.name, u.email) AS claimer_name FROM applications a LEFT JOIN users u ON u.id = a.claimed_by`;
async function listInbound(env, me) {
  const { results } = await env.DB.prepare(APP_SQL + " WHERE a.status IN ('open','claimed') ORDER BY a.created_at DESC").all();
  // Each application reaches the members whose check size fits it, like deals do
  const mine = results.filter((a) => a.claimed_by === me.id || fits(me, { min_tier: a.min_tier, poster_id: null }));
  return json({ applications: mine.map(({ founder_email, ...x }) => x) });
}
async function getApplication(env, me, id) {
  const a = await env.DB.prepare(APP_SQL + " WHERE a.id = ?").bind(id).first();
  if (!a) throw new HttpError(404, "not_found", "Application not found.");
  const mine = a.claimed_by === me.id;
  if (!mine && me.role !== "admin") delete a.founder_email;   // one member reaches out, not twelve
  if (a.interview_id) a.interview = (await env.DB.prepare("SELECT transcript, duration_secs FROM interviews WHERE id = ?").bind(a.interview_id).first()) || null;
  return json({ application: a, mine });
}
async function claimApplication(env, me, id, action) {
  const r = action === "claim"
    ? await env.DB.prepare("UPDATE applications SET status = 'claimed', claimed_by = ?, claimed_at = ? WHERE id = ? AND status = 'open'").bind(me.id, now(), id).run()
    : await env.DB.prepare("UPDATE applications SET status = 'open', claimed_by = NULL, claimed_at = NULL WHERE id = ? AND status = 'claimed' AND (claimed_by = ? OR ? = 'admin')").bind(id, me.id, me.role).run();
  if (!r.meta.changes) bad(action === "claim" ? "Another member already took this one." : "Only the member taking the call can let it go.");
  await notify(env, { type: "changed", what: "inbound", id });
  return json({ ok: true });
}

// ---------------------------------------------------------------- cohorts
// No cap: every approved member joins one network. Groups are only labels (like "Founding group"),
// so a new member gets the open group's label if there is one.
async function groupFor(env) {
  const c = await env.DB.prepare("SELECT number FROM cohorts WHERE status = 'open' ORDER BY number DESC LIMIT 1").first();
  return c ? c.number : null;
}
async function listCohorts(env) {
  const { results } = await env.DB.prepare(`SELECT c.*, (SELECT COUNT(*) FROM users u WHERE u.status = 'active' AND u.cohort = c.number) AS members FROM cohorts c ORDER BY c.number`).all();
  return json({ cohorts: results });
}
async function openCohort(request, env) {
  const b = await readJson(request);
  const last = await env.DB.prepare("SELECT MAX(number) AS n FROM cohorts").first();
  const n = (last.n || 0) + 1, t = now();
  await env.DB.batch([   // seats is unused now (no cap); 0 keeps the old column filled
    env.DB.prepare("UPDATE cohorts SET status = 'closed', closed_at = ? WHERE status = 'open'").bind(t),
    env.DB.prepare("INSERT INTO cohorts (number, name, seats, status, opened_at) VALUES (?, ?, 0, 'open', ?)").bind(n, clean(b.name, 60), t),
  ]);
  await notify(env, { type: "changed", what: "members" });
  return json({ ok: true, number: n });
}
async function editCohort(request, env, n) {
  const b = await readJson(request);
  const c = await env.DB.prepare("SELECT * FROM cohorts WHERE number = ?").bind(n).first();
  if (!c) throw new HttpError(404, "not_found", "Group not found.");
  if (b.name !== undefined) await env.DB.prepare("UPDATE cohorts SET name = ? WHERE number = ?").bind(clean(b.name, 60), n).run();
  if (b.status === "closed") await env.DB.prepare("UPDATE cohorts SET status = 'closed', closed_at = ? WHERE number = ?").bind(now(), n).run();
  if (b.status === "open") await env.DB.batch([
    env.DB.prepare("UPDATE cohorts SET status = 'closed', closed_at = ? WHERE status = 'open' AND number != ?").bind(now(), n),
    env.DB.prepare("UPDATE cohorts SET status = 'open', closed_at = NULL WHERE number = ?").bind(n),
  ]);
  await notify(env, { type: "changed", what: "members" });
  return json({ ok: true });
}

async function sendInvite(env, email, name, inviter, observer = false) {
  const who = inviter.name || "A member";
  await sendMail(env, email, `You're invited to ${env.APP_NAME}`,
    `Hi ${name},\n\n${who} has added you to ${env.APP_NAME}, a new way to invest in early-stage companies: investors share every good deal they find, and each decides alone.${observer ? " You're joining as a guest: you can read everything, but you can't post or make calls on deals." : ""}\n\nSign in with this email address at https://staghunts.com/login. No password needed.\n\nDeals and terms shared in Stag Hunt stay among members.`,
    inviteEmailHtml(env.APP_NAME, name, who, observer));
}

async function editMember(request, env, me, id) {
  const b = await readJson(request);
  const target = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
  if (!target) throw new HttpError(404, "not_found", "Member not found.");
  if (b.status === "removed") {
    if (target.id === me.id) bad("You can't remove yourself.");
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET status = 'removed' WHERE id = ?").bind(id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id),
      env.DB.prepare("DELETE FROM api_keys WHERE user_id = ?").bind(id),
    ]);
    try { await hub(env).fetch("https://hub/kick", { method: "POST", body: JSON.stringify({ user_id: id }) }); } catch {}
  }
  if (b.cohort !== undefined) {
    const c = await env.DB.prepare("SELECT number FROM cohorts WHERE number = ?").bind(parseInt(b.cohort, 10)).first();
    if (!c) bad("Pick a group.");
    await env.DB.prepare("UPDATE users SET cohort = ? WHERE id = ?").bind(c.number, id).run();
  }
  if (b.role === "admin" || b.role === "member" || b.role === "observer") {
    if (target.id === me.id && b.role !== "admin") bad("You can't remove your own admin role.");
    if (b.role === "observer") await env.DB.prepare("UPDATE users SET role = 'observer', cohort = NULL WHERE id = ?").bind(id).run();
    else {
      let cohort = target.cohort;
      if (target.role === "observer" && !cohort) cohort = await groupFor(env);
      await env.DB.prepare("UPDATE users SET role = ?, cohort = ? WHERE id = ?").bind(b.role, cohort, id).run();
    }
    try { await hub(env).fetch("https://hub/kick", { method: "POST", body: JSON.stringify({ user_id: id, reconnect: true }) }); } catch {}
  }
  await notify(env, { type: "changed", what: "members" });
  return json({ ok: true });
}

// ---------------------------------------------------------------- deals

const DEAL_LIST_SQL = `
  SELECT d.*, COALESCE(u.name, u.email) AS poster_name, (SELECT name FROM hunts h WHERE h.id = d.home_hunt) AS hunt_name,
    (SELECT COUNT(*) FROM scores s WHERE s.deal_id = d.id) AS score_count,
    (SELECT AVG(total) FROM scores s WHERE s.deal_id = d.id) AS avg_total,
    (SELECT COUNT(*) FROM scores s WHERE s.deal_id = d.id AND s.yes = 1) AS yes_count,
    (SELECT COUNT(*) FROM investments i WHERE i.deal_id = d.id) AS investor_count,
    (SELECT COALESCE(SUM(amount_cents),0) FROM investments i WHERE i.deal_id = d.id) AS invested_cents
  FROM deals d JOIN users u ON u.id = d.poster_id`;

// Check-size tiers. A member sees deals whose smallest check is at or below their tier.
// Admins, observers and members who haven't picked a tier see everything; posters always see their own.
const INVOLVEMENT = ["silent", "advice", "hands_on"];
const tierLabel = (t) => {             // $500, $7.5k, $25k, $12,345, $1.5M
  const n = Number(t);
  if (n >= 1e6 && n % 1e5 === 0) return `$${n / 1e6}M`;
  if (n >= 1e3 && n % 100 === 0) return `$${n / 1e3}k`;
  return "$" + n.toLocaleString("en-US");
};
// Any amount in dollars: "25000", "$25,000", "25k", "1.5M". Whole dollars from $1 to $10 billion.
function dollars(v) {
  const m = String(v ?? "").replace(/[,\s]/g, "").match(/^\$?(\d+(?:\.\d+)?)(k|thousand|m|mm|million)?$/i);
  if (!m) return null;
  const n = Math.round(Number(m[1]) * ({ k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, million: 1e6 }[(m[2] || "").toLowerCase()] || 1));
  return n >= 1 && n <= 1e10 ? n : null;
}
const seesAll = (me) => me.role !== "member" || !me.tier;
const fits = (me, d) => seesAll(me) || d.min_tier == null || d.min_tier <= me.tier || d.poster_id === me.id;
// The same rule as SQL, for queries with a LIMIT (deals table aliased as d; me.id is a server-made id)
const fitsSql = (me) => (seesAll(me) ? "1" : `(d.min_tier IS NULL OR d.min_tier <= ${Number(me.tier)} OR d.poster_id = '${String(me.id).replace(/[^0-9a-zA-Z-]/g, "")}')`);

// Judge alone: a member sees others' calls only after making their own,
// once a deal is past the scoring stage, or if they can't call it (observers, and whoever brought it).
const SCORING = ["reviewing", "founder_call"];
function hideScores(d, me, scored) {
  if (me.role === "observer" || d.poster_id === me.id || !SCORING.includes(d.status) || scored.has(d.id)) return { ...d, scores_hidden: false };
  return { ...d, avg_total: null, yes_count: null, scores_hidden: true };
}
async function myScored(env, me) {
  const r = await env.DB.prepare("SELECT deal_id FROM scores WHERE member_id = ?").bind(me.id).all();
  return new Set(r.results.map((x) => x.deal_id));
}

async function listDeals(env, me) {
  const { results } = await env.DB.prepare(DEAL_LIST_SQL + " ORDER BY d.created_at DESC").all();
  const scored = await myScored(env, me);
  return json({ deals: results.filter((d) => fits(me, d)).map((d) => ({ ...hideScores(d, me, scored), i_scored: scored.has(d.id) })) });
}

// The company's own place to invest. Secure links only: members may follow it to sign and send money.
function investUrl(v) {
  if (!clean(v, 300)) return null;
  const u = cleanUrl(v);
  if (!u || !u.startsWith("https://")) bad("The invest link needs to be a secure link, starting with https://");
  return u;
}

function dealFields(b, partial = false) {
  const f = {
    company: clean(b.company, 120),
    website: cleanUrl(b.website),
    invest_url: investUrl(b.invest_url),
    sector: clean(b.sector, 80),
    one_liner: clean(b.one_liner, 400),
    round_type: ROUND_TYPES.includes(b.round_type) ? b.round_type : null,
    raise_amount: clean(b.raise_amount, 80),
    valuation_cap: clean(b.valuation_cap, 80),
    discount: clean(b.discount, 80),
    min_tier: dollars(b.min_tier),
    min_check: clean(b.min_check, 80),
    deadline: clean(b.deadline, 40),
    accredited_only: b.accredited_only ? 1 : 0,
    how_found: clean(b.how_found, 1000),
    why_now: clean(b.why_now, 600),
    disclosure: clean(b.disclosure, 600),
    end_state: clean(b.end_state, 300),
    flywheel: clean(b.flywheel, 300),
    next_goal: clean(b.next_goal, 300),
    blocker: clean(b.blocker, 300),
    customers: clean(b.customers, 400),
    traction: clean(b.traction, 400),
    acquisition: clean(b.acquisition, 400),
    competition: clean(b.competition, 400),
    round_public: b.round_public ? 1 : 0,
    materials: cleanMaterials(b.materials),
  };
  if (!partial) {
    if (!f.company) bad("Company name is required.");
    if (!f.one_liner) bad("Say what the company does.");
    if (!f.round_type) bad("Pick the round type.");
    if (!f.how_found) bad("Say how you came across this deal.");
    if (!f.why_now) bad("Add a one-line why now.");
    if (!f.min_tier) bad("Add the smallest check the founder takes, like $25,000.");
  }
  if (f.min_tier) f.min_check = tierLabel(f.min_tier);
  return f;
}

const MATERIAL_LABELS = ["Founder video", "Pitch deck", "Demo", "Data room", "Founder's link", "Memo", "Other"];
function cleanMaterials(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const m of list.slice(0, 6)) {
    const url = cleanUrl(m && m.url);
    if (!url || !/^https:\/\//i.test(url)) continue;
    const label = MATERIAL_LABELS.includes(m.label) ? m.label : (clean(m && m.label, 40) || "Link");
    out.push({ label, url });
  }
  return out.length ? JSON.stringify(out) : null;
}

// A member's call on a deal: do you want to meet the team, yes or no, with one line on why,
// and whether you've already met them (a yes from someone who has counts for more).
// The ten questions behind every check are optional: all ten (0-10, total out of 100) or none.
const SCORE_KEYS = ["team", "problem", "product", "market", "moat", "money", "growth", "retention", "timing", "endgame"];
function scoreFields(b) {
  if (b.yes !== true && b.yes !== false) bad("Say yes or no: do you want to meet the team?");
  if (b.met !== true && b.met !== false) bad("Say whether you've met the founders.");
  const s = { yes: b.yes ? 1 : 0, met: b.met ? 1 : 0, why: clean(b.why, 300), total: null };
  if (!s.why) bad("Add one line on why.");
  const given = SCORE_KEYS.filter((k) => b[k] !== undefined && b[k] !== null && b[k] !== "");
  if (given.length && given.length < SCORE_KEYS.length) bad("Score all ten questions, or leave them all empty.");
  for (const k of SCORE_KEYS) {
    s[k] = null; s[k + "_why"] = null;
    if (!given.length) continue;
    const v = Number(b[k]);
    if (!Number.isInteger(v) || v < 0 || v > 10) bad("Each score must be a whole number from 0 to 10.");
    s[k] = v;
    s.total = (s.total || 0) + v;
    s[k + "_why"] = clean(b[k + "_why"], 300);
  }
  return s;
}

async function createDeal(request, env, me, ctx) {
  const b = await readJson(request);
  const f = dealFields(b);
  if (!f.customers || !f.traction || !f.acquisition || !f.competition) bad("Answer the four questions under Where is it today? \"None yet\" is a fine answer.");
  if (!f.end_state || !f.flywheel || !f.next_goal || !f.blocker) bad("Answer the four questions under Where is it going?");
  if (b.meets_standard !== true) bad("Confirm the company meets our standard: no gambling, adult content, or cheating.");
  const s = scoreFields({ ...(b.score || {}), met: true });   // whoever brings a deal knows the founders
  const recId = typeof b.rec_id === "string" && /^[0-9a-f-]{36}$/.test(b.rec_id) ? b.rec_id : null;
  const fromRec = recId && (await env.DB.prepare("SELECT 1 FROM recordings WHERE id = ? AND member_id = ?").bind(recId, me.id).first()) ? 1 : 0;
  const appId = typeof b.app_id === "string" && /^[0-9a-f-]{36}$/.test(b.app_id) ? b.app_id : null;
  if (appId && !(await env.DB.prepare("SELECT 1 FROM applications WHERE id = ? AND claimed_by = ? AND status = 'claimed'").bind(appId, me.id).first()))
    bad("Take the call on this application before posting it.");
  // The deal's home hunt: the one named, or the bringer's only hunt.
  const mine = (await env.DB.prepare("SELECT hunt FROM memberships WHERE person = ? ORDER BY joined_at, hunt").bind(me.id).all()).results.map((r) => r.hunt);
  const home = mine.includes(b.home_hunt) ? b.home_hunt : mine.length === 1 ? mine[0] : null;
  if (!home) bad(mine.length ? "Choose which hunt this deal is for." : "Start or join a hunt before sharing a deal.");
  const id = crypto.randomUUID(), t = now();
  const row = { id, poster_id: me.id, home_hunt: home, ...f, from_recording: fromRec, application_id: appId, status: "reviewing", created_at: t, updated_at: t };
  await env.DB.batch([
    insertRow(env, "deals", row),
    insertScore(env, id, me.id, s, t),
    ...(appId ? [env.DB.prepare("UPDATE applications SET status = 'posted', deal_id = ? WHERE id = ?").bind(id, appId)] : []),
  ]);
  await recordCall(env, id, me.id);
  if (fromRec) await deleteRecording(env, me, recId); // the transcript goes once the deal is posted
  const name = me.name || me.email;
  await notify(env, { type: "deal_posted", deal: { id, company: f.company, one_liner: f.one_liner, poster: name } });
  if (ctx) ctx.waitUntil(emailNewDeal(env, { id, company: f.company, one_liner: f.one_liner, round_type: f.round_type, min_tier: f.min_tier, poster: name, poster_id: me.id }));
  return json({ ok: true, id });
}

// Calls lock once they're in: you see everyone else's only after adding yours, so yours stays your own.
// Framework Phase 1 (Proof): a record that proves itself (migrations/0027_ledger.sql).
// Each entry's hash covers the entry before it, so changing any old entry breaks every hash
// after it. Entry content stays private; only its hash is chained. A salt keeps short content
// such as a bare "yes" from being guessed from its hash. Anyone can check a chain with
// scripts/verify-record.mjs.
const ZERO_HASH = "0".repeat(64);
const hex = (a) => [...a].map((x) => x.toString(16).padStart(2, "0")).join("");
const linkHash = (seq, prev, bodyHash) => sha256(`${seq}|${prev}|${bodyHash}`);

async function appendLedger(env, kind, ref, memberId, content, at = now()) {
  const body = JSON.stringify({ kind, ref, ...content, at, salt: hex(crypto.getRandomValues(new Uint8Array(16))) });
  const bodyHash = await sha256(body);
  for (let tries = 0; tries < 6; tries++) {
    const last = await env.DB.prepare("SELECT seq, hash FROM ledger ORDER BY seq DESC LIMIT 1").first();
    const seq = (last?.seq || 0) + 1, prev = last?.hash || ZERO_HASH;
    try {
      await env.DB.prepare("INSERT INTO ledger (seq, kind, ref, member_id, body, body_hash, prev, hash, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(seq, kind, ref, memberId, body, bodyHash, prev, await linkHash(seq, prev, bodyHash), at).run();
      return true;
    } catch (e) {
      if (await env.DB.prepare("SELECT 1 FROM ledger WHERE ref = ?").bind(ref).first()) return false;   // already on the record
      if (!/UNIQUE|constraint/i.test(String(e))) throw e;                                               // otherwise someone took this seq: retry
    }
  }
  throw new Error("ledger busy");
}
// A failed append never blocks a call; the nightly job catches up anything missed.
const safeLedger = async (f) => { try { await f(); } catch (e) { console.error("ledger", e); } };

const callContent = (r) => {
  const c = { deal: r.deal_id, member: r.member_id, yes: r.yes, why: r.why ?? null, met: r.met ?? null };
  for (const k of SCORE_KEYS) if (r[k] != null) c[k] = r[k];
  if (r.total != null) c.total = r.total;
  return c;
};
const recordCall = (env, dealId, memberId) => safeLedger(async () => {
  const r = await env.DB.prepare("SELECT * FROM scores WHERE deal_id = ? AND member_id = ?").bind(dealId, memberId).first();
  if (r) await appendLedger(env, "call", `call:${dealId}:${memberId}`, memberId, callContent(r), r.updated_at);
});
const outcomeContent = (d) => ({ deal: d.id, outcome: d.outcome, note: d.outcome_note ?? null, by: d.outcome_by ?? null, confirmed_by: d.outcome_confirmed_by ?? null, source: d.outcome_source ?? null });
const recordOutcome = (env, dealId) => safeLedger(async () => {
  const d = await env.DB.prepare("SELECT id, outcome, outcome_note, outcome_at, outcome_by, outcome_confirmed_by, outcome_source FROM deals WHERE id = ?").bind(dealId).first();
  if (d?.outcome && d.outcome_at) await appendLedger(env, "outcome", `outcome:${d.id}:${d.outcome_at}`, null, outcomeContent(d), d.outcome_at);
});

// Nightly: put anything missed on the record, oldest first, then seal the day's fingerprint.
async function sealLedger(env) {
  const calls = await env.DB.prepare(`SELECT * FROM scores s WHERE NOT EXISTS
    (SELECT 1 FROM ledger l WHERE l.ref = 'call:' || s.deal_id || ':' || s.member_id) ORDER BY s.updated_at LIMIT 200`).all();
  const outs = await env.DB.prepare(`SELECT id, outcome, outcome_note, outcome_at, outcome_by, outcome_confirmed_by, outcome_source FROM deals d
    WHERE outcome IS NOT NULL AND outcome_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ledger l WHERE l.ref = 'outcome:' || d.id || ':' || d.outcome_at)
    ORDER BY outcome_at LIMIT 50`).all();
  const todo = [...calls.results.map((r) => ({ at: r.updated_at, go: () => appendLedger(env, "call", `call:${r.deal_id}:${r.member_id}`, r.member_id, callContent(r), r.updated_at) })),
    ...outs.results.map((d) => ({ at: d.outcome_at, go: () => appendLedger(env, "outcome", `outcome:${d.id}:${d.outcome_at}`, null, outcomeContent(d), d.outcome_at) }))]
    .sort((a, b) => a.at - b.at);
  for (const t of todo) await t.go();
  const head = await env.DB.prepare("SELECT seq, hash FROM ledger ORDER BY seq DESC LIMIT 1").first();
  if (head) await env.DB.prepare("INSERT OR IGNORE INTO ledger_heads (day, seq, hash, at) VALUES (?, ?, ?, ?)")
    .bind(new Date().toISOString().slice(0, 10), head.seq, head.hash, now()).run();
  return { added: todo.length, head };
}

// Public: the chain's daily fingerprints. They reveal nothing about anyone's calls.
async function ledgerFingerprints(env) {
  const { results } = await env.DB.prepare("SELECT day, seq, hash FROM ledger_heads ORDER BY day").all();
  return json({ about: "Daily fingerprints of the Stag Hunt record. See github.com/jpmanta/stag-hunt, scripts/verify-record.mjs.", fingerprints: results });
}

// Your record, provably intact: your own entries in full, plus the whole chain as hashes only.
async function myLedger(env, me) {
  const [chain, mine, heads] = await Promise.all([
    env.DB.prepare("SELECT seq, body_hash, prev, hash FROM ledger ORDER BY seq").all(),
    env.DB.prepare("SELECT seq, kind, body FROM ledger WHERE member_id = ? ORDER BY seq").bind(me.id).all(),
    env.DB.prepare("SELECT day, seq, hash FROM ledger_heads ORDER BY day").all(),
  ]);
  const file = { about: "Your Stag Hunt record. Check it with scripts/verify-record.mjs from github.com/jpmanta/stag-hunt.",
    downloaded_at: new Date().toISOString(), mine: mine.results, chain: chain.results, fingerprints: heads.results };
  return new Response(JSON.stringify(file, null, 1), { headers: { "content-type": "application/json; charset=utf-8",
    "content-disposition": `attachment; filename="stag-hunt-record-${new Date().toISOString().slice(0, 10)}.json"`, "cache-control": "no-store" } });
}

const insertScore = (env, dealId, memberId, s, t) => insertRow(env, "scores", { deal_id: dealId, member_id: memberId, ...s, updated_at: t });

async function loadDeal(env, id) {
  const d = await env.DB.prepare(DEAL_LIST_SQL + " WHERE d.id = ?").bind(id).first();
  if (!d) throw new HttpError(404, "not_found", "Deal not found.");
  return d;
}

async function getDeal(env, me, id) {
  const deal = await loadDeal(env, id);
  const [scores, investments, updates, intros] = await Promise.all([
    env.DB.prepare(`SELECT s.*, COALESCE(u.name,u.email) AS name FROM scores s JOIN users u ON u.id = s.member_id WHERE s.deal_id = ? ORDER BY s.updated_at`).bind(id).all(),
    env.DB.prepare(`SELECT i.*, COALESCE(u.name,u.email) AS name FROM investments i JOIN users u ON u.id = i.member_id WHERE i.deal_id = ? ORDER BY i.updated_at`).bind(id).all(),
    env.DB.prepare(`SELECT d.*, COALESCE(u.name,u.email) AS name FROM deal_updates d JOIN users u ON u.id = d.member_id WHERE d.deal_id = ? ORDER BY d.created_at DESC`).bind(id).all(),
    env.DB.prepare(`SELECT i.member_id, i.created_at, COALESCE(u.name,u.email) AS name FROM intros i JOIN users u ON u.id = i.member_id WHERE i.deal_id = ? ORDER BY i.created_at`).bind(id).all(),
  ]);
  // Whoever brought the deal (and admins) see who asked to meet the team; everyone else sees the count.
  const canSeeIntros = deal.poster_id === me.id || me.role === "admin";
  const introInfo = { count: intros.results.length, mine: intros.results.some((x) => x.member_id === me.id),
    who: canSeeIntros ? intros.results.map((x) => ({ name: x.name, at: x.created_at })) : [] };
  const pledges = await pledgeSummary(env, me, id, deal.poster_id);
  const shown = hideScores(deal, me, new Set(scores.results.some((x) => x.member_id === me.id) ? [deal.id] : []));
  const nameOf = async (uid) => uid ? (await env.DB.prepare("SELECT COALESCE(name, email) AS n FROM users WHERE id = ?").bind(uid).first())?.n?.split("@")[0] || null : null;
  const [pendingName, outcomeName, confirmName] = await Promise.all([nameOf(deal.pending_by), nameOf(deal.outcome_by), nameOf(deal.outcome_confirmed_by)]);
  const outcomeInfo = { pending_name: pendingName, by_name: outcomeName, confirmed_name: confirmName, mine_pending: deal.pending_by === me.id };
  return json({ deal: shown, scores: shown.scores_hidden ? [] : scores.results, investments: investments.results, updates: updates.results, intros: introInfo, pledges, outcome: outcomeInfo, can_edit: deal.poster_id === me.id || me.role === "admin" });
}

async function updateDeal(request, env, me, id) {
  const deal = await loadDeal(env, id);
  if (deal.poster_id !== me.id && me.role !== "admin") throw new HttpError(403, "forbidden", "Only the poster or an admin can edit this deal.");
  const b = await readJson(request);
  if (b.status !== undefined && Object.keys(b).length === 1) {
    if (!STATUSES.includes(b.status)) bad("Unknown status.");
    await env.DB.prepare("UPDATE deals SET status = ?, updated_at = ? WHERE id = ?").bind(b.status, now(), id).run();
  } else {
    const f = dealFields(b);
    const row = { ...f, status: STATUSES.includes(b.status) ? b.status : deal.status, updated_at: now() };
    const cols = Object.keys(row);
    await env.DB.prepare(`UPDATE deals SET ${cols.map((c) => c + " = ?").join(", ")} WHERE id = ?`).bind(...cols.map((c) => row[c]), id).run();
  }
  await notify(env, { type: "changed", what: "deal", id });
  return json({ ok: true });
}

async function deleteDeal(env, id) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM scores WHERE deal_id = ?").bind(id),
    env.DB.prepare("DELETE FROM intros WHERE deal_id = ?").bind(id),
    env.DB.prepare("DELETE FROM investments WHERE deal_id = ?").bind(id),
    env.DB.prepare("DELETE FROM pledges WHERE deal_id = ?").bind(id),
    env.DB.prepare("DELETE FROM deal_updates WHERE deal_id = ?").bind(id),
    env.DB.prepare("DELETE FROM messages WHERE room = ?").bind("deal:" + id),
    env.DB.prepare("DELETE FROM deals WHERE id = ?").bind(id),
  ]);
  await notify(env, { type: "changed", what: "deal", id, deleted: true });
  return json({ ok: true });
}

// Architecture 7.1, can_call: the deal is still in review, and nobody calls the deal they brought.
async function scoreDeal(request, env, me, id) {
  const deal = await loadDeal(env, id);
  if (deal.poster_id === me.id) bad("You brought this deal, so your call wouldn't be independent. Calls are for everyone else.");
  if (!SCORING.includes(deal.status)) bad("Calls are closed. This deal has left review, so a call now would be made after the fact.");
  if (await env.DB.prepare("SELECT 1 FROM scores WHERE deal_id = ? AND member_id = ?").bind(id, me.id).first())
    throw new HttpError(409, "locked", "You've already made your call on this deal. Calls lock once they're in, so everyone's stays their own.");
  const s = scoreFields(await readJson(request));
  await insertScore(env, id, me.id, s, now()).run();
  await recordCall(env, id, me.id);
  await notify(env, { type: "changed", what: "deal", id });
  return json({ ok: true });
}

// Ask whoever brought a deal to introduce you to the founders. They stay the point of contact,
// so the request goes to them by email, with your address to reply to. One request per deal.
async function requestIntro(env, me, id) {
  if (me.role === "observer") throw new HttpError(403, "forbidden", "Observers can't ask for introductions.");
  const deal = await env.DB.prepare(`SELECT d.company, d.poster_id, u.email AS poster_email, COALESCE(u.name,u.email) AS poster_name
    FROM deals d JOIN users u ON u.id = d.poster_id WHERE d.id = ?`).bind(id).first();
  if (!deal) throw new HttpError(404, "not_found", "Deal not found.");
  if (deal.poster_id === me.id) bad("You brought this deal, so you already know the founders.");
  const r = await env.DB.prepare("INSERT OR IGNORE INTO intros (deal_id, member_id, created_at) VALUES (?, ?, ?)").bind(id, me.id, now()).run();
  if (!r.meta.changes) return json({ ok: true, already: true });
  const who = me.name || me.email;
  const link = dealLink(id);
  await sendMail(env, deal.poster_email, `${who} wants to meet the founders of ${deal.company}`,
    `${who} (${me.email}) would like an introduction to the founders of ${deal.company}, the deal you brought to Stag Hunt.\n\nReply to this email to reach them directly.\n\n${link}`,
    mailLayout(env.APP_NAME,
      mailKicker("Introduction request") + mailTitle(escHtml(deal.company)) +
      mailPara(`${escHtml(who)} (${escHtml(me.email)}) would like an introduction to the founders. You brought the deal, so you're the one who can connect them.`, 6) +
      mailNote("Reply to this email to reach them directly.") + mailBtn(link, "Open the deal")),
    { replyTo: me.email });
  await notify(env, { type: "changed", what: "deal", id });
  return json({ ok: true });
}

function cents(v, { required = false, allowZero = false } = {}) {
  if (v === undefined || v === null || v === "") { if (required) bad("Enter an amount."); return null; }
  const n = Math.round(Number(String(v).replace(/[$,\s]/g, "")) * 100);
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0)) bad("Enter a valid dollar amount.");
  if (n > 1e13) bad("That amount looks too large.");
  return n;
}

async function investDeal(request, env, me, id) {
  await loadDeal(env, id);
  const b = await readJson(request);
  const amount = cents(b.amount_usd, { required: true });
  const realized = cents(b.realized_usd, { allowZero: true }) ?? 0;
  const paper = cents(b.paper_usd, { allowZero: true });
  const on = /^\d{4}-\d{2}-\d{2}$/.test(b.invested_on || "") ? b.invested_on : null;
  await env.DB.prepare(
    `INSERT INTO investments (deal_id, member_id, amount_cents, invested_on, realized_cents, paper_cents, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(deal_id, member_id) DO UPDATE SET amount_cents=excluded.amount_cents, invested_on=excluded.invested_on,
       realized_cents=excluded.realized_cents, paper_cents=excluded.paper_cents, note=excluded.note, updated_at=excluded.updated_at`
  ).bind(id, me.id, amount, on, realized, paper, clean(b.note, 500), now()).run();
  await notify(env, { type: "changed", what: "deal", id });
  return json({ ok: true });
}

async function deleteInvestment(env, me, id) {
  await env.DB.prepare("DELETE FROM investments WHERE deal_id = ? AND member_id = ?").bind(id, me.id).run();
  await notify(env, { type: "changed", what: "deal", id });
  return json({ ok: true });
}

// ---------------------------------------------------------------- the hunt: conditional pledges
// Each pledge says "I'm in for $X if at least N others are in". A group locks in when every member of it
// has their condition met by the rest of the group. Until then nobody's name or amount is shown to anyone.
function lockableSet(rows) {
  let set = rows.slice();
  for (;;) {
    const keep = set.filter((p) => p.locked_at || p.need_others <= set.length - 1);
    if (keep.length === set.length) return set;
    set = keep;
  }
}

// Whoever brought the deal sets their check first (it needs no one else) and the group fills the rest.
// Their check alone never locks anything: it locks together with the first group that does.
async function settlePledges(env, dealId, ctx) {
  const deal = await env.DB.prepare("SELECT poster_id FROM deals WHERE id = ?").bind(dealId).first();
  const poster = deal && deal.poster_id;
  const { results } = await env.DB.prepare("SELECT * FROM pledges WHERE deal_id = ?").bind(dealId).all();
  const set = lockableSet(results.map((p) => p.member_id === poster ? { ...p, need_others: 0 } : p));
  const fresh = set.filter((p) => !p.locked_at);
  const others = set.filter((p) => p.member_id !== poster);
  if (!fresh.length || !others.length || set.length < 2 && !others.some((p) => p.need_others === 0)) return false;
  const t = now();
  await env.DB.batch(fresh.map((p) => env.DB.prepare("UPDATE pledges SET locked_at = ? WHERE deal_id = ? AND member_id = ?").bind(t, dealId, p.member_id)));
  const job = emailLocked(env, dealId, fresh.map((p) => p.member_id));
  if (ctx) ctx.waitUntil(job); else await job;
  return true;
}

async function emailLocked(env, dealId, freshIds) {
  const deal = await env.DB.prepare("SELECT id, company FROM deals WHERE id = ?").bind(dealId).first();
  const { results } = await env.DB.prepare(`SELECT p.member_id, p.amount_cents, u.email, COALESCE(u.name,u.email) AS name FROM pledges p
    JOIN users u ON u.id = p.member_id WHERE p.deal_id = ? AND p.locked_at IS NOT NULL ORDER BY p.locked_at, p.created_at`).bind(dealId).all();
  const total = results.reduce((a, p) => a + p.amount_cents, 0);
  const money = (c) => "$" + Math.round(c / 100).toLocaleString("en-US");
  const link = dealLink(dealId);
  const list = results.map((p) => `${p.name}: ${money(p.amount_cents)}`).join("\n");
  for (const p of results) {
    const isNew = freshIds.includes(p.member_id);
    await sendMail(env, p.email, `${deal.company} is a go: ${results.length} members are in`,
      `${isNew ? "Enough members said they're in, so your promise to invest now counts." : "More members just joined your promise to invest."}\n\n${deal.company}: ${results.length} members, ${money(total)} promised together.\n${list}\n\nYou've given the others your word. Once you've invested, log it on the deal: ${link}`,
      mailLayout(env.APP_NAME,
        mailKicker(isNew ? "Enough members said they're in" : "More members joined") +
        mailTitle(`${escHtml(deal.company)} is a go`) +
        mailPara(`${results.length} members, ${money(total)} promised together.`, 8) +
        `<tr><td align="center" style="padding:0 0 16px;font:14px/1.8 Georgia,serif;color:${M_MUTED}">${results.map((r) => `${escHtml(r.name)}: ${money(r.amount_cents)}`).join("<br>")}</td></tr>` +
        mailNote("You've given the others your word. Once you've invested, log it on the deal.", 8) +
        mailBtn(link, "Open the deal"), "", false));
  }
}

async function pledgeSummary(env, me, dealId, posterId) {
  const { results } = await env.DB.prepare(`SELECT p.*, COALESCE(u.name,u.email) AS name FROM pledges p JOIN users u ON u.id = p.member_id WHERE p.deal_id = ?`).bind(dealId).all();
  const isFirst = (p) => p.member_id === posterId;
  const locked = results.filter((p) => p.locked_at).sort((a, b) => (isFirst(b) - isFirst(a)) || a.locked_at - b.locked_at);
  const firstOpen = results.find((p) => isFirst(p) && !p.locked_at) || null;
  const waiting = results.filter((p) => !p.locked_at && !isFirst(p)).sort((a, b) => a.need_others - b.need_others);
  // Smallest number of extra pledges that would lock in some of the waiting ones
  let next = null;
  for (let k = 1; k <= waiting.length; k++) {
    const more = Math.max(0, waiting[k - 1].need_others - (locked.length + (firstOpen ? 1 : 0) + k - 1));
    if (!next || more < next.more || (more === next.more && k > next.would_lock)) next = { more, would_lock: k };
  }
  const mine = results.find((p) => p.member_id === me.id) || null;
  return {
    mine: mine && { amount_cents: mine.amount_cents, need_others: mine.need_others, locked_at: mine.locked_at },
    waiting: waiting.length,
    next,
    first: firstOpen && { member_id: firstOpen.member_id, name: firstOpen.name, amount_cents: firstOpen.amount_cents },
    locked: locked.map((p) => ({ member_id: p.member_id, name: p.name, amount_cents: p.amount_cents, locked_at: p.locked_at, first: isFirst(p) })),
    locked_total: locked.reduce((a, p) => a + p.amount_cents, 0),
  };
}

async function pledgeDeal(request, env, me, id, ctx) {
  const deal = await loadDeal(env, id);
  if (["passed", "dead", "exited"].includes(deal.status)) bad("This deal is closed.");
  const b = await readJson(request);
  const amount = cents(b.amount_usd, { required: true });
  const need = deal.poster_id === me.id ? 0 : Math.max(0, Math.min(20, parseInt(b.need_others, 10) || 0));
  const cur = await env.DB.prepare("SELECT * FROM pledges WHERE deal_id = ? AND member_id = ?").bind(id, me.id).first();
  const t = now();
  if (cur && cur.locked_at) {
    if (amount < cur.amount_cents) bad("Your pledge is locked in. You can raise it, but not lower it.");
    await env.DB.prepare("UPDATE pledges SET amount_cents = ?, updated_at = ? WHERE deal_id = ? AND member_id = ?").bind(amount, t, id, me.id).run();
  } else {
    await env.DB.prepare(`INSERT INTO pledges (deal_id, member_id, amount_cents, need_others, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(deal_id, member_id) DO UPDATE SET amount_cents = excluded.amount_cents, need_others = excluded.need_others, updated_at = excluded.updated_at`)
      .bind(id, me.id, amount, need, t, t).run();
  }
  const lockedNow = await settlePledges(env, id, ctx);
  await notify(env, { type: "changed", what: "deal", id });
  return json({ ok: true, locked: lockedNow });
}

async function withdrawPledge(env, me, id) {
  const cur = await env.DB.prepare("SELECT locked_at FROM pledges WHERE deal_id = ? AND member_id = ?").bind(id, me.id).first();
  if (!cur) return json({ ok: true });
  if (cur.locked_at) bad("Your pledge is locked in, so the others are counting on it. Talk to an admin if something has changed.");
  await env.DB.prepare("DELETE FROM pledges WHERE deal_id = ? AND member_id = ?").bind(id, me.id).run();
  await notify(env, { type: "changed", what: "deal", id });
  return json({ ok: true });
}

const OUTCOMES = ["breakout", "on_track", "struggling", "dead"];
// Nobody grades their own deal. Any member can report how a deal turned out; it counts
// once a second member confirms it, or at once if it links a public source anyone can check.
async function setOutcome(request, env, me, id) {
  const deal = await loadDeal(env, id);
  const b = await readJson(request);
  const clearPending = "pending_outcome = NULL, pending_note = NULL, pending_by = NULL, pending_at = NULL";
  const settle = (outcome, note, by, confirmedBy, source) =>
    env.DB.prepare(`UPDATE deals SET outcome = ?, outcome_note = ?, outcome_at = ?, outcome_by = ?, outcome_confirmed_by = ?, outcome_source = ?, ${clearPending} WHERE id = ?`)
      .bind(outcome, note, now(), by, confirmedBy, source, id).run();

  if (b.action === "confirm") {
    if (!deal.pending_outcome) bad("There's nothing waiting to be confirmed.");
    if (deal.pending_by === me.id) bad("Someone else has to confirm what you reported.");
    await settle(deal.pending_outcome, deal.pending_note, deal.pending_by, me.id, null);
  } else if (b.action === "withdraw") {
    if (deal.pending_by !== me.id && me.role !== "admin") throw new HttpError(403, "forbidden", "Only whoever reported it can withdraw it.");
    await env.DB.prepare(`UPDATE deals SET ${clearPending} WHERE id = ?`).bind(id).run();
  } else if (!b.outcome) {
    if (me.role !== "admin") throw new HttpError(403, "forbidden", "Only an admin can clear a confirmed outcome.");
    await env.DB.prepare(`UPDATE deals SET outcome = NULL, outcome_note = NULL, outcome_at = NULL, outcome_by = NULL, outcome_confirmed_by = NULL, outcome_source = NULL, ${clearPending} WHERE id = ?`).bind(id).run();
    if (deal.outcome) await safeLedger(() => appendLedger(env, "outcome_cleared", `cleared:${id}:${now()}:${crypto.randomUUID()}`, null, { deal: id, by: me.id }));
  } else {
    if (!OUTCOMES.includes(b.outcome)) bad("Pick how it turned out.");
    const note = clean(b.note, 500), source = b.source ? cleanUrl(b.source) : null;
    if (b.source && !source) bad("That link doesn't look right.");
    if (source) await settle(b.outcome, note, me.id, null, source);
    else if (deal.pending_outcome === b.outcome && deal.pending_by && deal.pending_by !== me.id) await settle(b.outcome, deal.pending_note || note, deal.pending_by, me.id, null);
    else await env.DB.prepare("UPDATE deals SET pending_outcome = ?, pending_note = ?, pending_by = ?, pending_at = ? WHERE id = ?").bind(b.outcome, note, me.id, now(), id).run();
  }
  await recordOutcome(env, id);
  await notify(env, { type: "changed", what: "deal", id });
  await notify(env, { type: "changed", what: "members" });
  return json({ ok: true });
}

async function addUpdate(request, env, me, id) {
  await loadDeal(env, id);
  const body = clean((await readJson(request)).body, 4000);
  if (!body) bad("Write something first.");
  await env.DB.prepare("INSERT INTO deal_updates (id, deal_id, member_id, body, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), id, me.id, body, now()).run();
  await notify(env, { type: "changed", what: "deal", id });
  return json({ ok: true });
}

// ---------------------------------------------------------------- nominations

async function listNominations(env, me) {
  const { results } = await env.DB.prepare(
    `SELECT n.*, COALESCE(u.name,u.email) AS nominated_by_name,
       (SELECT COUNT(*) FROM objections o WHERE o.nomination_id = n.id) AS objection_count,
       EXISTS (SELECT 1 FROM objections o WHERE o.nomination_id = n.id AND o.member_id = ?) AS i_objected
     FROM nominations n JOIN users u ON u.id = n.nominated_by ORDER BY n.status = 'open' DESC, n.created_at DESC LIMIT 100`
  ).bind(me.id).all();
  let objections = [];
  if (me.role === "admin") {
    objections = (await env.DB.prepare(
      `SELECT o.nomination_id, o.reason, COALESCE(u.name,u.email) AS name FROM objections o JOIN users u ON u.id = o.member_id`).all()).results;
  }
  let requests = [];
  if (me.role === "admin") requests = (await env.DB.prepare("SELECT * FROM join_requests WHERE status = 'open' ORDER BY created_at DESC LIMIT 100").all()).results;
  return json({ nominations: results, objections, requests });
}

async function nominate(request, env, me) {
  const b = await readJson(request);
  const email = normalizeEmail(b.email);
  const name = clean(b.name, 80);
  const reason = clean(b.reason, 1000);
  if (!email) bad("Enter a valid email.");
  if (!name || !reason) bad("Add their name and why they belong.");
  const member = await env.DB.prepare("SELECT 1 FROM users WHERE email = ? AND status = 'active'").bind(email).first();
  if (member) bad("That person is already a member.");
  const open = await env.DB.prepare("SELECT 1 FROM nominations WHERE email = ? AND status = 'open'").bind(email).first();
  if (open) bad("That person already has an open nomination.");
  await env.DB.prepare("INSERT INTO nominations (id, email, name, reason, nominated_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), email, name, reason, me.id, now()).run();
  await emailAdmins(env, `${me.name || me.email} suggested ${name}`,
    `${me.name || me.email} suggested ${name} (${email}) for Stag Hunt.\n\nWhy they belong: ${reason}\n\nApprove or decline: https://staghunts.com/app#/nominations`,
    mailKicker(`${escHtml(me.name || me.email)} suggested someone`) + mailTitle(escHtml(name)) + mailNote(escHtml(email)) +
    mailPara(escHtml(reason), 8) +
    mailBtn("https://staghunts.com/app#/nominations", "Approve or decline"), me.id);
  await notify(env, { type: "changed", what: "nominations" });
  return json({ ok: true });
}

async function objectNomination(request, env, me, id) {
  const b = await readJson(request);
  if (b.withdraw) {
    await env.DB.prepare("DELETE FROM objections WHERE nomination_id = ? AND member_id = ?").bind(id, me.id).run();
  } else {
    await env.DB.prepare(
      "INSERT INTO objections (nomination_id, member_id, reason, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET reason = excluded.reason"
    ).bind(id, me.id, clean(b.reason, 500), now()).run();
  }
  await notify(env, { type: "changed", what: "nominations" });
  return json({ ok: true });
}

async function decideNomination(request, env, me, id) {
  const b = await readJson(request);
  const n = await env.DB.prepare("SELECT * FROM nominations WHERE id = ? AND status = 'open'").bind(id).first();
  if (!n) throw new HttpError(404, "not_found", "Nomination not found.");
  if (b.action === "approve") {
    await admit(env, { email: n.email, name: n.name, role: "member", invitedBy: n.nominated_by });
    await env.DB.prepare("UPDATE nominations SET status='approved', decided_at=? WHERE id=?").bind(now(), id).run();
    if (b.send_invite !== false) await sendInvite(env, n.email, n.name, me);
  } else if (b.action === "reject") {
    await env.DB.prepare("UPDATE nominations SET status='rejected', decided_at=? WHERE id=?").bind(now(), id).run();
  } else bad("Unknown action.");
  await notify(env, { type: "changed", what: "nominations" });
  await notify(env, { type: "changed", what: "members" });
  return json({ ok: true });
}

async function decideRequest(request, env, me, id) {
  const b = await readJson(request);
  const r = await env.DB.prepare("SELECT * FROM join_requests WHERE id = ? AND status = 'open'").bind(id).first();
  if (!r) throw new HttpError(404, "not_found", "Request not found.");
  if (b.action === "approve" || b.action === "observe") {
    // "observe" lets them in read-only: they can't post or make calls
    const role = b.action === "observe" ? "observer" : "member";
    await admit(env, { email: r.email, name: r.name, role, invitedBy: me.id, keepName: true });
    await env.DB.prepare("UPDATE join_requests SET status=?, decided_at=? WHERE id=?").bind(role === "observer" ? "observer" : "approved", now(), id).run();
    await sendInvite(env, r.email, r.name || "there", me, role === "observer");
  } else if (b.action === "decline") {
    await env.DB.prepare("UPDATE join_requests SET status='declined', decided_at=? WHERE id=?").bind(now(), id).run();
  } else bad("Unknown action.");
  await notify(env, { type: "changed", what: "nominations" });
  await notify(env, { type: "changed", what: "members" });
  return json({ ok: true });
}

// Membership decisions go to every admin, regardless of their email settings
async function emailAdmins(env, subject, text, rows, exceptId) {
  const { results } = await env.DB.prepare("SELECT id, email FROM users WHERE status = 'active' AND role = 'admin'").all();
  for (const a of results) if (a.id !== exceptId) await sendMail(env, a.email, subject, text, mailLayout(env.APP_NAME, rows, " Sent to admins.", false));
}

// ---------------------------------------------------------------- export (the "shared sheet")

async function exportCsv(env) {
  const { results } = await env.DB.prepare(DEAL_LIST_SQL + " ORDER BY d.created_at").all();
  const inv = (await env.DB.prepare(
    "SELECT i.deal_id, COALESCE(u.name,u.email) AS name, i.amount_cents FROM investments i JOIN users u ON u.id = i.member_id").all()).results;
  const byDeal = {};
  for (const i of inv) (byDeal[i.deal_id] ||= []).push(`${i.name} ($${(i.amount_cents / 100).toLocaleString("en-US")})`);
  // Average of each question (ten-question scores only; older five-question scores still count in the total)
  const avgs = Object.fromEntries((await env.DB.prepare(
    `SELECT deal_id, ${SCORE_KEYS.map((k) => `AVG(${k}) AS ${k}`).join(", ")} FROM scores GROUP BY deal_id`).all()).results.map((a) => [a.deal_id, a]));
  const cols = ["Date", "Company", "Posted by", "How found", "Round", "Raise", "Cap", "Discount", "Min check",
    "Team", "Problem", "Product", "Market", "Competition", "Business model", "Growth", "Retention", "Timing", "Outcome", "Avg total /100", "Yes", "Calls",
    "Invested by", "Total invested ($)", "Status", "Why now", "Disclosure", "Who pays", "Numbers so far", "How they get customers", "Competition", "End state", "Flywheel", "Next goal", "Blocker"];
  const rows = results.map((d) => [
    new Date(d.created_at * 1000).toISOString().slice(0, 10), d.company, d.poster_name, d.how_found, d.round_type, d.raise_amount, d.valuation_cap, d.discount, d.min_check,
    ...SCORE_KEYS.map((k) => fmt1(avgs[d.id] && avgs[d.id][k])), fmt1(d.avg_total), d.yes_count, d.score_count,
    (byDeal[d.id] || []).join("; "), (d.invested_cents / 100).toFixed(2), d.status, d.why_now, d.disclosure, d.customers, d.traction, d.acquisition, d.competition, d.end_state, d.flywheel, d.next_goal, d.blocker,
  ]);
  const csv = [cols, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="stag-hunt-deals-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
}
const fmt1 = (v) => (v === null || v === undefined ? "" : Number(v).toFixed(1));
const csvCell = (v) => { const s = v === null || v === undefined ? "" : String(v); return /[",\r\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : "") + s.replace(/"/g, '""')}"` : s; };

// ---------------------------------------------------------------- helpers

async function cleanup(env) {
  const t = now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_codes WHERE expires_at < ?").bind(t),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(t),
    env.DB.prepare("DELETE FROM rate_limits WHERE window_start < ?").bind(t - 3600),
  ]);
}

async function allow(env, key, limit, windowSecs) {
  const t = now();
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start < ? THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.window_start < ? THEN ? ELSE rate_limits.window_start END
     RETURNING count`
  ).bind(key, t, t - windowSecs, t - windowSecs, t).first();
  return row.count <= limit;
}

function clean(v, max) {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/\u0000/g, "").trim().slice(0, max);
  return s || null;
}
function cleanUrl(v) {
  const s = clean(v, 300);
  if (!s) return null;
  const withProto = /^https?:\/\//i.test(s) ? s : "https://" + s;
  try { const u = new URL(withProto); return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null; } catch { return null; }
}
function sameOrigin(request, url) { const o = request.headers.get("Origin"); return !o || o === url.origin; }
function normalizeEmail(v) { const e = String(v || "").trim().toLowerCase(); return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : null; }
function sixDigits() { const a = new Uint32Array(1); let n; do { crypto.getRandomValues(a); n = a[0]; } while (n >= 4294000000); return String(n % 1000000).padStart(6, "0"); }
function randomToken() { return b64url(crypto.getRandomValues(new Uint8Array(32))); }
async function sha256(s) { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
function timingSafeEqual(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
function getCookie(request, name) { const m = (request.headers.get("Cookie") || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`)); return m ? m[1] : null; }

// ---------------------------------------------------------------- recorded founder calls
// Audio is never stored. Each minute arrives as a small WAV, is transcribed
// right away, and only the text is kept: visible only to the member who
// recorded it, deleted when the deal is posted or after REC_KEEP_DAYS.
const REC_KEEP_DAYS = 7;
const REC_MAX_SEGMENTS = 240; // four hours of one-minute pieces
const DRAFT_FIELDS = {
  company: [80, "The company's name."],
  website: [300, "The company's website, only if said out loud."],
  sector: [80, "The space they're in, in two or three words (e.g. fintech, climate, dev tools)."],
  one_liner: [400, "What the company does, explained plainly in one or two sentences."],
  customers: [400, "Who pays the company and how much (price, plan, contract size). 'No one yet' if the founder says so."],
  traction: [400, "The numbers so far, as stated: paying customers, revenue, users, monthly growth, and how many customers come back or stay."],
  acquisition: [400, "How the company gets customers today: the channels and what a customer costs to win, as the founder describes it."],
  competition: [400, "Who else solves this problem, including what customers do today instead, and why the founder says they win."],
  end_state: [300, "If they win, what they would own. The specific end state the founder describes."],
  flywheel: [300, "The loop that makes them stronger as they grow, written as a chain like 'more X → more Y → more X'. Empty if the founder didn't describe one."],
  next_goal: [300, "The next milestone the founder is chasing right now."],
  blocker: [300, "What the founder says stands between them and that next milestone."],
  why_now: [600, "Why the founder says the timing is right now."],
  round_type: [40, "One of: SAFE, Convertible note, Priced round, Reg CF, Other. Empty if not said."],
  raise_amount: [80, "How much they're raising, e.g. $1.5M."],
  valuation_cap: [80, "The valuation cap, e.g. $12M post."],
  discount: [80, "The discount, e.g. 20%."],
  min_check: [80, "The smallest check they take."],
  deadline: [40, "When the round closes."],
};
const DRAFT_SYSTEM = `You read the transcript of a conversation between an investor and a startup founder. Fill in facts about the startup using only what was actually said, in plain words, staying close to the founder's own wording.
Rules:
- If something was not clearly said, return an empty string for it. Never guess or infer.
- Never give opinions, judgments or ratings of the company, team or market.
- Keep each answer to one or two short sentences.
Fields:
${Object.entries(DRAFT_FIELDS).map(([k, [, d]]) => `- ${k}: ${d}`).join("\n")}`;

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
async function myRecording(env, me, id) {
  const r = await env.DB.prepare("SELECT * FROM recordings WHERE id = ? AND member_id = ?").bind(id, me.id).first();
  if (!r) throw new HttpError(404, "not_found", "That recording is gone. Recordings are deleted after 7 days or once the deal is posted.");
  return r;
}
async function startRecording(request, env, me) {
  if (!env.AI) throw new HttpError(503, "no_ai", "Recording isn't set up yet.");
  const b = await readJson(request);
  if (b.consent !== true) bad("Confirm the founder knows you're recording and agreed.");
  const id = crypto.randomUUID(), t = now(), old = t - REC_KEEP_DAYS * 86400;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM rec_segments WHERE rec_id IN (SELECT id FROM recordings WHERE created_at < ?)").bind(old),
    env.DB.prepare("DELETE FROM recordings WHERE created_at < ?").bind(old),
    env.DB.prepare("INSERT INTO recordings (id, member_id, consent_at, created_at) VALUES (?, ?, ?, ?)").bind(id, me.id, t, t),
  ]);
  return json({ id });
}
async function addSegment(request, env, me, id, n) {
  await myRecording(env, me, id);
  return saveSegment(request, env, id, n, REC_MAX_SEGMENTS);
}
async function saveSegment(request, env, id, n, max) {
  if (n < 0 || n >= max) bad("This recording is too long.");
  const buf = await request.arrayBuffer();
  if (buf.byteLength < 1000) return json({ ok: true, chars: 0 });
  if (buf.byteLength > 8_000_000) bad("That piece of audio is too large.");
  const res = await env.AI.run("@cf/openai/whisper-large-v3-turbo", { audio: toBase64(buf) });
  const text = String(res?.text || "").trim();
  await env.DB.prepare("INSERT INTO rec_segments (rec_id, n, text) VALUES (?, ?, ?) ON CONFLICT(rec_id, n) DO UPDATE SET text = excluded.text")
    .bind(id, n, text).run();
  return json({ ok: true, chars: text.length });
}
// Second pass: everything else the call can answer, including the investor's
// own side (how they found it, any connection). Never scores.
const FILL_FIELDS = {
  how_found: [1000, "How the investor came to know this founder or company, if it comes up in the conversation (an introduction, a shared school or job, an event). Written from the investor's side, starting with a verb or 'Through'."],
  disclosure: [600, "Any connection the investor mentions having to the company: friend of the founder, advisor, employee, existing investor. Empty if none is mentioned."],
  ...DRAFT_FIELDS,
};
const FILL_SYSTEM = DRAFT_SYSTEM.split("\nFields:")[0] + `
- The investor is the person who recorded the call. For how_found and disclosure, use what either person said about how they know each other.
Fields:
${Object.entries(FILL_FIELDS).map(([k, [, d]]) => `- ${k}: ${d}`).join("\n")}`;

async function recTranscript(env, me, id) {
  await myRecording(env, me, id);
  const { results } = await env.DB.prepare("SELECT text FROM rec_segments WHERE rec_id = ? ORDER BY n").bind(id).all();
  const transcript = results.map((s) => s.text).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  if (transcript.length < 80) bad("We didn't catch enough of the conversation to draft anything. You can still fill in the deal by hand.");
  return transcript;
}
const REC_LIMIT = 60000; // the model reads about 24k tokens
async function extractFields(env, transcript, fields, system) {
  const schema = { type: "object", properties: Object.fromEntries(Object.keys(fields).map((k) => [k, { type: "string" }])), required: Object.keys(fields) };
  const out = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
    messages: [{ role: "system", content: system }, { role: "user", content: "Transcript:\n" + transcript.slice(0, REC_LIMIT) }],
    response_format: { type: "json_schema", json_schema: schema },
    max_tokens: 1800, temperature: 0.1,
  });
  let f = out?.response;
  if (typeof f === "string") { try { f = JSON.parse(f); } catch { f = {}; } }
  const got = {};
  for (const [k, [max]] of Object.entries(fields)) {
    const v = typeof f?.[k] === "string" ? f[k].trim() : "";
    if (!v || /^(n\/?a|none|unknown|not (mentioned|stated|said|discussed|specified)|empty)\.?$/i.test(v)) continue;
    if (k === "round_type" && !ROUND_TYPES.includes(v)) continue;
    got[k] = v.slice(0, max);
  }
  return got;
}
async function draftFromRecording(env, me, id) {
  const transcript = await recTranscript(env, me, id);
  const draft = await extractFields(env, transcript, DRAFT_FIELDS, DRAFT_SYSTEM);
  return json({ draft, transcript, truncated: transcript.length > REC_LIMIT });
}
async function fillFromRecording(env, me, id) {
  const transcript = await recTranscript(env, me, id);
  return json({ fields: await extractFields(env, transcript, FILL_FIELDS, FILL_SYSTEM) });
}
async function deleteRecording(env, me, id) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM rec_segments WHERE rec_id IN (SELECT id FROM recordings WHERE id = ? AND member_id = ?)").bind(id, me.id),
    env.DB.prepare("DELETE FROM recordings WHERE id = ? AND member_id = ?").bind(id, me.id),
  ]);
  return json({ ok: true });
}

// ---------------------------------------------------------------- pitch links
// Instead of recording in person, a member sends the founder a link. The founder
// agrees to be recorded and pitches out loud on their own phone, whenever suits
// them. It lands with the member as a recording like any other: same transcript,
// same draft, same 7 days. The link is the only key, so it's long and random.
const PITCH_MAX_SEGMENTS = 30;  // thirty minutes
const PITCH_OPEN_LINKS = 20;     // waiting links a member can have at once

async function createPitchLink(request, env, me) {
  if (!env.AI) throw new HttpError(503, "no_ai", "Recording isn't set up yet.");
  const b = await readJson(request);
  const founder = String(b.founder || "").trim().slice(0, 80);
  const t = now(), old = t - REC_KEEP_DAYS * 86400;
  const open = (await env.DB.prepare("SELECT COUNT(*) AS n FROM recordings WHERE member_id = ? AND link IS NOT NULL AND done_at IS NULL AND created_at >= ?").bind(me.id, old).first()).n;
  if (open >= PITCH_OPEN_LINKS) bad(`You have ${PITCH_OPEN_LINKS} links still waiting. Remove some you don't need, then make a new one.`);
  const id = crypto.randomUUID(), link = randomToken();
  await env.DB.prepare("INSERT INTO recordings (id, member_id, consent_at, created_at, link, founder) VALUES (?, ?, 0, ?, ?, ?)")
    .bind(id, me.id, t, link, founder || null).run();
  return json({ id });
}
async function listPitchLinks(env, me) {
  const { results } = await env.DB.prepare(`SELECT r.id, r.link, r.founder, r.created_at, r.consent_at, r.done_at,
      (SELECT COUNT(*) FROM rec_segments s WHERE s.rec_id = r.id) AS minutes
    FROM recordings r WHERE r.member_id = ? AND r.link IS NOT NULL AND r.created_at >= ? ORDER BY r.created_at DESC`)
    .bind(me.id, now() - REC_KEEP_DAYS * 86400).all();
  return json({ links: results.map(({ link, consent_at, ...r }) => ({ ...r, started: consent_at > 0, url: `https://staghunts.com/pitch/#${link}`, expires_at: r.created_at + REC_KEEP_DAYS * 86400 })) });
}
async function pitchByLink(env, link) {
  const r = await env.DB.prepare(`SELECT r.*, u.name AS member_name FROM recordings r JOIN users u ON u.id = r.member_id
    WHERE r.link = ? AND r.created_at >= ?`).bind(link, now() - REC_KEEP_DAYS * 86400).first();
  if (!r) throw new HttpError(404, "not_found", "This link has expired or was removed. Ask the investor who sent it for a new one.");
  return r;
}
async function getPitch(env, link) {
  const r = await pitchByLink(env, link);
  return json({ member: r.member_name || "A Stag Hunt member", founder: r.founder || "", done: !!r.done_at, minutes: PITCH_MAX_SEGMENTS });
}
async function startPitch(request, env, link) {
  const r = await pitchByLink(env, link);
  if (r.done_at) bad("You've already sent your pitch. Thank you.");
  if ((await readJson(request)).consent !== true) bad("Agree to be recorded to start.");
  if (!(await allow(env, `pitch:${r.id}`, 6, 86400))) bad("You've started over a few times today. Try again tomorrow, or reply to the investor who sent the link.");
  // Starting again clears an earlier attempt, so only the take the founder sends counts.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM rec_segments WHERE rec_id = ?").bind(r.id),
    env.DB.prepare("UPDATE recordings SET consent_at = ? WHERE id = ?").bind(now(), r.id),
  ]);
  return json({ ok: true });
}
async function addPitchSegment(request, env, link, n) {
  const r = await pitchByLink(env, link);
  if (r.done_at) bad("You've already sent your pitch.");
  if (!r.consent_at) bad("Agree to be recorded to start.");
  return saveSegment(request, env, r.id, n, PITCH_MAX_SEGMENTS);
}
async function finishPitch(env, ctx, link) {
  const r = await pitchByLink(env, link);
  if (r.done_at) return json({ ok: true });
  if (!r.consent_at) bad("Agree to be recorded to start.");
  const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM rec_segments WHERE rec_id = ? AND length(text) > 0").bind(r.id).first();
  if (!n) bad("We didn't hear anything yet. Check that your microphone is allowed, then try again.");
  await env.DB.prepare("UPDATE recordings SET done_at = ? WHERE id = ?").bind(now(), r.id).run();
  ctx.waitUntil(emailPitchIn(env, r));
  return json({ ok: true });
}
async function emailPitchIn(env, r) {
  const m = await env.DB.prepare("SELECT email, name FROM users WHERE id = ? AND status = 'active'").bind(r.member_id).first();
  if (!m) return;
  const who = r.founder || "The founder";
  const link = "https://staghunts.com/app#/record";
  const text = `${who} recorded a pitch for you. Open it to draft the deal from what they said, check it, and post it to the group.\n\n${link}\n\nOnly you can see the transcript. It's deleted when you post the deal, or after 7 days.`;
  await sendMail(env, m.email, `${who}'s pitch is in`, text, mailLayout(env.APP_NAME,
    mailTitle(`${escHtml(who)}'s pitch is in`) +
    mailPara("Draft the deal from what they said, check it, and post it to the group.") +
    mailBtn(link, "Open the pitch") +
    mailNote("Only you can see the transcript. It's deleted when you post the deal, or after 7 days.", 0), "", false));
}

// ---------------------------------------------------------------- spoken pitch interviews
// A founder can pitch out loud to an AI interviewer (ElevenLabs) instead of typing.
// It drafts their application from the conversation; they check it and send it like
// any other. The AI never judges the company: members still decide, each alone.
// Spending is capped by INTERVIEW_BUDGET_USD a month; past it, /apply shows only the form.
const INTERVIEW_HOLD_USD = 2;                     // the most one interview can cost (20 minutes at about 10 cents)
const INTERVIEW_USD_PER_MIN = 0.1;                // used only if ElevenLabs doesn't report the cost
const EL_API = "https://api.elevenlabs.io/v1/convai";
const elFetch = (env, path) => fetch(EL_API + path, { headers: { "xi-api-key": env.ELEVENLABS_API_KEY } });

function tierFromCheck(s) {
  const m = String(s || "").replace(/,/g, "").match(/\$?\s*(\d+(?:\.\d+)?)\s*(k|thousand|m|mm|million)?\b/i);
  if (!m) return null;
  const n = Number(m[1]) * ({ k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, million: 1e6 }[(m[2] || "").toLowerCase()] || 1);
  return n >= 1 && n <= 1e10 ? Math.round(n) : null;
}
async function interviewAvailable(env) {
  if (!env.ELEVENLABS_API_KEY || !env.INTERVIEW_AGENT_ID) return false;
  const d = new Date(), monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
  // A start holds the full cost for 15 minutes; one never finished after that counts a quarter
  // (most are someone who left before talking), so a few walk-aways can't switch it off for the month.
  const spent = (await env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN duration_secs IS NULL AND created_at < ?2 THEN 0.25 ELSE cost_usd END), 0) AS s
    FROM interviews WHERE created_at >= ?1`).bind(monthStart, now() - 900).first()).s;
  return spent + INTERVIEW_HOLD_USD <= Number(env.INTERVIEW_BUDGET_USD || 0);
}
async function startInterview(request, env, ctx) {
  const ip = clientIp(request);
  if (!(await interviewAvailable(env))) return json({ error: "unavailable", message: "The interviewer is resting for now. The form below works the same." }, 503);
  if (!(await allow(env, `interview:${ip}`, 2, 3600))) return json({ error: "rate_limited", message: "You've started two interviews in the last hour. Use the form below, or try again later." }, 429);
  const r = await elFetch(env, `/conversation/get-signed-url?agent_id=${encodeURIComponent(env.INTERVIEW_AGENT_ID)}`);
  const { signed_url } = r.ok ? await r.json() : {};
  if (!signed_url) ctx.waitUntil(interviewAlert(env, "elevenlabs"));
  if (!signed_url) return json({ error: "unavailable", message: "The interviewer isn't answering right now. The form below works the same." }, 503);
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO interviews (id, ip_hash, cost_usd, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, await sha256("iv:" + ip), INTERVIEW_HOLD_USD, now()).run();
  return json({ id, signed_url });
}
// The first time in a month a founder can't start an interview, the admins get one email,
// so they know to raise the budget or add ElevenLabs credit (Pay As You Go).
async function interviewAlert(env, why) {
  const d = new Date();
  if (!(await allow(env, `iv-alert:${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`, 1, 40 * 86400))) return;
  const reason = why === "budget"
    ? `This month's interviews reached the $${Number(env.INTERVIEW_BUDGET_USD || 0)} budget set on the site, so the "Or just talk" option is hidden until next month. To allow more, raise the interview budget in the site's settings (wrangler.jsonc).`
    : "ElevenLabs wouldn't start an interview. The likeliest reason is that your plan's monthly credits ran out. Turning on Pay As You Go in your ElevenLabs account keeps interviews running.";
  const after = "Founders can still apply with the typed form. You'll get this email at most once a month.";
  await emailAdmins(env, "Stag Hunt: founders can't start AI interviews", `${reason}\n\n${after}`,
    mailTitle("Founders can't start AI interviews") + mailPara(escHtml(reason)) + mailNote(after, 0));
}
// The page reports when the connection to ElevenLabs fails after the site said yes (for example, no credits left)
async function interviewFailed(env, ctx, id) {
  const iv = await env.DB.prepare("SELECT 1 FROM interviews WHERE id = ? AND duration_secs IS NULL AND created_at > ?").bind(id, now() - 600).first();
  if (iv) ctx.waitUntil(interviewAlert(env, "elevenlabs"));
  return json({ ok: true });
}
const APPLY_FIELDS = {
  founder_name: [80, "The founder's full name."],
  why_you: [600, "Why the founder is the one to build this: what they've lived, built or know, in their words."],
  ...DRAFT_FIELDS,
  heard_from: [200, "How the founder heard about Stag Hunt."],
};
delete APPLY_FIELDS.discount;
const APPLY_SYSTEM = DRAFT_SYSTEM.replace("between an investor and a startup founder", "between an AI interviewer and a startup founder applying for investment").split("\nFields:")[0] + `
Fields:
${Object.entries(APPLY_FIELDS).map(([k, [, d]]) => `- ${k}: ${d}`).join("\n")}`;

async function finishInterview(request, env, id) {
  const b = await readJson(request);
  const cid = String(b.conversation_id || "");
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(cid)) bad("That interview didn't connect.");
  const iv = await env.DB.prepare("SELECT * FROM interviews WHERE id = ?").bind(id).first();
  if (!iv || (iv.conversation_id && iv.conversation_id !== cid)) throw new HttpError(404, "not_found", "That interview isn't here.");
  if (iv.fields) return json({ fields: JSON.parse(iv.fields) });
  if (!iv.conversation_id) {
    const r = await env.DB.prepare("UPDATE interviews SET conversation_id = ? WHERE id = ? AND conversation_id IS NULL").bind(cid, id).run().catch(() => ({ meta: {} }));
    if (!r.meta.changes) throw new HttpError(404, "not_found", "That interview isn't here.");
  }
  const r = await elFetch(env, `/conversations/${cid}`);
  const c = r.ok ? await r.json() : null;
  if (!c || c.agent_id !== env.INTERVIEW_AGENT_ID) throw new HttpError(404, "not_found", "That interview isn't here.");
  if (!["done", "failed"].includes(c.status)) return json({ pending: true }, 202);   // still being processed; the page asks again
  const secs = Number(c.metadata?.call_duration_secs) || 0;
  const cost = Number.isFinite(c.metadata?.cost_fiat) ? c.metadata.cost_fiat : (secs / 60) * INTERVIEW_USD_PER_MIN;
  const transcript = (c.transcript || []).filter((t) => t.message).map((t) => `${t.role === "agent" ? "Interviewer" : "Founder"}: ${t.message.trim()}`).join("\n");
  const said = (c.transcript || []).filter((t) => t.role === "user" && t.message).map((t) => t.message).join(" ");
  if (said.length < 80) {
    await env.DB.prepare("UPDATE interviews SET duration_secs = ?, cost_usd = ? WHERE id = ?").bind(secs, cost, id).run();
    bad("We didn't hear enough to fill in your application. You can try again, or use the form.");
  }
  const fields = await extractFields(env, transcript, APPLY_FIELDS, APPLY_SYSTEM);
  await env.DB.prepare("UPDATE interviews SET transcript = ?, fields = ?, duration_secs = ?, cost_usd = ? WHERE id = ?")
    .bind(transcript.slice(0, REC_LIMIT), JSON.stringify(fields), secs, cost, id).run();
  return json({ fields });
}
// Members listen through the site; the recording itself stays with ElevenLabs.
async function interviewAudio(env, appId) {
  const row = await env.DB.prepare("SELECT i.conversation_id FROM applications a JOIN interviews i ON i.id = a.interview_id WHERE a.id = ?").bind(appId).first();
  if (!row?.conversation_id || !env.ELEVENLABS_API_KEY) throw new HttpError(404, "not_found", "No recording for this application.");
  const r = await elFetch(env, `/conversations/${row.conversation_id}/audio`);
  if (!r.ok) throw new HttpError(404, "not_found", "The recording isn't available.");
  return new Response(r.body, { headers: { "Content-Type": r.headers.get("Content-Type") || "audio/mpeg", "Cache-Control": "private, max-age=3600" } });
}

// INSERT built from an object's keys. Keys always come from this file, never from a request.
function insertRow(env, table, row) {
  const cols = Object.keys(row);
  return env.DB.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).bind(...cols.map((c) => row[c]));
}
async function readJson(request) { try { return await request.json(); } catch { return {}; } }
function now() { return Math.floor(Date.now() / 1000); }
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });
}
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---- Emails: one centered card that matches the site (navy, gold hairlines, serif type)
const M_INK = "#1B2233", M_NAVY = "#14244A", M_MUTED = "#555C6B", M_RULE = "#D9D6CE", M_GOLD = "#9a7b3f";
const M_SERIF = "'Cormorant Garamond',Georgia,'Times New Roman',serif";
const M_SANS = "Inter,-apple-system,'Helvetica Neue',Arial,sans-serif";

function checkerMark(size = 16) {
  const c = size / 2;
  const sq = (fill) => `<td width="${c}" height="${c}" style="width:${c}px;height:${c}px;padding:0;font-size:0;line-height:0;background:${fill ? M_NAVY : "transparent"}">&nbsp;</td>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border:1.5px solid ${M_NAVY};border-collapse:separate"><tr>${sq(1)}${sq(0)}</tr><tr>${sq(0)}${sq(1)}</tr></table>`;
}

function emailShell(app, inner) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Inter:wght@500&display=swap" rel="stylesheet">
<style>:root{color-scheme:light only}</style></head>
<body style="margin:0;padding:0;background:#F3F1EC;font-family:Georgia,'Times New Roman',serif;color:${M_INK}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F1EC"><tr><td align="center" style="padding:48px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px">
<tr><td align="center" style="padding-bottom:26px">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="padding-right:10px;vertical-align:middle">${checkerMark()}</td>
    <td style="vertical-align:middle;font:600 21px/1 ${M_SERIF};color:${M_NAVY};letter-spacing:.01em">${escHtml(app)}</td>
  </tr></table>
</td></tr>
<tr><td align="center" style="background:#FFFFFF;border:1px solid ${M_RULE};border-top:2px solid ${M_GOLD};padding:40px 32px 32px;text-align:center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${inner}</table></td></tr></table></td></tr></table></body></html>`;
}

// Building blocks. Every line is centered.
const mailKicker = (t) => `<tr><td align="center" style="padding:0 0 10px;font:italic 16px/1.4 Georgia,serif;color:${M_MUTED}">${t}</td></tr>`;
const mailTitle = (t) => `<tr><td align="center" style="padding:0 0 14px;font:500 30px/1.15 ${M_SERIF};color:${M_INK}">${t}</td></tr>`;
const mailPara = (t, pad = 14) => `<tr><td align="center" style="padding:0 0 ${pad}px;font:16px/1.65 Georgia,serif;color:#2E3445">${t}</td></tr>`;
const mailNote = (t, pad = 14) => `<tr><td align="center" style="padding:0 0 ${pad}px;font:14px/1.6 Georgia,serif;color:${M_MUTED}">${t}</td></tr>`;
const mailCode = (t) => `<tr><td align="center" style="padding:4px 0 18px;font:600 30px/1.2 ${M_SANS};letter-spacing:.22em;color:${M_INK}">${t}</td></tr>`;
const openBtn = (href, label) => `<a href="${href}" style="display:inline-block;background:${M_NAVY};color:#FAF9F6;text-decoration:none;font:500 12px/1 ${M_SANS};letter-spacing:.16em;text-transform:uppercase;padding:15px 26px">${escHtml(label)}</a>`;
const mailBtn = (href, label) => `<tr><td align="center" style="padding:10px 0 4px">${openBtn(href, label)}</td></tr>`;

function codeEmailHtml(app, code, link) {
  return emailShell(app,
    mailTitle(`Sign in to ${escHtml(app)}`) +
    mailBtn(link, "Sign in") +
    `<tr><td style="padding-top:22px"></td></tr>` +
    mailNote("Or type this code on the sign-in page:", 4) +
    mailCode(code) +
    mailNote("The link and code work once, for 10 minutes. Didn't ask for this? You can ignore this email.", 0));
}
function inviteEmailHtml(app, name, inviter, observer = false) {
  return mailLayout(app,
    mailTitle(`You're in, ${escHtml(name)}.`) +
    mailPara(`${escHtml(inviter)} added you to ${escHtml(app)}, a new way to invest in early-stage companies: investors share every good deal they find, and each decides alone.`) +
    (observer ? mailPara("You're joining as a guest. You can read everything, but you can't post or make calls on deals.") : "") +
    mailPara("Sign in with this email address. No password needed.", 8) +
    mailBtn("https://staghunts.com/login", "Sign in"), "", false);
}

function backupHtml(app, date) {
  const month = new Date(date + "T12:00:00Z").toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return mailLayout(app,
    mailKicker(escHtml(month)) +
    mailTitle("Monthly backup") +
    mailPara("Every deal, call and investment is in the spreadsheet attached. It opens in Excel or Google Sheets.") +
    mailPara("Keep it somewhere safe. It holds members' deals and terms.", 0),
    " Sent to admins on the first of each month.", false);
}

// ---------------------------------------------------------------- passkeys (Face ID / Touch ID)

function deviceName(request) {
  const ua = request.headers.get("User-Agent") || "";
  if (/iPhone/.test(ua)) return "iPhone"; if (/iPad/.test(ua)) return "iPad"; if (/Android/.test(ua)) return "Android";
  if (/Macintosh/.test(ua)) return "Mac"; if (/Windows/.test(ua)) return "Windows"; return "This device";
}

async function saveChallenge(env, kind, challenge, userId = null) {
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM webauthn_challenges WHERE expires_at < ?").bind(now()),
    env.DB.prepare("INSERT INTO webauthn_challenges (id, user_id, kind, challenge, expires_at) VALUES (?, ?, ?, ?, ?)").bind(id, userId, kind, challenge, now() + 300),
  ]);
  return id;
}
async function takeChallenge(env, id, kind) {
  const row = await env.DB.prepare("SELECT * FROM webauthn_challenges WHERE id = ? AND kind = ?").bind(String(id || ""), kind).first();
  if (row) await env.DB.prepare("DELETE FROM webauthn_challenges WHERE id = ?").bind(row.id).run();   // single use
  return row && row.expires_at >= now() ? row : null;
}

async function listPasskeys(env, me) {
  const { results } = await env.DB.prepare("SELECT id, name, created_at, last_used FROM passkeys WHERE user_id = ? ORDER BY created_at").bind(me.id).all();
  return json({ passkeys: results });
}

async function passkeyRegisterOptions(env, me) {
  const existing = (await env.DB.prepare("SELECT id, transports FROM passkeys WHERE user_id = ?").bind(me.id).all()).results;
  const options = await generateRegistrationOptions({
    rpName: "Stag Hunt", rpID: RP_ID,
    userName: me.email, userDisplayName: me.name || me.email,
    userID: new TextEncoder().encode(me.id),
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports ? JSON.parse(c.transports) : undefined })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  const challengeId = await saveChallenge(env, "register", options.challenge, me.id);
  return json({ options, challengeId });
}

async function passkeyRegisterVerify(request, env, me) {
  const b = await readJson(request);
  const ch = await takeChallenge(env, b.challengeId, "register");
  if (!ch || ch.user_id !== me.id) bad("That took too long. Please try again.");
  let v;
  try {
    v = await verifyRegistrationResponse({ response: b.response, expectedChallenge: ch.challenge, expectedOrigin: RP_ORIGIN, expectedRPID: RP_ID, requireUserVerification: true });
  } catch (e) { console.error("passkey register", e && e.message); bad("Couldn't set that up. Please try again."); }
  if (!v.verified) bad("Couldn't set that up. Please try again.");
  const c = v.registrationInfo.credential;
  await env.DB.prepare("INSERT OR REPLACE INTO passkeys (id, user_id, public_key, counter, transports, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(c.id, me.id, isoBase64URL.fromBuffer(c.publicKey), c.counter || 0, JSON.stringify(c.transports || []), clean(b.name, 60) || deviceName(request), now()).run();
  return json({ ok: true });
}

async function deletePasskey(env, me, id) {
  await env.DB.prepare("DELETE FROM passkeys WHERE id = ? AND user_id = ?").bind(id, me.id).run();
  return json({ ok: true });
}

async function passkeyLoginOptions(env) {
  const options = await generateAuthenticationOptions({ rpID: RP_ID, userVerification: "required" });
  const challengeId = await saveChallenge(env, "login", options.challenge);
  return json({ options, challengeId });
}

async function passkeyLoginVerify(request, env) {
  const b = await readJson(request);
  const ch = await takeChallenge(env, b.challengeId, "login");
  if (!ch) return json({ error: "expired", message: "That took too long. Please try again." }, 400);
  const credId = String(b.response && b.response.id || "");
  const pk = await env.DB.prepare("SELECT * FROM passkeys WHERE id = ?").bind(credId).first();
  if (!pk) return json({ error: "unknown_passkey", message: "That Face ID or Touch ID was removed from your account. Sign in with email, then set it up again in your profile." }, 400);
  let v;
  try {
    v = await verifyAuthenticationResponse({
      response: b.response, expectedChallenge: ch.challenge, expectedOrigin: RP_ORIGIN, expectedRPID: RP_ID, requireUserVerification: true,
      credential: { id: pk.id, publicKey: isoBase64URL.toBuffer(pk.public_key), counter: pk.counter, transports: pk.transports ? JSON.parse(pk.transports) : undefined },
    });
  } catch (e) { console.error("passkey login", e && e.message); return json({ error: "failed", message: "Couldn't verify that. Please try again." }, 400); }
  if (!v.verified) return json({ error: "failed", message: "Couldn't verify that. Please try again." }, 400);
  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ? AND status = 'active'").bind(pk.user_id).first();
  if (!user) return json({ error: "failed", message: "Couldn't verify that. Please try again." }, 400);
  const t = now(), s = await newSession(env, user.id, t);
  await env.DB.batch([
    env.DB.prepare("UPDATE passkeys SET counter = ?, last_used = ? WHERE id = ?").bind(v.authenticationInfo.newCounter || 0, t, pk.id),
    env.DB.prepare("UPDATE users SET last_login = ? WHERE id = ?").bind(t, user.id),
    s.insert,
  ]);
  return json({ ok: true }, 200, { "Set-Cookie": s.cookie });
}

// ---------------------------------------------------------------- notifications

async function updateNotifications(request, env, me) {
  const b = await readJson(request);
  await env.DB.prepare("UPDATE users SET notify_deals = ?, notify_digest = ? WHERE id = ?")
    .bind(b.notify_deals ? 1 : 0, b.notify_digest ? 1 : 0, me.id).run();
  return json({ ok: true });
}

function mailLayout(app, inner, footer = "", optOut = true) {
  return emailShell(app, inner + `<tr><td style="padding-top:28px"><div style="border-top:1px solid ${M_RULE};font-size:0;line-height:0">&nbsp;</div></td></tr>
<tr><td align="center" style="padding-top:18px;font:italic 13px/1.6 Georgia,serif;color:${M_MUTED}">Deals and terms shared in Stag Hunt stay among members.${footer}${optOut ? " You can turn these emails off in your profile." : ""}</td></tr>`);
}

const firstName = (u) => String(u.name || "").trim().split(/\s+/)[0] || "";

async function sendMail(env, to, subject, text, html, extra = {}) {
  try { await env.EMAIL.send({ to, from: { email: env.MAIL_FROM, name: env.APP_NAME }, subject, text, html, ...extra }); return true; }
  catch (e) { console.error("mail failed", to, e && e.message); return false; }
}

// A short heads-up to members when someone shares a new deal
async function emailNewDeal(env, d) {
  const { results } = await env.DB.prepare(`SELECT email, name FROM users WHERE status = 'active' AND notify_deals = 1 AND id != ?
    AND (role != 'member' OR tier IS NULL OR ? IS NULL OR tier >= ?)`).bind(d.poster_id, d.min_tier, d.min_tier).all();   // only members at this check size
  for (const u of results) await sendMail(env, u.email, ...newDealMail(env, d, u));
}

function newDealMail(env, d, u) {
  const link = dealLink(d.id), first = firstName(u);
  return [`New deal: ${d.company}`,
      `${first ? `${first}, ` : ""}${d.poster} shared a new deal in Stag Hunt.\n\n${d.company}: ${d.one_liner}\nHow they're raising: ${d.round_type}\n\nWant to meet the team? Say yes or no: ${link}`,
      mailLayout(env.APP_NAME,
        mailKicker(`${first ? `${escHtml(first)}, ` : ""}${escHtml(d.poster)} shared a new deal`) + mailTitle(escHtml(d.company)) +
        mailPara(escHtml(d.one_liner), 6) + mailNote(escHtml(d.round_type)) +
        mailBtn(link, "Yes or no?"))];
}

// Monday digest: what's new, what's waiting for your yes or no, and who brought deals this month
async function sendWeeklyDigest(env) {
  const t = now(), weekAgo = t - 7 * 86400;
  const monthStart = Math.floor(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1) / 1000);
  const inbound = (await env.DB.prepare("SELECT COUNT(*) AS n FROM applications WHERE status = 'open' AND created_at > ?").bind(weekAgo).first()).n;
  const [newDeals, members, contributors] = await Promise.all([
    env.DB.prepare(`SELECT d.id, d.company, d.one_liner, d.min_tier, d.poster_id, COALESCE(u.name,u.email) AS poster
      FROM deals d JOIN users u ON u.id = d.poster_id WHERE d.created_at > ? ORDER BY d.created_at DESC`).bind(weekAgo).all(),
    env.DB.prepare("SELECT id, email, name, role, tier FROM users WHERE status = 'active' AND notify_digest = 1").all(),
    env.DB.prepare(`SELECT COALESCE(u.name,u.email) AS name, COUNT(*) AS n FROM deals d JOIN users u ON u.id = d.poster_id
      WHERE d.created_at >= ? GROUP BY d.poster_id ORDER BY n DESC`).bind(monthStart).all(),
  ]);
  for (const m of members.results) {
    const mail = await digestMail(env, m, newDeals.results, contributors.results, inbound);
    if (mail) await sendMail(env, m.email, ...mail);
  }
}

// One member's Monday digest, or null when there is nothing worth an email (unless forced, for a test)
async function digestMail(env, m, newDeals, contributors, inbound, force = false, sample = null) {
  const mine = sample ? sample.mine : newDeals.filter((d) => fits(m, d));   // only deals at their check size
  const { toScore, ours, yourCalls, record, checks } = sample || await digestFacts(env, m);
  if (!mine.length && !toScore.length && !inbound && !ours.length && !force) return null;   // nothing worth an email
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const portfolio = portfolioLines(checks);
  const week = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "America/New_York" });
  const quiet = !mine.length && !toScore.length && !inbound && !ours.length;
  const fp = await env.DB.prepare("SELECT day, hash FROM ledger_heads ORDER BY day DESC LIMIT 1").first().catch(() => null);
  const fpLine = fp ? `Record fingerprint for ${fp.day}: ${fp.hash}. Keep this email: it proves no call made before that day can be changed later.` : "";
  const first = firstName(m), hi = first ? `${first}, ` : "";
  const madeCalls = yourCalls.n ? `You made ${plural(yourCalls.n, "call")} this past week.` : "";
  // Your record in one line, so it never drifts out of mind
  const recordLine = record.n ? `Your record: ${plural(record.n, "call")}${record.known ? `, ${record.known} with an outcome, ${record.right} right` : ", none with an outcome yet"}.` : "";
  const quietLine = `A quiet week${first ? `, ${first}` : ""}. No new deals, and nothing is waiting for your yes or no.`;
  // One labeled block per topic, divided by a thin rule
  const section = (label, inner) => `<tr><td align="center" style="padding:18px 0 6px;border-top:1px solid ${M_RULE};font:600 12px/1.4 ${M_SANS};letter-spacing:.14em;text-transform:uppercase;color:${M_MUTED}">${label}</td></tr>` + inner;
  const link = (href, t) => `<a href="${href}" style="color:${M_NAVY}">${t}</a>`;
  const dealRows = mine.map((d) => mailPara(`${link(dealLink(d.id), `<b>${escHtml(d.company)}</b>`)}<br><span style="font-size:14px;color:${M_MUTED}">${escHtml(d.one_liner)}<br>Brought by ${d.poster_id === m.id ? "you" : escHtml(d.poster)}</span>`, 10)).join("");
  const hunters = contributors.length ? contributors.map((c) => `${escHtml(c.name)} (${c.n})`).join(", ") : "No one has brought a deal yet this month.";
  const subject = hi + (mine.length ? `${plural(mine.length, "new deal")} this week`
    : ours.length ? `members made calls on your deal${ours.length === 1 ? "" : "s"} this week`
    : toScore.length ? `${plural(toScore.length, "deal")} waiting for your yes or no`
    : inbound ? `${plural(inbound, "founder")} applied this week`
    : "a quiet week in Stag Hunt");
  const subjectCased = subject.charAt(0).toUpperCase() + subject.slice(1);
  const text = [`${first ? `${first}, here is your week` : "Your week in Stag Hunt"} (week of ${week})`,
    sample ? "Sample numbers, so you can see what a full week looks like." : "",
    quiet ? quietLine : "", madeCalls,
    ours.length ? `Your deals:\n${ours.map((d) => `- ${d.company}: ${plural(d.n, "new call")} from members`).join("\n")}` : "",
    mine.length ? `New this week:\n${mine.map((d) => `- ${d.company}: ${d.one_liner} (brought by ${d.poster_id === m.id ? "you" : d.poster})`).join("\n")}` : "",
    toScore.length ? `Waiting for your yes or no: ${toScore.map((d) => d.company).join(", ")}` : "",
    inbound ? `Founders who applied: ${inbound} new (https://staghunts.com/app#/inbound)` : "",
    recordLine ? `${recordLine} https://staghunts.com/app#/history` : "",
    portfolio ? `Your portfolio: ${portfolio.headline}\n${portfolio.lines.join("\n")}` : "",
    `Deals brought this month: ${contributors.map((c) => `${c.name} (${c.n})`).join(", ") || "none yet"}`,
    fpLine, "https://staghunts.com/app"].filter(Boolean).join("\n\n");
  return [subjectCased, text,
    mailLayout(env.APP_NAME,
      mailTitle(first ? `${escHtml(first)}, here is your week` : "Your week in Stag Hunt") + mailKicker(`Week of ${week}`) +
      (sample ? mailNote("Sample numbers, so you can see what a full week looks like.") : "") +
      (quiet ? mailPara(escHtml(quietLine)) : "") + (madeCalls ? mailNote(madeCalls) : "") +
      (ours.length ? section("Your deals", ours.map((d) => mailPara(`${link(dealLink(d.id), `<b>${escHtml(d.company)}</b>`)}<br><span style="font-size:14px;color:${M_MUTED}">${plural(d.n, "new call")} from members</span>`, 10)).join("")) : "") +
      (mine.length ? section(`New this week (${mine.length})`, dealRows) : "") +
      (toScore.length ? section("Waiting for your yes or no", mailPara(toScore.map((d) => link(dealLink(d.id), escHtml(d.company))).join(", "))) : "") +
      (inbound ? section("Founders who applied", mailPara(`${link("https://staghunts.com/app#/inbound", plural(inbound, "new application"))}. Take a call if one fits what you invest in.`)) : "") +
      section("Deals brought this month", mailNote(hunters)) +
      (portfolio ? section("Your portfolio", mailPara(`<b>${escHtml(portfolio.headline)}</b>`, 6) + portfolio.lines.map((l) => mailNote(escHtml(l), 4)).join("")) : "") +
      (recordLine ? section("Your record", mailNote(`${escHtml(recordLine)} <a href="https://staghunts.com/app#/history" style="color:${M_NAVY}">See it</a>`)) : "") +
      mailBtn("https://staghunts.com/app", "Open Stag Hunt") +
      (fp ? mailNote(`Record fingerprint for ${fp.day}: <span style="font-family:Menlo,monospace;word-break:break-all">${fp.hash}</span>. Keep this email: it proves no call made before that day can be changed later.`) : ""))];
}

// Your record: every deal you brought, called or backed, for your eyes only
async function myHistory(env, me, format = "json") {
  const { results } = await env.DB.prepare(`SELECT d.id, d.company, d.sector, d.status, d.outcome, d.created_at,
      d.poster_id = ?1 AS brought, s.yes AS my_yes, s.why AS my_why, s.updated_at AS called_at,
      (SELECT COUNT(*) FROM scores x WHERE x.deal_id = d.id AND x.member_id != ?1) AS calls,
      (SELECT COALESCE(SUM(x.yes),0) FROM scores x WHERE x.deal_id = d.id AND x.member_id != ?1) AS yeses,
      i.amount_cents, i.realized_cents, COALESCE(i.paper_cents, i.amount_cents) AS paper_cents, i.invested_on
    FROM deals d
    LEFT JOIN scores s ON s.deal_id = d.id AND s.member_id = ?1
    LEFT JOIN investments i ON i.deal_id = d.id AND i.member_id = ?1
    WHERE d.poster_id = ?1 OR s.member_id IS NOT NULL OR i.member_id IS NOT NULL
    ORDER BY d.created_at DESC`).bind(me.id).all();
  // Judge alone: others' yeses stay hidden on open deals until you make your own call
  const deals = results.map((d) => me.role !== "observer" && SCORING.includes(d.status) && d.my_yes === null ? { ...d, yeses: null } : d);
  // The group's averages, for comparison. Open deals you haven't called stay out, so nothing leaks before your own call.
  const seen = `(d.status NOT IN ('reviewing','founder_call') OR EXISTS (SELECT 1 FROM scores c WHERE c.deal_id = d.id AND c.member_id = ?1))`;
  const [calls, sourced, backing] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n, AVG(s.yes) AS yes_rate, AVG((s.updated_at - d.created_at) / 86400.0) AS days,
        SUM(d.outcome IS NOT NULL) AS known, AVG(CASE WHEN d.outcome IS NOT NULL THEN s.yes = (d.outcome IN ('breakout','on_track')) END) AS good_rate
      FROM scores s JOIN deals d ON d.id = s.deal_id WHERE s.member_id != d.poster_id AND s.member_id != ?1 AND ${seen}`).bind(me.id).first(),
    env.DB.prepare(`SELECT AVG(y) AS member_yes, (SELECT AVG(outcome IN ('breakout','on_track')) FROM deals WHERE outcome IS NOT NULL AND poster_id != ?1) AS went_well
      FROM (SELECT AVG(s.yes) AS y FROM deals d JOIN scores s ON s.deal_id = d.id AND s.member_id != d.poster_id
        WHERE d.poster_id != ?1 AND ${seen} GROUP BY d.id)`).bind(me.id).first(),
    env.DB.prepare(`SELECT SUM(amount_cents) AS invested, SUM(COALESCE(realized_cents,0) + COALESCE(paper_cents, amount_cents)) AS worth
      FROM investments WHERE member_id != ?1`).bind(me.id).first(),
  ]);
  if (format === "csv") return historyCsv(deals);
  return json({ joined: me.created_at, deals, group: { ...calls, ...sourced, multiple: backing.invested ? backing.worth / backing.invested : null } });
}

// A track record you choose to share: every call is dated and locked before anyone knows the outcome.
// Company names, terms and money stay inside Stag Hunt; only sectors, calls and outcomes show.
const trackLink = (t) => `${RP_ORIGIN}/track/#${t}`;
async function publicTrack(env, token) {
  const u = await env.DB.prepare("SELECT id, name, email, headline, created_at FROM users WHERE record_link = ? AND status = 'active'").bind(token).first();
  if (!u) throw new HttpError(404, "not_found", "This track record isn't shared anymore.");
  const good = "d.outcome IN ('breakout','on_track')";
  const [calls, brought, group] = await Promise.all([
    env.DB.prepare(`SELECT s.updated_at AS called_at, d.sector, s.yes, d.outcome, d.outcome_at FROM scores s JOIN deals d ON d.id = s.deal_id
      WHERE s.member_id = ? AND d.poster_id != ? ORDER BY s.updated_at DESC LIMIT 500`).bind(u.id, u.id).all(),
    env.DB.prepare(`SELECT COUNT(*) AS n, SUM(d.outcome IS NOT NULL) AS known, SUM(${good}) AS well FROM deals d WHERE d.poster_id = ?`).bind(u.id).first(),
    env.DB.prepare(`SELECT AVG(s.yes = (${good})) AS good_rate, COUNT(*) AS n FROM scores s JOIN deals d ON d.id = s.deal_id
      WHERE d.outcome IS NOT NULL AND s.member_id != d.poster_id`).first(),
  ]);
  return json({
    member: { name: u.name || u.email.split("@")[0], headline: u.headline || "", since: u.created_at },
    calls: calls.results.map((c) => ({ called_at: c.called_at, sector: c.sector || "", yes: !!c.yes, outcome: c.outcome, outcome_at: c.outcome ? c.outcome_at : null })),
    brought: { n: brought.n, known: brought.known || 0, well: brought.well || 0 },
    group: { good_rate: group.n ? group.good_rate : null, calls: group.n },
  }, 200, { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" });
}

// Personal key: shown once, stored only as a hash, and a new one replaces the old
async function makeApiKey(env, me) {
  const key = "shk_" + randomToken();
  await env.DB.prepare(`INSERT INTO api_keys (user_id, key_hash, last4, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET key_hash = excluded.key_hash, last4 = excluded.last4, created_at = excluded.created_at, last_used_at = NULL`)
    .bind(me.id, await sha256(key), key.slice(-4), now()).run();
  const first = firstName(me);
  await sendMail(env, me.email, "A key was made for your Stag Hunt record",
    `${first ? first + ", a" : "A"} read-only key ending in ${key.slice(-4)} was just made for your record in Stag Hunt. If this wasn't you, turn it off on Your record: https://staghunts.com/app#/history`,
    mailLayout(env.APP_NAME, mailKicker("Your record") + mailTitle("A new key was made") +
      mailPara(`${first ? escHtml(first) + ", a" : "A"} read-only key ending in <b>${escHtml(key.slice(-4))}</b> was just made for your record. It can read your record and nothing else.`) +
      mailNote("If this wasn't you, turn it off. Any older key has already stopped working.") +
      mailBtn("https://staghunts.com/app#/history", "Open Your record"), "", false));
  return json({ key });
}
async function keyUser(env, key) {
  const u = /^shk_[A-Za-z0-9_-]{43}$/.test(key) && await env.DB.prepare(
    "SELECT u.* FROM api_keys k JOIN users u ON u.id = k.user_id WHERE k.key_hash = ? AND u.status = 'active'").bind(await sha256(key)).first();
  if (!u) throw new HttpError(401, "bad_key", "That key doesn't work. Make a new one on Your record in Stag Hunt.");
  await env.DB.prepare("UPDATE api_keys SET last_used_at = ? WHERE user_id = ?").bind(now(), u.id).run();
  return u;
}

// The same record as a spreadsheet: opens in Excel, Numbers or Google Sheets
function historyCsv(deals) {
  const day = (s) => (s ? new Date(s * 1000).toISOString().slice(0, 10) : "");
  const dollars = (c) => (c == null ? "" : Math.round(c / 100));
  const good = (o) => o === "breakout" || o === "on_track";
  const head = ["Deal shared", "Company", "Sector", "Your part", "Your call", "Called on", "Days to call", "Other members' calls", "Their yeses",
    "Your check ($)", "Invested on", "Cash back ($)", "Worth today ($)", "Multiple", "Status", "Outcome", "Your call was right", "Your why", "Link"];
  const rows = deals.map((d) => {
    const back = d.amount_cents ? (d.realized_cents || 0) + (d.paper_cents || 0) : null;
    return [day(d.created_at), d.company, d.sector, d.brought ? "Brought it" : d.my_yes === null ? "Backed it" : "Called it",
      d.my_yes === null ? "" : d.my_yes ? "Yes" : "No", day(d.called_at),
      d.called_at && !d.brought ? Math.max(0, (d.called_at - d.created_at) / 86400).toFixed(1) : "",
      d.calls, d.yeses ?? "hidden until you call", dollars(d.amount_cents), d.invested_on || "", dollars(d.realized_cents), dollars(back),
      back != null ? (back / d.amount_cents).toFixed(2) : "", d.status, d.outcome || "",
      d.outcome && d.my_yes !== null && !d.brought ? (!!d.my_yes === good(d.outcome) ? "Yes" : "No") : "", d.my_why || "", dealLink(d.id)];
  });
  const csv = "\ufeff" + [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="stag-hunt-my-record-${day(now())}.csv"`, "Cache-Control": "no-store" } });
}

async function digestFacts(env, m) {
  const weekAgo = now() - 7 * 86400;
  const [toScore, yourDeals, yourCalls, record, checks] = await Promise.all([
    env.DB.prepare(`SELECT d.id, d.company FROM deals d WHERE d.status IN ('reviewing','founder_call') AND d.poster_id != ?1
      AND ${fitsSql(m)} AND NOT EXISTS (SELECT 1 FROM scores s WHERE s.deal_id = d.id AND s.member_id = ?1) ORDER BY d.created_at DESC LIMIT 10`).bind(m.id).all(),
    env.DB.prepare(`SELECT d.id, d.company, COUNT(*) AS n FROM deals d JOIN scores s ON s.deal_id = d.id
      WHERE d.poster_id = ? AND s.member_id != d.poster_id AND s.updated_at > ? GROUP BY d.id ORDER BY n DESC`).bind(m.id, weekAgo).all(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM scores WHERE member_id = ? AND updated_at > ?").bind(m.id, weekAgo).first(),
    env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(d.outcome IS NOT NULL),0) AS known,
        COALESCE(SUM(d.outcome IS NOT NULL AND s.yes = (d.outcome IN ('breakout','on_track'))),0) AS right
      FROM scores s JOIN deals d ON d.id = s.deal_id WHERE s.member_id = ? AND d.poster_id != ?`).bind(m.id, m.id).first(),
    env.DB.prepare(`SELECT d.company, i.amount_cents AS amount, COALESCE(i.realized_cents,0) AS back, COALESCE(i.paper_cents, i.amount_cents) AS paper
      FROM investments i JOIN deals d ON d.id = i.deal_id WHERE i.member_id = ? AND i.amount_cents > 0`).bind(m.id).all(),
  ]);
  return { toScore: toScore.results, ours: yourDeals.results, yourCalls, record, checks: checks.results };
}

// Your checks as numbers: total, value, multiple, spread of check sizes, concentration, best and weakest
function portfolioLines(checks) {
  if (!checks || !checks.length) return null;
  const $ = (c) => "$" + Math.round(c / 100).toLocaleString("en-US");
  const x = (c) => (c.back + c.paper) / c.amount;
  const put = checks.reduce((t, c) => t + c.amount, 0), worth = checks.reduce((t, c) => t + c.back + c.paper, 0), back = checks.reduce((t, c) => t + c.back, 0);
  const sizes = checks.map((c) => c.amount).sort((a, b) => a - b), mid = sizes[Math.floor((sizes.length - 1) / 2)];
  const byX = [...checks].sort((a, b) => x(b) - x(a)), top = sizes[sizes.length - 1];
  const lines = [
    `Cash back so far: ${$(back)}. Still invested, at today's value: ${$(worth - back)}.`,
    checks.length > 1 ? `Check sizes: smallest ${$(sizes[0])}, middle ${$(mid)}, largest ${$(top)}.` : "",
    checks.length > 1 ? `Your largest check is ${Math.round((top / put) * 100)}% of everything you have put in.` : "",
    checks.length > 1 ? `Best: ${byX[0].company} at ${x(byX[0]).toFixed(1)}x. Weakest: ${byX[byX.length - 1].company} at ${x(byX[byX.length - 1]).toFixed(1)}x.` : "",
  ].filter(Boolean);
  return { headline: `${$(put)} in ${checks.length} check${checks.length === 1 ? "" : "s"}, worth ${$(worth)} today (${(worth / put).toFixed(2)}x).`, lines };
}

// What a busy week looks like, for the sample test email. Every name here is made up.
const SAMPLE_WEEK = {
  mine: [
    { id: "sample", company: "Tidewater Grid", one_liner: "Software that balances the power grid for small utilities.", poster: "A member", poster_id: "" },
    { id: "sample", company: "Quarry Labs", one_liner: "Recycled concrete that is stronger than new.", poster: "Another member", poster_id: "" },
  ],
  toScore: [{ id: "sample", company: "Tidewater Grid" }, { id: "sample", company: "Quarry Labs" }],
  ours: [{ id: "sample", company: "Ledgerline", n: 4 }],
  yourCalls: { n: 3 },
  record: { n: 18, known: 7, right: 5 },
  checks: [
    { company: "Northwind Robotics", amount: 500000, back: 0, paper: 1500000 },
    { company: "Ledgerline", amount: 1000000, back: 2500000, paper: 0 },
    { company: "Ember Health", amount: 1500000, back: 0, paper: 0 },
    { company: "Tidewater Grid", amount: 10000000, back: 0, paper: 18000000 },
    { company: "Harbor Bio", amount: 50000000, back: 0, paper: 50000000 },
  ],
};

// "Send me a test": both automated emails, to the signed-in person only
async function sendTestEmails(env, me, sample = false) {
  const t = now(), weekAgo = t - 7 * 86400;
  const monthStart = Math.floor(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1) / 1000);
  const [latest, newDeals, contributors, inbound] = await Promise.all([
    env.DB.prepare(`SELECT d.id, d.company, d.one_liner, d.round_type, COALESCE(u.name,u.email) AS poster
      FROM deals d JOIN users u ON u.id = d.poster_id WHERE ${fitsSql(me)} ORDER BY d.created_at DESC LIMIT 1`).first(),
    env.DB.prepare(`SELECT d.id, d.company, d.one_liner, d.min_tier, d.poster_id, COALESCE(u.name,u.email) AS poster
      FROM deals d JOIN users u ON u.id = d.poster_id WHERE d.created_at > ? ORDER BY d.created_at DESC`).bind(weekAgo).all(),
    env.DB.prepare(`SELECT COALESCE(u.name,u.email) AS name, COUNT(*) AS n FROM deals d JOIN users u ON u.id = d.poster_id
      WHERE d.created_at >= ? GROUP BY d.poster_id ORDER BY n DESC`).bind(monthStart).all(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM applications WHERE status = 'open' AND created_at > ?").bind(weekAgo).first(),
  ]);
  const test = ([subject, text, html]) => [`${sample ? "Sample" : "Test"}: ${subject}`, text, html];
  if (sample) {
    if (!await sendMail(env, me.email, ...test(await digestMail(env, me, [], [{ name: "A member", n: 2 }, { name: "Another member", n: 1 }], 2, true, SAMPLE_WEEK))))
      throw new HttpError(502, "mail_failed", "The sample email didn't send. Try again in a minute.");
    return json({ ok: true, to: me.email });
  }
  const deal = latest || { id: "example", company: "Example Co", one_liner: "What a new deal email looks like.", round_type: "Seed", poster: me.name || me.email };
  const a = await sendMail(env, me.email, ...test(newDealMail(env, deal, me)));
  const b = await sendMail(env, me.email, ...test(await digestMail(env, me, newDeals.results, contributors.results, inbound.n, true)));
  if (!a || !b) throw new HttpError(502, "mail_failed", "The test email didn't send. Try again in a minute.");
  return json({ ok: true, to: me.email });
}

// 1st of each month: email admins a copy of the full deals sheet
async function sendMonthlyBackup(env) {
  const csv = await (await exportCsv(env)).text();
  const date = new Date().toISOString().slice(0, 10);
  const admins = (await env.DB.prepare("SELECT email FROM users WHERE status = 'active' AND role = 'admin'").all()).results;
  for (const a of admins) {
    await sendMail(env, a.email, `Stag Hunt monthly backup (${date})`,
      "Every deal, call and investment in Stag Hunt is in the spreadsheet attached. Keep it somewhere safe. It holds members' deals and terms.",
      backupHtml(env.APP_NAME, date),
      { attachments: [{ content: new TextEncoder().encode(csv), filename: `stag-hunt-deals-${date}.csv`, type: "text/csv", disposition: "attachment" }] });
  }
}

// ---------------------------------------------------------------- Sign in with Google (members only)

const GOOGLE_REDIRECT = "https://staghunts.com/api/auth/google/callback";
const redirectTo = (loc, headers = {}) => new Response(null, { status: 302, headers: { Location: loc, "Cache-Control": "no-store", ...headers } });
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function googleStart(env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return redirectTo("/login?google=off");
  const state = randomToken(), verifier = randomToken() + randomToken();
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const q = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID.trim(), redirect_uri: GOOGLE_REDIRECT, response_type: "code",
    scope: "openid email profile", state, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account",
  });
  return redirectTo("https://accounts.google.com/o/oauth2/v2/auth?" + q, {
    "Set-Cookie": `sh_g=${state}.${verifier}; Path=/api/auth/google; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
  });
}

async function googleCallback(request, env, url) {
  const clear = { "Set-Cookie": "sh_g=; Path=/api/auth/google; HttpOnly; Secure; SameSite=Lax; Max-Age=0" };
  const [state, verifier] = String(getCookie(request, "sh_g") || "").split(".");
  if (!state || !verifier || url.searchParams.get("state") !== state || !url.searchParams.get("code")) return redirectTo("/login?google=failed", clear);
  let tok;
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: url.searchParams.get("code"), client_id: env.GOOGLE_CLIENT_ID.trim(), client_secret: String(env.GOOGLE_CLIENT_SECRET).trim(),
        redirect_uri: GOOGLE_REDIRECT, grant_type: "authorization_code", code_verifier: verifier }) });
    tok = await r.json();
    if (!r.ok || !tok.id_token) throw new Error(tok.error || "no id_token");
  } catch (e) { console.error("google token", e && e.message); return redirectTo("/login?google=failed", clear); }
  // The ID token came straight from Google's token endpoint over TLS, so its contents can be trusted; still check the basics.
  let claims;
  try { claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(tok.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)))); }
  catch { return redirectTo("/login?google=failed", clear); }
  const t = now();
  if (claims.aud !== env.GOOGLE_CLIENT_ID.trim() || !["https://accounts.google.com", "accounts.google.com"].includes(claims.iss) || claims.exp < t || claims.email_verified !== true) {
    return redirectTo("/login?google=failed", clear);
  }
  const email = normalizeEmail(claims.email);
  const user = email && await env.DB.prepare("SELECT * FROM users WHERE email = ? AND status = 'active'").bind(email).first();
  if (!user) {
    const removed = email && await env.DB.prepare("SELECT 1 FROM users WHERE email = ? AND status = 'removed'").bind(email).first();
    const already = email && await env.DB.prepare("SELECT 1 FROM join_requests WHERE email = ? AND (status = 'open' OR (status = 'declined' AND decided_at > ?))").bind(email, t - 30 * 86400).first();
    if (email && !removed && !already) {
      const name = clean(claims.name, 80) || email;
      await env.DB.prepare("INSERT INTO join_requests (id, email, name, source, created_at) VALUES (?, ?, ?, 'google', ?)").bind(crypto.randomUUID(), email, name, t).run();
      await emailAdmins(env, `${name} asked to join Stag Hunt`,
        `${name} (${email}) signed in with Google but isn't a member yet. They can't see anything until you approve them.\n\nApprove or decline: https://staghunts.com/app#/nominations`,
        mailKicker("Someone asked to join") + mailTitle(escHtml(name)) + mailNote(escHtml(email)) +
        mailPara("They signed in with Google, so the email address is real. They can't see anything until you approve them.", 8) +
        mailBtn("https://staghunts.com/app#/nominations", "Approve or decline"));
      await notify(env, { type: "changed", what: "nominations" });
    }
    return redirectTo("/login?google=" + (removed ? "notmember" : "requested"), clear);
  }
  const s = await newSession(env, user.id, t);
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET last_login = ?, name = COALESCE(name, ?) WHERE id = ?").bind(t, clean(claims.name, 80), user.id),
    s.insert,
  ]);
  const h = new Headers({ Location: user.last_login ? "/app" : "/app#/profile?welcome=1", "Cache-Control": "no-store" });
  h.append("Set-Cookie", clear["Set-Cookie"]);
  h.append("Set-Cookie", s.cookie);
  return new Response(null, { status: 302, headers: h });
}
