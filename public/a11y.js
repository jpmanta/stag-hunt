// Reading help: listen, text, color and focus. Each reader chooses, and it's saved on their device only.
// Public pages can be read by ElevenLabs voices (/api/voice); the members' app uses only the device's own voice,
// so deals and calls never leave the device.
"use strict";
(function () {
  const KEY = "sh-a11y", root = document.documentElement;
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  let prefs = read();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch {} };
  const DEFAULTS = { size: 100, font: "default", theme: "default", tint: "none", rate: 1, voice: "" };
  const get = (k) => prefs[k] ?? DEFAULTS[k];

  // Apply before paint, so nothing flashes.
  function apply() {
    const size = get("size");
    if (size !== 100) { root.dataset.a11ySize = ""; root.style.setProperty("--a11y-size", size / 100); } else { delete root.dataset.a11ySize; root.style.removeProperty("--a11y-size"); }
    for (const k of ["font", "theme", "tint"]) { const v = get(k); if (v === DEFAULTS[k]) delete root.dataset["a11y" + k[0].toUpperCase() + k.slice(1)]; else root.dataset["a11y" + k[0].toUpperCase() + k.slice(1)] = v; }
    for (const k of ["spacing", "italic", "links", "guide", "calm", "click"]) { if (prefs[k]) root.dataset["a11y" + k[0].toUpperCase() + k.slice(1)] = ""; else delete root.dataset["a11y" + k[0].toUpperCase() + k.slice(1)]; }
    const tint = document.getElementById("a11y-tint");
    if (tint) tint.style.background = TINTS[get("tint")] || "";
  }
  const TINTS = { none: "", turquoise: "#BFE4E4", blue: "#C8DAFF", green: "#D3EFC8", yellow: "#FFF0A6", peach: "#FFD9BD", rose: "#FFD0DC", lilac: "#E3D5FA", grey: "#D6D6D6" };
  apply();

  const inApp = location.pathname === "/app" || location.pathname.startsWith("/app/");
  const changed = () => Object.keys(prefs).some((k) => k !== "voice" && k !== "rate" && prefs[k] !== undefined && prefs[k] !== DEFAULTS[k] && prefs[k] !== false);

  function build() {
    const icon = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="4.2" r="2.1" fill="currentColor"/><path d="M4.5 8.2c2.4.7 4.9 1 7.5 1s5.1-.3 7.5-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 9.6v5.2M12 14.4l-3.3 6.3M12 14.4l3.3 6.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const seg = (group, opts) => `<div class="seg" role="group" data-group="${group}">${opts.map(([v, t, cls]) => `<button type="button" data-v="${v}"${cls ? ` class="${cls}"` : ""}>${t}</button>`).join("")}</div>`;
    const sw = (k, t, s) => `<label class="sw"><input type="checkbox" data-pref="${k}"><i></i><span><b>${t}</b><small>${s}</small></span></label>`;
    const main = document.querySelector("main, #view, .wrap");
    if (main && !main.id) main.id = "content";
    document.body.insertAdjacentHTML("afterbegin", `<a class="a11y-skip" href="#${main ? main.id : "content"}">Skip to content</a>`);
    document.body.insertAdjacentHTML("beforeend", `
      <div id="a11y-tint" aria-hidden="true"></div><div id="a11y-guide" aria-hidden="true"></div>
      <button id="a11y-toggle" type="button" aria-expanded="false" aria-controls="a11y-panel" title="Reading help">${icon}<span>Reading help</span></button>
      <div id="a11y-bar" role="status" hidden><span>Reading aloud</span><button type="button" data-tts="pause">Pause</button><button type="button" data-tts="stop">Stop</button></div>
      <div id="a11y-panel" role="dialog" aria-modal="false" aria-labelledby="a11y-title" tabindex="-1" hidden>
        <div class="a11y-head"><div><h2 id="a11y-title">Read it your way</h2><p class="a11y-intro">Try anything you like. You can undo it any time.</p></div><button type="button" class="a11y-x" aria-label="Close reading help">&times;</button></div>
        <section><h3>Listen</h3>
          <div class="row"><button type="button" class="b go" data-tts="play">Read this page aloud</button><button type="button" class="b" data-tts="stop">Stop</button></div>
          <p class="hint">Select some text first to hear just that part.</p>
          <span class="lbl">Voice</span><select id="a11y-voice" aria-label="Voice"></select>
          <span class="lbl">Speed</span>${seg("rate", [["0.75", "Slow"], ["1", "Normal"], ["1.25", "Fast"], ["1.5", "Faster"]])}
          ${sw("click", "Tap to listen", "Tap any paragraph to hear it from there.")}
        </section>
        <section><h3>Text</h3>
          <span class="lbl">Size</span><div class="step" role="group" aria-label="Text size"><button type="button" data-size="-10" aria-label="Smaller text">A&minus;</button><output aria-live="polite" id="a11y-size">100%</output><button type="button" data-size="10" aria-label="Larger text">A+</button></div>
          <span class="lbl">Font</span>${seg("font", [["default", "Classic"], ["atkinson", "Easy to read", "f-atk"], ["dyslexic", "OpenDyslexic", "f-dys"]])}
          ${sw("spacing", "More breathing room", "Extra space between letters, words and lines.")}
          ${sw("italic", "No slanted text", "Shows italics as regular letters.")}
          ${sw("links", "Make links stand out", "Puts a soft yellow mark on every link.")}
        </section>
        <section><h3>Color</h3>
          <span class="lbl">Page</span>${seg("theme", [["default", "Light"], ["dark", "Dark"], ["contrast", "High contrast"]])}
          <span class="lbl">Tint</span><div class="tints" role="group" data-group="tint">${Object.entries(TINTS).map(([v, c]) => `<button type="button" data-v="${v}" aria-label="${v === "none" ? "No tint" : v[0].toUpperCase() + v.slice(1)}" title="${v === "none" ? "No tint" : v[0].toUpperCase() + v.slice(1)}"${c ? ` style="background:${c}"` : ""}>${c ? "" : "&#8856;"}</button>`).join("")}</div>
          <p class="hint">Like tinted reading lenses. Some people with dyslexia find one color makes words sit still.</p>
        </section>
        <section><h3>Focus</h3>
          ${sw("guide", "Reading guide", "A clear band follows your pointer and dims the rest.")}
          ${sw("calm", "Calm motion", "Turns off animations and smooth scrolling.")}
        </section>
        <div class="foot"><span>Saved on this device</span><button type="button" data-reset>Start over</button></div>
      </div>`);
    apply();
    wire();
  }

  function sync() {
    const p = document.getElementById("a11y-panel");
    p.querySelectorAll("[data-group]").forEach((g) => g.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === String(get(g.dataset.group))))));
    p.querySelectorAll("[data-pref]").forEach((c) => (c.checked = !!prefs[c.dataset.pref]));
    p.querySelector("#a11y-size").textContent = get("size") + "%";
    p.querySelector("[data-reset]").hidden = !changed();
  }
  const set = (k, v) => { prefs[k] = v; save(); apply(); sync(); };

  function wire() {
    const t = document.getElementById("a11y-toggle"), p = document.getElementById("a11y-panel");
    const open = (on) => { p.hidden = !on; t.setAttribute("aria-expanded", String(on)); if (on) { sync(); loadVoices(); p.focus(); } else t.focus(); };
    t.onclick = () => open(true);
    p.querySelector(".a11y-x").onclick = () => open(false);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !p.hidden) open(false); });
    document.addEventListener("click", (e) => { if (!p.hidden && !p.contains(e.target) && e.target !== t && !t.contains(e.target)) open(false); });
    p.querySelectorAll("[data-group]").forEach((g) => g.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      const k = g.dataset.group; set(k, k === "rate" ? Number(b.dataset.v) : b.dataset.v);
      if (k === "rate") Reader.rate();
    }));
    p.querySelectorAll("[data-pref]").forEach((c) => (c.onchange = () => set(c.dataset.pref, c.checked)));
    p.querySelectorAll("[data-size]").forEach((b) => (b.onclick = () => set("size", Math.min(200, Math.max(80, get("size") + Number(b.dataset.size))))));
    p.querySelector("[data-reset]").onclick = () => { const keep = { voice: prefs.voice, rate: prefs.rate }; prefs = keep; save(); apply(); sync(); };
    p.querySelector("#a11y-voice").onchange = (e) => set("voice", e.target.value);
    document.querySelectorAll("[data-tts]").forEach((b) => (b.onclick = () => { if (b.dataset.tts === "play" && !p.hidden) open(false); Reader[b.dataset.tts](); }));
    // Reading guide follows the pointer
    const guide = document.getElementById("a11y-guide");
    addEventListener("pointermove", (e) => { if (!prefs.guide) return; guide.style.setProperty("--gy-top", Math.max(0, e.clientY - 26) + "px"); guide.style.setProperty("--gy-bot", e.clientY + 26 + "px"); }, { passive: true });
    // Tap to listen
    document.addEventListener("click", (e) => {
      if (!prefs.click || e.target.closest("a,button,input,textarea,select,label,#a11y-panel,#a11y-bar,summary")) return;
      const el = e.target.closest(BLOCKS); if (el && !el.closest("#a11y-panel")) Reader.play(el);
    });
  }

  // ---------- Voices ----------
  let cloud = [], voicesLoaded = false;
  async function loadVoices() {
    const sel = document.getElementById("a11y-voice");
    if (!inApp && !voicesLoaded) { try { const r = await fetch("/api/voices"); if (r.ok) cloud = (await r.json()).voices || []; } catch {} }
    voicesLoaded = true;
    const local = (window.speechSynthesis?.getVoices() || []).filter((v) => /^en/i.test(v.lang));
    sel.innerHTML = (cloud.length ? `<optgroup label="Studio voices">${cloud.map((v) => `<option value="cloud:${v.key}">${v.name}</option>`).join("")}</optgroup>` : "")
      + `<optgroup label="This device">${local.length ? local.map((v) => `<option value="device:${v.name}">${v.name.replace(/\s*\(.*\)$/, "")}</option>`).join("") : '<option value="device:">Default voice</option>'}</optgroup>`;
    const want = get("voice");
    if (want && [...sel.options].some((o) => o.value === want)) sel.value = want;
    else if (cloud.length) sel.value = "cloud:" + cloud[0].key;
    if (inApp) sel.insertAdjacentHTML("afterend", sel.nextElementSibling?.classList.contains("hint") ? "" : '<p class="hint">In the app, reading stays on your device, so deals never leave it.</p>');
  }
  if (window.speechSynthesis) speechSynthesis.onvoiceschanged = () => { if (voicesLoaded) loadVoices(); };

  // ---------- Reading aloud ----------
  const BLOCKS = "h1,h2,h3,h4,p,li,blockquote,figcaption,dt,dd,td,.notice,.empty .et";
  const Reader = (() => {
    let queue = [], i = 0, playing = false, paused = false, audio = null, current = null, token = 0;
    const bar = () => document.getElementById("a11y-bar");
    const visible = (el) => el.offsetParent !== null && !el.closest("#a11y-panel,#a11y-bar,nav,header,footer,.side,.tabbar,[aria-hidden=true],script,style") && el.textContent.trim();
    const blocks = (from) => {
      const scope = document.getElementById("view") || document.querySelector("main") || document.body;
      const all = [...scope.querySelectorAll(BLOCKS)].filter((el) => visible(el) && !el.parentElement.closest(BLOCKS.replace(/,\.empty \.et/, "")));
      return from ? all.slice(Math.max(0, all.indexOf(from))) : all;
    };
    const mark = (el) => { current?.classList.remove("a11y-reading"); current = el; if (el) { el.classList.add("a11y-reading"); el.scrollIntoView({ block: "center", behavior: prefs.calm ? "auto" : "smooth" }); } };
    const voice = () => document.getElementById("a11y-voice")?.value || get("voice") || "";
    const chunks = (text) => { const out = []; let cur = ""; for (const s of text.match(/[^.!?]+[.!?]*\s*/g) || [text]) { if ((cur + s).length > 500 && cur) { out.push(cur.trim()); cur = ""; } cur += s; } if (cur.trim()) out.push(cur.trim()); return out; };
    const sayDevice = (text, my) => new Promise((done) => {
      if (!window.speechSynthesis) return done();
      const u = new SpeechSynthesisUtterance(text), name = voice().replace(/^device:/, "");
      const v = speechSynthesis.getVoices().find((x) => x.name === name); if (v) u.voice = v;
      u.rate = get("rate"); u.onend = u.onerror = () => done();
      if (my === token) speechSynthesis.speak(u); else done();
    });
    const sayCloud = async (text, my) => {
      const r = await fetch("/api/voice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ page: location.pathname, voice: voice().slice(6), text }) });
      if (!r.ok) throw new Error("voice");
      const url = URL.createObjectURL(await r.blob());
      if (my !== token) return;
      await new Promise((done) => { audio = new Audio(url); audio.preservesPitch = true; audio.playbackRate = get("rate"); audio.onended = audio.onerror = done; audio.play().catch(done); });
      URL.revokeObjectURL(url);
    };
    async function run(my) {
      while (my === token && i < queue.length) {
        const item = queue[i]; if (item.el) mark(item.el);
        for (const part of chunks(item.text)) {
          if (my !== token) return;
          if (!inApp && voice().startsWith("cloud:")) { try { await sayCloud(part, my); continue; } catch {} }
          await sayDevice(part, my);
        }
        i++;
      }
      if (my === token) stop();
    }
    function play(from) {
      stop();
      const sel = String(window.getSelection?.() || "").trim();
      queue = sel && !from ? [{ text: sel }] : blocks(from).map((el) => ({ el, text: el.innerText.replace(/\s+/g, " ").trim() }));
      if (!queue.length) return;
      i = 0; playing = true; paused = false; const my = ++token;
      bar().hidden = false; bar().querySelector("[data-tts=pause]").textContent = "Pause";
      run(my);
    }
    function stop() { token++; playing = false; paused = false; window.speechSynthesis?.cancel(); if (audio) { audio.pause(); audio = null; } mark(null); const b = bar(); if (b) b.hidden = true; }
    function pause() {
      if (!playing) return;
      paused = !paused; bar().querySelector("[data-tts=pause]").textContent = paused ? "Resume" : "Pause";
      if (audio) paused ? audio.pause() : audio.play();
      else if (window.speechSynthesis) paused ? speechSynthesis.pause() : speechSynthesis.resume();
    }
    const rate = () => { if (audio) audio.playbackRate = get("rate"); };
    addEventListener("hashchange", stop);
    return { play: () => play(), stop, pause, rate, from: play };
  })();
  Reader.play = ((p) => (el) => (el && el.nodeType ? Reader.from(el) : p()))(Reader.play);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build); else build();
})();
