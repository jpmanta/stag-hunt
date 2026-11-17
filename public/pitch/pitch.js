// The page a founder opens from a member's link. They agree to be recorded, then
// pitch out loud on their own phone. Each minute is turned into text as it goes
// (public/recorder.js); the member who sent the link gets an email when it's in.
"use strict";
(function () {
  const box = document.getElementById("pitch");
  const link = location.hash.slice(1);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const COVER = ["What you're building, in a sentence", "Why you're the one to build it", "Who pays, and how much", "Your numbers so far", "How you get customers", "Who else solves this", "What you'd own if you win", "Your next goal, and what's in the way", "Your round: how much, the terms, the smallest check"];
  const api = async (path, body) => {
    const res = await fetch(`/api/pitch/${link}${path}`, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let data = {}; try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error(data.message || "Something went wrong. Try again in a moment.");
    return data;
  };
  const say = (html) => { box.innerHTML = html; };

  async function open() {
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(link)) return say(`<p class="asub">This link isn't complete. Copy the whole link from the message you got and open it again.</p>`);
    let p;
    try { p = await api(""); } catch (e) { return say(`<p class="asub">${esc(e.message)}</p>`); }
    if (p.done) return sent(p.member);
    const canRecord = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.AudioWorkletNode);
    say(`
      <p class="asub">${esc(p.member)}, an investor in Stag Hunt, would like to hear about your company. Talk for ten minutes or so, the way you would over coffee.</p>
      <div class="aprep">
        <p class="aprep-h">What to cover</p>
        <ol>${COVER.map((c) => `<li>${esc(c)}</li>`).join("")}</ol>
        <p class="ahint">These stay on screen while you talk. Skip any that don't apply. Up to ${p.minutes} minutes.</p>
      </div>
      <div class="aprep">
        <p class="aprep-h">What happens to it</p>
        <ol>
          <li><b>The audio is never saved.</b> Each minute is turned into text as you go, then the sound is thrown away.</li>
          <li><b>Only ${esc(p.member)} reads the transcript.</b> AI drafts a summary from it, which ${esc(p.member)} checks before sharing your company with other Stag Hunt investors.</li>
          <li><b>The transcript is deleted</b> once it's shared, or after 7 days.</li>
        </ol>
        <p class="ahint"><a href="/privacy/">How we handle it</a></p>
      </div>
      ${canRecord ? `<form id="pform" class="cform" novalidate>
        <label class="check"><input type="checkbox" name="consent">I agree to be recorded.</label>
        <div class="talkrow"><button class="btn" type="submit">Start talking</button></div>
        <p class="ahint">Keep this page open and your phone unlocked while you talk. Locking it pauses the recording.</p>
        <div class="msg err"></div>
      </form>` : `<div class="aprep"><p>This browser can't record. Open this link in Safari or Chrome on your phone.</p></div>`}`);
    const form = document.getElementById("pform");
    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = form.querySelector(".msg"), btn = form.querySelector("button");
      msg.textContent = "";
      if (!form.consent.checked) { msg.textContent = "Tick the box to agree to be recorded, then start."; return; }
      btn.disabled = true;
      try { await record(p); } catch (err) { msg.textContent = err.message; }
      finally { btn.disabled = false; }
    });
  }

  async function record(p) {
    const cap = await startCapture((n) => `/api/pitch/${link}/seg/${n}`, () => api("/start", { consent: true }));
    const ov = document.createElement("div");
    ov.className = "rec-live";
    ov.innerHTML = `
      <div class="rec-top"><span class="rec-dot"></span><span>Recording for ${esc(p.member)}</span></div>
      <div class="rec-time">0:00</div>
      <div class="rec-note" hidden></div>
      <div class="rec-ask"><div>What to cover</div>${COVER.map((c) => `<div>${esc(c)}</div>`).join("")}</div>
      <div class="rec-actions"><button class="btn rec-stop" type="button">Finish and send</button>
        <button class="link small rec-cancel" type="button">Stop and start over</button></div>`;
    document.body.appendChild(ov);
    document.body.classList.add("recording");
    const started = Date.now(), limit = p.minutes * 60;
    const timeEl = ov.querySelector(".rec-time"), dot = ov.querySelector(".rec-dot"), note = ov.querySelector(".rec-note");
    const tell = (t) => { note.textContent = t; note.hidden = !t; };
    const close = () => { clearInterval(tick); ov.remove(); document.body.classList.remove("recording"); };
    const tick = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      timeEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      dot.style.transform = `scale(${1 + Math.min(cap.level() * 4, 1.2)})`;
      if (s > 20 && !cap.heard()) tell("Can't hear anything yet. Check that the microphone is allowed and not covered.");
      else if (cap.heard() && note.textContent.startsWith("Can't hear")) tell("");
      if (s >= limit - 60 && s < limit && !note.textContent.startsWith("One minute")) tell("One minute left. Wrap up when you're ready.");
      if (s >= limit) finish();
    }, 200);
    cap.onResume = () => tell("The recording paused while the screen was off or another app was open. It's listening again.");

    ov.querySelector(".rec-cancel").onclick = () => {
      if (!confirm("Stop and start over? What you've said so far won't be sent.")) return;
      cap.stop(); close();
    };
    let finishing = false;
    async function finish() {
      if (finishing) return; finishing = true;
      clearInterval(tick);
      ov.innerHTML = `<div class="rec-work"><div class="rec-time small-t">Sending your pitch…</div><p>Keep this page open. It takes a few seconds.</p><div class="msg err"></div></div>`;
      try { await cap.finish(); await api("/done", {}); close(); sent(p.member); }
      catch (e) {
        ov.querySelector(".msg").textContent = e.message;
        ov.querySelector(".rec-work").insertAdjacentHTML("beforeend", `<div class="rec-actions" style="margin-top:16px"><button class="btn" type="button">Back</button></div>`);
        ov.querySelector(".rec-actions .btn").onclick = close;
      }
    }
    ov.querySelector(".rec-stop").onclick = finish;
  }

  function sent(member) {
    say(`<p class="asub">Sent. Thank you.</p>
      <div class="aprep"><p class="aprep-h">What happens next</p>
      <p>${esc(member)} will read what you said and be in touch. If it's a fit, they'll share your company with other investors in Stag Hunt, and each decides on their own.</p></div>
      <p class="ahint"><a href="/learn/the-group/">What Stag Hunt is</a></p>`);
  }

  open();
})();
