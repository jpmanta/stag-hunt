// Stag Hunt home page: checkerboard hunt animation + interactive proof figures.
"use strict";
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
// Reduce Motion (common on iPhones) still plays the board, just calmer: pieces glide, nothing hops, bursts or puffs dust.
const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
const reduceMotion = false;

/* =========================================================== the board */
(function board() {
  const canvas = document.getElementById("hunt-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const COLS = 12, ROWS = 7, STEP = 600, HOLD = 2800, FADE = 380;

  const pad = (arr, n = 8) => { while (arr.length < n) arr.push(arr[arr.length - 1]); return arr; };
  const SCENES = [
    {
      key: "ss", tag: "Scene 1 of 3", title: "Both hunt the stag. 4 each.",
      desc: "Both hold their posts and corner the stag. 4 each, the best outcome.",
      intents: { A: "S", B: "S" },
      pieces: {
        A: pad([[0,3],[1,3],[2,3],[3,3],[4,3],[5,3]]),
        B: pad([[11,3],[10,3],[9,3],[8,3],[7,3]]),
        S: pad([[6,3],[6,3],[6,2],[6,3],[6,4],[6,3]]),
        H1: pad([[2,0],[3,0],[3,1],[2,1],[2,0],[1,0],[1,1]]),
        H2: pad([[9,6],[9,5],[10,5],[10,6],[9,6],[8,6],[8,5]]),
      },
      gone: { S: 6 }, pops: [[6, "A", "+4"], [6, "B", "+4"]],
    },
    {
      key: "sh", tag: "Scene 2 of 3", title: "B takes a hare. The stag escapes.",
      desc: "B leaves for a sure hare. A can't hold the stag alone. A gets 0, B gets 1.",
      intents: { A: "S", B: "H2" },
      pieces: {
        A: pad([[0,3],[1,3],[2,3],[3,3],[4,3],[5,3]]),
        B: pad([[11,3],[11,4],[11,5],[10,5],[10,6]]),
        S: pad([[6,3],[6,3],[6,3],[6,3],[6,2],[6,1],[6,0],[6,-1]]),
        H1: pad([[2,0],[2,1],[3,1],[3,0],[4,0],[4,1],[3,1]]),
        H2: pad([[9,6],[9,6],[10,6],[9,6],[10,6]]),
      },
      gone: { H2: 4, S: 7 }, pops: [[4, "B", "+1"], [7, "A", "+0"]],
    },
    {
      key: "hh", tag: "Scene 3 of 3", title: "Both play safe. 1 each.",
      desc: "Both take the sure thing. 1 each. Safe, but the stag gets away.",
      intents: { A: "H1", B: "H2" },
      pieces: {
        A: pad([[0,3],[0,3],[0,2],[1,2]]),
        B: pad([[11,3],[11,4],[11,4],[10,4]]),
        S: pad([[6,3],[7,3],[7,2],[6,2],[6,3],[5,3],[5,2]]),
        H1: pad([[2,0],[2,1],[1,1],[1,2]]),
        H2: pad([[9,6],[9,5],[10,5],[10,4]]),
      },
      gone: { H1: 3, H2: 3 }, pops: [[3, "A", "+1"], [3, "B", "+1"]],
    },
    {
      key: "hs", tag: "Scene", title: "You take a hare. The stag escapes.",
      desc: "B holds the line alone and the stag slips away. You get 1, B gets 0.",
      intents: { A: "H1", B: "S" },
      pieces: {
        A: pad([[0,3],[0,2],[1,2],[1,1],[2,1]]),
        B: pad([[11,3],[10,3],[9,3],[8,3],[7,3]]),
        S: pad([[6,3],[6,3],[6,3],[6,3],[6,4],[6,5],[6,6],[6,7]]),
        H1: pad([[2,0],[2,0],[1,0],[2,0],[2,1]]),
        H2: pad([[9,6],[9,5],[10,5],[10,6],[10,6],[9,6]]),
      },
      gone: { H1: 4, S: 7 }, pops: [[4, "A", "+1"], [7, "B", "+0"]],
    },
  ];
  const FILM = [0, 1, 2];
  let mode = "film", round = 0, myTotal = 0;

  let scene = 0, t0 = performance.now(), paused = false, pauseAt = 0;
  const capTag = document.getElementById("cap-tag"), capTitle = document.getElementById("cap-title"), capDesc = document.getElementById("cap-desc");
  const btns = [...document.querySelectorAll("[data-scene]")], playBtn = document.getElementById("play");
  const prog = [...document.querySelectorAll(".bprog i b")];

  function setScene(i) {
    scene = (i + SCENES.length) % SCENES.length; t0 = performance.now();
    const s = SCENES[scene];
    capTag.textContent = s.tag; capTitle.textContent = s.title; capDesc.textContent = s.desc;
    btns.forEach((b) => b.classList.toggle("on", +b.dataset.scene === scene));
    document.querySelectorAll(".mini .c").forEach((c) => c.classList.remove("on"));
  }
  btns.forEach((b) => (b.onclick = () => { setScene(+b.dataset.scene); if (paused) pauseAt = performance.now(); }));
  playBtn.onclick = () => {
    paused = !paused;
    if (paused) pauseAt = performance.now(); else t0 += performance.now() - pauseAt;
    playBtn.textContent = paused ? "Play" : "Pause";
  };

  // ---- wooden board, drawn once per size into an offscreen canvas
  let woodCanvas = null, woodKey = "";
  function wood(W, H, c, col) {
    const key = `${W}x${H}:${col.sq}:${col.sq2}`;
    if (woodKey === key && woodCanvas) return woodCanvas;
    const dpr = Math.min(4, (devicePixelRatio || 1) * (window.__zoom || 1));
    const off = document.createElement("canvas"); off.width = Math.round(W * dpr); off.height = Math.round(H * dpr);
    const o = off.getContext("2d"); o.setTransform(dpr, 0, 0, dpr, 0, 0);
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let r = 0; r < ROWS; r++) for (let q = 0; q < COLS; q++) {
      const x = q * c, y = r * c, dark = (r + q) % 2;
      const g = o.createLinearGradient(x, y, x + c, y + c);
      g.addColorStop(0, dark ? col.sq : col.sq2); g.addColorStop(1, dark ? col.sq : col.sq2);
      o.fillStyle = g; o.fillRect(x, y, c + 0.5, c + 0.5);
      // grain: a few long, slightly wavy strokes running along the square
      const vertical = (r + q) % 2 === 0;
      o.save(); o.beginPath(); o.rect(x, y, c, c); o.clip();
      for (let k = 0; k < 0; k++) {
        o.strokeStyle = `rgba(90,60,30,${0.018 + rnd() * 0.028})`; o.lineWidth = 0.5 + rnd() * 0.6;
        o.beginPath();
        const off1 = rnd() * c, amp = 0.4 + rnd() * 1.1, f = 0.7 + rnd() * 0.9;
        for (let s = 0; s <= 1.001; s += 0.1) {
          const along = s * c, across = off1 + Math.sin(s * Math.PI * f + k) * amp;
          const px = vertical ? x + across : x + along, py = vertical ? y + along : y + across;
          s === 0 ? o.moveTo(px, py) : o.lineTo(px, py);
        }
        o.stroke();
      }
      o.restore();
    }
    woodCanvas = off; woodKey = key; return off;
  }
  function resize() {
    const w = canvas.clientWidth, dpr = Math.min(4, (devicePixelRatio || 1) * (window.__zoom || 1));
    canvas.width = Math.round(w * dpr); canvas.height = Math.round((w * ROWS) / COLS * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); woodKey = "";
  }
  addEventListener("resize", resize); resize();

  // ---- motion: smooth Catmull-Rom glide through each piece's squares
  const cr = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  function at(path, s) {
    const n = path.length, i = Math.max(0, Math.min(n - 1, Math.floor(s))), t = Math.max(0, Math.min(1, s - i));
    const P = (k) => path[Math.max(0, Math.min(n - 1, k))];
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    if (p1[0] === p2[0] && p1[1] === p2[1]) return [p1[0], p1[1]];
    return [cr(p0[0], p1[0], p2[0], p3[0], t), cr(p0[1], p1[1], p2[1], p3[1], t)];
  }
  const easeOut = (x) => 1 - Math.pow(1 - x, 3);

  function drawHunter(x, y, c, filled, label, col) {
    ctx.beginPath(); ctx.arc(x, y, c * 0.34, 0, Math.PI * 2);
    ctx.fillStyle = filled ? col.fg : col.bg; ctx.fill();
    ctx.lineWidth = Math.max(1.5, c * 0.04); ctx.strokeStyle = col.fg; ctx.stroke();
    gloss(x, y, c * 0.34, filled);
    ctx.beginPath(); ctx.arc(x, y, c * 0.24, 0, Math.PI * 2);
    ctx.strokeStyle = filled ? col.bg : col.fg; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = filled ? col.bg : col.fg;
    ctx.font = `600 ${Math.round(c * 0.25)}px Inter, sans-serif`;
    centerText(label, x, y);
  }
  function centerText(t, x, y) {
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const m = ctx.measureText(t);
    const w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight, h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    ctx.fillText(t, x - w / 2 + m.actualBoundingBoxLeft, y + h / 2 - m.actualBoundingBoxDescent);
  }
  // Classic playing-piece tokens. Silhouettes are drawn on a 100×100 grid.
  const P2 = (d) => new Path2D(d);
  const STAG = { head: P2("M66 114 C64.8 96 63 78 59.5 66 C58.5 62 57.6 58.5 57 55.5 C60 53.5 63.5 50.5 67.5 47.5 C64.2 46.8 60.3 47.6 57 49.4 C56.2 47.9 55.2 46.8 53.8 46.2 C50.3 47 47.2 49.4 44.2 52.6 C40.3 56.7 36 60.4 31.4 63.6 C28.2 65.8 27.2 68.7 29.2 70.8 C32 72.9 36.2 72.3 40.2 71.1 C44.2 70.4 47.1 72.6 48.9 76.4 C51.2 83 50.6 98 49.4 114 Z"), beam: P2("M53.8 46.4 C54.6 38.4 56.2 30.4 59.8 22.6"), near: P2("M54.8 40.6 C49.6 37.8 45.6 33.6 43.2 27.4 M56.9 31.2 C52.6 27.4 50.6 22 50.8 15.6 M61.6 19.8 C60.8 14.8 61.6 10.2 64 5.6 M67.8 13.2 C70.4 9.4 73.4 6.8 77.6 5.2 M59.8 22.6 C62.8 16.4 67.6 11.8 74.2 9.4"), far: P2("M57.4 47.8 C60.2 40.8 63.6 34 68.8 27.8 C72.8 23 78 20 84.2 19 M61.4 39.6 C62.2 34.4 61.6 29.6 59.6 24.8 M66.2 31 C66.8 25.6 69 21 72.6 17.2 M75.2 22.4 C77 18 80 15 84.2 12.8") };
  const HARE = { body: P2("M15.5 47.5 C16.4 43 20.6 39.6 26 38.8 C28.4 38.5 30.6 38.6 32.4 39.2 C37.2 40.6 40.4 43.6 42.6 47.6 C46.6 52.2 52.6 54.4 60.4 54.4 C72.6 54.4 82.4 61.4 85.4 71.2 C87.4 78.2 84.2 84.4 77.4 86.4 C76 86.8 74.6 87 73 87 L40.6 87 C36.6 87 34.4 85 35.2 82 C36 77.4 35.2 72.4 32.4 67.6 C29.8 63 27.4 59.2 25 57 C21 55.6 17.4 53 16 50.2 Z"), earF: P2("M28.6 40.2 C28.4 30 31.6 20.2 37.8 12 C39.6 10.2 41.8 11.2 41 13.8 C37.2 21.8 35.2 30.8 35.4 41.2 Z"), earB: P2("M33.2 41.2 C36 31.4 42 22.4 50.2 16 C52.2 14.8 53.8 16.6 52.6 18.8 C46.8 25 41.8 33 38.8 43.2 Z"), haunch: P2("M61 86.4 C58.4 77.6 64.4 68.2 75.8 68.6") };
  const GOLD = "#c9a877";
  function drawStag(x, y, c, col) {
    const R = c * 0.45;
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fillStyle = col.oakDark; ctx.fill();
    gloss(x, y, R, true);
    ctx.beginPath(); ctx.arc(x, y, R * 0.88, 0, Math.PI * 2); ctx.lineWidth = Math.max(0.8, R * 0.03); ctx.strokeStyle = GOLD; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, R * 0.84, 0, Math.PI * 2); ctx.clip();
    ctx.translate(x - R * 0.95, y - R * 0.74); const k = (R * 1.62) / 100; ctx.scale(k, k);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.globalAlpha *= 0.45; ctx.strokeStyle = col.cream; ctx.lineWidth = 2.2; ctx.stroke(STAG.far); ctx.globalAlpha /= 0.45;
    ctx.lineWidth = 2.4; ctx.stroke(STAG.near); ctx.lineWidth = 3.6; ctx.stroke(STAG.beam);
    ctx.fillStyle = col.cream; ctx.fill(STAG.head);
    ctx.fillStyle = col.oakDark; ctx.beginPath(); ctx.arc(41.6, 58.4, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function drawHare(x, y, c, col, flip) {
    const R = c * 0.36;
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fillStyle = col.cream; ctx.fill();
    ctx.lineWidth = Math.max(1, R * 0.06); ctx.strokeStyle = col.oak; ctx.stroke();
    gloss(x, y, R, false);
    ctx.beginPath(); ctx.arc(x, y, R * 0.85, 0, Math.PI * 2); ctx.lineWidth = Math.max(0.6, R * 0.025); ctx.strokeStyle = GOLD; ctx.stroke();
    ctx.translate(x, y); if (flip) ctx.scale(-1, 1);
    const k = (R * 1.62) / 100; ctx.scale(k, k); ctx.translate(-51.5, -50);
    ctx.fillStyle = col.oak; ctx.fill(HARE.earB);
    ctx.fillStyle = col.oakDark; ctx.fill(HARE.body); ctx.fill(HARE.earF);
    ctx.beginPath(); ctx.arc(85.6, 68, 4.6, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha *= 0.55; ctx.strokeStyle = col.cream; ctx.lineWidth = 1.6; ctx.lineCap = "round"; ctx.stroke(HARE.haunch); ctx.globalAlpha /= 0.55;
    ctx.fillStyle = col.cream; ctx.beginPath(); ctx.arc(23.4, 45.2, 1.7, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }


  function gloss(x, y, R, dark) {
    ctx.save();
    const g = ctx.createRadialGradient(x - R * 0.38, y - R * 0.42, R * 0.05, x, y, R);
    g.addColorStop(0, dark ? "rgba(255,255,255,.26)" : "rgba(255,255,255,.55)"); g.addColorStop(0.45, "rgba(255,255,255,0)"); g.addColorStop(1, "rgba(0,0,0,.10)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function shadow(x, y, r, lift) {
    ctx.save();
    ctx.fillStyle = `rgba(55,35,15,${0.18 + lift * 0.1})`;
    ctx.filter = "blur(" + (1.5 + lift * 3) + "px)";
    ctx.beginPath(); ctx.ellipse(x + lift * r * 0.15, y + r * (0.62 + lift * 0.25), r * (0.85 + lift * 0.1), r * 0.32, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function frame(now) {
    try { drawFrame(now); } catch (e) { console.error("board frame", e); }
    requestAnimationFrame(frame);
  }
  function drawFrame(now) {
    const col = { fg: css("--fg"), bg: css("--bg"), sq: css("--board-sq") || css("--sq"), sq2: css("--board-sq2") || css("--sq2"), accent: css("--accent"), muted: css("--muted"),
      oak: css("--oak"), oakDark: css("--oak-dark"), cream: css("--panel"), forest: css("--forest"), hare: "#8a7454" };
    const W = canvas.clientWidth, c = W / COLS, H = c * ROWS;
    const s = SCENES[scene], n = s.pieces.A.length;
    const t = Math.max(0, (paused ? pauseAt : now) - t0);
    const total = (n - 1) * STEP + HOLD;
    if (mode === "film" && !paused && !reduceMotion && t > total) { setScene(FILM[(FILM.indexOf(scene) + 1) % FILM.length]); return; }
    const ft = reduceMotion ? (n - 1) * STEP + HOLD / 2 : mode === "play" ? Math.min(t, total - FADE - 1) : t;
    if (mode === "play" && t > (n - 1) * STEP + 900 && !playDone) { playDone = true; onPlayDone(); }
    const sNow = Math.min(n - 1, ft / STEP);
    const sceneAlpha = reduceMotion ? 1 : mode === "play" ? Math.min(1, ft / FADE) : Math.min(1, ft / FADE, Math.max(0, (total - ft) / FADE));

    // progress bar under the board
    prog.forEach((el, i) => { el.style.width = mode !== "film" ? "0%" : i < scene ? "100%" : i > scene ? "0%" : Math.min(100, (ft / total) * 100) + "%"; });

    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(wood(W, H, c, col), 0, 0, W, H);
    { const g = ctx.createRadialGradient(W * 0.28, H * 0.15, c * 0.5, W * 0.5, H * 0.55, W * 0.75);
      g.addColorStop(0, "rgba(255,250,236,0)"); g.addColorStop(1, "rgba(60,38,18,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }

    const px = (p) => [(p[0] + 0.5) * c, (p[1] + 0.5) * c];
    const pos = (key, ss = sNow) => px(at(s.pieces[key], ss));
    const goneT = (key) => (s.gone[key] === undefined ? Infinity : s.gone[key] * STEP);
    const alpha = (key) => { const d = ft - goneT(key); return d <= 0 ? 1 : Math.max(0, 1 - d / 520); };
    const speed = (key) => { const [x1, y1] = pos(key, Math.max(0, sNow - 0.06)), [x2, y2] = pos(key); return Math.min(1, Math.hypot(x2 - x1, y2 - y1) / (c * 0.06)); };

    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    ctx.globalAlpha = sceneAlpha;

    // intent lines: who is going after what
    const firstPop = Math.min(...s.pops.map((p) => p[0])) * STEP;
    for (const h of ["A", "B"]) {
      const target = s.intents[h], ta = alpha(target);
      const fade = Math.max(0, Math.min(1, (firstPop - ft) / 400)) * ta;
      if (fade <= 0) continue;
      const [x1, y1] = pos(h), [x2, y2] = pos(target);
      ctx.save(); ctx.globalAlpha = sceneAlpha * fade * 0.55;
      ctx.strokeStyle = h === "A" ? col.forest : col.oak; ctx.lineWidth = Math.max(1, c * 0.025);
      ctx.setLineDash([c * 0.07, c * 0.11]); ctx.lineDashOffset = -ft / 40;
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - c * 0.35;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(mx, my, x2, y2); ctx.stroke();
      ctx.restore();
    }

    ctx.globalAlpha = sceneAlpha;

    // hares: hop while moving, twitch while waiting
    for (const key of ["H1", "H2"]) {
      const a = alpha(key); if (a <= 0) continue;
      const path = s.pieces[key], i = Math.floor(sNow), f = sNow - i;
      let dir = 0; for (let j = Math.min(n - 1, i + 1); j > 0 && !dir; j--) dir = Math.sign(path[j][0] - path[j - 1][0]);
      const nxt = path[Math.min(n - 1, i + 1)], moving = path[i][0] !== nxt[0] || path[i][1] !== nxt[1];
      const hop = calm ? 0 : moving ? Math.sin(Math.PI * f) * c * 0.16 : Math.max(0, Math.sin(ft / 260 + (key === "H1" ? 0 : 2))) * c * 0.012;
      const [x, y] = pos(key);
      ctx.globalAlpha = sceneAlpha * a;
      shadow(x, y, c * 0.34, moving ? Math.sin(Math.PI * f) : 0);
      const dg = ft - goneT(key), flip = dg > 0 ? Math.max(0.02, Math.cos(Math.min(1, dg / 420) * Math.PI / 2)) : 1;
      safe(() => { ctx.translate(x, y - hop); ctx.scale(flip, 1); ctx.translate(-x, -(y - hop)); drawHare(x, y - hop, c, col, dir > 0); });
    }
    // stag
    { const a = alpha("S"); if (a > 0) {
        const [x, y] = pos("S"), dg = ft - goneT("S"), caught = s.key === "ss" && dg > -350;
        ctx.globalAlpha = sceneAlpha * a; shadow(x, y, c * 0.42, speed("S") * 0.6);
        const sc = caught && dg > 0 ? 1 - Math.min(1, dg / 520) * 0.35 : 1;
        safe(() => { ctx.translate(x, y); ctx.scale(sc, sc); ctx.translate(-x, -y); drawStag(x, y, c, col); }); } }
    // hunters lift slightly as they glide
    for (const [key, filled, label] of [["A", true, "A"], ["B", false, "B"]]) {
      const [x, y] = pos(key), lift = speed(key);
      ctx.globalAlpha = sceneAlpha;
      shadow(x, y, c * 0.34, lift);
      ctx.save(); ctx.translate(x, y - lift * c * 0.05); const sc = 1 + lift * 0.05; ctx.scale(sc, sc);
      safe(() => drawHunter(0, 0, c, filled, label, col)); ctx.restore();
    }
    // payoff pops
    for (const [st, who, text] of s.pops) {
      const dt = ft - st * STEP; if (dt < 0) continue;
      const [x, y] = pos(who), lift = easeOut(Math.min(1, dt / 800));
      ctx.globalAlpha = sceneAlpha * Math.min(1, dt / 260);
      ctx.fillStyle = col.fg; ctx.font = `500 ${Math.round(c * 0.52)}px "Cormorant Garamond", Georgia, serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      ctx.fillText(text, x, y - c * 0.46 - lift * c * 0.32);
      const cell = document.querySelector(`.mini .c[data-k="${s.key}"]`); if (cell) cell.classList.add("on");
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
  const safe = (fn) => { try { ctx.save(); fn(); } catch (e) { if (!safe.w) { console.error("piece", e); safe.w = 1; } } finally { ctx.restore(); } };

  let playDone = false;
  const filmBar = document.querySelector(".controls:not(.playbar)"), playBar = document.querySelector(".playbar");
  const choose = (mine) => {
    const bStag = Math.random() < 0.6;   // B is a stranger: hunts the stag about 60% of the time
    const key = mine === "S" ? (bStag ? "ss" : "sh") : (bStag ? "hs" : "hh");
    const pay = { ss: 4, sh: 0, hs: 1, hh: 1 }[key];
    round++; myTotal += pay;
    mode = "play"; paused = false; playDone = false;
    setScene(SCENES.findIndex((x) => x.key === key));
    capTag.textContent = `Your turn · Round ${round}`;
    capTitle.textContent = mine === "S" ? "You go for the stag…" : "You go for a hare…";
    capDesc.textContent = "";
    playBar.querySelectorAll("[data-choice]").forEach((b) => (b.disabled = true));
    playBar.dataset.pending = JSON.stringify({ mine, bStag, pay });
  };
  function onPlayDone() {
    const { mine, bStag } = JSON.parse(playBar.dataset.pending || "{}");
    capTitle.textContent = bStag
      ? (mine === "S" ? "B hunted the stag too. You each eat 4." : "B went for the stag alone. You get 1, B gets nothing.")
      : (mine === "S" ? "B took a hare. The stag escapes. You get 0." : "B took a hare too. 1 each.");
    capDesc.textContent = `After ${round} round${round === 1 ? "" : "s"}: you have ${myTotal}. Always taking hares would have given you ${round}.`;
    playBar.querySelectorAll("[data-choice]").forEach((b) => (b.disabled = false));
  }
  document.getElementById("yourturn")?.addEventListener("click", () => {
    mode = "play"; round = 0; myTotal = 0; paused = true; pauseAt = performance.now(); playDone = true;
    filmBar.hidden = true; playBar.hidden = false;
    playBar.querySelectorAll("[data-choice]").forEach((b) => (b.disabled = false));
    delete playBar.dataset.pending;
    capTag.textContent = "Your turn"; capTitle.textContent = "You're Hunter A. B is someone you just met.";
    capDesc.textContent = "Pick what you hunt. B decides at the same time, and you won't know their choice until it plays out.";
    document.querySelectorAll(".mini .c").forEach((c) => c.classList.remove("on"));
  });
  playBar?.querySelectorAll("[data-choice]").forEach((b) => (b.onclick = () => choose(b.dataset.choice)));
  document.getElementById("backtofilm")?.addEventListener("click", () => {
    mode = "film"; playDone = true; filmBar.hidden = false; playBar.hidden = true; paused = false; playBtn.textContent = "Pause"; setScene(0);
  });

  setScene(0);
  if (reduceMotion) { paused = true; pauseAt = performance.now(); playBtn.hidden = true; }
  requestAnimationFrame(frame);
})();

/* =========================================================== the payoff lab */
(function lab() {
  const st = { S: 4, H: 1, L: 0, p: 0.5 };
  // Each page can set its own starting values on the sliders
  ["S", "H", "L", "p"].forEach((k) => { const i = document.getElementById("sl-" + k); if (i) st[k] = +i.defaultValue; });
  const defaults = { ...st };
  // Carry the reader's numbers between folders (per-tab convenience only)
  try { const saved = JSON.parse(sessionStorage.getItem("stag-lab") || "null"); if (saved) Object.assign(st, saved); } catch {}
  ["S", "H", "L"].forEach((k) => { st[k] = Math.round(st[k]); });
  const save = () => { try { sessionStorage.setItem("stag-lab", JSON.stringify(st)); } catch {} };
  const $ = (id) => document.getElementById(id);
  const fmt = (v, d = 2) => (Math.round(v * 10 ** d) / 10 ** d).toString();
  const pct = (v) => (v * 100).toFixed(v > 0.99 && v < 1 ? 1 : 0) + "%";
  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs = {}, text) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text !== undefined) e.textContent = text; return e; };

  ["S", "H", "L", "p"].forEach((k) => { const i = $("sl-" + k); if (!i) return; i.value = st[k]; i.oninput = () => { st[k] = +i.value; save(); render(); }; });
  $("reset")?.addEventListener("click", () => { Object.assign(st, defaults); save(); ["S", "H", "L", "p"].forEach((k) => { const i = $("sl-" + k); if (i) i.value = st[k]; }); render(); });

  const kind = () => {
    const { S, H, L } = st;
    if (S > H && H > L) return "stag";
    if (L >= H && S >= H) return "coop";   // stag is always at least as good: no dilemma
    if (H >= S) return "hare";             // hare always at least as good
    return "other";
  };
  const pstar = () => { const { S, H, L } = st; return S > L ? Math.min(1, Math.max(0, (H - L) / (S - L))) : 1; };

  /* ---- payoff matrix as an SVG board with best-response arrows */
  function drawMatrix() {
    const svg = $("matrix"); if (!svg) return;
    svg.innerHTML = "";
    const { S, H, L } = st, fg = css("--fg"), muted = css("--muted"), sq = css("--sq"), bg = css("--bg"), accent = css("--accent");
    const pay = [[[S, S], [L, H]], [[H, L], [H, H]]]; // [row A][col B] -> [A, B]; 0 = Stag, 1 = Hare
    const x0 = 130, y0 = 70, cw = 210, ch = 150;
    svg.setAttribute("viewBox", "0 0 560 400");
    const defs = el("defs"); const mk = el("marker", { id: "ah", viewBox: "0 0 10 10", refX: "8", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" });
    mk.appendChild(el("path", { d: "M0,0 L10,5 L0,10 z", fill: accent })); defs.appendChild(mk); svg.appendChild(defs);
    svg.appendChild(el("text", { x: x0 + cw, y: 20, "text-anchor": "middle", fill: muted, "font-family": "Cormorant Garamond, Georgia, serif", "font-size": 17, "font-style": "italic" }, "Hunter B"));
    ["Stag", "Hare"].forEach((t, j) => svg.appendChild(el("text", { x: x0 + cw * j + cw / 2, y: 52, "text-anchor": "middle", fill: fg, "font-family": "Cormorant Garamond, Georgia, serif", "font-size": 20, "font-weight": 500 }, t)));
    svg.appendChild(el("text", { x: 18, y: y0 + ch, "text-anchor": "middle", fill: muted, "font-family": "Cormorant Garamond, Georgia, serif", "font-size": 17, "font-style": "italic", transform: `rotate(-90 18 ${y0 + ch})` }, "Hunter A"));
    ["Stag", "Hare"].forEach((t, i) => svg.appendChild(el("text", { x: x0 - 16, y: y0 + ch * i + ch / 2 + 6, "text-anchor": "end", fill: fg, "font-family": "Cormorant Garamond, Georgia, serif", "font-size": 20, "font-weight": 500 }, t)));
    const isNE = (i, j) => pay[i][j][0] >= pay[1 - i][j][0] && pay[i][j][1] >= pay[i][1 - j][1];
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      const x = x0 + cw * j, y = y0 + ch * i;
      svg.appendChild(el("rect", { x, y, width: cw, height: ch, fill: (i + j) % 2 ? sq : bg, stroke: fg, "stroke-width": 1 }));
      const t = el("text", { x: x + cw / 2, y: y + ch / 2 + 12, "text-anchor": "middle", "font-family": "Cormorant Garamond, Georgia, serif", "font-size": 38, "font-weight": 500 });
      const a = el("tspan", { fill: fg }, fmt(pay[i][j][0], 1)); const cm = el("tspan", { fill: muted }, ",  "); const b = el("tspan", { fill: muted }, fmt(pay[i][j][1], 1));
      t.append(a, cm, b); svg.appendChild(t);
      if (isNE(i, j)) {
        svg.appendChild(el("rect", { x: x + 3, y: y + 3, width: cw - 6, height: ch - 6, fill: "none", stroke: css("--forest"), "stroke-width": 2 }));
        svg.appendChild(el("text", { x: x + cw - 14, y: y + 26, "text-anchor": "end", fill: css("--forest"), "font-family": "Cormorant Garamond, Georgia, serif", "font-size": 16, "font-style": "italic" }, "stable"));
      }
    }
    // Best-response arrows. Each sits on the wall between two squares, at its middle, in line with the numbers:
    // A's cross the wall between the rows, B's the wall between the columns. Placed this way no two ever cross.
    const reach = 28, arrow = (x1, y1, x2, y2) => svg.appendChild(el("line", { x1, y1, x2, y2, stroke: accent, "stroke-width": 2, "marker-end": "url(#ah)" }));
    for (let j = 0; j < 2; j++) {
      const a0 = pay[0][j][0], a1 = pay[1][j][0];
      if (a0 === a1) continue;
      const d = a0 > a1 ? -reach : reach, x = x0 + cw * j + cw / 2, y = y0 + ch;   // up toward Stag, or down toward Hare
      arrow(x, y - d, x, y + d);
    }
    for (let i = 0; i < 2; i++) {
      const b0 = pay[i][0][1], b1 = pay[i][1][1];
      if (b0 === b1) continue;
      const d = b0 > b1 ? -reach : reach, x = x0 + cw, y = y0 + ch * i + ch / 2;   // left toward Stag, or right toward Hare
      arrow(x - d, y, x + d, y);
    }
  }

  /* ---- chart: expected payoff vs belief p */
  function axes(svg, W, Hh, m, xTicks, yTicks, xLabel, yLabel, sx, sy) {
    const fg = css("--fg"), muted = css("--muted"), line = css("--line");
    for (const v of yTicks) { svg.appendChild(el("line", { x1: m.l, x2: W - m.r, y1: sy(v), y2: sy(v), stroke: line })); svg.appendChild(el("text", { x: m.l - 8, y: sy(v) + 4, "text-anchor": "end", fill: muted, "font-size": 11, "font-family": "Inter" }, v.label ?? v)); }
    for (const v of xTicks) svg.appendChild(el("text", { x: sx(v.v ?? v), y: Hh - m.b + 18, "text-anchor": "middle", fill: muted, "font-size": 11, "font-family": "Inter" }, v.label ?? v));
    svg.appendChild(el("line", { x1: m.l, x2: W - m.r, y1: Hh - m.b, y2: Hh - m.b, stroke: fg }));
    svg.appendChild(el("text", { x: (m.l + W - m.r) / 2, y: Hh - 4, "text-anchor": "middle", fill: muted, "font-size": 12, "font-family": "Inter" }, xLabel));
    svg.appendChild(el("text", { x: 12, y: (m.t + Hh - m.b) / 2, "text-anchor": "middle", fill: muted, "font-size": 12, "font-family": "Inter", transform: `rotate(-90 12 ${(m.t + Hh - m.b) / 2})` }, yLabel));
  }

  function drawBelief() {
    const svg = $("chart-belief"); if (!svg) return; svg.innerHTML = "";
    const W = (innerWidth < 600 ? 430 : 680), Hh = 360, m = { l: 56, r: 20, t: 18, b: 46 };
    svg.setAttribute("viewBox", `0 0 ${W} ${Hh}`);
    const { S, H, L, p } = st, ps = pstar();
    const ymax = Math.max(S, H, L, 1) * 1.15;
    const sx = (v) => m.l + v * (W - m.l - m.r), sy = (v) => Hh - m.b - (v / ymax) * (Hh - m.t - m.b);
    const fg = css("--fg"), muted = css("--muted"), accent = css("--accent"), sq = css("--sq");
    if (kind() === "stag") svg.appendChild(el("rect", { x: sx(ps), y: m.t, width: sx(1) - sx(ps), height: Hh - m.b - m.t, fill: sq }));
    const yt = []; const stepY = ymax > 8 ? 2 : 1; for (let v = 0; v <= ymax; v += stepY) yt.push(v);
    axes(svg, W, Hh, m, [0, 0.25, 0.5, 0.75, 1].map((v) => ({ v, label: Math.round(v * 100) + "%" })), yt, "How sure you are that your partner hunts the stag", "Days of food, on average", sx, sy);
    svg.appendChild(el("line", { x1: sx(0), y1: sy(L), x2: sx(1), y2: sy(S), stroke: accent, "stroke-width": 2.5 }));
    svg.appendChild(el("line", { x1: sx(0), y1: sy(H), x2: sx(1), y2: sy(H), stroke: fg, "stroke-width": 2.5, "stroke-dasharray": "0" }));
    // "Hunt the stag" sits just above its line, clear of it along its whole width whichever way the line slopes,
    // and stops short of the dashed tipping-point line when that would run through the words.
    const stagLabel = svg.appendChild(el("text", { "text-anchor": "end", fill: accent, "font-size": 13, "font-family": "Inter", "font-weight": 600 }, "Hunt the stag"));
    const lw = stagLabel.getComputedTextLength() || 92, lineY = (x) => sy(L + (S - L) * (x - m.l) / (W - m.l - m.r));
    let lr = sx(0.97); if (kind() === "stag" && sx(ps) > lr - lw - 8 && sx(ps) < lr + 8) lr = sx(ps) - 8;
    stagLabel.setAttribute("x", lr); stagLabel.setAttribute("y", Math.min(lineY(lr), lineY(lr - lw)) - 14);
    svg.appendChild(el("text", { x: sx(0) + 6, y: sy(H) - 10, fill: fg, "font-size": 13, "font-family": "Inter", "font-weight": 600 }, "Take a hare"));
    if (kind() === "stag") {
      svg.appendChild(el("line", { x1: sx(ps), x2: sx(ps), y1: m.t, y2: Hh - m.b, stroke: fg, "stroke-dasharray": "4 4" }));
      svg.appendChild(el("text", { x: sx(ps) + 6, y: m.t + 14, fill: fg, "font-size": 12, "font-family": "Inter" }, `tipping point ${pct(ps)}`));
      svg.appendChild(el("circle", { cx: sx(ps), cy: sy(H), r: 4.5, fill: css("--bg"), stroke: fg, "stroke-width": 2 }));
    }
    const es = p * S + (1 - p) * L;
    svg.appendChild(el("line", { x1: sx(p), x2: sx(p), y1: sy(Math.max(es, H)), y2: Hh - m.b, stroke: muted, "stroke-width": 1 }));
    svg.appendChild(el("circle", { cx: sx(p), cy: sy(es), r: 5.5, fill: accent }));
    svg.appendChild(el("circle", { cx: sx(p), cy: sy(H), r: 5.5, fill: fg }));
    if (!$("out-es")) return;
    $("out-es").textContent = fmt(es); $("out-eh").textContent = fmt(H);
    $("out-best").textContent = Math.abs(es - H) < 1e-9 ? "Either one" : es > H ? "Hunt the stag" : "Hunt the hare";
  }

  /* ---- chart: population dynamics (who's left hunting stag over time) */
  function drawDynamics() {
    const svg = $("chart-dyn"); if (!svg) return; svg.innerHTML = "";
    const W = (innerWidth < 600 ? 430 : 680), Hh = 230, m = { l: 56, r: 20, t: 20, b: 46 };
    svg.setAttribute("viewBox", `0 0 ${W} ${Hh}`);
    const { S, H, L } = st, ps = pstar(), k = kind();
    const g = (x) => x * (1 - x) * (x * S + (1 - x) * L - H);
    let gmax = 0; for (let i = 0; i <= 200; i++) gmax = Math.max(gmax, Math.abs(g(i / 200)));
    gmax = gmax || 1;
    const sx = (v) => m.l + v * (W - m.l - m.r), mid = (m.t + Hh - m.b) / 2, sy = (v) => mid - (v / gmax) * ((Hh - m.t - m.b) / 2);
    const fg = css("--fg"), muted = css("--muted"), accent = css("--accent"), bg = css("--bg"), line = css("--line");
    svg.appendChild(el("line", { x1: m.l, x2: W - m.r, y1: mid, y2: mid, stroke: fg }));
    [0, 0.25, 0.5, 0.75, 1].forEach((v) => svg.appendChild(el("text", { x: sx(v), y: Hh - m.b + 18, "text-anchor": "middle", fill: muted, "font-size": 11, "font-family": "Inter" }, Math.round(v * 100) + "%")));
    svg.appendChild(el("text", { x: (m.l + W - m.r) / 2, y: Hh - 4, "text-anchor": "middle", fill: muted, "font-size": 12, "font-family": "Inter" }, "Share of the crowd hunting the stag"));
    svg.appendChild(el("text", { x: m.l - 8, y: m.t + 10, "text-anchor": "end", fill: muted, "font-size": 11, "font-family": "Inter" }, "grows"));
    svg.appendChild(el("text", { x: m.l - 8, y: Hh - m.b - 4, "text-anchor": "end", fill: muted, "font-size": 11, "font-family": "Inter" }, "shrinks"));
    let d = ""; for (let i = 0; i <= 200; i++) { const x = i / 200; d += (i ? "L" : "M") + sx(x).toFixed(1) + "," + sy(g(x)).toFixed(1); }
    svg.appendChild(el("path", { d, fill: "none", stroke: accent, "stroke-width": 2.5 }));
    // flow arrows along the axis
    for (let i = 1; i < 20; i++) {
      const x = i / 20; if (k === "stag" && Math.abs(x - ps) < 0.03) continue;
      const dir = Math.sign(g(x)); if (!dir) continue;
      const cx = sx(x), y = mid + 22;
      svg.appendChild(el("path", { d: `M${cx - 5 * dir},${y - 4} L${cx + 5 * dir},${y} L${cx - 5 * dir},${y + 4}`, fill: "none", stroke: muted, "stroke-width": 1.5 }));
    }
    const dot = (x, stable) => svg.appendChild(el("circle", { cx: sx(x), cy: mid, r: 6.5, fill: stable ? fg : bg, stroke: fg, "stroke-width": 2 }));
    if (k === "stag") { dot(0, true); dot(1, true); dot(ps, false);
      // The label sits beside the hollow dot, above the axis and above the curve, so the curve never runs through the words.
      // Left of the dot the curve dips below the axis, so that side is used whenever the words fit there.
      const tip = svg.appendChild(el("text", { fill: fg, "font-size": 12, "font-family": "Inter" }, `tipping point ${pct(ps)}`));
      const tw = tip.getComputedTextLength() || 104, left = sx(ps) - 10 - tw >= 2, from = left ? sx(ps) - 10 - tw : sx(ps) + 10;
      let top = mid; for (let x = from; x <= from + tw; x += 4) top = Math.min(top, sy(g((x - m.l) / (W - m.l - m.r))));
      tip.setAttribute("text-anchor", left ? "end" : "start"); tip.setAttribute("x", left ? from + tw : from); tip.setAttribute("y", top - 14); }
    else if (k === "hare") { dot(0, true); dot(1, false); }
    else { dot(0, false); dot(1, true); }
    void line;
  }

  /* ---- chart: trust needed per person as the group grows */
  function drawGroup() {
    const svg = $("chart-n"); if (!svg) return; svg.innerHTML = "";
    const W = (innerWidth < 600 ? 430 : 680), Hh = 350, m = { l: 56, r: 20, t: 50, b: 46 };
    svg.setAttribute("viewBox", `0 0 ${W} ${Hh}`);
    const ps = pstar(), ns = []; for (let n = 2; n <= 20; n++) ns.push(n);
    const lo = Math.min(0.5, Math.floor(ps * 10) / 10);
    const bw = (W - m.l - m.r) / ns.length;
    const sx = (i) => m.l + i * bw, sy = (v) => Hh - m.b - ((v - lo) / (1 - lo)) * (Hh - m.t - m.b);
    const fg = css("--fg"), muted = css("--muted"), accent = css("--accent");
    const yt = []; for (let v = lo; v <= 1.0001; v += 0.1) yt.push({ v: +v.toFixed(1), label: Math.round(v * 100) + "%" });
    yt.forEach((t) => (t.valueOf = () => t.v));
    for (const t of yt) { svg.appendChild(el("line", { x1: m.l, x2: W - m.r, y1: sy(t.v), y2: sy(t.v), stroke: css("--line") })); svg.appendChild(el("text", { x: m.l - 8, y: sy(t.v) + 4, "text-anchor": "end", fill: muted, "font-size": 11, "font-family": "Inter" }, t.label)); }
    ns.forEach((n, i) => {
      const q = Math.pow(ps, 1 / (n - 1));
      svg.appendChild(el("rect", { x: sx(i) + bw * 0.18, y: sy(q), width: bw * 0.64, height: Math.max(0, Hh - m.b - sy(q)), fill: n === 2 ? accent : fg }));
      if (n === 2 || n === 5 || n === 10 || n === 15 || n === 20) svg.appendChild(el("text", { x: sx(i) + bw / 2, y: sy(q) - 6, "text-anchor": "middle", fill: fg, "font-size": 10.5, "font-family": "Inter" }, (q * 100).toFixed(1) + "%"));
      svg.appendChild(el("text", { x: sx(i) + bw / 2, y: Hh - m.b + 16, "text-anchor": "middle", fill: muted, "font-size": 10.5, "font-family": "Inter" }, n));
    });
    svg.appendChild(el("line", { x1: m.l, x2: W - m.r, y1: Hh - m.b, y2: Hh - m.b, stroke: fg }));
    svg.appendChild(el("text", { x: (m.l + W - m.r) / 2, y: Hh - 4, "text-anchor": "middle", fill: muted, "font-size": 12, "font-family": "Inter" }, "Number of hunters who must all show up"));
    svg.appendChild(el("text", { x: 12, y: (m.t + Hh - m.b) / 2, "text-anchor": "middle", fill: muted, "font-size": 12, "font-family": "Inter", transform: `rotate(-90 12 ${(m.t + Hh - m.b) / 2})` }, "How reliable each must be"));
  }

  function render() {
    const { S, H, L } = st, ps = pstar(), k = kind();
    ["S", "H", "L", "p"].forEach((key) => { const o = $("o-" + key); if (o) o.textContent = key === "p" ? pct(st.p) : fmt(st[key], 1); });
    document.querySelectorAll("[data-bind]").forEach((n) => {
      const b = n.dataset.bind;
      const val = { S, H, L, ps: fmt(ps), pspct: pct(ps), lossHH: fmt(H - L, 1), lossSS: fmt(S - H, 1), prodHH: fmt((H - L) ** 2, 2), prodSS: fmt((S - H) ** 2, 2),
        n5: pct(Math.pow(ps, 1 / 4)), n10: pct(Math.pow(ps, 1 / 9)), n15: pct(Math.pow(ps, 1 / 14)), mixed: fmt(H, 1) }[b];
      if (val !== undefined) n.textContent = typeof val === "number" ? fmt(val, 1) : val;
    });
    const w = $("lab-warn");
    if (w) w.textContent = k === "stag" ? "" : k === "hare" ? "When a hare is worth as much as half a stag, there is no reason to risk it. Everyone takes a hare." : k === "coop" ? "When the stag alone pays as much as a hare, there is no risk. Everyone hunts the stag." : "Not a stag hunt with these numbers.";
    const rd = $("rd-verdict");
    if (rd) rd.textContent = k !== "stag" ? "–" : (H - L) > (S - H) ? "the hare hunt is harder to break, so groups drift toward playing it safe" : (H - L) < (S - H) ? "the stag hunt is both better and harder to break" : "they're exactly as hard to break";
    drawMatrix(); drawBelief(); drawDynamics(); drawGroup();
  }
  render();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
  document.fonts && document.fonts.ready.then(render);
})();

;(function(){var n=document.querySelector("header nav.toc"),a=n&&n.querySelector("a.on");if(a&&n.scrollWidth>n.clientWidth){var r=a.getBoundingClientRect(),q=n.getBoundingClientRect();n.scrollLeft+=r.left-q.left-(q.width-r.width)/2;}})();
