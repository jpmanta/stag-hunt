// Live record for the Stag Hunt paper.
// Works on jonathanmanta.com/stag-hunt and on any staghunts.com page.
// staghunts.com loads it from /paper-record-live.js; jonathanmanta.com inlines it on /stag-hunt.
//
// On the paper it adds a "Now" column beside Table 7 (the Nov 26 column is never
// touched) and a live status for H1–H5 under Table 1.
// On staghunts.com, put <div id="paper-record"></div> wherever the record should show.
(function () {
  // jonathanmanta.com reads it through its own /api/stag-hunt/record (its security policy allows only its own address).
  var API = /jonathanmanta\.com$/.test(location.hostname) ? "/api/stag-hunt/record" : "/api/paper/record";
  var n = function (x) { return Number(x || 0).toLocaleString("en-US"); };
  var pct = function (a, b) { return b ? " (" + Math.round((100 * a) / b) + "%)" : ""; };

  function status(r) {
    var h1 = r.with_statement >= 20
      ? (r.sharers_with_statement * 2 >= r.with_statement ? "On track" : "Behind") : "Not started (day 1 is the 20th investor statement)";
    return [
      ["H1 Members share", n(r.sharers_with_statement) + " of " + n(r.with_statement) + " members with a statement have shared" + pct(r.sharers_with_statement, r.with_statement), h1],
      ["H2 A second yes", n(r.deals_live) + " of " + n(r.deals_shared) + " shared deals have a second yes" + pct(r.deals_live, r.deals_shared), r.deals_shared ? (r.deals_live * 10 >= r.deals_shared ? "Passing" : "Below 1 in 10") : "No deals yet"],
      ["H3 Calls are independent", n(r.deals_split) + " of " + n(r.deals_3plus_calls) + " deals with 3+ calls are split", r.deals_3plus_calls ? (r.deals_split * 3 >= r.deals_3plus_calls ? "Passing" : "Below 1 in 3") : "No deals with 3+ calls yet"],
      ["H4 Members invest", n(r.cross_investments) + " investments in another member’s deal", r.cross_investments > 0 ? "Passed" : "Not yet"],
      ["H5 Calls carry information", n(r.outcomes) + " outcomes recorded", "Settles at month 24"],
    ];
  }

  function stamp(r) {
    return "Live from staghunts.com, as of " + new Date(r.as_of).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) + ". Refreshes every 5 minutes.";
  }

  function fillPaper(r) {
    var caps = document.querySelectorAll(".tbl .cap");
    var t7 = null, t1 = null;
    caps.forEach(function (c) {
      if (/^Table 7/.test(c.textContent)) t7 = c.parentNode;
      if (/^Table 1/.test(c.textContent)) t1 = c.parentNode;
    });
    if (t7 && !t7.dataset.live) {
      t7.dataset.live = "1";
      var head = t7.querySelector("thead tr");
      head.lastElementChild.textContent = "Nov 26, 2026";
      var th = document.createElement("th"); th.className = "r"; th.textContent = "Now"; head.appendChild(th);
      var now = [r.members, r.with_statement, r.deals_shared, r.founder_apps,
        n(r.calls) + ", " + n(r.investments) + ", " + n(r.outcomes)];
      t7.querySelectorAll("tbody tr").forEach(function (tr, i) {
        var td = document.createElement("td"); td.className = "r"; td.textContent = typeof now[i] === "number" ? n(now[i]) : now[i];
        tr.appendChild(td);
      });
      var note = document.createElement("p"); note.className = "tn"; note.textContent = stamp(r); t7.appendChild(note);
    }
    if (t1 && !t1.dataset.live) {
      t1.dataset.live = "1";
      t1.insertAdjacentHTML("beforeend", block(r));
    }
  }

  function block(r, tableAttrs) {
    var rows = status(r).map(function (s) {
      return "<tr><td>" + s[0] + "</td><td>" + s[1] + "</td><td>" + s[2] + "</td></tr>";
    }).join("");
    return '<p class="cap" style="margin-top:22px"><b>Live:</b> where each prediction stands</p>' +
      "<table" + (tableAttrs || "") + "><thead><tr><th>Prediction</th><th>Record</th><th>Status</th></tr></thead><tbody>" + rows +
      '</tbody></table><p class="tn">' + stamp(r) + "</p>";
  }

  fetch(API).then(function (res) { return res.json(); }).then(function (r) {
    fillPaper(r);
    var slot = document.getElementById("paper-record");
    if (slot) slot.innerHTML = '<div class="cmpwrap">' + block(r, ' class="cmp" style="min-width:0"') + "</div>";
  }).catch(function () { /* stay on the static Nov 26 numbers */ });
})();
