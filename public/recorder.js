// Records from the microphone and sends each minute up as a small 16 kHz WAV to
// be transcribed. The audio itself is never saved. Shared by the members' app
// (a call recorded in person) and the founder's pitch page (a link sent to them).
//
//   const cap = await startCapture((n) => url for minute n, async () => { ...before the first minute... });
//   cap.level()  cap.heard()  cap.failed  cap.finish()  cap.stop()
async function startCapture(segUrl, begin) {
  // Create and start the audio context inside the tap itself; iPhones won't start it later.
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  ctx.resume();
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch { ctx.close(); throw new Error("The microphone is blocked. Allow microphone access for staghunts.com in your browser settings, then try again."); }
  try { await ctx.audioWorklet.addModule("/rec-worklet.js?v=1"); if (begin) await begin(); }
  catch (e) { stream.getTracks().forEach((t) => t.stop()); ctx.close(); throw e; }

  const src = ctx.createMediaStreamSource(stream);
  const tap = new AudioWorkletNode(ctx, "rec-tap");
  const mute = ctx.createGain(); mute.gain.value = 0;
  src.connect(tap); tap.connect(mute); mute.connect(ctx.destination);

  const SR = ctx.sampleRate, SEG_SECONDS = 60;
  let chunks = [], samples = 0, seg = 0, level = 0, heard = false, stopped = false, paused = false, uploading = null;
  const queue = [], failed = [];
  const upload = async () => {
    while (queue.length) {
      const { n, blob } = queue[0];
      let ok = false;
      for (let attempt = 0; attempt < 4 && !ok; attempt++) {
        try {
          const r = await fetch(segUrl(n), { method: "POST", credentials: "same-origin", headers: { "Content-Type": "audio/wav" }, body: blob });
          ok = r.ok;
          if (!ok && r.status < 500) break;
        } catch {}
        if (!ok) await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
      }
      if (!ok) failed.push(n);
      queue.shift();
    }
    uploading = null;
  };
  const flush = () => {
    if (!samples) return;
    const all = new Float32Array(samples); let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    chunks = []; samples = 0;
    queue.push({ n: seg++, blob: toWav16k(all, SR) });
    if (!uploading) uploading = upload();
  };
  tap.port.onmessage = (e) => {
    if (stopped || paused) return;
    const c = e.data; chunks.push(c); samples += c.length;
    let peak = 0; for (let i = 0; i < c.length; i += 16) { const a = Math.abs(c[i]); if (a > peak) peak = a; }
    level = Math.max(peak, level * 0.92);
    if (peak > 0.02) heard = true;
    if (samples >= SR * SEG_SECONDS) flush();
  };

  // Keep the screen on, and pause while the page is hidden (a locked phone, another app).
  let lock = null;
  const keepAwake = async () => { try { lock = await navigator.wakeLock?.request("screen"); } catch {} };
  await keepAwake();
  const cap = { failed, onResume: null, level: () => level, heard: () => heard, minutes: () => seg };
  const onVis = () => {
    if (document.visibilityState === "hidden") { paused = true; return; }
    paused = false; ctx.resume(); keepAwake();
    if (cap.onResume) cap.onResume();
  };
  document.addEventListener("visibilitychange", onVis);
  const beforeUnload = (e) => { e.preventDefault(); e.returnValue = ""; };
  window.addEventListener("beforeunload", beforeUnload);

  // Stop listening without sending what's left.
  cap.stop = () => {
    if (stopped) return;
    stopped = true;
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("beforeunload", beforeUnload);
    stream.getTracks().forEach((t) => t.stop());
    try { tap.disconnect(); src.disconnect(); ctx.close(); } catch {}
    try { lock && lock.release(); } catch {}
  };
  // Send the last piece, stop, and wait until every minute is up.
  cap.finish = async () => { flush(); cap.stop(); while (uploading) await uploading; };
  return cap;
}

function toWav16k(input, rate) {
  const ratio = rate / 16000, len = Math.floor(input.length / ratio);
  const out = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    const a = Math.floor(i * ratio), b = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0; for (let j = a; j < b; j++) sum += input[j];
    const v = Math.max(-1, Math.min(1, sum / Math.max(1, b - a)));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  const buf = new ArrayBuffer(44 + out.length * 2), dv = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); dv.setUint32(4, 36 + out.length * 2, true); w(8, "WAVE"); w(12, "fmt ");
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, 16000, true); dv.setUint32(28, 32000, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  w(36, "data"); dv.setUint32(40, out.length * 2, true);
  new Int16Array(buf, 44).set(out);
  return new Blob([buf], { type: "audio/wav" });
}
