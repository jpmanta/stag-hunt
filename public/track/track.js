// A member's shared track record (staghunts.com/track/#<secret>). Calls, sectors and
// outcomes only: company names, terms and money stay inside Stag Hunt.
"use strict";
(function () {
  const box = document.getElementById("track");
  const token = location.hash.slice(1);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const month = (s) => new Date(s * 1000).toLocaleDateString(undefined, { month: "short", year: "numeric" });
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + "%" : "–");
  const OUTCOME = { breakout: "Breakout", on_track: "On track", struggling: "Struggling", dead: "Shut down" };
  const good = (o) => o === "breakout" || o === "on_track";
  const say = (html) => { box.innerHTML = html; };

  async function open() {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return say('<p class="asub">This link isn\'t complete. Copy the whole link and open it again.</p>');
    let r;
    try {
      const res = await fetch(`/api/track/${token}`);
      r = await res.json();
      if (!res.ok) throw new Error(r.message || "This record couldn't be opened.");
    } catch (e) { return say(`<p class="asub">${esc(e.message)}</p>`); }

    const calls = r.calls, known = calls.filter((c) => c.outcome);
    const right = known.filter((c) => c.yes === good(c.outcome));
    const stat = (n, l) => `<div class="tstat"><div class="n">${n}</div><div class="l">${l}</div></div>`;
    say(`
      <h1 class="learn-h1">${esc(r.member.name)}</h1>
      <p class="asub">${r.member.headline ? esc(r.member.headline) + ". " : ""}Stag Hunt member since ${month(r.member.since)}.</p>
      <div class="tstats">
        ${stat(calls.length, "Calls made")}
        ${stat(pct(calls.filter((c) => c.yes).length, calls.length), "Said yes")}
        ${stat(known.length ? `${right.length} of ${known.length}` : "–", "Right, once the outcome was known")}
        ${stat(r.group.good_rate == null ? "–" : pct(r.group.good_rate, 1), "Right, across all members")}
        ${stat(r.brought.n, r.brought.known ? `Deals brought, ${r.brought.well} of ${r.brought.known} went well` : "Deals brought")}
      </div>
      <p class="tnote">Every call is a yes or no on whether to meet a team, made before the outcome is known and locked the moment it is made. Nobody can change it afterward. Company names, terms and amounts stay private to Stag Hunt members.</p>
      ${calls.length ? `<table class="ttable"><thead><tr><th>Called</th><th>Sector</th><th>Call</th><th>How it turned out</th></tr></thead><tbody>
        ${calls.map((c) => `<tr><td>${month(c.called_at)}</td><td>${esc(c.sector) || "<span class=\"tfaint\">Not given</span>"}</td><td>${c.yes ? "Yes" : "No"}</td>
          <td>${c.outcome ? `${OUTCOME[c.outcome] || esc(c.outcome)}<span class="tfaint"> · ${c.yes === good(c.outcome) ? "right" : "wrong"}${c.outcome_at ? `, known ${month(c.outcome_at)}` : ""}</span>` : '<span class="tfaint">Too early to tell</span>'}</td></tr>`).join("")}
      </tbody></table>` : '<p class="tnote">No calls yet.</p>'}
    `);
  }
  open();
  addEventListener("hashchange", () => location.reload());
})();
