/* The Group: "Alone, a hare. Together, the stag." A small looping scene. */
(function () {
  var host = document.getElementById("huntscene"); if (!host) return;
  var NS = "http://www.w3.org/2000/svg";
  var STAG = {"head": "M66 114 C64.8 96 63 78 59.5 66 C58.5 62 57.6 58.5 57 55.5 C60 53.5 63.5 50.5 67.5 47.5 C64.2 46.8 60.3 47.6 57 49.4 C56.2 47.9 55.2 46.8 53.8 46.2 C50.3 47 47.2 49.4 44.2 52.6 C40.3 56.7 36 60.4 31.4 63.6 C28.2 65.8 27.2 68.7 29.2 70.8 C32 72.9 36.2 72.3 40.2 71.1 C44.2 70.4 47.1 72.6 48.9 76.4 C51.2 83 50.6 98 49.4 114 Z", "beam": "M53.8 46.4 C54.6 38.4 56.2 30.4 59.8 22.6", "near": "M54.8 40.6 C49.6 37.8 45.6 33.6 43.2 27.4 M56.9 31.2 C52.6 27.4 50.6 22 50.8 15.6 M61.6 19.8 C60.8 14.8 61.6 10.2 64 5.6 M67.8 13.2 C70.4 9.4 73.4 6.8 77.6 5.2 M59.8 22.6 C62.8 16.4 67.6 11.8 74.2 9.4", "far": "M57.4 47.8 C60.2 40.8 63.6 34 68.8 27.8 C72.8 23 78 20 84.2 19 M61.4 39.6 C62.2 34.4 61.6 29.6 59.6 24.8 M66.2 31 C66.8 25.6 69 21 72.6 17.2 M75.2 22.4 C77 18 80 15 84.2 12.8"}, HARE = {"body": "M15.5 47.5 C16.4 43 20.6 39.6 26 38.8 C28.4 38.5 30.6 38.6 32.4 39.2 C37.2 40.6 40.4 43.6 42.6 47.6 C46.6 52.2 52.6 54.4 60.4 54.4 C72.6 54.4 82.4 61.4 85.4 71.2 C87.4 78.2 84.2 84.4 77.4 86.4 C76 86.8 74.6 87 73 87 L40.6 87 C36.6 87 34.4 85 35.2 82 C36 77.4 35.2 72.4 32.4 67.6 C29.8 63 27.4 59.2 25 57 C21 55.6 17.4 53 16 50.2 Z", "earF": "M28.6 40.2 C28.4 30 31.6 20.2 37.8 12 C39.6 10.2 41.8 11.2 41 13.8 C37.2 21.8 35.2 30.8 35.4 41.2 Z", "earB": "M33.2 41.2 C36 31.4 42 22.4 50.2 16 C52.2 14.8 53.8 16.6 52.6 18.8 C46.8 25 41.8 33 38.8 43.2 Z", "haunch": "M61 86.4 C58.4 77.6 64.4 68.2 75.8 68.6"};
  var C = { fg: "#1B2233", bg: "#FFFFFF", forest: "#14244A", oak: "#8a5a33", oakDark: "#5b3c22", cream: "#FFFFFF", gold: "#c9a877", line: "#D9D6CE" };
  function el(t, a, kids) { var e = document.createElementNS(NS, t); for (var k in a) e.setAttribute(k, a[k]); (kids || []).forEach(function (c) { e.appendChild(c); }); return e; }
  var svg = el("svg", { viewBox: "0 0 640 168", role: "img", "aria-label": "Alone, a hunter catches a hare. Together, four hunters catch the stag." });
  var defs = el("defs");
  var gl = el("radialGradient", { id: "hs-gloss", cx: "0.32", cy: "0.28", r: "0.75" });
  gl.appendChild(el("stop", { offset: "0", "stop-color": "#fff", "stop-opacity": ".5" }));
  gl.appendChild(el("stop", { offset: ".45", "stop-color": "#fff", "stop-opacity": "0" }));
  gl.appendChild(el("stop", { offset: "1", "stop-color": "#000", "stop-opacity": ".10" }));
  defs.appendChild(gl);
  var clip = el("clipPath", { id: "hs-stagclip" }); clip.appendChild(el("circle", { cx: 0, cy: 0, r: 30 })); defs.appendChild(clip);
  svg.appendChild(defs);
  svg.appendChild(el("line", { x1: 320, y1: 22, x2: 320, y2: 140, stroke: C.line }));

  function hunter(filled) {
    var g = el("g");
    g.appendChild(el("ellipse", { cx: 0, cy: 15, rx: 13, ry: 4, fill: "#000", opacity: ".10" }));
    g.appendChild(el("circle", { r: 14, fill: filled ? C.forest : C.cream, stroke: C.forest, "stroke-width": 1.6 }));
    g.appendChild(el("circle", { r: 14, fill: "url(#hs-gloss)" }));
    g.appendChild(el("circle", { r: 9.5, fill: "none", stroke: filled ? C.cream : C.forest, "stroke-width": 0.9 }));
    return g;
  }
  function hare() {
    var R = 22, k = (R * 1.62) / 100, g = el("g");
    g.appendChild(el("ellipse", { cx: 0, cy: R + 2, rx: R * 0.85, ry: 4, fill: "#000", opacity: ".10", "class": "hs-shadow" }));
    var body = el("g", { "class": "hs-hop" });
    body.appendChild(el("circle", { r: R, fill: C.cream, stroke: C.oak, "stroke-width": 1.3 }));
    body.appendChild(el("circle", { r: R, fill: "url(#hs-gloss)" }));
    body.appendChild(el("circle", { r: R * 0.85, fill: "none", stroke: C.gold, "stroke-width": 0.6 }));
    var art = el("g", { transform: "scale(" + k + ") translate(-51.5 -50)" });
    art.appendChild(el("path", { d: HARE.earB, fill: C.oak }));
    art.appendChild(el("path", { d: HARE.body, fill: C.oakDark }));
    art.appendChild(el("path", { d: HARE.earF, fill: C.oakDark }));
    art.appendChild(el("circle", { cx: 85.6, cy: 68, r: 4.6, fill: C.oakDark }));
    art.appendChild(el("path", { d: HARE.haunch, fill: "none", stroke: C.cream, "stroke-width": 1.6, "stroke-linecap": "round", opacity: ".55" }));
    art.appendChild(el("circle", { cx: 23.4, cy: 45.2, r: 1.7, fill: C.cream }));
    body.appendChild(art); g.appendChild(body);
    return g;
  }
  function stag() {
    var R = 34, k = (R * 1.62) / 100, g = el("g");
    g.appendChild(el("ellipse", { cx: 0, cy: R + 2, rx: R * 0.85, ry: 5, fill: "#000", opacity: ".12" }));
    var halo = el("circle", { r: R + 7, fill: "none", stroke: C.gold, "stroke-width": 1.4, opacity: 0, "class": "hs-halo" }); g.appendChild(halo);
    g.appendChild(el("circle", { r: R, fill: C.oakDark }));
    g.appendChild(el("circle", { r: R, fill: "url(#hs-gloss)", opacity: ".6" }));
    g.appendChild(el("circle", { r: R * 0.88, fill: "none", stroke: C.gold, "stroke-width": 1 }));
    var inner = el("g", { "clip-path": "url(#hs-stagclip)", transform: "scale(" + (R * 0.84 / 30) + ")" });
    var art = el("g", { transform: "translate(" + (-R * 0.95 / (R * 0.84 / 30)) + " " + (-R * 0.74 / (R * 0.84 / 30)) + ") scale(" + (k / (R * 0.84 / 30)) + ")", "stroke-linecap": "round", "stroke-linejoin": "round" });
    art.appendChild(el("path", { d: STAG.far, fill: "none", stroke: C.cream, "stroke-width": 2.2, opacity: ".45" }));
    art.appendChild(el("path", { d: STAG.near, fill: "none", stroke: C.cream, "stroke-width": 2.4 }));
    art.appendChild(el("path", { d: STAG.beam, fill: "none", stroke: C.cream, "stroke-width": 3.6 }));
    art.appendChild(el("path", { d: STAG.head, fill: C.cream }));
    art.appendChild(el("circle", { cx: 41.6, cy: 58.4, r: 1.6, fill: C.oakDark }));
    inner.appendChild(art); g.appendChild(inner);
    return { g: g, halo: halo };
  }
  function cap(x, text) { return el("text", { x: x, y: 160, "text-anchor": "middle", fill: C.fg, "font-family": "Cormorant Garamond, Georgia, serif", "font-size": 24, "font-style": "italic" }, [document.createTextNode(text)]); }

  var H = hare(), solo = hunter(true), S = stag();
  var ring = [hunter(true), hunter(false), hunter(true), hunter(false)];
  svg.appendChild(H); svg.appendChild(solo); svg.appendChild(S.g); ring.forEach(function (h) { svg.appendChild(h); });
  svg.appendChild(cap(160, "Alone, a hare.")); svg.appendChild(cap(480, "Together, the stag."));
  host.appendChild(svg);

  var SX = 480, SY = 82, RR = 60;
  var spots = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(function (d) { return [SX + d[0] * RR * 0.78, SY + d[1] * RR * 0.62]; });
  var starts = [[SX - 150, SY - 70], [SX + 150, SY - 70], [SX + 150, SY + 80], [SX - 150, SY + 80]];
  var ease = function (t) { t = Math.max(0, Math.min(1, t)); return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var put = function (n, x, y, o) { n.setAttribute("transform", "translate(" + x.toFixed(1) + " " + y.toFixed(1) + ")"); n.setAttribute("opacity", o == null ? 1 : o.toFixed(2)); };
  var T = 9.5;
  function frame(sec) {
    var t = sec % T, fade = t > T - .6 ? (T - t) / .6 : t < .4 ? t / .4 : 1;
    // left: hare hops toward the middle, one hunter walks over and takes it
    var hx = lerp(108, 176, ease((t - .2) / 2.2)), hop = Math.abs(Math.sin(Math.min(t, 2.6) * Math.PI * 2.2)) * 9 * (t < 2.6 ? 1 : 0);
    var caught = ease((t - 3.1) / .5);
    put(H, hx, 86 - hop, fade * (1 - caught * .85));
    put(solo, lerp(40, 146, ease((t - 1.2) / 1.9)), 86, fade);
    // right: four hunters close in on the stag, then it's caught
    ring.forEach(function (h, i) { var k = ease((t - 2.6 - i * .35) / 1.8); put(h, lerp(starts[i][0], spots[i][0], k), lerp(starts[i][1], spots[i][1], k), fade * Math.min(1, k * 3)); });
    put(S.g, SX, SY, fade);
    var glow = ease((t - 5.4) / .6); S.halo.setAttribute("opacity", (glow * fade).toFixed(2));
  }
  var still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (still) { frame(7); return; }
  var t0 = null, on = true, raf;
  function loop(ts) { if (t0 == null) t0 = ts; frame((ts - t0) / 1000); if (on) raf = requestAnimationFrame(loop); }
  if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { var v = es[0].isIntersecting; if (v && !on) { on = true; raf = requestAnimationFrame(loop); } else if (!v) { on = false; cancelAnimationFrame(raf); } }).observe(host);
  frame(0); raf = requestAnimationFrame(loop);
})();
