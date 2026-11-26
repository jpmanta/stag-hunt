// Stag Hunt members app: hash-routed single page app with a live WebSocket connection.
"use strict";

// ------------------------------------------------------------ utilities
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const linkify = (s) => esc(s).replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
const usd = (cents) => "$" + Math.round((cents || 0) / 100).toLocaleString("en-US");
const date = (s) => new Date(s * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const ago = (s) => {
  const d = Date.now() / 1000 - s;
  if (d < 60) return "just now"; if (d < 3600) return Math.floor(d / 60) + "m ago"; if (d < 86400) return Math.floor(d / 3600) + "h ago";
  if (d < 86400 * 30) return Math.floor(d / 86400) + "d ago"; return date(s);
};
const firstName = (n) => String(n || "").split(" ")[0];
// A link shown without https:// or a trailing slash
const bareUrl = (u) => String(u || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
const initials = (n) => String(n || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const avatar = (name, id, size = "") => {
  const ph = id && state.photos && state.photos[id];
  return `<span class="avatar ${size}">${ph ? `<img src="/api/photo/${esc(id)}?v=${ph}" alt="">` : esc(initials(name))}${id && !size ? `<i class="dot${state.online.has(id) ? " on" : ""}" data-dot="${esc(id)}"></i>` : ""}</span>`;
};
async function loadPhotos() {
  try { const { members } = await api("/api/members"); state.photos = Object.fromEntries(members.filter((m) => m.photo_at).map((m) => [m.id, m.photo_at])); } catch {}
}
const fmt1 = (v) => (v == null ? "–" : (Math.round(v * 10) / 10).toString());
const STATUS = { reviewing: "Reviewing", founder_call: "Founder call", invested: "Invested", passed: "Passed", exited: "Exited", dead: "Dead" };
const ROUNDS = ["SAFE", "Convertible note", "Priced round", "Reg CF", "Other"];
// The ten questions behind every check. Each has what a low, middle and high score looks like,
// so a 7 means the same thing to everyone.
const CATS = [
  { k: "team", t: "Team", q: "Can they execute?", lo: "No relevant experience or proof they ship", mid: "Capable and committed, nothing rare yet", hi: "Lived the problem, rare insight, have shipped before, and good people follow them" },
  { k: "problem", t: "Problem", q: "Is the pain real?", lo: "Nice to have; people shrug", mid: "Real pain for some, but not urgent or costly", hi: "Urgent, frequent and expensive; people already hack together workarounds" },
  { k: "product", t: "Product", q: "Do users care?", lo: "No product or no users yet", mid: "People use it and like it; little proof in behavior", hi: "People pay, use it often, and would be upset to lose it" },
  { k: "market", t: "Market", q: "Is it big enough?", lo: "A niche that tops out small", mid: "Big enough for a good company, not a giant one", hi: "Large and growing; this could be worth $1B or more" },
  { k: "moat", t: "Competition", q: "Can they defend it?", lo: "Crowded; anyone could copy it in months", mid: "Some edge, but it could be competed away", hi: "Rare data, network effects, a license, or know-how that takes years to copy" },
  { k: "money", t: "Business model", q: "How does money flow?", lo: "Unclear who pays or why", mid: "Clear buyer; pricing or margins unproven", hi: "Clear buyer, pricing power, and recurring revenue" },
  { k: "growth", t: "Growth", q: "Can they scale?", lo: "Every customer is won by hand", mid: "Some channels work, but they're costly or unproven", hi: "Repeatable, low-cost ways to win customers, plus word of mouth" },
  { k: "retention", t: "Retention", q: "Will users stay?", lo: "Users try it and leave, or no data yet", mid: "Some stick around; early signs only", hi: "Users stay, use it more over time, and spend more" },
  { k: "timing", t: "Timing", q: "Why now?", lo: "Could have been built ten years ago", mid: "Some tailwind, but no clear shift", hi: "New technology, rules or behavior make this possible now, not before" },
  { k: "endgame", t: "Outcome", q: "How does this end?", lo: "Hard to see a big exit", mid: "A good acquisition is possible", hi: "Big enough to return everything we put in: IPO-scale, or a must-buy for big companies" },
];
// Scores from before the ten questions (out of 50, shown doubled to compare)
const OLD_CATS = [["fmf", "Team fit"], ["market", "Market"], ["scarcity", "Hard to copy"], ["pmf", "Customers"], ["vibe", "Trust"]];
const isTen = (s) => s.team != null;
// Check-size tiers: each member sees deals whose smallest check is at or below theirs
const tierLabel = (t) => {             // $500, $7.5k, $25k, $12,345, $1.5M
  const n = Number(t);
  if (n >= 1e6 && n % 1e5 === 0) return `$${n / 1e6}M`;
  if (n >= 1e3 && n % 100 === 0) return `$${n / 1e3}k`;
  return "$" + n.toLocaleString("en-US");
};
const money = (n) => (n ? Number(n).toLocaleString("en-US") : "");   // 25000 -> "25,000" for inputs
const INVOLVEMENT = { silent: "Silent money", advice: "Advice when asked", hands_on: "Hands-on" };
const hiddenPanel = (t) => `<div class="panel"><div class="ph"><h3>${t}</h3></div><div class="pb"><p class="small muted" style="margin:0">Hidden until you make your call, so everyone judges on their own.</p></div></div>`;
// The group's call: how many want to meet the team
const tally = (d) => (d.scores_hidden ? "–" : `${d.yes_count ?? 0}<small>/${d.score_count} yes</small>`);
function band(d) {
  if (d.scores_hidden) return `<span class="pill">Call to see</span>`;
  if (!d.score_count) return `<span class="pill">No calls yet</span>`;
  const share = d.yes_count / d.score_count;
  if (share >= 2 / 3) return `<span class="pill hit">Most want to meet them</span>`;
  if (share > 1 / 3) return `<span class="pill prom">Split</span>`;
  return `<span class="pill pass">Most would pass</span>`;
}
const callPill = (s) => `${s.met ? '<span class="pill" title="Has met the founders">Met the team</span>' : ""}<span class="pill ${s.yes ? "hit" : "pass"}">${s.yes ? "Yes" : "No"}</span>`;
// A deal still open for calls that you haven't called yet (observers never make calls)
const needsMyCall = (d) => state.me.role !== "observer" && d.poster_id !== state.me.id && !d.i_scored && ["reviewing", "founder_call"].includes(d.status);
const statusPill = (s) => `<span class="pill st-${esc(s)}">${esc(STATUS[s] || s)}</span>`;

async function api(path, body) {
  const opts = body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const res = await fetch(path, { credentials: "same-origin", ...opts });
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401) { location.replace("/login"); throw new Error("signed out"); }
  if (!res.ok) throw Object.assign(new Error(data.message || "Something went wrong."), { data, status: res.status });
  return data;
}

function toast(text, href) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = text;
  if (href) t.onclick = () => { location.hash = href; t.remove(); };
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 6000);
}

// Our own "are you sure" and "type a value" sheets. The built-in ones (confirm, prompt, alert) never
// appear inside the iPhone app, where they quietly answer "no", so nothing that asks first would work.
function sheet(text, { ok = "Yes", cancel = "Cancel", input = null } = {}) {
  return new Promise((done) => {
    const w = document.createElement("div");
    w.className = "sheetwrap";
    w.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><p>${esc(text)}</p>${input === null ? "" : '<input type="text" class="sheet-in">'}
      <div class="sheet-btns"><button type="button" class="btn ghost" data-a="no">${esc(cancel)}</button><button type="button" class="btn" data-a="yes">${esc(ok)}</button></div></div>`;
    const field = $(".sheet-in", w);
    if (field) field.value = input;
    const prev = document.activeElement;
    const end = (yes) => { removeEventListener("keydown", key, true); w.remove(); try { prev && prev.focus({ preventScroll: true }); } catch {} done(field ? (yes ? field.value : null) : yes); };
    const key = (e) => { if (e.key === "Escape") { e.preventDefault(); end(false); } else if (e.key === "Enter" && (field || e.target === document.body)) { e.preventDefault(); end(true); } };
    w.addEventListener("click", (e) => { const a = e.target.closest("[data-a]"); if (a) end(a.dataset.a === "yes"); else if (e.target === w) end(false); });
    addEventListener("keydown", key, true);
    document.body.appendChild(w);
    if (field) { field.focus(); field.select(); } else $('[data-a="yes"]', w).focus({ preventScroll: true });
  });
}
const ask = (text, ok) => sheet(text, { ok });
const askText = (label, value = "", ok = "Save") => sheet(label, { ok, input: value });

function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === "radio") { if (el.checked) o[el.name] = el.value; continue; }
    o[el.name] = el.type === "checkbox" ? el.checked : el.value;
  }
  return o;
}

async function submitting(form, fn) {
  const btn = $("button[type=submit]", form);
  const msg = $(".msg", form);
  if (msg) { msg.textContent = ""; msg.className = "msg err"; }
  if (btn) btn.disabled = true;
  try { await fn(); }
  catch (e) { if (msg) msg.textContent = e.message; else toast(e.message); }
  finally { if (btn) btn.disabled = false; }
}

// ------------------------------------------------------------ state + realtime
const state = { me: null, online: new Set(), wsOk: false, refresh: null };

function connect(attempt = 0) {
  const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/ws");
  let ping;
  ws.onopen = () => { state.wsOk = true; attempt = 0; renderMe(); ping = setInterval(() => ws.readyState === 1 && ws.send('{"type":"ping"}'), 25000); };
  ws.onclose = (e) => {
    state.wsOk = false; clearInterval(ping); renderMe();
    if (e.code === 4001) { location.replace("/login"); return; }
    if (e.code === 4002) { location.reload(); return; }   // your role changed
    setTimeout(() => connect(attempt + 1), Math.min(15000, 1000 * 2 ** attempt));
  };
  ws.onmessage = (e) => {
    let ev; try { ev = JSON.parse(e.data); } catch { return; }
    if (ev.type === "presence") {
      state.online = new Set(ev.online);
      $$("[data-dot]").forEach((d) => d.classList.toggle("on", state.online.has(d.dataset.dot))); return;
    }
    if (ev.type === "deal_posted") {
      if (ev.deal.poster !== state.me.name) toast(`New deal from ${ev.deal.poster}: ${ev.deal.company}`, `#/deals/${ev.deal.id}`);
      state.refresh && state.refresh(ev);
      return;
    }
    if (ev.type === "changed") { state.refresh && state.refresh(ev); }
  };
}

// ------------------------------------------------------------ shell
const ICONS = {
  home: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>',
  deals: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  members: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 4.5a3 3 0 0 1 0 6M18 14c2 .7 3 2.6 3 6"/>',
  hunts: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  nom: '<path d="M12 4v16M4 12h16"/><circle cx="12" cy="12" r="9"/>',
  book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
  admin: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
  inbox: '<path d="M4 13 6.5 5h11L20 13v6H4z"/><path d="M4 13h5l1 2h4l1-2h5"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.8"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>`;

const currentPath = () => location.hash.split("?")[0] || "#/";
const onDeals = (cur) => cur === "#/deals" || /^#\/deals\/[0-9a-f-]{36}/.test(cur);
function renderNav() {
  const cur = currentPath();
  const items = [
    ["#/", "home", "Home"], ["#/deals", "deals", "Deals"], ["#/deals/new", "plus", "Share a deal"], ["#/inbound", "inbox", "Applications"],
    "-", ["#/history", "chart", "Your record"], ["#/members", "members", "Members"], ["#/hunts", "hunts", "Hunts"],
  ];
  if (state.me.role === "admin") items.push(["#/admin", "admin", "Admin"]);
  $("#nav").innerHTML = items.map((it) => {
    if (it === "-") return '<div class="sep"></div>';
    const [href, ic, label] = it;
    const on = href === "#/" ? cur === "#/" || cur === "" : href === "#/deals" ? onDeals(cur) : cur.startsWith(href);
    return `<a href="${href}" class="${on ? "on" : ""}">${icon(ic)}${label}</a>`;
  }).join("") + `<div class="sep"></div><a href="#/help" class="nav-help ${cur.startsWith("#/help") ? "on" : ""}">${icon("help")}Help</a><a href="#/profile" class="nav-profile ${cur.startsWith("#/profile") ? "on" : ""}">${icon("user")}Profile</a>`;
  renderTabbar();
}
function renderTabbar() {
  const bar = document.getElementById("tabbar"); if (!bar) return;
  const cur = currentPath();
  const t = (href, ic, label, on, extra = "") => `<a href="${href}" class="${on ? "on" : ""}">${icon(ic)}<span>${label}</span>${extra}</a>`;
  bar.innerHTML =
    t("#/", "home", "Home", cur === "#/" || cur === "") +
    t("#/deals", "deals", "Deals", onDeals(cur)) +
    `<a href="#/deals/new" class="share ${cur === "#/deals/new" ? "on" : ""}" aria-label="Share a deal"><span class="ic">${icon("plus")}</span><span>Share</span></a>` +
    t("#/members", "members", "Members", cur.startsWith("#/members")) +
    `<button type="button" id="more" class="${/^#\/(inbound|admin|profile|history|hunts|help)/.test(cur) ? "on" : ""}">${icon("more")}<span>More</span></button>`;
  bar.querySelector("#more").onclick = () => $("#app").classList.toggle("menu");
  bar.querySelectorAll("a.on").forEach((a) => a.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" })));
}
function renderMe() {
  if (!state.me) return;
  $("#me").innerHTML = `<a href="#/profile">${esc(state.me.name)}</a>
    <span class="conn"><i class="dot ${state.wsOk ? "on" : ""}"></i>${state.wsOk ? "Live" : "Reconnecting…"}</span>
    <div class="melinks"><a href="/terms/" target="_blank">Terms</a><a href="/privacy/" target="_blank">Privacy</a></div>`;
}

// ------------------------------------------------------------ router
const routes = [
  [/^#?\/?$/, viewHome],
  [/^#\/(chat|playbook)$/, () => { location.replace("#/"); }],
  [/^#\/deals$/, viewDeals],
  [/^#\/deals\/new$/, () => viewDealForm()],
  [/^#\/record$/, viewRecord],
  [/^#\/inbound$/, viewInbound],
  [/^#\/inbound\/([0-9a-f-]{36})$/, (m) => viewApplication(m[1])],
  [/^#\/deals\/([0-9a-f-]{36})\/edit$/, (m) => viewDealForm(m[1])],
  [/^#\/deals\/([0-9a-f-]{36})$/, (m) => viewDeal(m[1])],
  [/^#\/members(\?.*)?$/, viewMembers],
  [/^#\/members\/([0-9a-z-]{8,40})$/, (m) => viewMember(m[1])],
  [/^#\/hunts$/, viewHunts],
  [/^#\/hunts\/([0-9a-f-]{36})$/, (m, seq) => viewHunt(m[1], seq)],
  [/^#\/admin$/, viewAdmin],
  [/^#\/profile$/, viewProfile],
  [/^#\/history$/, viewHistory],
  [/^#\/help$/, viewHelp],
];
let renderSeq = 0;
let lastPath = null;
async function router() {
  const seq = ++renderSeq;
  const path = location.hash.split("?")[0].replace(/#(score|hunt|lookback)$/, "");
  state.refresh = null;
  $("#app").classList.remove("menu");
  const view = $("#view");
  const moved = path !== lastPath; lastPath = path;   // a new page arrives; a live refresh of the same page doesn't
  view.className = "view";
  renderNav();
  for (const [re, fn] of routes) {
    const m = (path || "#/").match(re);
    if (m) {
      try { await fn(m, seq); } catch (e) { if (seq === renderSeq) view.innerHTML = `<div class="panel">${emptyState("Not available", esc(e.message), '<a class="btn sm ghost" href="#/">Go home</a>')}</div>`; }
      if (moved && seq === renderSeq) { view.classList.add("enter"); setTimeout(() => seq === renderSeq && view.classList.remove("enter"), 900); window.scrollTo(0, 0); }
      return;
    }
  }
  view.innerHTML = `<div class="panel">${emptyState("Page not found", "The link may be old, or the page has moved.", '<a class="btn sm ghost" href="#/">Go home</a>')}</div>`;
}
const query = () => new URLSearchParams(location.hash.split("?")[1] || "");
function live(fn, filter) { // re-render the current view when relevant data changes (debounced)
  let t;
  state.refresh = (ev) => { if (filter && !filter(ev)) return; clearTimeout(t); t = setTimeout(fn, 250); };
}

// ------------------------------------------------------------ add to home screen
// Opened from the home screen, Stag Hunt runs full screen like an app.
let installPrompt = null;   // Chrome and Android hand over an install prompt to show when we choose
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; });
addEventListener("appinstalled", () => { installPrompt = null; $("#installbanner")?.remove(); });
// Once Apple approves the iPhone app, put its App Store link here and iPhones are offered the app instead.
const APP_STORE_URL = "";
const SHARE_ICON = '<svg class="ios-share" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-label="Share"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M6 11H5v10h14V11h-1"/></svg>';
function showInstall() {
  const box = $("#installbanner"); if (!box) return;
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  let skipped = false; try { skipped = localStorage.getItem("sh-install-skip") === "1"; } catch {}
  const ios = /iPhone|iPad/.test(navigator.userAgent);
  const inApp = /StagHuntApp/.test(navigator.userAgent);   // already inside the iPhone app
  if (inApp || standalone || skipped || !(ios || installPrompt)) return;
  box.className = "notice row between";
  if (ios && APP_STORE_URL) {
    box.innerHTML = `<span><b>Stag Hunt is on the App Store.</b> Get the iPhone app.</span>
      <span class="row"><a class="btn sm" href="${APP_STORE_URL}">Get it</a><button class="link small" id="installhide">Not now</button></span>`;
  } else {
    box.innerHTML = `<span><b>Put Stag Hunt on your home screen.</b> ${ios ? `Tap ${SHARE_ICON} Share, then <b>Add to Home Screen</b>.` : "It opens like an app."}</span>
      <span class="row">${ios ? "" : '<button class="btn sm" id="installgo">Add it</button>'}<button class="link small" id="installhide">${ios ? "Got it" : "Not now"}</button></span>`;
  }
  box.hidden = false;
  $("#installhide").onclick = () => { try { localStorage.setItem("sh-install-skip", "1"); } catch {} box.remove(); };
  $("#installgo")?.addEventListener("click", async () => { installPrompt.prompt(); const r = await installPrompt.userChoice; installPrompt = null; if (r.outcome === "accepted") box.remove(); });
}

// ------------------------------------------------------------ home

// Where the group stands: plain numbers, no test and no targets.
function scorecardPanel(c, t) {
  if (!c) return "";
  const pct = c.deals ? Math.round((c.rated_all / c.deals) * 100) : null;
  const row = (label, have, of, note) =>
    `<div class="sc-row"${note ? ` title="${note}"` : ""}><div class="sc-l">${label}</div><div class="sc-n">${have}${of != null ? `<span> of ${of}</span>` : ""}</div></div>`;
  const money = t && t.invested_cents > 0 ? `<div class="sc-money">Invested so far ${usd(t.invested_cents)} · Cash back ${usd(t.realized_cents)} · Worth today ${usd(t.paper_cents)}</div>` : "";
  return `<div class="panel scorecard"><div class="ph"><h3>How the group is doing</h3></div>
    <div class="sc-grid">
      ${row("Deals", c.deals)}
      ${row("Sharing", c.posters, c.members, "Members who have shared a deal")}
      ${row("Called by all", pct === null ? "–" : pct + "%", null, "Deals with a yes or no from every member they fit")}
    </div>${money}</div>`;
}

async function viewHome(_, seq) {
  const o = await api("/api/overview");
  if (seq !== renderSeq) return;
  const t = o.totals;
  const observer = state.me.role === "observer";
  const pkBanner = `<div class="notice row between" id="pkbanner" hidden><span><b>Sign in with ${Passkey.name} next time.</b> One touch, no email.</span><span class="row"><button class="btn sm" id="pkset">Turn it on</button><button class="link small" id="pkhide">Not now</button></span></div><div id="installbanner" hidden></div>`;
  const n = o.nudges || {};
  const me = state.me, starting = me.role === "member" && (!dealsOpen() || !me.tier);
  const step = (done, title, line, act = "") => `<li class="${done ? "done" : ""}"><span class="mk" aria-hidden="true"></span><div class="grow"><b>${title}</b><span>${line}</span></div>${done ? "" : act}</li>`;
  const steps = starting ? [
    step(me.accredited != null, "Investor statement", me.accredited == null ? "It takes a minute." : "Done. You can update it any time in your profile.", '<button class="btn sm ghost" type="button" data-statement>Start</button>'),
    step(!!me.tier, "Your check size", me.tier ? "Done. You'll see deals that fit it." : "So you only see deals you could invest in.", '<a class="btn sm ghost" href="#/profile">Set it</a>'),
    step(dealsOpen(), "Deals open", dealsOpen() ? "You're in." : me.accredited === "none" ? "Deals are for accredited investors. You can still bring deals and start hunts." : `On ${dealsOpenOn()}. The 30-day wait keeps founders' rounds private.`),
  ] : [];
  const startCard = starting ? `<div class="panel startcard"><div class="ph"><h3>Getting started</h3><span class="small muted"><a href="#/help" class="helplink">Need help?</a> · ${steps.filter((x) => x.startsWith('<li class="done"')).length} of ${steps.length} done</span></div><div class="wtvid"><video controls preload="none" playsinline poster="/learn/how-it-works/walkthrough-investors.jpg" src="/learn/how-it-works/walkthrough-investors.mp4"><track kind="captions" srclang="en" label="English" src="/learn/how-it-works/walkthrough-investors.vtt"></video><p class="small muted">A short walkthrough of how to use Stag Hunt.</p></div><ol class="steps">${steps.join("")}</ol></div>` : "";
  const nudges = [
    ...(n.locked_open || []).map((d) => `<div class="notice nudge"><b>You're locked in on ${esc(d.company)}.</b> <a href="#/deals/${d.id}#hunt">Log your investment</a> when it's done.</div>`),
    ...(n.look_back || []).map((d) => `<div class="notice nudge">It's been six months since <b>${esc(d.company)}</b>. <a href="#/deals/${d.id}#lookback">How did it turn out?</a></div>`),
    ...(n.to_confirm || []).map((d) => `<div class="notice nudge">Someone reported how <b>${esc(d.company)}</b> turned out. <a href="#/deals/${d.id}#lookback">Is it right?</a></div>`),
  ].join("");
  // What needs you first, then what's new, then how the group is doing
  const waiting = !observer && o.to_score.length ? `<div class="panel"><div class="ph"><h3>Waiting for your call</h3><span class="small muted">${o.to_score.length} deal${o.to_score.length === 1 ? "" : "s"}</span></div>
    <div class="list">${o.to_score.map((d) => `<a href="#/deals/${d.id}#score"><span class="grow"><b>${esc(d.company)}</b></span><span class="small">Yes or no →</span></a>`).join("")}</div></div>` : "";
  $("#view").innerHTML = `
    <div class="pagehead"><div><h1>${(() => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; })()}, ${esc(firstName(state.me.name))}</h1>
      ${observer || o.to_score.length ? "" : `<p class="muted" style="margin:4px 0 0">${starting ? "Welcome to Stag Hunt." : "You're all caught up."}</p>`}</div>
      ${observer ? "" : `<a class="btn" href="#/deals/new">${icon("plus")} Share a deal</a>`}</div>
    ${observer ? '<div class="notice">You\'re an observer. You can read everything, members see you listed as an observer, and you can\'t post or make calls.</div>' : `${pkBanner}${nudges}`}
    <div class="stack-lg">
      ${startCard}
      ${waiting}
      <div class="panel"><div class="ph"><h3>Latest deals</h3><a href="#/deals?status=all" class="small">All deals →</a></div>
        <div class="list">${o.recent.length ? o.recent.map((d) => `
          <a href="#/deals/${d.id}"><div class="grow"><div><b>${esc(d.company)}</b> <span class="faint small">· ${esc(d.poster)} · ${ago(d.created_at)}</span></div>
            <div class="muted small">${esc(d.one_liner)}</div></div>
            <div style="text-align:right"><div class="score">${d.score_count ? tally(d) : "–"}</div>${statusPill(d.status)}</div></a>`).join("")
          : noDealsYet(observer)}</div></div>
      ${scorecardPanel(o.scorecard, t)}
    </div>`;
  $("#pkset")?.addEventListener("click", async () => { try { await Passkey.setUp(); $("#pkbanner").remove(); toast(`Done. Next time, sign in with ${Passkey.name}.`); } catch (e) { toast(e.message); } });
  $("#pkhide")?.addEventListener("click", () => { Passkey.skip(); $("#pkbanner").remove(); showInstall(); });
  if ($("#pkbanner")) {
    const offerPk = !Passkey.here() && !Passkey.skipped() && (await Passkey.available());
    if (seq !== renderSeq) return;
    if (offerPk) $("#pkbanner").hidden = false; else showInstall();
  }
  live(() => router(), (ev) => ev.type === "deal_posted" || ev.what === "deal");
}

// ------------------------------------------------------------ deals list (the tracker)
async function viewDeals(_, seq) {
  const inHunt = query().get("hunt");
  const deals = (await api("/api/deals")).deals.filter((d) => !inHunt || d.home_hunt === inHunt);
  if (seq !== renderSeq) return;
  const huntTitle = inHunt && deals.length ? deals[0].hunt_name : "";
  // Open on the deals that need you, if any; "All" is one tap away
  let filter = query().get("status") || (deals.some(needsMyCall) ? "unscored" : "all"), sort = { k: "created_at", dir: -1 };
  const v = $("#view");
  const counts = deals.reduce((a, d) => ((a[d.status] = (a[d.status] || 0) + 1), a), {});
  function draw() {
    let rows = deals.filter((d) => filter === "all" || (filter === "unscored" ? needsMyCall(d) : d.status === filter));
    rows = rows.sort((a, b) => ((a[sort.k] ?? -1) > (b[sort.k] ?? -1) ? 1 : -1) * sort.dir);
    const th = (k, label, cls = "") => `<th class="sort ${cls}" data-k="${k}">${label}${sort.k === k ? (sort.dir > 0 ? " ↑" : " ↓") : ""}</th>`;
    v.innerHTML = `
      <div class="pagehead"><div><h1>Deals</h1>${inHunt ? `<div class="small muted">${esc(huntTitle || "This hunt")} · <a href="#/deals">All hunts</a></div>` : ""}</div>
        <div class="row">${dealsOpen() ? '<a class="btn ghost hide-sm" href="/api/export.csv">Export to spreadsheet</a>' : ""}<a class="btn" href="#/deals/new">${icon("plus")} Share a deal</a></div></div>
      ${dealGate()}
      <div class="filters">${[["all", "All", deals.length], ...(state.me.role === "observer" ? [] : [["unscored", "Needs my call", deals.filter(needsMyCall).length]]), ...Object.keys(STATUS).filter((s) => counts[s]).map((s) => [s, STATUS[s], counts[s]])]
        .map(([k, l, n]) => `<button data-f="${k}" class="${filter === k ? "on" : ""}">${l} · ${n}</button>`).join("")}</div>
      ${rows.length ? `<div class="dealcards">${rows.map((d) => `
        <a class="dealcard" href="#/deals/${d.id}">
          <div class="row between" style="flex-wrap:nowrap"><b class="dc-co">${esc(d.company)}</b>${statusPill(d.status)}</div>
          <div class="dc-one">${esc(d.one_liner)}</div>
          <div class="row between dc-foot"><span><span class="score">${tally(d)}</span> ${band(d)}</span>${needsMyCall(d) ? '<span class="pill">Your call</span>' : ""}</div>
          <div class="dc-meta">${esc(d.poster_name)} · ${date(d.created_at)} · ${esc(d.round_type)}${d.investor_count ? ` · ${d.investor_count} invested` : ""}</div>
        </a>`).join("")}</div><div class="tablewrap"><table><thead><tr>
        ${th("company", "Company")}${th("created_at", "Posted")}${th("round_type", "Round")}${th("yes_count", "Yes", "num")}<th>Signal</th>${th("investor_count", "Investors", "num")}${th("invested_cents", "Invested", "num")}${th("status", "Status")}
        </tr></thead><tbody>${rows.map((d) => `
        <tr class="click" data-id="${d.id}">
          <td><div class="co">${esc(d.company)} ${needsMyCall(d) ? '<span class="pill" title="You haven\'t made your call yet">Your call</span>' : ""}</div><div class="sub">${esc(d.one_liner)}</div></td>
          <td><div>${esc(d.poster_name)}</div><div class="sub">${date(d.created_at)}</div></td>
          <td><div>${esc(d.round_type)}</div><div class="sub">${esc([d.valuation_cap && "Cap " + d.valuation_cap, d.raise_amount && "Raising " + d.raise_amount].filter(Boolean).join(" · "))}</div></td>
          <td class="num"><span class="score">${tally(d)}</span><div class="sub">${d.score_count} call${d.score_count === 1 ? "" : "s"}</div></td>
          <td>${band(d)}</td>
          <td class="num">${d.investor_count}</td>
          <td class="num">${d.invested_cents ? usd(d.invested_cents) : "–"}</td>
          <td>${statusPill(d.status)}</td></tr>`).join("")}</tbody></table></div>`
        : `<div class="panel">${deals.length ? emptyState("Nothing here", "No deals match this filter.") : noDealsYet(state.me.role === "observer")}</div>`}`;
    $$("[data-f]", v).forEach((b) => (b.onclick = () => { filter = b.dataset.f; history.replaceState(null, "", "#/deals?status=" + filter); draw(); }));
    $$("th.sort", v).forEach((h) => (h.onclick = () => { sort = { k: h.dataset.k, dir: sort.k === h.dataset.k ? -sort.dir : h.dataset.k === "company" ? 1 : -1 }; draw(); }));
    $$("tr[data-id]", v).forEach((r) => (r.onclick = () => (location.hash = "#/deals/" + r.dataset.id)));
  }
  draw();
  live(() => router(), (ev) => ev.type === "deal_posted" || ev.what === "deal");
}

// ------------------------------------------------------------ scorecard form
// Your call on a deal: do you want to meet the team, yes or no, and why, and have you met them already.
// Whoever brings the deal knows the founders, so their form skips that question. The ten questions are optional.
function scorecardHtml(poster = false) {
  return `<div class="scorecard">
    <div class="yesno"><label><input type="radio" name="yes" value="yes" required><span>${poster ? "Yes, I'd back them" : "Yes"}</span></label><label><input type="radio" name="yes" value="no"><span>${poster ? "No, just passing it on" : "No"}</span></label></div>
    ${poster ? "" : `<div class="q small met-q">Have you met the founders?</div>
    <div class="yesno"><label><input type="radio" name="met" value="yes" required><span>I've met them</span></label><label><input type="radio" name="met" value="no"><span>Not yet</span></label></div>`}
    <textarea class="why" name="why" required maxlength="300" rows="1" placeholder="Why? One line is enough"></textarea>
    <p class="small muted sc-rule">Your call locks when you submit, and you see everyone else's only after. Every yes and no teaches the group what you back.</p>
    <details class="tenq"><summary class="small">Add the ten questions behind every check (optional)</summary>
    <p class="small muted sc-rule">Score all ten or none. Score what you can see, not what you hope: no evidence yet means 3 or less.</p>
    ${CATS.map((c, i) => `
    <div class="scrow">
      <div><div class="t">${i + 1}. ${c.t}</div><div class="q">${c.q}</div></div>
      <input type="number" name="${c.k}" min="0" max="10" step="1" aria-label="${c.t} score, 0 to 10" placeholder="0–10">
      <div class="anch"><div><b>0–3</b> ${c.lo}</div><div><b>4–6</b> ${c.mid}</div><div><b>7–10</b> ${c.hi}</div></div>
      <textarea class="why" name="${c.k}_why" maxlength="300" rows="1" placeholder="What did you see? (optional)"></textarea>
    </div>`).join("")}
    <div class="total"><span class="mono small">Your total</span><span><b class="score" data-total>–</b></span></div></details></div>`;
}
// One member's call, read-only: yes or no, why, and their ten scores if they gave them
function scoreReasons(s) {
  const rows = isTen(s) ? CATS.map((c) => [c.t, s[c.k], s[c.k + "_why"]]) : OLD_CATS.filter(([k]) => s[k] != null).map(([k, t]) => [t, s[k], s[k + "_why"]]);
  return `${s.why ? `<div class="callwhy">${esc(s.why)}</div>` : ""}${rows.length ? `<div class="reasons">${rows.map(([t, v, why]) => `<div><b>${t}</b> ${v}${why ? ` · ${esc(why)}` : ""}</div>`).join("")}${isTen(s) ? "" : '<div class="small faint">Scored on the old five questions before yes or no.</div>'}</div>` : ""}`;
}
// The group's spread on each question, from ten-question scores
function groupBars(scores) {
  const ten = scores.filter(isTen);
  if (!ten.length) return '<div class="small muted">No scores on the ten questions yet.</div>';
  let split = null;
  const rows = CATS.map((c) => {
    const v = ten.map((s) => s[c.k]), lo = Math.min(...v), hi = Math.max(...v), avg = v.reduce((a, x) => a + x, 0) / v.length;
    if (ten.length > 1 && hi - lo >= 4 && (!split || hi - lo > split.hi - split.lo)) split = { t: c.t, lo, hi };
    return `<div class="bar"><span>${c.t}</span><span class="track"><span class="range" style="left:${lo * 10}%;width:${(hi - lo) * 10}%"></span><span class="fill" style="width:${avg * 10}%"></span></span><span class="mono small" style="text-align:right" title="Lowest to highest: ${lo} to ${hi}">${fmt1(avg)}</span></div>`;
  }).join("");
  return rows + (split ? `<div class="notice split">The group is most split on <b>${split.t}</b>: scores run from ${split.lo} to ${split.hi}. Worth asking about on the call.</div>` : "");
}
function wireScorecard(form) {
  // One line on why: Enter doesn't start a new line
  $$("textarea.why", form).forEach((t) => t.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) e.preventDefault(); }));
  const upd = () => {
    const vals = CATS.map((c) => form.elements[c.k].value).filter((v) => v !== "");
    const sum = CATS.reduce((a, c) => a + (Number(form.elements[c.k].value) || 0), 0);
    $("[data-total]", form).innerHTML = vals.length === CATS.length ? `${sum}<small>/100</small>` : "–";
    // Started the ten questions? Then all ten are needed.
    CATS.forEach((c) => (form.elements[c.k].required = vals.length > 0));
  };
  CATS.forEach((c) => form.elements[c.k].addEventListener("input", upd));
  upd();
}
const scoreFromForm = (o) => {
  const ten = CATS.some((c) => o[c.k] !== "");
  return { yes: o.yes === "yes", met: o.met === "yes", why: o.why, ...(ten ? Object.fromEntries(CATS.flatMap((c) => [[c.k, Number(o[c.k])], [c.k + "_why", o[c.k + "_why"]]])) : {}) };
};

// ------------------------------------------------------------ post / edit deal
async function viewDealForm(id) {
  let d = {};
  if (id) { const r = await api("/api/deals/" + id); d = r.deal; if (!r.can_edit) throw new Error("Only the poster or an admin can edit this deal."); }
  let rd = null; // a draft from a recorded founder call
  if (!id) { try { rd = JSON.parse(sessionStorage.getItem("recDraft") || "null"); } catch {} if (rd) d = { ...rd.draft }; }
  let app = null; // a founder application this member took the call on
  const fromApp = !id && query().get("from");
  if (fromApp) {
    const r = await api("/api/inbound/" + fromApp); app = r.application;
    if (!r.mine || app.status !== "claimed") throw new Error("Take the call on this application before posting it.");
    rd = null;
    d = { ...app, disclosure: "", how_found: `${app.founder_name} applied through staghunts.com. I took the call.`,
      materials: JSON.stringify([app.video_url && { label: "Founder video", url: app.video_url }, app.deck_url && { label: "Pitch deck", url: app.deck_url }].filter(Boolean)) };
  }
  const hunts = id ? [] : (await api("/api/hunts")).hunts;
  if (!id && !hunts.length) throw new Error("Start or join a hunt before sharing a deal. Open Hunts in the menu.");
  const v = $("#view");
  const f = (name, label, opts = {}) => `<div><label for="f-${name}">${label}</label>${opts.area
    ? `<textarea id="f-${name}" name="${name}" ${opts.req ? "required" : ""} maxlength="${opts.max || 1000}" placeholder="${esc(opts.ph || "")}">${esc(d[name] || "")}</textarea>`
    : `<input id="f-${name}" name="${name}" ${opts.req ? "required" : ""} maxlength="${opts.max || 120}" placeholder="${esc(opts.ph || "")}" value="${esc(d[name] || "")}">`}
    ${opts.hint ? `<div class="hint">${opts.hint}</div>` : ""}</div>`;
  v.innerHTML = `
    <div class="pagehead"><div><h1>${id ? esc(d.company) : "Share a deal"}</h1></div></div>
    ${!id && !rd && !app ? `<a class="rec-cta" href="#/record"><span class="ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></span><span class="tx"><b>Or let the founder pitch it out loud</b><span>Send them a link, or record the call in person. The deal fills itself in.</span></span><span class="go">Start →</span></a>` : ""}
    <form id="dealform" class="stack-lg" style="max-width:760px">
      ${app ? `<div class="notice"><p style="margin:0"><b>From ${esc(app.founder_name)}'s application.</b> Their answers are filled in. Check them against what you heard on the call, say how the call went under How did you find it, then make your own call. The deal will show that the founder applied.</p></div>` : ""}
      ${rd ? (() => {
        const missing = [["company", "the company name"], ["one_liner", "what they do"], ["customers", "who pays"], ["traction", "the numbers so far"], ["acquisition", "how they get customers"], ["competition", "the competition"], ["end_state", "what they'd own"], ["flywheel", "how growth builds on itself"], ["next_goal", "their next goal"], ["blocker", "what's blocking it"]].filter(([k]) => !d[k]).map(([, l]) => l);
        return `<div class="notice rec-draft"><p><b>Drafted by AI from ${rd.link ? `${esc(rd.founder || "the founder")}'s recorded pitch` : "your recorded call"}.</b> It can mishear names and numbers, so check every answer before you post.${missing.length ? ` Didn't hear: ${missing.join(", ")}. Fill those in yourself.` : ""}${rd.gaps ? ` ${rd.gaps} minute${rd.gaps > 1 ? "s" : ""} of audio didn't upload, so parts of the call may be missing.` : ""}${rd.truncated ? " The call was long, so only about the first hour was read." : ""}</p>
          <p>The deal will say its answers were drafted by AI from a recorded call and checked by you.</p>
          <details><summary class="small">Transcript (only you can see this; deleted when you post)</summary><div class="rec-transcript">${esc(rd.transcript || "")}</div></details>
          <div class="rec-fill"><button class="btn sm" type="button" id="fill-rec">Fill in the rest from the ${rd.link ? "pitch" : "call"}</button>
            <span class="small">Fills every empty box the conversation answers, including how you found it. Your call stays yours.</span></div>
          <button class="link small" type="button" id="discard-rec">Discard the draft and delete the transcript</button></div>`; })()
      : ""}
      <div class="panel"><div class="ph"><h3>What's the company?</h3></div><div class="pb">
        <div class="grid2">${f("company", "Company name", { req: true, ph: "Acme Robotics" })}${f("website", "Website (optional)", { ph: "acme.com", max: 300 })}</div>
        ${f("one_liner", "What do they do?", { req: true, max: 400, ph: "Explain it like you would to a friend" })}
        ${f("sector", "What space are they in?", { ph: "Fintech, climate, dev tools…", max: 80 })}
      </div></div>
      <div class="panel"><div class="ph"><h3>Where is it today?</h3></div><div class="pb">
        <p class="small" style="margin-top:-2px">The facts behind the ten questions. Get numbers where you can. "None yet" is a fine answer.</p>
        ${f("customers", "Who pays, and how much?", { area: true, req: !id, max: 400, ph: "Clinics pay $400 a month. Or: no one yet, we start charging in March" })}
        ${f("traction", "The numbers so far", { area: true, req: !id, max: 400, ph: "Paying customers, revenue, users, monthly growth, and how many come back" })}
        ${f("acquisition", "How do they get customers?", { area: true, req: !id, max: 400, ph: "Where the last ten came from, and what each one cost" })}
        ${f("competition", "Who else solves this, and why do they win?", { area: true, req: !id, max: 400, ph: "Include what customers do today instead" })}
      </div></div>
      <div class="panel"><div class="ph"><h3>Where is it going?</h3></div><div class="pb">
        <p class="small" style="margin-top:-2px">Ask the founder and use their words. Save your own opinion for your yes or no.</p>
        ${f("end_state", "If they win, what do they own?", { area: true, req: !id, max: 300, ph: "Be specific: every small-business payroll in Latin America" })}
        ${f("flywheel", "What makes growth easier as they grow?", { area: true, req: !id, max: 300, ph: "For example: more drivers mean shorter waits, which bring more riders. \"Not yet\" is a fine answer." })}
        ${f("next_goal", "What's their next goal?", { req: !id, max: 300, ph: "The milestone they're chasing now: 10 paying hospitals" })}
        ${f("blocker", "What's blocking it?", { req: !id, max: 300, ph: "The one thing standing between them and that goal" })}
      </div></div>
      <div class="panel"><div class="ph"><h3>What's the deal?</h3></div><div class="pb">
        <div class="grid2"><div><label for="f-round_type">Type of round</label><select id="f-round_type" name="round_type" required>
          ${ROUNDS.map((r) => `<option ${d.round_type === r ? "selected" : ""}>${r}</option>`).join("")}</select></div>
          ${f("raise_amount", "How much are they raising?", { ph: "$1.5M" })}</div>
        <div class="grid3">${f("valuation_cap", "Valuation cap", { ph: "$12M post" })}${f("discount", "Discount", { ph: "20%" })}<div><label for="f-min_tier">Smallest check they take ($)</label><input id="f-min_tier" name="min_tier" required inputmode="decimal" maxlength="20" placeholder="25,000" value="${money(d.min_tier)}"><div class="hint">Members of the deal's hunt see it if their check size is this or more.</div></div></div>
        <div class="grid2">${f("deadline", "When does it close?", { ph: "Nov 30, or rolling", max: 40 })}${hunts.length > 1
          ? `<div><label for="f-home_hunt">Which hunt is it for?</label><select id="f-home_hunt" name="home_hunt" required><option value="">Choose a hunt</option>${hunts.map((h) => `<option value="${h.id}">${esc(h.name)}</option>`).join("")}</select><div class="hint">Only this hunt sees the deal.</div></div>`
          : hunts.length === 1 ? `<div><label>Who sees it</label><div class="hint">Only members of ${esc(hunts[0].name)}.</div></div>` : "<div></div>"}</div>
        ${f("invest_url", "Where members invest (optional)", { ph: "https://… the company's SAFE signing page, Wefunder page or wire instructions", max: 300, hint: "The founder's own link. Members invest straight with the company; Stag Hunt never touches the money. Share it only if the founder is happy for the group to have it." })}
        <label class="check"><input type="checkbox" name="accredited_only" ${d.accredited_only ? "checked" : ""}>Only open to accredited investors</label>
        <label class="check"><input type="checkbox" name="round_public" ${d.round_public ? "checked" : ""}>This round is already public (fine to mention outside the group)</label>
      </div></div>
      <div class="panel"><div class="ph"><h3>Deck and materials</h3><span class="small muted">Optional · links only</span></div><div class="pb">
        <p class="small" style="margin-top:-2px">Paste links the founder shared: a DocSend, Google Drive or Pitch deck, a demo video, a data room. Only share what the founder is OK with the group seeing.</p>
        <div id="mats"></div>
        <button class="link small" type="button" id="addmat" style="margin-top:12px">+ Add a link</button>
      </div></div>
      <div class="panel"><div class="ph"><h3>Why should we care?</h3></div><div class="pb">
        ${f("how_found", "How do you know the founders?", { area: true, req: true, ph: "e.g. she was my lab partner for two years, and I've watched her ship…", hint: "Early investors back the team. Your name stands behind them, and members who want to meet them will ask you for the intro." })}
        ${f("why_now", "Why now?", { req: true, max: 600, ph: "One line on why the timing is right" })}
        ${f("disclosure", "Any connection to the company?", { area: true, max: 600, ph: "None, or e.g. I'm friends with the founder / I advise them", hint: "If you work there, advise them, or already invested, just say so." })}
      </div></div>
      ${id ? `<div class="panel"><div class="ph"><h3>Status</h3></div><div class="pb"><select name="status">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${d.status === k ? "selected" : ""}>${l}</option>`).join("")}</select></div></div>`
           : `<div class="panel" id="score"><div class="ph"><h3>Your call</h3><span class="small muted">Your own, before anyone else's</span></div><div class="pb">${scorecardHtml(true)}</div></div>`}
      ${id ? "" : `<div class="panel"><div class="ph"><h3>Our standard</h3></div><div class="pb">
        <p class="small" style="margin-top:-2px">Stag Hunt only shares companies we'd be proud to back. No gambling, no adult content or pornography, and nothing built on cheating or deceiving people.</p>
        <label class="check"><input type="checkbox" name="meets_standard" required>This company doesn't make money from gambling, adult content, or cheating or deceiving people.</label>
      </div></div>`}
      <div class="row"><button class="btn" type="submit">${id ? "Save changes" : "Share with the group"}</button><a class="btn ghost" href="${id ? "#/deals/" + id : "#/deals"}">Cancel</a></div>
      <div class="msg err"></div>
    </form>`;
  const form = $("#dealform");
  const LABELS = ["Founder video", "Pitch deck", "Demo", "Data room", "Founder's link", "Memo", "Other"];
  const matRow = (m = {}) => {
    const row = document.createElement("div");
    row.className = "matrow";
    row.innerHTML = `<select aria-label="Link type">${LABELS.map((l) => `<option ${m.label === l ? "selected" : ""}>${l}</option>`).join("")}</select>
      <input type="url" inputmode="url" placeholder="https://docsend.com/view/…" value="${esc(m.url || "")}" aria-label="Link">
      <button type="button" class="link small" aria-label="Remove link">Remove</button>`;
    row.querySelector("button").onclick = () => row.remove();
    $("#mats").appendChild(row);
  };
  let existingMats = []; try { existingMats = JSON.parse(d.materials || "[]"); } catch {}
  (existingMats.length ? existingMats : [{ label: "Pitch deck" }]).forEach(matRow);
  $("#addmat").onclick = () => { if ($$("#mats .matrow").length < 6) matRow({ label: "Other" }); };
  const readMats = () => $$("#mats .matrow").map((r) => ({ label: r.querySelector("select").value, url: r.querySelector("input").value.trim() })).filter((m) => m.url);
  if (!id) wireScorecard(form);
  const fillBtn = $("#fill-rec");
  if (fillBtn) fillBtn.onclick = async () => {
    fillBtn.disabled = true; fillBtn.textContent = "Filling in…";
    const note = fillBtn.nextElementSibling;
    try {
      const { fields } = await api(`/api/rec/${rd.rec_id}/fill`, {});
      let n = 0;
      for (const [k, val] of Object.entries(fields)) {
        const el = form.elements[k];
        if (!el || el.tagName === "SELECT" || el.value.trim()) continue;
        el.value = val; el.classList.add("ai-filled"); n++;
        el.addEventListener("input", () => el.classList.remove("ai-filled"), { once: true });
      }
      rd.draft = { ...rd.draft, ...fields }; sessionStorage.setItem("recDraft", JSON.stringify(rd));
      fillBtn.remove();
      note.innerHTML = n ? `Filled ${n} more box${n > 1 ? "es" : ""}, shaded below. Check each one. Anything still empty wasn't said on the call. Then make <a href="#score">your call</a>.`
                         : "Nothing else came up on the call. Fill in what's left, then make your call.";
    } catch (e) { fillBtn.disabled = false; fillBtn.textContent = `Fill in the rest from the ${rd.link ? "pitch" : "call"}`; note.textContent = e.message; }
  };
  const discard = $("#discard-rec");
  if (discard) discard.onclick = async () => {
    if (!(await ask("Discard this draft and delete the transcript?"))) return;
    try { await api(`/api/rec/${rd.rec_id}/delete`, {}); } catch {}
    sessionStorage.removeItem("recDraft"); router();
  };
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    submitting(form, async () => {
      const o = formData(form);
      o.materials = readMats();
      if (o.materials.some((m) => !/^https:\/\//i.test(m.url) && !/^[\w.-]+\.[a-z]{2,}/i.test(m.url))) throw new Error("One of the links doesn't look right. Paste the full link, starting with https://");
      if (id) { await api("/api/deals/" + id, o); location.hash = "#/deals/" + id; }
      else { const r = await api("/api/deals", { ...o, score: scoreFromForm(o), rec_id: rd ? rd.rec_id : undefined, app_id: app ? app.id : undefined }); sessionStorage.removeItem("recDraft"); location.hash = "#/deals/" + r.id; }
    });
  });
}

// ------------------------------------------------------------ inbound (founder applications)
async function viewInbound(_, seq) {
  if (!dealsOpen() && state.me.role !== "admin") {
    $("#view").innerHTML = `<div class="pagehead"><div><h1>Founder applications</h1></div></div><div class="panel">${emptyState("Applications will show here", state.me.accredited === "none" ? "Founders' applications are for accredited investors." : `They open for you on ${dealsOpenOn()}, with deals.`)}</div>`;
    return;
  }
  const { applications: apps } = await api("/api/inbound");
  if (seq !== renderSeq) return;
  $("#view").innerHTML = `
    <div class="pagehead"><div><h1>Founder applications</h1></div><button class="btn ghost" type="button" id="copyapply">Copy the apply link</button></div>
    <p class="muted" style="max-width:640px;margin-top:-6px">Founders who applied at staghunts.com/apply. Nothing here is a deal yet. If one fits what you'd back, take the call, then post it as your deal for members to say yes or no.</p>
    <div class="panel"><div class="list">${apps.length ? apps.map((a) => `
      <a href="#/inbound/${a.id}"><span class="grow"><b>${esc(a.company)}</b> <span class="small muted">${esc(a.one_liner)}</span>
        <span class="small faint" style="display:block;margin-top:2px">${esc(a.founder_name)} · ${esc(a.round_type)}${a.raise_amount ? " · Raising " + esc(a.raise_amount) : ""} · ${ago(a.created_at)}</span></span>
        ${a.status === "claimed" ? `<span class="pill">${a.claimed_by === state.me.id ? "Your call" : esc(firstName(a.claimer_name)) + " is on it"}</span>` : '<span class="small">Open →</span>'}</a>`).join("")
      : emptyState("No applications waiting", "Founders apply at staghunts.com/apply. Send the link to anyone worth hearing from.")}</div></div>`;
  $("#copyapply").onclick = async () => { try { await navigator.clipboard.writeText("https://staghunts.com/apply/"); toast("Apply link copied"); } catch { toast("staghunts.com/apply"); } };
  live(() => router(), (ev) => ev.what === "inbound");
}

async function viewApplication(id) {
  const { application: a, mine } = await api("/api/inbound/" + id);
  if (a.status === "posted" && a.deal_id) { location.replace("#/deals/" + a.deal_id); return; }
  const first = firstName(a.founder_name);
  const fact = (l, val) => (val ? `<div><dt>${l}</dt><dd>${esc(val)}</dd></div>` : "");
  const qa = (l, val) => (val ? `<div><div class="q">${l}</div><div class="prose">${linkify(val)}</div></div>` : "");
  const observer = state.me.role === "observer";
  const action = a.status === "open"
    ? (observer ? "" : `<div class="notice"><p style="margin:0 0 10px"><b>Want to take the call?</b> You'll get ${esc(first)}'s email. After you talk, post it as your deal. Others see that you're on it.</p><button class="btn sm" id="claim">I'll take the call</button></div>`)
    : mine
      ? `<div class="notice"><p style="margin:0 0 10px"><b>You're taking this call.</b> Reach ${esc(first)} at <a href="mailto:${esc(a.founder_email)}">${esc(a.founder_email)}</a>. When you've talked, post it as your deal.</p>
          <div class="row"><a class="btn sm" href="#/deals/new?from=${a.id}">Share as my deal</a><a class="btn ghost sm" href="mailto:${esc(a.founder_email)}?subject=${encodeURIComponent(a.company + " and Stag Hunt")}">Email ${esc(first)}</a><button class="link small" id="release">Let someone else take it</button></div></div>`
      : `<div class="notice"><b>${esc(a.claimer_name)}</b> is taking this call. If they post it, it shows up in Deals for members to say yes or no.${state.me.role === "admin" ? ' <button class="link small" id="release">Reopen it</button>' : ""}</div>`;
  $("#view").innerHTML = `
    <div class="dealhead"><div><div class="row"><a href="#/inbound" class="small">← Applications</a><span class="pill">Founder applied</span>${a.interview ? '<span class="pill">Pitched out loud</span>' : ""}${a.accredited_only ? '<span class="pill">Accredited only</span>' : ""}${a.sector ? `<span class="pill">${esc(a.sector)}</span>` : ""}</div>
      <h1>${esc(a.company)}</h1><div class="one">${esc(a.one_liner)}</div>
      <div class="small faint" style="margin-top:8px">${esc(a.founder_name)} applied ${ago(a.created_at)}${a.website ? ` · <a href="${esc(a.website)}" target="_blank" rel="noopener noreferrer">${esc(bareUrl(a.website))}</a>` : ""}${a.founder_link ? ` · <a href="${esc(a.founder_link)}" target="_blank" rel="noopener noreferrer">${esc(first)}'s profile</a>` : ""}</div></div></div>
    ${action}
    <dl class="facts">${fact("Round", a.round_type)}${fact("Raising", a.raise_amount)}${fact("Valuation cap", a.valuation_cap)}${fact("Min check", a.min_check)}${fact("Closes", a.deadline)}</dl>
    ${(() => { const m = [["Founder video", a.video_url], ["Pitch deck", a.deck_url]].filter(([, u]) => u);
      return m.length ? `<div class="mats">${m.map(([l, u]) => `<a class="mat" href="${esc(u)}" target="_blank" rel="noopener noreferrer"><span class="ml">${l}</span><span class="mu">${esc(bareUrl(u).slice(0, 48))}</span><span class="mx">↗</span></a>`).join("")}</div>` : ""; })()}
    <div class="stack-lg" style="max-width:760px">
      ${a.interview ? `<div class="panel"><div class="ph"><h3>The interview</h3><span class="small muted">${Math.max(1, Math.round((a.interview.duration_secs || 0) / 60))} min with the AI interviewer</span></div><div class="pb">
        <audio controls preload="none" src="/api/inbound/${a.id}/interview" style="width:100%"></audio>
        <details style="margin-top:12px"><summary class="small">Read the transcript</summary><div class="prose small" style="margin-top:10px;white-space:pre-wrap">${esc(a.interview.transcript || "")}</div></details>
        <p class="small faint" style="margin:10px 0 0">The answers on this page were drafted from this conversation and checked by the founder. The AI never judged the company.</p></div></div>` : ""}
      ${a.customers || a.traction || a.acquisition || a.competition ? `<div class="panel"><div class="ph"><h3>Where it is today</h3><span class="small muted">In the founder's words</span></div><div class="pb qa">
        ${qa("Who pays", a.customers)}${qa("The numbers so far", a.traction)}${qa("How they get customers", a.acquisition)}${qa("Competition", a.competition)}</div></div>` : ""}
      <div class="panel"><div class="ph"><h3>Where it's going</h3><span class="small muted">In the founder's words</span></div><div class="pb qa">
        ${qa("If they win, they own", a.end_state)}${qa("How growth builds", a.flywheel)}${qa("Next goal", a.next_goal)}${qa("Blocking it", a.blocker)}</div></div>
      <div class="panel"><div class="pb qa">${qa("Why " + esc(first), a.why_you)}${qa("Why now", a.why_now)}${qa("Heard about us from", a.heard_from)}</div></div>
      ${state.me.role === "admin" ? '<div><button class="btn danger sm" id="remove">Remove application</button></div>' : ""}
    </div>`;
  const act = (sel, path, after) => { const b = $(sel); if (b) b.onclick = async () => { b.disabled = true; try { await api(path, {}); after(); } catch (e) { toast(e.message); b.disabled = false; } }; };
  act("#claim", `/api/inbound/${id}/claim`, () => router());
  act("#release", `/api/inbound/${id}/release`, () => router());
  const rm = $("#remove");
  if (rm) rm.onclick = async () => { if (!(await ask("Remove this application? Use this for spam or companies that break our standard."))) return; await api(`/api/admin/inbound/${id}/delete`, {}); location.hash = "#/inbound"; };
  live(() => router(), (ev) => ev.what === "inbound" && (!ev.id || ev.id === id));
}

// ------------------------------------------------------------ deal page
async function viewDeal(id, seq) {
  const r = await api("/api/deals/" + id);
  if (seq !== undefined && seq !== renderSeq) return;
  const { deal: d, scores, investments, updates, can_edit, pledges: pl = { locked: [], waiting: 0 }, intros = { count: 0, mine: false, who: [] } } = r;
  const first = esc(firstName(d.poster_name));
  const brought = d.poster_id === state.me.id;
  const mine = scores.find((s) => s.member_id === state.me.id);
  const myInv = investments.find((i) => i.member_id === state.me.id);
  const v = $("#view");
  const fact = (l, val) => (val ? `<div><dt>${l}</dt><dd>${val}</dd></div>` : "");
  const totalRealized = investments.reduce((a, i) => a + (i.realized_cents || 0), 0);
  const totalPaper = investments.reduce((a, i) => a + (i.paper_cents ?? i.amount_cents), 0);

  v.innerHTML = `
    <div class="dealhead">
      <div><div class="row"><a href="#/deals" class="small">← Deals</a>${statusPill(d.status)}${d.accredited_only ? '<span class="pill">Accredited only</span>' : ""}${d.application_id ? '<span class="pill" title="The founder applied through staghunts.com">Founder applied</span>' : ""}${d.sector ? `<span class="pill">${esc(d.sector)}</span>` : ""}</div>
        <h1>${esc(d.company)}</h1><div class="one">${esc(d.one_liner)}</div>
        <div class="small faint" style="margin-top:8px">Posted by <b>${esc(d.poster_name)}</b> · ${date(d.created_at)}${d.website ? ` · <a href="${esc(d.website)}" target="_blank" rel="noopener noreferrer">${esc(bareUrl(d.website))}</a>` : ""} · <button class="link small" type="button" id="sharedeal">Share link</button>${brought ? "" : ` · ${reportBtn("deal", d.id, "", d.poster_id, d.poster_name)}`}</div>
        ${d.poster_blocked ? `<div class="small muted" style="margin-top:6px">You blocked ${first}. <a href="#/members/${d.poster_id}">Unblock</a></div>` : ""}</div>
      <div class="bigscore"><div class="n">${tally(d)}</div><div class="small faint">${d.score_count} call${d.score_count === 1 ? "" : "s"}${d.scores_hidden || d.avg_total == null ? "" : ` · ten questions ${fmt1(d.avg_total)}/100`}</div><div style="margin-top:6px">${band(d)}${d.min_tier && state.me.tier && d.min_tier > state.me.tier ? ' <span class="pill" title="The smallest check here is above your tier">Above your check size</span>' : ""}</div>
        ${can_edit ? `<div class="row" style="justify-content:flex-end;margin-top:12px"><select id="status" style="width:auto;padding:6px 8px;font-size:13px">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${d.status === k ? "selected" : ""}>${l}</option>`).join("")}</select>
          <a class="btn ghost sm" href="#/deals/${d.id}/edit">Edit</a>${state.me.role === "admin" ? '<button class="btn danger sm" id="del">Delete</button>' : ""}</div>` : ""}</div>
    </div>

    <dl class="facts">${fact("Hunt", esc(d.hunt_name))}${fact("Round", esc(d.round_type))}${fact("Raising", esc(d.raise_amount))}${fact("Valuation cap", esc(d.valuation_cap))}${fact("Discount", esc(d.discount))}${fact("Min check", esc(d.min_check))}${fact("Closes", esc(d.deadline))}
      ${fact("Group invested", d.invested_cents ? `${usd(d.invested_cents)} · ${d.investor_count} member${d.investor_count === 1 ? "" : "s"}` : "")}${fact("Round public", d.round_public ? "Yes" : "")}</dl>

    ${(() => { let mats = []; try { mats = JSON.parse(d.materials || "[]"); } catch {}
      return mats.length ? `<div class="mats">${mats.map((m) => `<a class="mat" href="${esc(m.url)}" target="_blank" rel="noopener noreferrer"><span class="ml">${esc(m.label)}</span><span class="mu">${esc(bareUrl(m.url).slice(0, 48))}</span><span class="mx">↗</span></a>`).join("")}</div>` : ""; })()}
    ${investStrip(d)}
    <div class="two">
      <div class="stack-lg">
        <div class="panel vouch"><div class="ph"><h3>How ${first} knows the founders</h3></div><div class="pb"><div class="prose">${linkify(d.how_found)}</div></div></div>
        ${d.customers || d.traction || d.acquisition || d.competition ? `<div class="panel"><div class="ph"><h3>Where it is today</h3><span class="small muted">In the founder's words</span></div><div class="pb qa">
          ${[["customers", "Who pays"], ["traction", "The numbers so far"], ["acquisition", "How they get customers"], ["competition", "Competition"]].filter(([k]) => d[k]).map(([k, l]) => `<div><div class="q">${l}</div><div class="prose">${linkify(d[k])}</div></div>`).join("")}</div></div>` : ""}
        ${d.end_state || d.flywheel || d.next_goal || d.blocker ? `<div class="panel"><div class="ph"><h3>Where it's going</h3><span class="small muted">${d.from_recording ? `In the founder's words · drafted by AI from a recorded call, checked by ${esc(firstName(d.poster_name))}` : "In the founder's words"}</span></div><div class="pb qa">
          ${[["end_state", "If they win, they own"], ["flywheel", "How growth builds"], ["next_goal", "Next goal"], ["blocker", "Blocking it"]].filter(([k]) => d[k]).map(([k, l]) => `<div><div class="q">${l}</div><div class="prose">${linkify(d[k])}</div></div>`).join("")}
        </div></div>` : ""}
        <div class="panel"><div class="pb qa">
          <div><div class="q">Why now</div><div class="prose">${linkify(d.why_now)}</div></div>
          <div><div class="q">Disclosed interest</div><div class="prose">${d.disclosure ? linkify(d.disclosure) : '<span class="muted">None disclosed</span>'}</div></div>
        </div></div>
      </div>

      <div class="stack-lg">
        ${mine ? `<div class="panel" id="score"><div class="ph"><h3>Your call</h3>${callPill(mine)}</div><div class="pb who">
          <div class="small muted">Locked when you submitted it, so it stays your own read.</div>${scoreReasons(mine)}</div></div>`
        : state.me.role === "observer" ? ""
        : brought ? `<div class="panel" id="score"><div class="ph"><h3>Your deal</h3></div><div class="pb"><div class="small muted">You brought it, so you don't make a call. Everyone else's calls stay independent of yours.</div></div></div>`
        : !["reviewing", "founder_call"].includes(d.status) ? `<div class="panel" id="score"><div class="ph"><h3>Calls are closed</h3></div><div class="pb"><div class="small muted">This deal has left review. Calls close then, so every call on the record was made before anyone knew how it turned out.</div></div></div>`
        : `<div class="panel" id="score"><div class="ph"><h3>Want to meet the team?</h3><a href="#/help" class="small helplink">How calls work</a></div><div class="pb">
          <form id="scoreform">${scorecardHtml()}<button class="btn block" type="submit">Submit my call</button><div class="msg err"></div></form></div></div>`}

        ${d.scores_hidden ? hiddenPanel("Everyone's calls") : ""}<div class="panel" ${d.scores_hidden ? "hidden" : ""}><div class="ph"><h3>Everyone's calls</h3>${scores.length ? `<span class="small muted">${d.yes_count} of ${scores.length} said yes${(() => { const m = scores.filter((s) => s.yes && s.met).length; return d.yes_count ? ` · ${m} of them met the team` : ""; })()}</span>` : ""}</div><div class="pb who">${scores.length ? scores.map((s) => `
          <div class="w"><div class="row between"><b>${esc(s.name)}${s.member_id === d.poster_id ? ' <span class="pill">Brought it</span>' : ""}</b><span class="row" style="gap:8px">${s.total != null ? `<span class="score">${s.total}<small>/100</small></span>` : ""}${callPill(s)}</span></div>
            ${scoreReasons(s)}${s.member_id !== state.me.id && s.why ? `<div style="text-align:right">${reportBtn("call", s.member_id, d.id, s.member_id, s.name)}</div>` : ""}</div>`).join("") : '<div class="small muted">No calls yet.</div>'}</div></div>

        ${!d.scores_hidden && scores.some(isTen) ? `<div class="panel"><div class="ph"><h3>The ten questions</h3><span class="small muted">Bar: average · outline: lowest to highest</span></div><div class="pb bars">${groupBars(scores)}</div></div>` : ""}

        ${state.me.role === "observer" ? "" : `<div class="panel"><div class="ph"><h3>Meet the team</h3>${intros.count ? `<span class="small muted">${intros.count} asked</span>` : ""}</div><div class="pb">
          ${brought ? (intros.who.length ? `<div class="who">${intros.who.map((w) => `<div class="w row between"><b>${esc(w.name)}</b><span class="small faint">${ago(w.at)}</span></div>`).join("")}</div><p class="small muted" style="margin:10px 0 0">Each request came to you by email with their address. Reply to connect them.</p>`
            : '<p class="small muted" style="margin:0">When members ask to meet the founders, you get an email and they show up here. You stay the point of contact.</p>')
          : intros.mine ? `<p class="small" style="margin:0">You asked ${first} for an introduction. ${first} has your email address and may connect you.</p>`
          : `<p class="small muted" style="margin-top:0">${first} knows the founders and stays the point of contact. Asking sends ${first} your email address.</p><button class="btn ghost block" type="button" id="askintro">Ask ${first} for an intro</button>`}
        </div></div>`}
        ${huntPanel(d, pl, myInv)}
        <div class="panel"><div class="ph"><h3>Who invested</h3></div><div class="pb">
          ${investments.length ? `<div class="who">${investments.map((i) => `<div class="w"><div class="row between"><b>${esc(i.name)}</b><span class="mono">${usd(i.amount_cents)}</span></div>
            <div class="small muted">${i.invested_on ? esc(i.invested_on) + " · " : ""}Cash returned ${usd(i.realized_cents)}${i.paper_cents != null ? ` · Worth today ${usd(i.paper_cents)}` : ""}</div>${i.note ? `<div class="small" style="margin-top:4px">${esc(i.note)}${i.member_id !== state.me.id ? ` · ${reportBtn("investment", i.member_id, d.id, i.member_id, i.name)}` : ""}</div>` : ""}</div>`).join("")}</div>
            <div class="small muted" style="margin-top:10px">Totals: ${usd(d.invested_cents)} in · ${usd(totalRealized)} cash returned · ${usd(totalPaper)} paper value</div>` : '<div class="small muted">No one has logged an investment yet.</div>'}
          <details style="margin-top:14px"><summary class="small" style="cursor:pointer;color:var(--accent)">${myInv ? "Edit my investment" : "I invested"}</summary>
            <form id="invform" style="margin-top:6px">
              <div class="grid2"><div><label>Amount ($)</label><input name="amount_usd" inputmode="decimal" required value="${myInv ? myInv.amount_cents / 100 : ""}" placeholder="25,000"></div>
                <div><label>Date</label><input name="invested_on" type="date" value="${esc(myInv?.invested_on || "")}"></div></div>
              <div class="grid2"><div><label>Cash returned ($)</label><input name="realized_usd" inputmode="decimal" value="${myInv ? myInv.realized_cents / 100 : "0"}"></div>
                <div><label>What it's worth today ($)</label><input name="paper_usd" inputmode="decimal" value="${myInv && myInv.paper_cents != null ? myInv.paper_cents / 100 : ""}" placeholder="Same as amount"></div></div>
              <label>Note</label><input name="note" maxlength="500" value="${esc(myInv?.note || "")}" placeholder="Via Wefunder, SAFE at $10M cap…">
              <div class="row" style="margin-top:14px"><button class="btn sm" type="submit">Save</button>${myInv ? '<button class="btn danger sm" type="button" id="uninvest">Remove</button>' : ""}</div>
              <div class="msg err"></div></form></details>
        </div></div>
      </div>
    </div>
    <div class="stack-lg" style="margin-top:18px">
      ${lookBackPanel(d, scores, r.outcome)}
      <div class="panel"><div class="ph"><h3>Updates and lessons</h3></div><div class="pb">
        <form id="updform" class="stack"><textarea name="body" required maxlength="4000" placeholder="${myInv ? "How's it going? Share an update or a lesson…" : "Share news, research notes or lessons…"}"></textarea>
          <div class="row"><button class="btn sm" type="submit">Post update</button><span class="msg err"></span></div></form>
        <div class="feed" style="margin-top:12px">${updates.length ? updates.map((u) => `<div class="u"><div class="small faint"><b style="color:var(--fg)">${esc(u.name)}</b> · ${ago(u.created_at)}${u.member_id !== state.me.id ? ` · ${reportBtn("update", u.id, d.id, u.member_id, u.name)}` : ""}</div><div class="prose" style="font-size:15px">${linkify(u.body)}</div></div>`).join("") : '<div class="small muted">No updates yet.</div>'}</div>
      </div></div>
    </div>
    ${!mine && state.me.role !== "observer" ? `<div class="callbar" id="callbar" aria-hidden="true"><span>Want to meet the team?</span><button type="button" data-pick="yes">Yes</button><button type="button" data-pick="no">No</button></div>` : ""}`;

  $("#askintro")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    try { await api(`/api/deals/${d.id}/intro`, {}); toast(`Sent. ${firstName(d.poster_name)} may be in touch.`); await viewDeal(d.id); }
    catch (err) { e.target.disabled = false; toast(err.message); }
  });
  $("#sharedeal").onclick = async () => {
    const url = `https://staghunts.com/app#/deals/${d.id}`;
    if (navigator.share) { try { await navigator.share({ title: d.company, text: `${d.company}: ${d.one_liner}`, url }); } catch {} return; }
    try { await navigator.clipboard.writeText(url); toast("Link copied. Paste it in the group chat."); } catch { await askText("Copy this link:", url, "Done"); }
  };

  const sf = $("#scoreform");
  const bar = $("#callbar");
  if (sf && bar) {
    const io = new IntersectionObserver(([e]) => bar.classList.toggle("away", e.isIntersecting), { rootMargin: "0px 0px -20% 0px" });
    io.observe($("#score"));
    $$("[data-pick]", bar).forEach((b) => (b.onclick = () => {
      const r = sf.querySelector(`input[name="yes"][value="${b.dataset.pick}"]`); r.checked = true;
      $("#score").scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => sf.querySelector('input[name="met"]')?.focus({ preventScroll: true }), 450);
    }));
  }
  if (sf) { wireScorecard(sf);
    sf.addEventListener("submit", async (e) => { e.preventDefault();
      if (!(await ask("Submit your call? It locks once it's in, and then you'll see everyone else's.", "Submit"))) return;
      submitting(sf, async () => { await api(`/api/deals/${d.id}/score`, scoreFromForm(formData(sf))); toast("Call saved");
        await viewDeal(d.id); $("#score")?.scrollIntoView(); }); }); }
  const inf = $("#invform");
  inf.addEventListener("submit", (e) => { e.preventDefault(); submitting(inf, async () => { await api(`/api/deals/${d.id}/invest`, formData(inf)); toast("Investment logged"); }); });
  $("#uninvest")?.addEventListener("click", async () => { if (await ask("Remove your investment from this deal?")) await api(`/api/deals/${d.id}/invest/delete`, {}); });
  const pf = $("#pledgeform");
  pf?.addEventListener("submit", (e) => { e.preventDefault(); submitting(pf, async () => {
    const res = await api(`/api/deals/${d.id}/pledge`, formData(pf));
    toast(res.locked ? "It locked in. The hunt is on." : pl.mine?.locked_at ? "Promise raised" : "Promise saved. Nobody sees it until it locks in.");
  }); });
  $("#unpledge")?.addEventListener("click", async () => { if (await ask("Take back your promise?")) { await api(`/api/deals/${d.id}/pledge/withdraw`, {}); toast("Promise taken back"); } });
  const of = $("#outcomeform");
  of?.addEventListener("submit", (e) => { e.preventDefault(); submitting(of, async () => {
    const f = formData(of); await api(`/api/deals/${d.id}/outcome`, f);
    toast(f.source ? "Outcome recorded" : "Reported. It counts once another member confirms it.");
  }); });
  $("#outcomeconfirm")?.addEventListener("click", async () => { await api(`/api/deals/${d.id}/outcome`, { action: "confirm" }); toast("Confirmed. The outcome now counts."); });
  $("#outcomewithdraw")?.addEventListener("click", async () => { await api(`/api/deals/${d.id}/outcome`, { action: "withdraw" }); toast("Withdrawn"); });
  for (const k of ["hunt", "lookback"]) if (location.hash.endsWith("#" + k)) setTimeout(() => $("#" + k)?.scrollIntoView({ block: "start" }), 50);
  const uf = $("#updform");
  uf.addEventListener("submit", (e) => { e.preventDefault(); submitting(uf, async () => { await api(`/api/deals/${d.id}/updates`, formData(uf)); uf.reset(); }); });
  $("#status")?.addEventListener("change", async (e) => { await api("/api/deals/" + d.id, { status: e.target.value }); toast("Status updated"); });
  $("#del")?.addEventListener("click", async () => {
    if (!(await ask(`Delete ${d.company} and all its calls, investments and discussion? This can't be undone.`))) return;
    await api(`/api/admin/deals/${d.id}/delete`, {}); location.hash = "#/deals";
  });
  if (location.hash.includes("#score") || location.hash.endsWith("#score")) $("#score")?.scrollIntoView();

  // Live: refresh the deal when someone scores/invests/updates
  live(async () => {
    // Don't yank the page out from under someone who is typing or has a half-written message
    const typingSomewhere = (document.activeElement && document.activeElement.closest("form")) || $$("textarea", $("#view")).some((t) => t.value.trim());
    if (typingSomewhere) { pendingRefresh = true; return; }
    const keepScroll = window.scrollY;
    await viewDeal(id);
    window.scrollTo(0, keepScroll);
  }, (ev) => ev.what === "deal" && ev.id === id && (ev.deleted ? (location.hash = "#/deals", false) : true));
}
// Invest straight with the company, then log it here
function investStrip(d) {
  if (!d.invest_url || state.me.role === "observer" || ["passed", "dead", "exited"].includes(d.status)) return "";
  const host = (() => { try { return new URL(d.invest_url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  return `<div class="investstrip"><div><b>Ready to invest?</b> <span class="muted">You invest straight with ${esc(d.company)}. Stag Hunt never touches the money.</span></div>
    <a class="btn" href="${esc(d.invest_url)}" target="_blank" rel="noopener noreferrer">Invest${host ? ` on ${esc(host)}` : ""} ↗</a></div>`;
}
const OUTCOME = { breakout: "Breakout", on_track: "On track", struggling: "Struggling", dead: "Shut down" };
const goodOutcome = (o) => o === "breakout" || o === "on_track";

function huntPanel(d, pl, myInv) {
  const closed = ["passed", "dead", "exited"].includes(d.status);
  const mine = pl.mine, lockedMe = mine && mine.locked_at;
  const brought = d.poster_id === state.me.id;
  const needOpts = [[0, "I'm in no matter what"], ...[1, 2, 3, 4, 5].map((k) => [k, `If at least ${k} other${k === 1 ? "" : "s"} are in`])];
  const first = pl.first && !brought
    ? `<div class="hunt-first"><b>${esc(pl.first.name)} brought this deal</b> and is in for <span class="mono">${usd(pl.first.amount_cents)}</span>. Their check comes first; the group fills the rest.</div>`
    : "";
  const status = pl.locked.length
    ? `<div class="hunt-locked"><div class="row between"><b>Locked in · ${pl.locked.length} member${pl.locked.length === 1 ? "" : "s"}</b><span class="mono">${usd(pl.locked_total)}</span></div>
        <div class="who" style="margin-top:8px">${pl.locked.map((p) => `<div class="w row between"><span>${esc(p.name)}${p.first ? ' <i class="faint">brought it</i>' : ""}</span><span class="mono small">${usd(p.amount_cents)}</span></div>`).join("")}</div></div>`
    : "";
  const waiting = pl.waiting
    ? `<div class="hunt-wait"><span class="num-big">${pl.waiting}</span><span>conditional promise${pl.waiting === 1 ? "" : "s"} waiting${pl.next ? `. <b>${pl.next.more} more</b> would lock in ${pl.next.would_lock === 1 ? "one of them" : pl.next.would_lock === pl.waiting ? (pl.waiting === 2 ? "both" : "all " + pl.waiting) : pl.next.would_lock}.` : "."}</span></div>`
    : "";
  const mineLine = mine
    ? (lockedMe
        ? `<div class="hunt-mine ok"><b>You're locked in for ${usd(mine.amount_cents)}.</b> ${myInv ? "Investment logged. Thank you." : "Log your investment below once it's done."}</div>`
        : brought
          ? `<div class="hunt-mine"><b>Your check: ${usd(mine.amount_cents)}</b>, first in. You brought this deal, so your check comes before anyone else's and everyone can see it. It locks when the group does.</div>`
          : `<div class="hunt-mine"><b>Your promise: ${usd(mine.amount_cents)}</b>, ${mine.need_others ? `if at least ${mine.need_others} other${mine.need_others === 1 ? "" : "s"} join` : "no matter what"}. Waiting. Only you can see this.</div>`)
    : "";
  const form = closed ? "" : `
    <details class="hunt-form"><summary class="small">${brought ? (mine ? (lockedMe ? "Raise my check" : "Change my check") : "Set your check first") : mine ? (lockedMe ? "Raise my promise" : "Change my promise") : "Make a promise"}</summary>
      <form id="pledgeform" style="margin-top:8px">
        <div class="grid2"><div><label>Amount ($)</label><input name="amount_usd" inputmode="decimal" required value="${mine ? mine.amount_cents / 100 : ""}" placeholder="25,000"></div>
          ${lockedMe || brought ? "" : `<div><label>When</label><select name="need_others">${needOpts.map(([k, l]) => `<option value="${k}" ${(mine ? mine.need_others : 2) === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>`}</div>
        <div class="row" style="margin-top:12px"><button class="btn sm" type="submit">${mine ? "Save" : brought ? "Set my check" : "Promise"}</button>${mine && !lockedMe ? '<button class="btn ghost sm" type="button" id="unpledge">Withdraw</button>' : ""}</div>
        <div class="msg err"></div></form></details>`;
  return `<div class="panel" id="hunt"><div class="ph"><h3>The hunt</h3></div><div class="pb stack">
    ${!pl.locked.length && !pl.waiting && !closed ? `<p class="small muted" style="margin:0">${brought ? "You brought this deal, so you set your check first and the group fills the rest. Then the others say what they'd put in <i>if enough others join</i>." : "Say what you'd put in <i>if enough others join</i>. Nobody sees names or amounts until a group locks in. Once it locks, everyone in it has promised the others."} By default, three in is a go.</p>` : ""}
    ${status}${first}${waiting}${mineLine}${form}
    ${closed && !pl.locked.length && !pl.waiting ? '<div class="small muted">This deal is closed.</div>' : ""}
  </div></div>`;
}

// Look back: anyone can report how a deal turned out. It counts once a second member
// confirms it, or right away with a public source link. Nobody grades their own deal.
function lookBackPanel(d, scores, o = {}) {
  const age = Date.now() / 1000 - d.created_at, due = age > 180 * 86400;
  const canReport = state.me.role !== "observer", pending = d.pending_outcome;
  if (!d.outcome && !pending && !canReport) return "";
  const form = canReport ? `<form id="outcomeform" class="stack" style="margin-top:12px">
      <div class="grid2"><div><label>How did it turn out?</label><select name="outcome" required><option value="">Pick one</option>${Object.entries(OUTCOME).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></div>
        <div><label>One line on what happened</label><input name="note" maxlength="500" placeholder="Raised a Series A at 4x…"></div></div>
      <div><label>Public link, if there is one</label><input name="source" inputmode="url" maxlength="300" placeholder="News or funding announcement"></div>
      <div class="small muted">With a public link it counts right away. Without one, it counts once another member confirms it.</div>
      <div class="row"><button class="btn sm" type="submit">Report</button></div><div class="msg err"></div></form>` : "";
  const calls = d.outcome ? `<div class="who">${scores.map((s) => { const right = !!s.yes === goodOutcome(d.outcome);
      return `<div class="w row between"><span>${esc(s.name)}</span><span class="row" style="gap:10px">${callPill(s)}<span class="pill ${right ? "hit" : "pass"}">${right ? "Called it" : "Missed"}</span></span></div>`; }).join("") || '<div class="small muted">Nobody made a call on this one.</div>'}</div>` : "";
  const source = d.outcome_source ? `<a href="${esc(d.outcome_source)}" target="_blank" rel="noopener">public source</a>` : "";
  const provenance = o.by_name ? `<div class="small muted" style="margin-bottom:8px">Reported by ${esc(firstName(o.by_name))}${o.confirmed_name ? `, confirmed by ${esc(firstName(o.confirmed_name))}` : source ? `, with a ${source}` : ""}.</div>` : "";
  const pendingBox = pending ? `<div class="notice" style="margin:${d.outcome ? "12px 0 0" : "0"}"><b>${o.mine_pending ? "You reported" : esc(firstName(o.pending_name || "A member")) + " reports"}: ${OUTCOME[pending]}.</b>${d.pending_note ? " " + esc(d.pending_note) : ""}
      <div class="small muted" style="margin-top:4px">${o.mine_pending ? "It counts once another member confirms it." : "It counts once another member confirms it. Do you know this to be true?"}</div>
      <div class="row" style="margin-top:8px;gap:8px">${o.mine_pending ? '<button class="btn ghost sm" type="button" id="outcomewithdraw">Withdraw</button>' : canReport ? '<button class="btn sm" type="button" id="outcomeconfirm">Confirm</button>' : ""}</div></div>` : "";
  const pill = d.outcome ? `<span class="pill ${goodOutcome(d.outcome) ? "hit" : "pass"}">${OUTCOME[d.outcome]}</span>` : pending ? '<span class="pill prom">Needs a second member</span>' : due ? '<span class="pill prom">Due</span>' : "";
  const intro = d.outcome ? `${d.outcome_note ? `<div class="prose" style="font-size:15px;margin-bottom:10px">${esc(d.outcome_note)}</div>` : ""}${provenance}<div class="small muted" style="margin-bottom:8px">A yes counts as a good call if the company is on track or broke out, and a no counts if it struggled or shut down.</div>${calls}`
    : pending ? "" : `<p class="small muted" style="margin:0">${due ? "It's been six months. If you know how it went, report it, and everyone's yes or no gets checked against what actually happened." : "Once anyone knows how it went, they report it here, and a second member confirms. Then every yes and no gets checked against the result."}</p>`;
  const reportLabel = d.outcome || pending ? "Report something different" : "Report how it turned out";
  const reportBlock = form && !o.mine_pending ? `<details${!d.outcome && !pending && due ? " open" : ""}><summary class="small" style="cursor:pointer;color:var(--accent);margin-top:10px">${reportLabel}</summary>${form}</details>` : "";
  return `<div class="panel" id="lookback"><div class="ph"><h3>Look back</h3>${pill}</div><div class="pb">${intro}${pendingBox}${reportBlock}</div></div>`;
}

let pendingRefresh = false;
document.addEventListener("focusout", () => { if (pendingRefresh && !$$("textarea", $("#view")).some((t) => t.value.trim())) { pendingRefresh = false; setTimeout(() => state.refresh && state.refresh({ what: "deal", id: (location.hash.match(/[0-9a-f-]{36}/) || [])[0] }), 300); } });

// ------------------------------------------------------------ members
async function viewMembers(_, seq) {
  const { members: all, observers = [] } = await api("/api/members");
  if (seq !== renderSeq) return;
  const members = all;
  $("#view").innerHTML = `
    <div class="pagehead"><div><h1>Members</h1></div></div>
    <div class="tablewrap"><table class="mtable"><thead><tr><th>Member</th><th class="num" title="Deals brought to the group">Deals</th><th class="num" title="Share of other members' deals at their check size they've said yes or no to">Calls made</th><th class="num" title="Promises they followed through on">Promises kept</th><th class="num" title="A yes on a company that did well, or a no on one that didn't">Good calls</th><th class="num">Invested</th></tr></thead><tbody>
    ${members.map((m) => {
      const called = m.scores_possible ? `${Math.min(100, Math.round((m.scores_on_others / m.scores_possible) * 100))}%` : "–";
      // On a phone the numbers sit under the name instead of in columns
      const line = [`${m.deals_posted} deal${m.deals_posted === 1 ? "" : "s"}`, m.scores_possible && `${called} called`, m.calls && `${m.calls_right} of ${m.calls} good calls`, m.invested_cents && `${usd(m.invested_cents)} in`].filter(Boolean).join(" · ");
      return `<tr class="rowlink" data-go="#/members/${esc(m.id)}"><td><a class="row" style="flex-wrap:nowrap;text-decoration:none;color:inherit" href="#/members/${esc(m.id)}">${avatar(m.name, m.id)}<div><div class="co">${esc(m.name)} ${m.role === "admin" ? '<span class="pill">Admin</span>' : ""}</div><div class="sub">${esc(m.headline || m.email)}</div><div class="sub mline">${line}</div></div></a></td>
        <td class="num">${m.deals_posted}${m.deals_30d ? ` <span class="faint small">+${m.deals_30d}</span>` : ""}</td>
        <td class="num">${called}</td>
        <td class="num">${m.pledges_locked ? `${m.pledges_kept} of ${m.pledges_locked}` : "–"}</td>
        <td class="num">${m.calls ? `${m.calls_right} of ${m.calls}` : "–"}</td>
        <td class="num">${m.invested_cents ? usd(m.invested_cents) : "–"}</td></tr>`;
    }).join("")}</tbody></table></div>
    ${observers.length ? `<p class="small muted" style="margin-top:14px"><b style="color:var(--fg);font-weight:600">Observers:</b> ${observers.map((o) => esc(o.name)).join(", ")} <span class="faint">· can read, can't post</span></p>` : ""}
    <div class="repkey small">
      <div><b>Deals</b> brought to the group (<span class="faint">+n</span> this month)</div>
      <div><b>Calls made</b>: share of other members' deals at their check size they've said yes or no to since joining</div>
      <div><b>Promises kept</b>: promises they followed through on</div>
      <div><b>Good calls</b>: a yes on a company that did well, or a no on one that didn't</div>
      </div>`;
  $$("tr.rowlink").forEach((tr) => tr.addEventListener("click", (e) => { if (!e.target.closest("a")) location.hash = tr.dataset.go; }));
  live(async () => { await loadPhotos(); router(); }, (ev) => ev.what === "members" || ev.type === "deal_posted");
}

// ------------------------------------------------------------ one member's profile
async function viewMember(id) {
  const seq = renderSeq;
  const { member: m, deals, taste = { calls: 0, yes: 0, sectors: [], rounds: [] }, blocked } = await api("/api/members/" + id);
  if (seq !== renderSeq) return;
  const mine = m.id === state.me.id;
  // What they actually back, learned from every yes and no
  const backs = (rows) => rows.filter((r) => r.yes).map((r) => `${esc(r.name)} <span class="faint">${r.yes} of ${r.n}</span>`).join(" · ");
  // Shown once there is at least one call; an empty box says nothing
  const tastePanel = taste.calls ? `<div class="panel"><div class="ph"><h3>What ${mine ? "you" : esc(firstName(m.name))} back${mine ? "" : "s"}</h3></div><div class="pb pfacts">
    <div><div class="l">Says yes to</div><div>${taste.yes} of ${taste.calls} deals</div></div>
    ${backs(taste.sectors) ? `<div><div class="l">Said yes in</div><div>${backs(taste.sectors)}</div></div>` : ""}
    ${backs(taste.rounds) ? `<div><div class="l">Rounds</div><div>${backs(taste.rounds)}</div></div>` : ""}
    <div class="small faint">From every yes and no on other members' deals.</div></div></div>` : "";
  const links = [["LinkedIn", m.linkedin], ["X", m.twitter], ["Website", m.website]].filter(([, u]) => u);
  const stat = (l, v) => `<div class="pstat"><div class="n">${v}</div><div class="l">${l}</div></div>`;
  $("#view").innerHTML = `
    <div class="profilehead">
      ${avatar(m.name, m.id, "xl")}
      <div class="grow"><h1>${esc(m.name)}</h1>
        ${m.headline ? `<div class="headline">${esc(m.headline)}</div>` : ""}
        <div class="small muted">${[m.location, `Member since ${date(m.created_at)}`].filter(Boolean).map(esc).join(" · ")}</div>
        ${links.length ? `<div class="proflinks">${links.map(([l, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${l}</a>`).join("")}</div>` : ""}</div>
      ${mine ? '<a class="btn ghost sm" href="#/profile">Edit profile</a>' : `<div class="row" style="gap:8px">${m.email ? `<a class="btn ghost sm" href="mailto:${esc(m.email)}">Email</a>` : ""}<button class="btn ghost sm" type="button" id="blockbtn">${blocked ? "Unblock" : "Block"}</button></div>`}
    </div>
    ${mine ? "" : `<div class="small" style="margin:-6px 0 16px">${blocked ? `<span class="muted">You blocked ${esc(firstName(m.name))}. What they post doesn't show for you.</span> · ` : ""}${reportBtn("member", m.id, "", m.id, m.name)}</div>`}
    ${m.deals_posted || m.scores_on_others || m.pledges_locked || m.calls ? `<div class="pstats">
      ${stat("Deals brought", m.deals_posted)}
      ${stat("Made a call", m.scores_possible ? Math.min(100, Math.round((m.scores_on_others / m.scores_possible) * 100)) + "%" : "–")}
      ${stat("Promises kept", m.pledges_locked ? `${m.pledges_kept} of ${m.pledges_locked}` : "–")}
      ${stat("Good calls", m.calls ? `${m.calls_right} of ${m.calls}` : "–")}
    </div>` : ""}
    <div class="two">
      <div class="stack-lg">
        ${m.bio ? `<div class="panel"><div class="pb prose" style="font-size:16px">${linkify(m.bio)}</div></div>` : mine ? `<div class="small muted">Add a short bio in <a href="#/profile">your profile</a>.</div>` : ""}
        <div class="panel"><div class="ph"><h3>Deals</h3></div><div class="list">${deals.length ? deals.map((d) => `<a href="#/deals/${d.id}"><span class="grow"><b>${esc(d.company)}</b> <span class="small muted">${esc(d.one_liner)}</span></span>${statusPill(d.status)}</a>`).join("") : '<div class="empty">No deals yet.</div>'}</div></div>
      </div>
      <div class="stack-lg">
        <div class="panel"><div class="pb pfacts">
          ${[["Check size", m.tier ? tierLabel(m.tier) : m.check_size], ["What they back", m.thesis], ["Involvement", INVOLVEMENT[m.involvement]], ["Brings", m.network], ["Focus", m.focus]]
            .filter(([, v]) => v).map(([l, v]) => `<div><div class="l">${l}</div><div>${esc(v)}</div></div>`).join("") || '<div class="small muted">No details yet.</div>'}
        </div></div>
        ${tastePanel}
      </div>
    </div>`;
  $("#blockbtn")?.addEventListener("click", () => setBlock(m.id, m.name, !blocked));
  live(() => router(), (ev) => ev.what === "members");
}

// ------------------------------------------------------------ report and block
// Anyone can report something posted here; an admin looks within 24 hours. Blocking someone
// hides what they post, for you only, and can be undone from their page.
const reportBtn = (kind, id, deal, who, name) =>
  `<button class="link small rep" type="button" data-report="${kind}" data-id="${esc(id)}" data-deal="${esc(deal)}" data-who="${esc(who)}" data-name="${esc(firstName(name))}">Report</button>`;

async function setBlock(id, name, on) {
  const first = firstName(name);
  if (on && !(await ask(`Block ${first}? What ${first} posts stops showing for you. ${first} isn't told, and you can unblock any time from this page.`, "Block"))) return;
  await api(`/api/members/${id}/${on ? "block" : "unblock"}`, {});
  toast(on ? `${first} is blocked.` : `${first} is unblocked.`);
  router();
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-report]");
  if (!b) return;
  const { report: kind, id, deal, who, name } = b.dataset;
  const reason = await askText(`Report this to Stag Hunt? Tell us what's wrong (optional). An admin looks within 24 hours.`, "", "Report");
  if (reason === null) return;
  try { await api("/api/report", { kind, id, deal, reason }); } catch (err) { toast(err.message); return; }
  if (who && who !== state.me.id && (await ask(`Thanks, it's reported. Block ${name} too? What ${name} posts stops showing for you.`, "Block"))) {
    await api(`/api/members/${who}/block`, {}); toast(`${name} is blocked.`); router();
  } else toast("Thanks, it's reported.");
});

// ------------------------------------------------------------ your record
async function viewHistory(_, seq) {
  const { joined, deals, group: g } = await api("/api/me/history");
  if (seq !== renderSeq) return;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + "%" : "–");
  const brought = deals.filter((d) => d.brought);
  const called = deals.filter((d) => d.my_yes !== null && !d.brought);
  const backed = deals.filter((d) => d.amount_cents);
  const known = called.filter((d) => d.outcome);
  const right = known.filter((d) => !!d.my_yes === goodOutcome(d.outcome));
  const invested = backed.reduce((t, d) => t + d.amount_cents, 0);
  const worth = backed.reduce((t, d) => t + (d.realized_cents || 0) + (d.paper_cents || 0), 0);
  const stat = (l, v, sub = "") => `<div class="pstat"><div class="n">${v}</div><div class="l">${l}${sub ? `<br><span class="faint">${sub}</span>` : ""}</div></div>`;

  // Month by month since you joined (last two years at most)
  const key = (s) => { const t = new Date(s * 1000); return t.getFullYear() * 12 + t.getMonth(); };
  const first = Math.min(...deals.map((d) => key(d.brought ? d.created_at : d.called_at || d.created_at)));
  const end = key(Date.now() / 1000), start = Math.min(end - 5, Math.max(key(joined), first, end - 23));   // six months at least, two years at most
  const months = Array.from({ length: end - start + 1 }, (_, i) => ({ k: start + i, brought: 0, calls: 0 }));
  const at = (s) => months[key(s) - start];
  brought.forEach((d) => at(d.created_at) && at(d.created_at).brought++);
  called.forEach((d) => at(d.called_at) && at(d.called_at).calls++);
  const top = Math.max(1, ...months.map((m) => Math.max(m.brought, m.calls)));
  const W = 640, H = 150, gw = W / months.length, bw = Math.min(14, gw / 3);
  const label = (k) => new Date(Math.floor(k / 12), k % 12, 1).toLocaleDateString(undefined, { month: "short" });
  const every = months.length > 12 ? 3 : 1;
  const chart = `<svg class="hchart" viewBox="0 0 ${W} ${H + 22}" role="img" aria-label="Deals brought and calls made each month">
    <line x1="0" x2="${W}" y1="${H}" y2="${H}" stroke="var(--line)"/>
    ${months.map((m, i) => {
      const x = i * gw + gw / 2, h = (n) => (n / top) * (H - 10);
      return `<g><title>${label(m.k)} ${Math.floor(m.k / 12)}: ${m.brought} brought, ${m.calls} calls</title>
        <rect x="${x - bw - 1}" y="${H - h(m.brought)}" width="${bw}" height="${h(m.brought)}" fill="var(--forest)" rx="1"/>
        <rect x="${x + 1}" y="${H - h(m.calls)}" width="${bw}" height="${h(m.calls)}" fill="var(--oak)" opacity=".75" rx="1"/>
        ${i % every === 0 ? `<text x="${x}" y="${H + 16}" text-anchor="middle">${label(m.k)}</text>` : ""}</g>`;
    }).join("")}</svg>
    <div class="hlegend small muted"><span><i style="background:var(--forest)"></i>Deals you brought</span><span><i style="background:var(--oak);opacity:.75"></i>Calls you made</span></div>`;

  // How your calls turned out, once the outcome is known
  const cell = (yes, good, l) => { const n = known.filter((d) => !!d.my_yes === yes && goodOutcome(d.outcome) === good).length; return `<div class="hcell ${yes === good ? "right" : ""}"><div class="n">${n}</div><div class="l">${l}</div></div>`; };
  const grid = known.length ? `<div class="hgrid">
      <div></div><div class="h">Went well</div><div class="h">Struggled</div>
      <div class="h">You said yes</div>${cell(true, true, "Spotted it")}${cell(true, false, "Missed the risk")}
      <div class="h">You said no</div>${cell(false, true, "Passed on a winner")}${cell(false, false, "Dodged it")}
    </div>` : '<div class="small muted">Fills in once deals you called have a known outcome.</div>';

  // You versus the group: same measures, side by side, with how many each rests on
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const p0 = (x) => (x === null || x === undefined ? "–" : Math.round(x * 100) + "%");
  const days = avg(called.map((d) => Math.max(0, (d.called_at - d.created_at) / 86400)));
  const shown = brought.filter((d) => d.yeses !== null && d.calls);
  const broughtKnown = brought.filter((d) => d.outcome);
  const vs = [
    ["Say yes", p0(avg(called.map((d) => d.my_yes))), p0(g.yes_rate), called.length, "calls"],
    ["Good calls", p0(avg(known.map((d) => +(!!d.my_yes === goodOutcome(d.outcome))))), p0(g.good_rate), known.length, "with an outcome"],
    ["Days to make a call", days === null ? "–" : days.toFixed(1), g.days == null ? "–" : g.days.toFixed(1), called.length, "calls"],
    ["Members say yes to your deals", p0(avg(shown.map((d) => d.yeses / d.calls))), p0(g.member_yes), shown.length, "deals"],
    ["Your deals that went well", p0(avg(broughtKnown.map((d) => +goodOutcome(d.outcome)))), p0(g.went_well), broughtKnown.length, "with an outcome"],
    ["Worth today, per dollar in", invested ? (worth / invested).toFixed(2) + "x" : "–", g.multiple ? g.multiple.toFixed(2) + "x" : "–", backed.length, "checks"],
  ];
  const vsPanel = `<table class="vs"><thead><tr><th></th><th class="num">You</th><th class="num">Group</th></tr></thead><tbody>${vs.map(([l, me, grp, n, unit]) =>
    `<tr><td>${l}<div class="small faint">${n ? `${n} ${n === 1 ? unit.replace(/s$/, "") : unit}${n < 5 ? ", too few to tell yet" : ""}` : "none yet"}</div></td><td class="num"><b>${me}</b></td><td class="num muted">${grp}</td></tr>`).join("")}</tbody></table>`;

  // Against the crowd: your call versus most other members on the same deal
  const crowd = called.filter((d) => d.calls >= 2 && d.yeses !== null && d.yeses * 2 !== d.calls)
    .map((d) => ({ ...d, against: !!d.my_yes !== d.yeses * 2 > d.calls }));
  const side = (list, label) => { const k = list.filter((d) => d.outcome), r = k.filter((d) => !!d.my_yes === goodOutcome(d.outcome));
    return `<div class="hcell"><div class="n">${list.length}</div><div class="l">${label}<br>${k.length ? `Right ${r.length} of ${k.length} with an outcome` : "No outcomes yet"}</div></div>`; };
  const crowdPanel = crowd.length ? `<div class="hpair">${side(crowd.filter((d) => !d.against), "With most members")}${side(crowd.filter((d) => d.against), "Against most members")}</div>
    <div class="small muted" style="margin-top:10px">The calls that count most are the ones you made alone and got right.</div>`
    : '<div class="small muted">Fills in once other members have called the same deals as you.</div>';

  // Where your judgment is best, sector by sector
  const bySector = {};
  for (const d of called) { const k = (d.sector || "Other").trim(); const t = (bySector[k.toLowerCase()] ||= { name: k, n: 0, yes: 0, known: 0, right: 0 });
    t.n++; t.yes += d.my_yes; if (d.outcome) { t.known++; t.right += +(!!d.my_yes === goodOutcome(d.outcome)); } }
  const sectors = Object.values(bySector).sort((a, b) => b.n - a.n).slice(0, 8);
  const sectorPanel = sectors.length ? `<table class="vs"><thead><tr><th>Sector</th><th class="num">Calls</th><th class="num">Yes</th><th class="num">Good calls</th></tr></thead><tbody>${sectors.map((t) =>
    `<tr><td>${esc(t.name)}</td><td class="num">${t.n}</td><td class="num">${pct(t.yes, t.n)}</td><td class="num">${t.known ? `${t.right} of ${t.known}` : "–"}</td></tr>`).join("")}</tbody></table>`
    : '<div class="small muted">Fills in with your calls.</div>';

  const part = (d) => d.brought ? "Brought it" : d.my_yes === null ? "Backed it" : d.my_yes ? "Said yes" : "Said no";
  const members = (d) => !d.calls ? "–" : d.yeses === null ? `${d.calls} call${d.calls === 1 ? "" : "s"}` : `${d.yeses} yes of ${d.calls}`;
  const result = (d) => d.outcome ? `<span class="pill ${goodOutcome(d.outcome) ? "hit" : "pass"}">${OUTCOME[d.outcome]}</span>` : statusPill(d.status);
  const rows = (list) => list.length ? list.map((d) => `<tr>
      <td class="faint">${date(d.created_at)}</td>
      <td><a href="#/deals/${d.id}"><b>${esc(d.company)}</b></a>${d.sector ? ` <span class="small faint">${esc(d.sector)}</span>` : ""}<div class="mline small muted">${part(d)} · ${members(d)}</div>${d.my_why ? `<div class="hwhy small">${esc(d.my_why)}</div>` : ""}</td>
      <td>${part(d)}</td><td class="num">${members(d)}</td><td class="num">${d.amount_cents ? `${usd(d.amount_cents)}<div class="small faint">${(((d.realized_cents || 0) + (d.paper_cents || 0)) / d.amount_cents).toFixed(2)}x</div>` : "–"}</td><td>${result(d)}</td></tr>`).join("")
    : '<tr><td colspan="6" class="empty">Nothing here yet.</td></tr>';
  const tabs = [["all", "All", deals], ["brought", "Brought", brought], ["called", "Called", called], ["backed", "Backed", backed]];

  // Each analysis appears once there is something real behind it; until then it says what unlocks it
  const panels = [
    ["Month by month", deals.length, chart, "Starts with your first deal or call."],
    ["How your calls turned out", known.length, grid, "Opens when a deal you called has an outcome."],
    ["You and the group", called.length, vsPanel, "Opens after your first call on another member's deal."],
    ["With or against the crowd", crowd.length, crowdPanel, "Opens when other members have called the same deals as you."],
    ["Where your judgment is best", sectors.length, sectorPanel, "Opens after your first call."],
  ];
  const ready = panels.filter(([, n]) => n), waiting = panels.filter(([, n]) => !n);
  const waitingPanel = waiting.length ? `<div class="panel"><div class="ph"><h3>${ready.length ? "Still to come" : "What your record will show"}</h3></div><div class="pb"><ol class="hsoon">${waiting.map(([t, , , why]) =>
    `<li><b>${t}</b><span class="small muted">${why}</span></li>`).join("")}</ol></div></div>` : "";
  const welcome = `<div class="panel hstart"><div class="pb">
      <h2>Your record builds itself</h2>
      <p>Every deal you bring, every yes or no, and every check you write lands here. Over time it shows what you back, how often you are right, and how you compare with the group.</p>
      <ol class="hsteps">
        <li><b>Bring a deal</b><span>A company whose founders you can vouch for.</span></li>
        <li><b>Make your call</b><span>Yes or no on other members' deals, with one line on why.</span></li>
        <li><b>Look back</b><span>When an outcome is known, your record shows if you were right.</span></li>
      </ol>
      <div class="row"><a class="btn" href="#/deals/new">Share a deal</a><a class="btn ghost" href="#/deals">See deals</a></div>
    </div></div>`;

  $("#view").innerHTML = `
    <div class="pagehead"><div><h1>Your record</h1><div class="muted">${deals.length ? `Every deal you brought, called and backed since ${date(joined)}.` : "Everything you bring, call and back, in one place."} Only you see this.</div></div>
      ${deals.length ? '<div class="row"><a class="btn ghost sm" href="/api/me/history.csv" download>Download for Excel</a><a class="btn ghost sm" href="/api/me/history" target="_blank" rel="noopener" title="The same data as JSON, for your own tools">JSON</a></div>' : ""}</div>
    ${deals.length ? `<div class="pstats hstats">
      ${stat("Deals brought", brought.length)}
      ${stat("Calls made", called.length, called.length ? `${pct(called.filter((d) => d.my_yes).length, called.length)} yes` : "")}
      ${stat("Good calls", known.length ? pct(right.length, known.length) : "–", known.length ? `${right.length} of ${known.length} with an outcome` : "")}
      ${stat("Invested", usd(invested), backed.length ? `${backed.length} check${backed.length === 1 ? "" : "s"}` : "")}
      ${stat("Worth today", invested ? usd(worth) : "–", invested ? `${(worth / invested).toFixed(2)}x` : "")}
    </div>` : welcome}
    <div class="hpanels">
      ${ready.map(([t, , body]) => `<div class="panel"><div class="ph"><h3>${t}</h3></div><div class="pb">${body}</div></div>`).join("")}
      ${waitingPanel}
    </div>
    ${deals.length ? `<div class="panel" style="margin-top:24px"><div class="ph"><h3>Every deal</h3><div class="cfilter">${tabs.map(([k, l, list], i) => `<a href="#" data-ht="${k}" class="${i ? "" : "on"}">${l} ${list.length}</a>`).join("")}</div></div>
      <div class="pb" style="overflow-x:auto"><table class="mtable"><thead><tr><th>Date</th><th>Company</th><th>You</th><th>Members</th><th>Your check</th><th>Now</th></tr></thead><tbody id="hrows">${rows(deals)}</tbody></table></div></div>` : ""}
    ${deals.length ? `<div class="panel" style="margin-top:24px" id="sharetrack"></div>
    <div class="panel" style="margin-top:24px" id="apikey"></div>` : ""}`;
  $$("[data-ht]").forEach((a) => (a.onclick = (e) => {
    e.preventDefault();
    $$("[data-ht]").forEach((b) => b.classList.toggle("on", b === a));
    $("#hrows").innerHTML = rows(tabs.find(([k]) => k === a.dataset.ht)[2]);
  }));
  shareTrackPanel();
  apiKeyPanel();
  live(() => router(), (ev) => ev.what === "deal");
}

// A private link to your track record, for a founder, co-investor or fund you choose
async function shareTrackPanel() {
  const box = $("#sharetrack"); if (!box) return;
  const { link } = await api("/api/me/record-link");
  box.innerHTML = `<div class="ph"><h3>Share your track record</h3><span class="small muted">${link ? "On" : "Off"}</span></div><div class="pb stack">
    <div class="small muted">A private link that shows your calls, the sector of each deal and how it turned out, with your hit rate next to the group's. Every call is dated and locked before anyone knows the outcome, so it is a record nobody can fake. <b>Company names, terms and money stay inside Stag Hunt.</b></div>
    ${link ? `<div class="keyline"><code>${esc(link)}</code><button class="link small" type="button" id="trackcopy">Copy</button></div>` : ""}
    <div class="row">${link ? `<a class="btn ghost sm" href="${esc(link)}" target="_blank" rel="noopener">See what they see</a><button class="link small" type="button" id="tracknew">New link</button><button class="link small" type="button" id="trackoff">Turn off</button>`
      : '<button class="btn sm" type="button" id="trackon">Make a link</button>'}</div>
    <div class="small muted">Every call you make is sealed into a chained record that nobody, Stag Hunt included, can change without it showing. <a href="/api/me/ledger" download>Download your record</a> and check it any time with the <a href="https://github.com/jpmanta/stag-hunt/blob/main/scripts/verify-record.mjs" target="_blank" rel="noopener">public checker</a>.</div>
  </div>`;
  const on = async () => { await api("/api/me/record-link", {}); shareTrackPanel(); };
  if ($("#trackon")) $("#trackon").onclick = on;
  if ($("#tracknew")) $("#tracknew").onclick = async () => { if (await ask("Make a new link? The old one stops working.", "New link")) on(); };
  if ($("#trackoff")) $("#trackoff").onclick = async () => { if (!(await ask("Turn off your link? Anyone you shared it with loses access."))) return; await api("/api/me/record-link/delete", {}); shareTrackPanel(); };
  if ($("#trackcopy")) $("#trackcopy").onclick = async () => { try { await navigator.clipboard.writeText(link); toast("Copied"); } catch { toast("Select it and copy"); } };
}

// A read-only key so your record flows into Excel, Google Sheets or your own tools
async function apiKeyPanel(fresh) {
  const box = $("#apikey"); if (!box) return;
  const { key } = fresh ? { key: null } : await api("/api/me/api-key");
  const base = location.origin + "/api/me/history";
  const k = fresh || "YOUR_KEY";
  const code = (t) => `<div class="keyline"><code>${esc(t)}</code><button class="link small" type="button" data-copy="${esc(t)}">Copy</button></div>`;
  box.innerHTML = `<div class="ph"><h3>Connect your own tools</h3><span class="small muted">Read-only. It can only read this page.</span></div><div class="pb stack">
    ${fresh ? `<div class="notice"><b>Your key.</b> Copy it now. It won't be shown again.${code(fresh)}</div>`
      : key ? `<div class="small muted">Key ending in <b>${esc(key.last4)}</b>, made ${date(key.created_at)}. ${key.last_used_at ? `Last used ${ago(key.last_used_at)}.` : "Not used yet."}</div>`
      : '<div class="small muted">Make a key to pull your record into a spreadsheet that updates itself.</div>'}
    ${fresh || key ? `<div class="small"><b>Google Sheets</b>: paste into a cell</div>${code(`=IMPORTDATA("${base}.csv?key=${k}")`)}
      <div class="small"><b>Excel</b>: Data, then From Web, and paste</div>${code(`${base}.csv?key=${k}`)}
      <div class="small faint">Google Sheets refreshes about once an hour. In Excel, press Refresh to pull the latest.</div>
      <div class="small"><b>Your own code</b></div>${code(`curl -H "Authorization: Bearer ${k}" ${base}`)}` : ""}
    <div class="row"><button class="btn sm" type="button" id="keymake">${key || fresh ? "Make a new key" : "Make a key"}</button>${key || fresh ? '<button class="link small" type="button" id="keydel">Turn off</button>' : ""}</div>
    ${key || fresh ? '<div class="small faint">Anyone with the key can read your record, so keep it like a password. A new key turns the old one off.</div>' : ""}
  </div>`;
  box.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast("Copied"); } catch { toast("Select it and copy"); } }));
  $("#keymake").onclick = async () => {
    if ((key || fresh) && !await ask("Make a new key? The old one stops working, so update anything that uses it.")) return;
    const r = await api("/api/me/api-key", {}); apiKeyPanel(r.key);
  };
  const del = $("#keydel");
  if (del) del.onclick = async () => { if (!(await ask("Turn off your key? Anything using it stops updating."))) return; await api("/api/me/api-key/delete", {}); apiKeyPanel(); };
}

// ------------------------------------------------------------ hunts
// A hunt is a group that shares deals. One account can be in many.
async function viewHunts(_, seq) {
  const { hunts, invites } = await api("/api/hunts");
  if (seq !== renderSeq) return;
  const people = (n) => `${n} member${n === 1 ? "" : "s"}`;
  $("#view").innerHTML = `
    <div class="pagehead"><div><h1>Hunts</h1></div></div>
    <div class="two">
      <div class="stack-lg">
        ${invites.length ? `<div class="panel"><div class="ph"><h3>Invites</h3></div><div class="list">${invites.map((i) => `
          <div style="display:block"><div class="row between"><b>${esc(i.name)}</b><span class="small faint">${people(i.members)} · from ${esc(i.invited_by)}</span></div>
            <div class="row" style="margin-top:8px"><button class="btn sm" data-join="${i.id}">Join</button><button class="btn ghost sm" data-decline="${i.id}">Decline</button></div></div>`).join("")}</div></div>` : ""}
        <div class="panel"><div class="ph"><h3>Your hunts</h3></div><div class="list">${hunts.length ? hunts.map((h) => `
          <a href="#/hunts/${h.id}"><span class="grow"><b>${esc(h.name)}</b> ${h.role === "lead" ? '<span class="pill">Lead</span>' : ""}</span>
            <span class="small faint">${people(h.members)} · ${h.deals} deal${h.deals === 1 ? "" : "s"}</span></a>`).join("")
          : emptyState("No hunts yet", "Start one with the people you already trade deals with, or accept an invite.")}</div></div>
      </div>
      <div class="panel"><div class="ph"><h3>Start a hunt</h3></div><div class="pb">
        <form id="huntform"><label>Name</label><input name="name" required maxlength="60" placeholder="The Tuesday table">
          <button class="btn block" type="submit">Start the hunt</button><div class="msg err"></div></form>
        <p class="small" style="margin-top:12px">A hunt is a group that shares deals. Start one with the people you already trade deals with, then invite them.</p>
        <p class="small muted">A deal is seen only by the hunt it's shared in. Not ready to share one yet? Start a hunt of your own, log the deal there, and invite people when the founder is ready.</p></div></div>
    </div>`;
  const hf = $("#huntform");
  hf.addEventListener("submit", (e) => { e.preventDefault(); submitting(hf, async () => { const r = await api("/api/hunts", formData(hf)); location.hash = "#/hunts/" + r.id; }); });
  const act = (sel, key, verb, done) => $$(sel).forEach((b) => (b.onclick = async () => { await api(`/api/hunts/${b.dataset[key]}/${verb}`, {}); toast(done); router(); }));
  act("[data-join]", "join", "join", "You're in");
  act("[data-decline]", "decline", "decline", "Invite declined");
  live(router, (ev) => ev.what === "hunts");
}

async function viewHunt(id, seq) {
  const { hunt, members, invites } = await api("/api/hunts/" + id);
  if (seq !== undefined && seq !== renderSeq) return;
  const lead = hunt.role === "lead";
  $("#view").innerHTML = `
    <div class="pagehead"><div><h1>${esc(hunt.name)}</h1><div class="small muted"><a href="#/hunts">Hunts</a> · ${members.length} member${members.length === 1 ? "" : "s"} · <a href="#/deals?hunt=${hunt.id}">${hunt.deals} deal${hunt.deals === 1 ? "" : "s"}</a></div></div>
      <div class="row hunt-acts">${lead ? '<button class="btn ghost sm" id="rename">Rename</button>' : ""}<button class="btn ghost sm" id="leave">Leave</button></div></div>
    <div class="two">
      <div class="panel"><div class="ph"><h3>Members</h3></div><div class="list">${members.map((m) => `
        <a href="#/members/${m.id}">${avatar(m.name, m.id)}<span class="grow"><b>${esc(m.name)}</b> ${m.role === "lead" ? '<span class="pill">Lead</span>' : ""}${m.headline ? `<div class="small faint">${esc(m.headline)}</div>` : ""}</span>
          <span class="small faint">since ${date(m.joined_at)}</span></a>`).join("")}</div></div>
      <div class="panel"><div class="ph"><h3>Invite someone</h3></div><div class="pb">
        <form id="invform"><label>Their email</label><input name="email" type="email" required placeholder="name@example.com">
          <button class="btn block" type="submit">Invite</button><div class="msg err"></div></form>
        <p class="small" style="margin-top:12px">Joining is their choice. Anyone in the hunt can invite.</p>
        ${invites.length ? `<div class="who" style="margin-top:12px">${invites.map((i) => `<div class="w row between"><span>${esc(i.name || i.email)}${i.name ? "" : ' <i class="faint">not on Stag Hunt yet</i>'}</span>
          <button class="link small" data-uninvite="${esc(i.email)}">Remove</button></div>`).join("")}</div>` : ""}</div></div>
    </div>`;
  const inv = $("#invform");
  inv.addEventListener("submit", (e) => { e.preventDefault(); submitting(inv, async () => {
    const r = await api(`/api/hunts/${id}/invite`, formData(inv));
    toast(r.member ? "Invite sent" : "They aren't on Stag Hunt yet. The invite will be waiting when they join."); router(); }); });
  $$("[data-uninvite]").forEach((b) => (b.onclick = async () => { await api(`/api/hunts/${id}/uninvite`, { email: b.dataset.uninvite }); router(); }));
  if (lead) $("#rename").onclick = async () => { const name = await askText("Hunt name", hunt.name); if (name && name.trim()) { await api("/api/hunts/" + id, { name }); router(); } };
  $("#leave").onclick = async () => {
    if (!(await ask(`Leave ${hunt.name}? Your record and the deals you brought stay yours.`))) return;
    await api(`/api/hunts/${id}/leave`, {}); toast("You left the hunt"); location.hash = "#/hunts"; };
  live(router, (ev) => ev.what === "hunts");
}

// ------------------------------------------------------------ admin
async function viewAdmin(_, seq) {
  if (state.me.role !== "admin") throw new Error("Admins only.");
  const { members } = await api("/api/members");
  if (seq !== renderSeq) return;
  $("#view").innerHTML = `
    <div class="pagehead"><div><h1>Manage members</h1></div></div>
    <div class="panel cohortpanel"><div class="pb">
      <div class="ctitle">Open to everyone</div>
      <div class="small muted" style="margin-top:4px">Anyone can make an account. Check sizes decide who sees which deal, and hunts are how members group themselves. Removing someone signs them out everywhere and keeps them out; their past deals and calls stay.</div>
    </div></div>
    <div class="adminhead row between">
      <h3>Members <span class="faint small">${members.length}</span></h3>
      <div class="row" style="gap:10px"><input id="msearch" type="search" placeholder="Search name or email" class="msearch"></div>
    </div>
    <div class="mlist">
      <div class="mhead"><span>Member</span><span>Role</span><span></span></div>
      ${members.map((m) => `<div class="mrow" data-q="${esc((m.name + " " + m.email).toLowerCase())}">
        <div class="mwho">${avatar(m.name, m.id)}<div><div class="co">${esc(m.name)}</div><div class="sub">${esc(m.email)}</div><div class="sub faint">Joined ${date(m.created_at)}</div></div></div>
        <div>${m.role === "admin" ? '<span class="pill">Admin</span>' : m.role === "observer" ? '<span class="pill">Observer</span>' : '<span class="small">Member</span>'}</div>
        <div class="macts2">${m.id === state.me.id ? '<span class="faint small">You</span>' : `
          ${m.role === "observer" ? `<button class="link small" data-role="${m.id}" data-to="member">Make member</button>`
            : `<button class="link small" data-role="${m.id}" data-to="${m.role === "admin" ? "member" : "admin"}">${m.role === "admin" ? "Make member" : "Make admin"}</button>
               <button class="link small" data-role="${m.id}" data-to="observer">Make observer</button>`}
          <button class="link small danger-link" data-remove="${m.id}" data-name="${esc(m.name)}">Remove</button>`}</div>
      </div>`).join("")}
      <div class="empty" id="mnone" hidden>No one matches that search.</div>
    </div>`;
  $("#msearch").oninput = (e) => { const q = e.target.value.trim().toLowerCase(); let n = 0;
    $$(".mrow").forEach((r) => { const hit = !q || r.dataset.q.includes(q); r.hidden = !hit; n += hit; }); $("#mnone").hidden = n > 0; };
  $$("[data-remove]").forEach((b) => (b.onclick = async () => { if (await ask(`Remove ${b.dataset.name} from Stag Hunt? They'll be signed out immediately.`)) await api("/api/admin/members/" + b.dataset.remove, { status: "removed" }); }));
  $$("[data-role]").forEach((b) => (b.onclick = async () => {
    if (b.dataset.to === "observer" && !await ask("Make them an observer? They'll be listed only as an observer and won't be able to post or make calls.")) return;
    await api("/api/admin/members/" + b.dataset.role, { role: b.dataset.to }); toast("Role updated");
  }));
  live(async () => { await loadPhotos(); router(); }, (ev) => ev.what === "members");
}

// ------------------------------------------------------------ profile
async function viewProfile() {
  const welcome = query().get("welcome"), me = state.me;
  const field = (name, label, val, attrs = "", hint = "") => `<div><label for="pf-${name}">${label}</label><input id="pf-${name}" name="${name}" value="${esc(val || "")}" ${attrs}>${hint ? `<div class="hint">${hint}</div>` : ""}</div>`;
  $("#view").innerHTML = `
    <div class="pagehead"><div><h1>${welcome ? "Tell the group who you are" : "Your profile"}</h1></div>${welcome ? "" : `<a class="small" href="#/members/${esc(me.id)}">View my profile →</a>`}</div>
    <form id="pform" class="stack-lg" style="max-width:720px">
      <div class="panel"><div class="ph"><h3>How you invest</h3></div><div class="pb pgrid">
        <div class="span2"><label for="pf-tier">Check size ($)</label><input id="pf-tier" name="tier" inputmode="decimal" maxlength="20" placeholder="Any amount, like 25,000" value="${money(me.tier)}">
          <div class="hint">Any amount. You'll see deals that take a check this size or smaller.</div></div>
        <div class="span2"><label for="pf-thesis">What you back</label><textarea id="pf-thesis" name="thesis" maxlength="400" rows="2" style="min-height:0" placeholder="e.g. Hardware companies that make factories cheaper to run. I pass on consumer apps.">${esc(me.thesis)}</textarea></div>
        <div class="span2">${field("focus", "Sectors", me.focus, 'maxlength="200" placeholder="Fintech, climate, developer tools"')}</div>
        <div class="span2"><label>How involved you like to be</label><div class="yesno three">${Object.entries(INVOLVEMENT).map(([k, l]) => `<label><input type="radio" name="involvement" value="${k}" ${me.involvement === k ? "checked" : ""}><span>${l}</span></label>`).join("")}</div></div>
      </div></div>
      <div class="panel"><div class="ph"><h3>About you</h3></div><div class="pb">
        <div class="photoedit">
          <span id="ph-preview">${avatar(me.name, me.id, "xl")}</span>
          <div class="row" style="gap:14px"><label class="link small" style="margin:0;cursor:pointer">${me.photo_at ? "Change photo" : "Add a photo"}<input type="file" id="ph-file" accept="image/*" hidden></label>
            ${me.photo_at ? '<button class="link small faint" type="button" id="ph-remove">Remove</button>' : ""}</div>
        </div>
        <div class="pgrid">
        ${field("name", "Name", me.name, 'required maxlength="80"')}
        ${field("headline", "Headline", me.headline, 'maxlength="120" placeholder="Founder, Acme · ex-Stripe"')}
        <div class="span2">${field("location", "Based in", me.location, 'maxlength="80" placeholder="Boston"')}</div>
        <div class="span2"><label for="pf-bio">About you</label><textarea id="pf-bio" name="bio" maxlength="1000" placeholder="A few lines: what you've built, what you know well, what you'd love to see.">${esc(me.bio)}</textarea></div>
        <div class="span2"><label for="pf-network">Networks you bring</label><textarea id="pf-network" name="network" maxlength="500" placeholder="Stanford CS, ex-Stripe, Boston biotech founders…" rows="2" style="min-height:0">${esc(me.network)}</textarea></div>
        ${field("linkedin", "LinkedIn", me.linkedin, 'maxlength="300" placeholder="linkedin.com/in/you" inputmode="url"')}
        ${field("twitter", "X", me.twitter, 'maxlength="120" placeholder="@you"')}
        <div class="span2">${field("website", "Website", me.website, 'maxlength="300" placeholder="you.com" inputmode="url"')}</div>
        </div>
      </div></div>
      <div class="row"><button class="btn" type="submit">${welcome ? "Save and continue" : "Save"}</button></div>
      <div class="msg err"></div>
    </form>
    <div class="panel settings" style="max-width:720px;margin-top:28px"><div class="ph"><h3>Sign-in and email</h3></div><div class="pb">
      <div class="setrow"><span>${Passkey.supported ? `Sign in with ${Passkey.name}` : "Face ID / Touch ID"}</span><span id="pklist" class="small"></span>${Passkey.supported ? '<button class="link small" id="pkadd" hidden>Turn on for this device</button>' : ""}</div>
      <label class="check"><input type="checkbox" id="n-deals" ${me.notify_deals ? "checked" : ""}> Email me new deals</label>
      <label class="check"><input type="checkbox" id="n-digest" ${me.notify_digest ? "checked" : ""}> Weekly digest on Mondays</label>
      <div class="setrow"><span class="small faint">See both emails as members get them</span><span class="row"><button class="link small" type="button" id="testmail">Send me a test</button><button class="link small" type="button" id="samplemail" title="A Monday digest filled with made-up numbers, to see every section">Send a sample</button></span></div>
      ${me.demo ? "" : `<div class="setrow"><span class="small faint">Investor statement: ${me.accredited == null ? "not made yet" : me.accredited === "none" ? "not accredited" : "accredited"}</span><button class="link small" type="button" data-statement>${me.accredited == null ? "Make it" : "Update"}</button></div>`}
      <div class="setrow"><span class="small faint">${esc(me.email)}</span><button class="link small" type="button" id="logout">Sign out</button></div>
      <div class="setrow"><span class="small faint">Questions, a problem, or something to report?</span><span class="row"><a class="link small" href="/contact/">Contact support</a><a class="link small" href="/terms/">Terms</a></span></div>
      <div class="setrow"><span class="small faint">Delete your account and everything in it</span><button class="link small" type="button" id="delacct">Delete account</button></div>
    </div></div>`;

  // photo: resize to a 320px square JPEG in the browser, then upload
  $("#ph-file").onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
      const side = Math.min(img.naturalWidth, img.naturalHeight), c = document.createElement("canvas"); c.width = c.height = 320;
      c.getContext("2d").drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 320, 320);
      const r = await api("/api/me/photo", { photo: c.toDataURL("image/jpeg", 0.86) });
      me.photo_at = r.photo_at; state.photos = { ...(state.photos || {}), [me.id]: r.photo_at }; toast("Photo updated"); viewProfile();
    } catch (err) { toast(err.message || "That photo didn't work. Try another."); }
  };
  $("#ph-remove")?.addEventListener("click", async () => { await api("/api/me/photo", { remove: true }); me.photo_at = null; delete state.photos[me.id]; toast("Photo removed"); viewProfile(); });

  const saveN = async () => {
    const body = { notify_deals: $("#n-deals").checked, notify_digest: $("#n-digest").checked };
    await api("/api/me/notifications", body); Object.assign(me, body); toast("Email settings saved");
  };
  $("#n-deals").onchange = saveN; $("#n-digest").onchange = saveN;
  $("#samplemail").onclick = async (e) => {
    e.target.disabled = true;
    try { const r = await api("/api/me/test-email", { sample: true }); toast(`Sent a sample digest to ${r.to}`); }
    catch (err) { toast(err.message || "The sample didn't send."); }
    finally { setTimeout(() => (e.target.disabled = false), 30000); }
  };
  $("#testmail").onclick = async (e) => {
    e.target.disabled = true;
    try { const r = await api("/api/me/test-email", {}); toast(`Sent two test emails to ${r.to}`); }
    catch (err) { toast(err.message || "The test email didn't send."); }
    finally { setTimeout(() => (e.target.disabled = false), 30000); }
  };
  const loadPk = async () => {
    const { passkeys } = await api("/api/passkeys");
    $("#pklist").innerHTML = passkeys.length ? passkeys.map((k) => `<span class="pk">${esc(k.name || "Device")} <button class="link small faint" data-pkdel="${k.id}" title="Turn off for ${esc(k.name || "this device")}" aria-label="Turn off for ${esc(k.name || "this device")}">×</button></span>`).join("") : '<span class="faint">Off</span>';
    $$("[data-pkdel]").forEach((b) => (b.onclick = async () => { if (await ask(`Turn off ${b.title.replace("Turn off for ", "")} sign-in? You can still sign in by email.`)) { await api(`/api/passkeys/${b.dataset.pkdel}/delete`, {}); loadPk(); } }));
    // Offer it for this device unless this device already has one
    if ($("#pkadd")) $("#pkadd").hidden = Passkey.here() && passkeys.length > 0;
  };
  loadPk();
  $("#pkadd")?.addEventListener("click", async () => { try { await Passkey.setUp(); toast(`Done. Next time, sign in with ${Passkey.name}.`); loadPk(); } catch (e) { toast(e.message); } });
  const pf = $("#pform");
  pf.addEventListener("submit", (e) => { e.preventDefault(); submitting(pf, async () => {
    const r = await api("/api/me", formData(pf));
    Object.assign(state.me, r.user); renderMe(); toast("Profile saved");
    if (welcome) location.hash = "#/";
  }); });
  $("#logout").onclick = async () => { await api("/api/auth/logout", {}); location.replace("/"); };
  $("#delacct").onclick = async () => {
    if (!(await ask("Delete your Stag Hunt account now? Your profile, calls, investments, notes and sign-ins are deleted right away, and this can't be undone. Deals you brought stay for your hunt, shown as from a former member."))) return;
    await api("/api/me/delete", {}); toast("Your account is deleted."); setTimeout(() => location.replace("/"), 900);
  };
}

// ------------------------------------------------------------ text boxes: fit to their text, and voice dictation
// Every text box grows to show all its text (up to its max-height), so nothing is hidden or cut off
function fitArea(t) {
  if (!t || t.tagName !== "TEXTAREA" || t.classList.contains("nofit") || !t.offsetParent) return;
  const max = parseFloat(getComputedStyle(t).maxHeight) || Infinity;
  t.style.height = "auto";
  const h = t.scrollHeight + (t.offsetHeight - t.clientHeight);
  t.style.height = Math.min(h, max) + "px";
  t.style.overflowY = h > max ? "auto" : "hidden";
}
function fitAll() { document.querySelectorAll("#view textarea").forEach(fitArea); }
document.addEventListener("input", (e) => fitArea(e.target));
window.addEventListener("resize", () => { clearTimeout(fitAll._t); fitAll._t = setTimeout(fitAll, 120); });
document.fonts && document.fonts.ready.then(fitAll);
document.addEventListener("toggle", fitAll, true);   // textareas inside <details> that just opened
{ let t; new MutationObserver(() => { clearTimeout(t); t = setTimeout(fitAll, 60); }).observe(document.getElementById("view"), { childList: true, subtree: true }); }

(function dictation() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  // no mic where speech-to-text isn't available, or inside the iPhone app: the app can't use the web
  // speech service, and the iPhone keyboard already has its own dictation key
  if (!SR || /StagHuntApp/.test(navigator.userAgent)) return;
  const MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
  let active = null;
  function start(field, btn) {
    if (active) { const was = active.btn; active.rec.stop(); if (was === btn) return; }
    const rec = new SR();
    rec.lang = navigator.language || "en-US"; rec.continuous = true; rec.interimResults = true;
    const base = field.value; let finalText = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t; else interim += t;
      }
      const spoken = (finalText + interim).replace(/\s+/g, " ").trim();
      const said = spoken ? spoken.charAt(0).toUpperCase() + spoken.slice(1) : "";
      field.value = (base.trim() ? base.replace(/\s*$/, " ") : "") + said;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    };
    rec.onerror = (e) => { if (e.error === "not-allowed" || e.error === "service-not-allowed") toast("Dictation is blocked. Allow the microphone for staghunts.com, or use the mic key on your keyboard."); };
    rec.onend = () => { btn.classList.remove("on"); btn.setAttribute("aria-label", "Dictate"); if (active && active.rec === rec) active = null; };
    try { rec.start(); } catch { return; }
    active = { rec, btn };
    btn.classList.add("on"); btn.setAttribute("aria-label", "Stop dictating");
    field.focus();
  }
  function enhance(root) {
    root.querySelectorAll('textarea, input:not([type]), input[type="text"], input[type="search"]').forEach((field) => {
      if (field.dataset.dict || field.closest(".dict")) return;
      field.dataset.dict = "1";
      const wrap = document.createElement("span");
      wrap.className = "dict" + (field.tagName === "TEXTAREA" ? " area" : "");
      // the wrapper takes the field's place in any grid/flex layout, so the field keeps its full width
      const cs = getComputedStyle(field);
      if (cs.gridColumnStart !== "auto" || cs.gridColumnEnd !== "auto") wrap.style.gridColumn = `${cs.gridColumnStart} / ${cs.gridColumnEnd}`;
      if (cs.flexGrow !== "0") wrap.style.flex = `${cs.flexGrow} ${cs.flexShrink} ${cs.flexBasis}`;
      field.parentNode.insertBefore(wrap, field); wrap.appendChild(field);
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "micbtn"; btn.innerHTML = MIC; btn.setAttribute("aria-label", "Dictate"); btn.title = "Dictate with your voice";
      btn.addEventListener("mousedown", (e) => e.preventDefault());   // keep focus in the field
      btn.addEventListener("click", () => start(field, btn));
      wrap.appendChild(btn);
    });
  }
  let t;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => enhance(document.getElementById("view")), 60); })
    .observe(document.getElementById("view"), { childList: true, subtree: true });
  addEventListener("hashchange", () => { if (active) active.rec.stop(); });
})();

// ------------------------------------------------------------ phones: behave like an app, not a web page
(function phone() {
  const root = document.documentElement;
  const inApp = /StagHuntApp/.test(navigator.userAgent);
  if (inApp) root.classList.add("inapp");
  // While the keyboard is up, the tab bar and the Yes/No bar step aside so the field has the room
  const typing = (el) => el && el.matches && el.matches('textarea, input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]):not([type=button]):not([type=submit])');
  const touch = matchMedia("(hover: none) and (pointer: coarse)");
  let t;
  addEventListener("focusin", (e) => { if (touch.matches && typing(e.target)) { clearTimeout(t); root.classList.add("kb"); } });
  addEventListener("focusout", () => { clearTimeout(t); t = setTimeout(() => { if (!typing(document.activeElement)) root.classList.remove("kb"); }, 120); });
  // Files (your record, the Excel sheet): the iPhone app can't "download", so hand the file to the share sheet instead
  document.addEventListener("click", async (e) => {
    const a = e.target.closest && e.target.closest("a[download]");
    if (!a || !inApp || !navigator.canShare) return;
    e.preventDefault();
    try {
      const res = await fetch(a.href, { credentials: "same-origin" });
      if (!res.ok) throw new Error("Couldn't get the file. Try again.");
      const blob = await res.blob();
      const named = /filename="?([^";]+)/.exec(res.headers.get("content-disposition") || "");
      const name = (named && named[1]) || a.getAttribute("download") || a.pathname.split("/").pop() || "stag-hunt";
      const file = new File([blob], name, { type: blob.type || "application/octet-stream" });
      if (!navigator.canShare({ files: [file] })) throw new Error("Open staghunts.com in Safari to save this file.");
      await navigator.share({ files: [file] });
    } catch (err) { if (err.name !== "AbortError") toast(err.message); }
  });
})();

// ------------------------------------------------------------ custom dropdowns (native menus can't be styled)
(function customSelects() {
  function closeAll(except) { document.querySelectorAll(".cs.open").forEach((w) => w !== except && w._close && w._close()); }
  function build(sel) {
    if (sel.dataset.cs) return;
    sel.dataset.cs = "1";
    const wrap = document.createElement("span");
    wrap.className = "cs" + (sel.id === "status" || sel.style.width === "auto" ? " inline" : "");
    sel.parentNode.insertBefore(wrap, sel); wrap.appendChild(sel);
    sel.classList.add("cs-native"); sel.tabIndex = -1; sel.setAttribute("aria-hidden", "true");
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "cs-btn"; btn.setAttribute("aria-haspopup", "listbox"); btn.setAttribute("aria-expanded", "false");
    if (sel.getAttribute("aria-label")) btn.setAttribute("aria-label", sel.getAttribute("aria-label"));
    else if (sel.id && document.querySelector(`label[for="${sel.id}"]`)) document.querySelector(`label[for="${sel.id}"]`).htmlFor = "";
    const menu = document.createElement("div");
    menu.className = "cs-menu"; menu.setAttribute("role", "listbox"); menu.hidden = true;
    wrap.append(btn, menu);
    const sync = () => { btn.textContent = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : ""; };
    let focusIdx = 0;
    const paint = () => menu.querySelectorAll(".cs-opt").forEach((el, i) => el.classList.toggle("kb", i === focusIdx));
    const choose = (i) => { sel.selectedIndex = i; sync(); close(); btn.focus(); sel.dispatchEvent(new Event("change", { bubbles: true })); };
    const open = () => {
      closeAll(wrap);
      menu.innerHTML = [...sel.options].map((o, i) => `<div role="option" class="cs-opt${i === sel.selectedIndex ? " on" : ""}" data-i="${i}" aria-selected="${i === sel.selectedIndex}">${esc(o.text)}</div>`).join("");
      menu.querySelectorAll(".cs-opt").forEach((el) => { el.onclick = () => choose(+el.dataset.i); el.onmouseenter = () => { focusIdx = +el.dataset.i; paint(); }; });
      focusIdx = Math.max(0, sel.selectedIndex); paint();
      menu.hidden = false; wrap.classList.add("open"); btn.setAttribute("aria-expanded", "true");
    };
    const close = () => { menu.hidden = true; wrap.classList.remove("open"); btn.setAttribute("aria-expanded", "false"); };
    btn.addEventListener("click", (e) => { e.stopPropagation(); menu.hidden ? open() : close(); });
    btn.addEventListener("keydown", (e) => {
      const n = sel.options.length;
      if (["ArrowDown", "ArrowUp"].includes(e.key)) { e.preventDefault(); if (menu.hidden) open(); else { focusIdx = (focusIdx + (e.key === "ArrowDown" ? 1 : n - 1)) % n; paint(); } }
      else if ((e.key === "Enter" || e.key === " ") && !menu.hidden) { e.preventDefault(); choose(focusIdx); }
      else if (e.key === "Escape" || e.key === "Tab") close();
    });
    sel.addEventListener("change", sync);
    wrap._close = close;
    sync();
  }
  document.addEventListener("click", (e) => { if (!e.target.closest(".cs")) closeAll(); });
  let t;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => document.querySelectorAll("#view select").forEach(build), 40); })
    .observe(document.getElementById("view"), { childList: true, subtree: true });
})();

// ------------------------------------------------------------ help (Nov 26)
// Short answers for investors who forget a step and don't want the video. "Show me" opens the page
// and points at the thing to click. Every answer restates what the app does; no promises (Nov 24 rule).
const HELP = [
  { q: "Why can't I see any deals?", a: "Deals show to members who have made an investor statement saying they're accredited. New accounts see deals 30 days after the statement. You only see deals whose smallest check is at or below your check size, and only deals shared in a hunt you're in.", go: "#/profile", at: "[data-statement]", btn: "Show me my statement" },
  { q: "How do I make a call on a deal?", a: "Open a deal from Home or Deals. Under Want to meet the team, pick Yes or No, say whether you've met the founders, and write one line on why. Then submit.", go: "#/deals", at: "tr[data-id], .list a, .empty .btn", btn: "Show me the deals" },
  { q: "Can I change my call?", a: "No. A call locks once you submit it, so everyone's first read stays their own. You see the others' calls only after you make yours." },
  { q: "How do I meet the founders?", a: "On the deal page, below your call, use the button that asks the member who brought the deal for an intro. That sends them your email address.", go: "#/deals", at: "tr[data-id], .list a", btn: "Show me the deals" },
  { q: "How do I invest?", a: "If the company shared its own invest link, the deal page has an Invest button. You invest straight with the company. Stag Hunt never holds or moves money. If there's no button, ask the member who brought the deal." },
  { q: "How do I share a deal?", a: "Click Share a deal. Fill in what the company does, where it is today, and the round. It goes to your hunt.", go: "#/deals/new", at: "#view form input, #view form textarea", btn: "Show me" },
  { q: "What is a hunt?", a: "A group that shares deals. You start in the first hunt. You can start your own and invite people by email; joining and leaving are always each person's choice.", go: "#/hunts", at: "#huntform input[name=name]", btn: "Show me" },
  { q: "How do I change my check size?", a: "In your profile, under How you invest. You see deals that take a check that size or smaller. Leave it empty to see every check size.", go: "#/profile", at: "#pf-tier", btn: "Show me" },
  { q: "How do I change my emails?", a: "In your profile, under Sign-in and email, you choose whether to get new-deal emails and the Monday digest.", go: "#/profile", at: "#n-deals", btn: "Show me" },
  { q: "What does Your record show?", a: "Every deal you bring, every call you make, and every check you log. When outcomes are known, it can show how your calls turned out.", go: "#/history", at: "#view h1", btn: "Show me" },
  { q: "Something's wrong with a deal or a member", a: "Use the Report link next to any deal, call, update or member. It emails the admins. You can also block a member from their page; you stop seeing what they post." },
];
async function viewHelp() {
  const groups = [["Getting in", [0, 7, 8]], ["Deals", [1, 2, 3, 4]], ["Sharing and hunts", [5, 6]], ["Your account", [9, 10]]];
  const row = (i) => { const h = HELP[i]; return `<details class="helpq" data-i="${i}"><summary><span>${esc(h.q)}</span><i aria-hidden="true"></i></summary><div class="helpa"><p>${esc(h.a)}</p>${h.go ? `<button class="btn sm ghost" type="button" data-showme="${i}">${esc(h.btn)} →</button>` : ""}</div></details>`; };
  $("#view").innerHTML = `<div class="helpwrap">
    <div class="helphead"><h1>Need help?</h1><p class="muted">Quick answers to the usual questions. Show me takes you to the spot.</p>
      <div class="helpsearch"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg><input type="search" id="helpq" placeholder="Search help, like invest" aria-label="Search help" autocomplete="off"></div></div>
    ${groups.map(([t, ids]) => `<section class="helpgroup"><div class="helplabel">${t}</div><div class="panel helplist">${ids.map(row).join("")}</div></section>`).join("")}
    <p class="small muted helpnone" hidden>Nothing matches. Try another word, or <a href="/contact/">contact support</a>.</p>
    <div class="helpmore">
      <a class="panel" href="/learn/how-it-works/walkthrough-investors.mp4" target="_blank" rel="noopener"><b>Prefer to watch?</b><span>A short walkthrough of the whole app.</span></a>
      <a class="panel" href="/contact/"><b>Still stuck?</b><span>Send us a note through Contact support.</span></a>
    </div></div>`;
  const q = $("#helpq"), items = $$(".helpq");
  q.addEventListener("input", () => {
    const words = q.value.toLowerCase().split(/\s+/).filter(Boolean); let shown = 0;
    items.forEach((d) => { const h = HELP[d.dataset.i], t = (h.q + " " + h.a).toLowerCase(); const ok = words.every((w) => t.includes(w)); d.hidden = !ok; if (ok) shown++; if (words.length) d.open = ok && shown === 1; });
    $$(".helpgroup").forEach((g) => (g.hidden = !$$(".helpq", g).some((d) => !d.hidden)));
    $(".helpnone").hidden = shown > 0;
  });
  $$("[data-showme]").forEach((b) => (b.onclick = () => showMe(HELP[b.dataset.showme])));
}
function showMe(h) {
  location.hash = h.go;
  let tries = 0;
  const look = () => {
    const el = h.at.split(",").map((s) => document.querySelector("#view " + s.trim().replace(/^#view /, ""))).find(Boolean);
    if (!el) { if (++tries < 30) return setTimeout(look, 100); return; }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("hl-pulse"); void el.offsetWidth; el.classList.add("hl-pulse");
    setTimeout(() => el.classList.remove("hl-pulse"), 4200);
  };
  setTimeout(look, 150);
}

// ------------------------------------------------------------ investor statement
// Deals go only to people who say they're accredited and will keep deals confidential; accounts made
// after sign-up opened wait 30 days. The exact wording comes from the server and is kept with each statement.
// One short welcome: who you are, then the investor statement (which carries the house rules and terms),
// then a clear word on what happens next. People who only need the statement see just that step.
function showStatement(canClose = false) {
  return new Promise(async (resolve) => {
    const st = await api("/api/statement");
    const me = state.me, isNew = me.accredited == null && !me.terms_accepted_at;
    const titles = { income: "Income", net_worth: "Net worth", license: "License", entity: "Through an entity", none: "Not accredited" };
    const steps = isNew ? 2 : 1;
    const linked = (t) => esc(t).replace("house rules", '<a href="/terms/#rules" target="_blank">house rules</a>')
      .replace("Terms of Service", '<a href="/terms/" target="_blank">Terms of Service</a>').replace("Privacy Policy", '<a href="/privacy/" target="_blank">Privacy Policy</a>');
    const progress = (n) => steps > 1 ? `<div class="ststeps" aria-label="Step ${n} of ${steps}">${[1, 2].map((i) => `<i class="${i <= n ? "on" : ""}"></i>`).join("")}</div>` : "";
    const o = document.createElement("div");
    o.className = "terms-overlay stwrap";
    o.innerHTML = `<div class="terms-card stcard" role="dialog" aria-modal="true" aria-labelledby="st-h">
      ${isNew ? `<form id="st-you" class="ststep">
        ${progress(1)}
        <div class="tag">Welcome to Stag Hunt</div>
        <h2 id="st-h">Who are you?</h2>
        <p class="stlead">Two short steps and you're in. Members see your name next to the deals you bring and the calls you make.</p>
        <label for="st-name">Your name</label><input id="st-name" name="name" required maxlength="80" autocomplete="name" value="${esc(me.name && !me.email.startsWith(me.name + "@") ? me.name : "")}">
        <label for="st-tier">Largest check you'd write <span class="faint">(optional)</span></label><input id="st-tier" name="tier" inputmode="decimal" maxlength="20" placeholder="Any amount, like 25,000" value="${me.tier ? esc(String(me.tier)) : ""}">
        <div class="hint">You'll see deals that take a check this size or smaller. Leave it empty to see every deal.</div>
        <button class="btn block" type="submit">Continue</button>
        <button class="link small stclose st-out" type="button">Sign out</button>
        <div class="msg err"></div>
      </form>` : ""}
      <form id="st-form" class="ststep" ${isNew ? "hidden" : ""}>
        ${progress(2)}
        <div class="tag">Investor statement</div>
        <h2 ${isNew ? "" : 'id="st-h"'}>One step before deals</h2>
        <p class="stlead">Founders share their rounds here in confidence, and the law lets them share only with accredited investors.</p>
        <div class="stq">Which is true for you?</div>
        <div class="stopts" role="radiogroup">${Object.entries(st.bases).map(([k, t]) => `<label class="stopt"><input type="radio" name="basis" value="${k}" ${me.accredited === k ? "checked" : ""} required><span class="stmark"></span><span class="sttxt"><b>${esc(titles[k] || k)}</b><span>${esc(t)}</span></span></label>`).join("")}</div>
        <p class="stnone" hidden>You can still bring deals, start hunts and build your record. You won't see other members' deals until you're accredited.</p>
        <div class="stq">And you agree</div>
        <div class="stopts stpromises">${st.promises.map((t, i) => `<label class="stopt"><input type="checkbox" data-i="${i}" required><span class="stmark sq"></span><span class="sttxt"><span>${linked(t)}</span></span></label>`).join("")}</div>
        <button class="btn block" type="submit">${isNew ? "Join Stag Hunt" : "Save my statement"}</button>
        ${isNew ? '<button class="link small stclose" type="button" id="st-back">Back</button>' : canClose ? '<button class="link small stclose" type="button" id="st-close">Not now</button>' : '<button class="link small stclose" type="button" data-x="st-out">Sign out</button>'}
        <div class="msg err"></div>
      </form>
      <div id="st-done" class="ststep" hidden></div>
    </div>`;
    document.body.appendChild(o);
    const card = o.querySelector(".stcard"), you = o.querySelector("#st-you"), f = o.querySelector("#st-form"), done = o.querySelector("#st-done");
    const show = (el) => { for (const s of card.querySelectorAll(".ststep")) s.hidden = s !== el; o.scrollTop = 0; el.querySelector("input,button")?.focus({ preventScroll: true }); };
    const busy = async (form, work) => {
      const go = form.querySelector("button[type=submit]"), msg = form.querySelector(".msg");
      go.disabled = true; msg.textContent = "";
      try { await work(); } catch (err) { msg.textContent = err.message; } finally { go.disabled = false; }
    };
    if (you) {
      you.onsubmit = (e) => { e.preventDefault(); busy(you, async () => { state.me = (await api("/api/me/basics", { name: you.name.value, tier: you.tier.value })).user; renderMe(); show(f); }); };
      o.querySelector("#st-back").onclick = () => show(you);
      setTimeout(() => you.name.focus(), 50);
    }
    if (canClose && !isNew) o.querySelector("#st-close").onclick = () => { o.remove(); resolve(false); };
    // Anyone can leave before finishing, including Apple's reviewer
    for (const b of o.querySelectorAll('.st-out, [data-x="st-out"]')) b.onclick = async () => { await api("/api/auth/logout", {}); location.replace("/login"); };
    f.addEventListener("change", () => (o.querySelector(".stnone").hidden = f.basis.value !== "none"));
    f.onsubmit = (e) => {
      e.preventDefault();
      busy(f, async () => {
        state.me = (await api("/api/me/statement", { basis: f.basis.value, agree: [...f.querySelectorAll("[data-i]")].map((c) => c.checked) })).user;
        if (!isNew) { o.remove(); resolve(true); return; }
        const when = state.me.deals_open_at && new Date(state.me.deals_open_at * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric" });
        done.innerHTML = `<div class="tag">You're in</div>
          <h2>Welcome, ${esc(state.me.name.split(" ")[0])}.</h2>
          <p class="stlead">${dealsOpen() ? "Deals are open to you now." : state.me.accredited === "none"
            ? "You can bring deals, start a hunt and build your record. Deals from other members are for accredited investors."
            : `Deals open for you on <b>${when}</b>. The 30-day wait keeps founders' rounds private and lawful.`}</p>
          <ul class="stnext"><li><b>Bring a deal</b> when you meet a founder worth backing.</li><li><b>Start a hunt</b> with the people you already trade deals with.</li>${dealsOpen() ? "<li><b>Make your calls</b>, yes or no with a line on why. Your record is yours.</li>" : "<li><b>Fill in your profile</b>, so members know who they're hunting with.</li>"}</ul>
          <button class="btn block" type="button" id="st-enter">Enter Stag Hunt</button>`;
        show(done);
        done.querySelector("#st-enter").onclick = () => { o.remove(); resolve(true); };
      });
    };
  });
}
// One quiet empty state everywhere: a short serif line, one sentence, at most one next step.
const emptyState = (title, line = "", action = "") => `<div class="empty"><div class="et">${title}</div>${line ? `<p>${line}</p>` : ""}${action}</div>`;
const dealsOpenOn = () => state.me.deals_open_at ? new Date(state.me.deals_open_at * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric" }) : "";
const noDealsYet = (observer) => dealsOpen() ? emptyState("No deals yet", "When a member meets a founder worth backing, it shows up here.", observer ? "" : '<a class="btn sm" href="#/deals/new">Share the first one</a>')
  : emptyState("Deals will show here", state.me.accredited === "none" ? "Deals are for accredited investors. You can still bring deals and start hunts." : `They open for you on ${dealsOpenOn()}. Until then, bring a deal or start a hunt.`);
const dealsOpen = () => state.me.deals_open_at !== null && state.me.deals_open_at * 1000 <= Date.now();
function dealGate() {
  if (dealsOpen()) return "";
  const me = state.me, again = '<button class="link" type="button" data-statement>Update your statement</button>';
  const when = me.deals_open_at && new Date(me.deals_open_at * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric" });
  const msg = me.accredited == null ? `<b>Fill in your investor statement to see deals.</b> It takes a minute. <button class="link" type="button" data-statement>Start</button>`
    : me.accredited === "none" ? `<b>Deals are only for accredited investors.</b> You can still bring deals, start hunts and build your profile. If that changes, ${again}.`
    : `<b>Deals open for you on ${when}.</b> New accounts wait 30 days after their statement, which keeps founders' rounds private. You can bring deals and start hunts now.`;
  return `<div class="notice nudge">${msg}</div>`;
}
document.addEventListener("click", async (e) => { if (e.target.closest("[data-statement]") && await showStatement(true)) router(); });

// ------------------------------------------------------------ boot
(async function boot() {
  const r = await fetch("/api/me", { credentials: "same-origin" });
  if (!r.ok) { location.replace("/login"); return; }
  state.me = (await r.json()).user;
  document.body.classList.toggle("observer", state.me.role === "observer");
  if (!state.me.demo && (state.me.accredited == null || !state.me.terms_accepted_at)) await showStatement();
  $("#app").hidden = false;
  renderMe();
  $("#menu").onclick = () => $("#app").classList.toggle("menu");
  $(".mainwrap").addEventListener("click", (e) => { if ($("#app").classList.contains("menu") && !e.target.closest("#more")) { $("#app").classList.remove("menu"); e.preventDefault(); } }, true);
  window.addEventListener("hashchange", router);
  connect();
  await loadPhotos();
  router();
})();

// ------------------------------------------------------------ a founder's pitch, recorded
// Two ways in: send the founder a link and they pitch on their own phone, or put
// your phone on the table while you talk. Either way the audio is never saved
// (public/recorder.js) and the deal drafts itself from what was said.
const REC_QUESTIONS = ["Who pays, and how much", "Their numbers so far", "How they get customers", "Who else solves this", "What they'd own if they win", "The flywheel", "Their next goal", "What's blocking it"];
const pitchMessage = (url) => `Could you pitch me out loud? Open this on your phone and talk for ten minutes or so, whenever suits you: ${url}`;

function viewRecord() {
  const v = $("#view");
  if (state.me.role === "observer") { v.innerHTML = '<div class="empty">Observers can read but not post.</div>'; return; }
  const canRecord = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.AudioWorkletNode);
  v.innerHTML = `
    <div class="pagehead"><div><h1>Hear a founder's pitch</h1></div></div>
    <div class="stack-lg" style="max-width:640px">
      <p>The founder talks, and the deal fills itself in from what they said. You check it, make your call, and post.</p>

      <div class="panel"><div class="ph"><h3>Send the founder a link</h3></div><div class="pb">
        <p class="small" style="margin:0 0 14px">They open it on their phone and pitch out loud, whenever suits them. You get an email when it's in.</p>
        <form id="linkform" class="stack">
          <div class="field"><label for="f-founder">Who is it for?</label><input id="f-founder" name="founder" maxlength="80" placeholder="Founder's name"></div>
          <div class="row"><button class="btn" type="submit">Make a link</button></div>
          <div class="msg err"></div>
        </form>
        <div id="links"></div>
      </div></div>

      <div class="panel"><div class="ph"><h3>Sitting with the founder?</h3></div><div class="pb">
        <p class="small" style="margin:0 0 14px">Put your phone on the table and talk.</p>
        ${canRecord ? `<form id="recform" class="stack">
          <label class="check"><input type="checkbox" name="consent" required>The founder knows I'm recording and agreed.</label>
          <div class="row"><button class="btn" type="submit">Start recording</button><a class="btn ghost" href="#/deals/new">Fill it in by hand</a></div>
          <div class="msg err"></div>
        </form>` : `<div class="notice">This browser can't record. Open staghunts.com in Safari or Chrome on your phone, or <a href="#/deals/new">fill the deal in by hand</a>.</div>`}
      </div></div>

      <div class="panel"><div class="ph"><h3>How it works</h3></div><div class="pb rec-terms">
        <p><b>The founder agrees first.</b> A founder with a link agrees on their own screen before anything records. In person, tell them you're recording, and why: recording someone without consent is illegal in many states, including Massachusetts.</p>
        <p><b>The audio is never saved.</b> Each minute is turned into text as it goes, then the sound is thrown away.</p>
        <p><b>Only you can see the transcript.</b> It's deleted when you post the deal, or after 7 days. Links expire after 7 days too.</p>
        <p><b>AI drafts the answers, and it can be wrong.</b> It can mishear names and numbers, so check every answer before you post. It never makes a call on the deal; your call stays yours.</p>
        <p><b>Keep the page open and the phone unlocked.</b> Locking the phone or switching apps pauses the recording.</p>
      </div></div>
    </div>`;

  const rec = $("#recform");
  if (rec) rec.addEventListener("submit", (e) => {
    e.preventDefault();
    submitting(rec, async () => {
      if (!rec.consent.checked) throw new Error("Confirm the founder knows you're recording and agreed.");
      await startRecorder();
    });
  });
  const lf = $("#linkform");
  lf.addEventListener("submit", (e) => {
    e.preventDefault();
    submitting(lf, async () => {
      const { id } = await api("/api/rec/links", { founder: lf.founder.value.trim() });
      lf.reset();
      await showLinks(id);
    });
  });
  showLinks();
}

async function showLinks(fresh) {
  const box = $("#links");
  if (!box) return;
  let links;
  try { ({ links } = await api("/api/rec/links")); } catch (e) { box.innerHTML = `<div class="msg err">${esc(e.message)}</div>`; return; }
  if (!links.length) { box.innerHTML = ""; return; }
  const left = (l) => { const d = Math.ceil((l.expires_at - Date.now() / 1000) / 86400); return d <= 1 ? "expires today" : `expires in ${d} days`; };
  const status = (l) => l.done_at ? `<span class="pill hit">Pitch in</span> <span class="small muted">${l.minutes} min · ${ago(l.done_at)}</span>`
    : l.started ? `<span class="pill">Recording</span> <span class="small muted">${left(l)}</span>`
    : `<span class="pill">Waiting</span> <span class="small muted">${left(l)}</span>`;
  box.innerHTML = `<div class="pitchlinks">${links.map((l) => `
    <div class="pitchlink${l.id === fresh ? " fresh" : ""}" data-id="${esc(l.id)}">
      <div class="pitchlink-top"><b>${esc(l.founder || "A founder")}</b><span>${status(l)}</span></div>
      ${l.done_at ? "" : `<div class="pitchlink-url"><input readonly data-dict="1" value="${esc(l.url)}" aria-label="Link for ${esc(l.founder || "the founder")}"></div>`}
      <div class="row">
        ${l.done_at ? `<button class="btn sm" type="button" data-act="draft">Draft the deal</button>`
          : `${navigator.share ? `<button class="btn sm" type="button" data-act="share">Send</button>` : ""}<button class="btn sm ${navigator.share ? "ghost" : ""}" type="button" data-act="copy">Copy</button>`}
        <button class="link small" type="button" data-act="remove">Remove</button>
      </div>
      <div class="msg err"></div>
    </div>`).join("")}</div>`;
  box.onclick = async (e) => {
    const b = e.target.closest("button[data-act]"); if (!b) return;
    const row = b.closest(".pitchlink"), l = links.find((x) => x.id === row.dataset.id), msg = $(".msg", row);
    msg.textContent = "";
    const act = b.dataset.act;
    if (act === "share") { try { await navigator.share({ text: pitchMessage(l.url) }); } catch {} }
    if (act === "copy") {
      try { await navigator.clipboard.writeText(pitchMessage(l.url)); toast("Copied, with a short note. Paste it into a text or email."); }
      catch { const i = $("input", row); i.select(); toast("Select the link and copy it."); }
    }
    if (act === "remove") {
      if (!(await ask(l.done_at ? "Remove this pitch and delete its transcript?" : "Remove this link? It stops working right away."))) return;
      try { await api(`/api/rec/${l.id}/delete`, {}); showLinks(); } catch (err) { msg.textContent = err.message; }
    }
    if (act === "draft") {
      b.disabled = true; b.textContent = "Drafting…";
      try {
        const r = await api(`/api/rec/${l.id}/draft`, {});
        sessionStorage.setItem("recDraft", JSON.stringify({ rec_id: l.id, founder: l.founder || "", link: true, draft: r.draft, transcript: r.transcript, truncated: r.truncated, gaps: 0 }));
        location.hash = "#/deals/new";
      } catch (err) { msg.textContent = err.message; b.disabled = false; b.textContent = "Draft the deal"; }
    }
  };
  if (fresh && navigator.share) { const s = $(`.pitchlink.fresh button[data-act=share]`, box); if (s) s.focus(); }
}

async function startRecorder() {
  let rec;
  const cap = await startCapture((n) => `/api/rec/${rec.id}/seg/${n}`, async () => { rec = await api("/api/rec", { consent: true }); });

  const ov = document.createElement("div");
  ov.className = "rec-live";
  ov.innerHTML = `
    <div class="rec-top"><span class="rec-dot"></span><span>Recording · the founder agreed</span></div>
    <div class="rec-time">0:00</div>
    <div class="rec-note" hidden></div>
    <div class="rec-ask"><div>Remember to ask about</div>${REC_QUESTIONS.map((q) => `<div>${q}</div>`).join("")}</div>
    <div class="rec-actions"><button class="btn rec-stop" type="button">Stop and draft</button>
      <button class="link small rec-cancel" type="button">Cancel and delete</button></div>`;
  document.body.appendChild(ov);
  document.body.classList.add("recording");
  const started = Date.now();
  const timeEl = $(".rec-time", ov), dot = $(".rec-dot", ov), note = $(".rec-note", ov);
  const say = (t) => { note.textContent = t; note.hidden = !t; };
  const tick = setInterval(() => {
    const s = Math.floor((Date.now() - started) / 1000);
    timeEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    dot.style.transform = `scale(${1 + Math.min(cap.level() * 4, 1.2)})`;
    if (s > 20 && !cap.heard()) say("Can't hear anything yet. Check that the microphone is allowed and not covered.");
    else if (cap.heard() && note.textContent.startsWith("Can't hear")) say("");
  }, 200);
  cap.onResume = () => say("The recording paused while the screen was off or another app was open. It's listening again.");
  const close = () => { clearInterval(tick); ov.remove(); document.body.classList.remove("recording"); };

  $(".rec-cancel", ov).onclick = async () => {
    if (!(await ask("Stop recording and delete everything captured so far?"))) return;
    cap.stop(); close();
    try { await api(`/api/rec/${rec.id}/delete`, {}); } catch {}
    toast("Recording deleted.");
  };
  $(".rec-stop", ov).onclick = async () => {
    clearInterval(tick);
    ov.innerHTML = `<div class="rec-work"><div class="rec-time small-t">Turning the conversation into a draft…</div><p>Usually under a minute. Keep this page open.</p><div class="msg err"></div></div>`;
    try {
      await cap.finish();
      const r = await api(`/api/rec/${rec.id}/draft`, {});
      sessionStorage.setItem("recDraft", JSON.stringify({ rec_id: rec.id, draft: r.draft, transcript: r.transcript, truncated: r.truncated, gaps: cap.failed.length }));
      close();
      location.hash = "#/deals/new";
      if (location.hash === "#/deals/new") router();
    } catch (e) {
      $(".msg", ov).textContent = e.message;
      ov.querySelector(".rec-work").insertAdjacentHTML("beforeend", `<div class="row" style="justify-content:center;margin-top:16px"><a class="btn" href="#/deals/new">Fill it in by hand</a></div>`);
      ov.querySelector("a.btn").onclick = close;
    }
  };
}
