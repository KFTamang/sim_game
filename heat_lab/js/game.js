/*
 * game.js — Heat Lab UI: paint conductive material, watch the temperature field and
 * the heat flow, submit a score.
 */
(function () {
  'use strict';

  const H = window.Heat;
  const STAGES = window.HeatStages.STAGES;
  const $ = (id) => document.getElementById(id);
  const cv = $('cv'), ctx = cv.getContext('2d');
  const fxc = $('fx'), fctx = fxc.getContext('2d');

  // ------------------------------------------------------------------ state
  const S = {
    idx: 0, st: null, P: null, ref: null,
    mat: null, T: null, ev: null, flux: null, conn: null, maxFlux: 1,
    cost: 0,
    undo: [], redo: [],
    matId: 1, brush: 1, erase: false,
    showTemp: true, showFlux: true,
    stroke: null, hover: null, dirty: false, line: null,
    submitted: false,
    saved: { designs: {}, best: {}, seenHelp: false },
  };
  const view = { cs: 12, ox: 0, oy: 0, w: 0, h: 0, dpr: 1 };
  const refCache = {};

  // ------------------------------------------------------------------ storage
  const KEY = 'heatlab.v1';
  function load() {
    try { const raw = localStorage.getItem(KEY); if (raw) Object.assign(S.saved, JSON.parse(raw)); } catch (e) { /* ignore */ }
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(S.saved)); } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------------ colour map (inferno-like)
  const STOPS = [[0, 0, 4], [27, 12, 65], [74, 12, 107], [120, 28, 109], [165, 44, 96], [207, 68, 70], [237, 105, 37], [251, 155, 6], [247, 209, 61], [252, 255, 164]];
  const LUT = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * (STOPS.length - 1), a = Math.min(STOPS.length - 2, Math.floor(t)), f = t - a;
    for (let c = 0; c < 3; c++) LUT[i * 3 + c] = Math.round(STOPS[a][c] + (STOPS[a + 1][c] - STOPS[a][c]) * f);
  }

  const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '—');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function toast(msg, ms = 1600) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
  }

  // ------------------------------------------------------------------ stage
  function selectStage(i) {
    S.idx = i; S.st = STAGES[i];
    S.P = H.makeProblem(S.st);
    S.ref = refCache[S.st.id] || (refCache[S.st.id] = H.reference(S.P));
    const saved = S.saved.designs[S.st.id];
    S.mat = new Uint8Array(S.P.n);
    if (saved && saved.length === S.P.n) S.mat.set(saved);
    S.T = new Float64Array(S.P.n);
    S.undo = []; S.redo = [];
    S.submitted = false;
    $('reportCard').hidden = true; $('shareTop').hidden = true;
    initParticles();
    resize();
    recalc();
  }

  function recalc() {
    S.cost = H.costOf(S.mat);
    S.ev = H.evaluate(S.P, S.mat, S.T, { tol: 1e-6, maxIter: 4000 });
    S.flux = H.fluxField(S.P, S.ev.A, S.T);
    let mx = 1e-9;
    for (let i = 0; i < S.P.n; i++) mx = Math.max(mx, Math.hypot(S.flux.fx[i], S.flux.fy[i]));
    S.maxFlux = mx;
    S.conn = H.connectedToSink(S.P, S.mat);
    buildEdges();
    updatePanel();
  }

  function factor() { return S.ref.tmax / S.ev.tmax; }
  function scoreNow() {
    const f = factor();
    if (S.cost <= 0 || f < S.st.target || S.cost > S.st.budget) return null;
    return Math.round(((f - 1) / S.cost) * 10000);
  }

  // ------------------------------------------------------------------ panel
  function updatePanel() {
    const st = S.st, f = factor(), sc = scoreNow();
    $('stageName').textContent = `${st.id}. ${st.name}`;
    $('stageBrief').textContent = st.brief;
    $('tgtVal').textContent = st.target;
    $('budVal').textContent = st.budget;
    $('facVal').textContent = `×${f.toFixed(1)}`;
    const maxF = Math.max(st.target * 1.8, f);
    $('facBar').style.width = `${clamp((f / maxF) * 100, 0, 100)}%`;
    $('facBar').style.background = f >= st.target ? 'var(--ok)' : 'var(--ten)';
    $('tgtMark').style.left = `${(st.target / maxF) * 100}%`;
    $('costVal').textContent = S.cost;
    $('costBar').style.width = `${clamp((S.cost / st.budget) * 100, 0, 100)}%`;
    $('costBar').style.background = S.cost >= st.budget ? 'var(--bad)' : 'var(--ten)';
    $('scoreVal').textContent = sc === null ? '—' : sc;
    const best = S.saved.best[st.id];
    $('bestVal').textContent = best ? `${best.score}(×${best.factor.toFixed(1)} / コスト ${best.cost})` : '—';
    const el = $('status');
    let cls = '', msg;
    if (S.cost === 0) msg = '樹脂だけの状態です。高伝導材を塗って、熱の通り道を作ろう。';
    else if (f < st.target) msg = `目標まであと ×${(st.target - f).toFixed(1)}。まだ熱がこもっている所(明るい所)へ道を伸ばそう。`;
    else { cls = 'ok'; msg = '目標クリア! 「提出」で記録できます。材料を減らしてさらに高得点を狙おう。'; }
    el.className = `status ${cls}`; el.textContent = msg;
    $('submitBtn').disabled = sc === null;
    const isl = islands();
    if (isl > 0 && S.cost > 0) el.textContent += `(放熱窓につながっていない材料 ${isl} セル — 点線)`;
    buildTabs();
  }

  function islands() {
    let n = 0;
    for (let i = 0; i < S.P.n; i++) if ((S.mat[i] === 1 || S.mat[i] === 2) && !S.conn[i]) n++;
    return n;
  }

  function buildTabs() {
    const nav = $('stageTabs'); nav.innerHTML = '';
    STAGES.forEach((st, i) => {
      const b = document.createElement('button');
      b.textContent = `${st.id}. ${st.name}`;
      if (i === S.idx) b.className = 'on';
      if (S.saved.best[st.id]) { const s = document.createElement('span'); s.className = 'star'; s.textContent = '★'; b.appendChild(s); }
      b.onclick = () => selectStage(i);
      nav.appendChild(b);
    });
  }

  function buildPalette() {
    const ms = $('matSeg'); ms.innerHTML = '';
    [[1, '#b9c4d6'], [2, '#e08a55']].forEach(([id, col]) => {
      const m = H.MATS.find((q) => q.id === id);
      const b = document.createElement('button');
      b.innerHTML = `<span class="sw" style="background:${col}"></span>${m.label}`;
      b.dataset.id = id;
      b.onclick = () => { S.matId = id; S.erase = false; refreshPalette(); };
      ms.appendChild(b);
    });
    const er = document.createElement('button');
    er.textContent = '消しゴム'; er.dataset.id = 'erase';
    er.onclick = () => { S.erase = true; refreshPalette(); };
    ms.appendChild(er);
    const bs = $('brushSeg'); bs.innerHTML = '';
    [['細', 0], ['中', 1], ['太', 2]].forEach(([label, r]) => {
      const b = document.createElement('button');
      b.textContent = `筆: ${label}`; b.dataset.r = r;
      b.onclick = () => { S.brush = r; refreshPalette(); };
      bs.appendChild(b);
    });
    refreshPalette();
  }
  function refreshPalette() {
    document.querySelectorAll('#matSeg button').forEach((b) => {
      b.classList.toggle('on', S.erase ? b.dataset.id === 'erase' : +b.dataset.id === S.matId);
    });
    document.querySelectorAll('#brushSeg button').forEach((b) => b.classList.toggle('on', +b.dataset.r === S.brush));
    const m = H.MATS.find((q) => q.id === S.matId);
    $('matInfo').textContent = S.erase ? '塗った材料を消します。'
      : `${m.label}: 熱伝導率 ${m.k}(樹脂の${m.k}倍)・1セル あたりコスト ${m.cost}`;
  }

  // ------------------------------------------------------------------ view
  function resize() {
    const r = cv.parentElement.getBoundingClientRect();
    view.dpr = window.devicePixelRatio || 1;
    view.w = Math.max(200, r.width); view.h = Math.max(200, r.height);
    for (const c of [cv, fxc]) { c.width = Math.round(view.w * view.dpr); c.height = Math.round(view.h * view.dpr); }
    if (!S.P) return;
    const pad = 28;
    view.cs = Math.min((view.w - pad * 2) / S.P.w, (view.h - pad * 2) / S.P.h);
    view.ox = (view.w - view.cs * S.P.w) / 2;
    view.oy = (view.h - view.cs * S.P.h) / 2;
    fctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    fctx.clearRect(0, 0, view.w, view.h);
  }
  window.addEventListener('resize', resize);

  // heat image (one pixel per cell) and material edges (path in cell units)
  const heatCv = document.createElement('canvas');
  let edgePath = null, edgeKinds = null;
  function buildEdges() {
    const { w, h } = S.P;
    const ap = new Path2D(), op = new Path2D();
    const seg = (p, x0, y0, x1, y1) => { p.moveTo(x0, y0); p.lineTo(x1, y1); };
    const kind = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return -1;
      const i = y * w + x;
      return S.P.obstacle[i] ? 9 : S.mat[i];
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const a = kind(x, y);
        if (a !== 1 && a !== 2 && a !== 9) continue;
        const p = a === 9 ? op : ap;
        if (kind(x - 1, y) !== a) seg(p, x, y, x, y + 1);
        if (kind(x + 1, y) !== a) seg(p, x + 1, y, x + 1, y + 1);
        if (kind(x, y - 1) !== a) seg(p, x, y, x + 1, y);
        if (kind(x, y + 1) !== a) seg(p, x, y + 1, x + 1, y + 1);
      }
    }
    edgePath = ap; edgeKinds = op;
  }

  function drawHeat(time) {
    const { w, h, n } = S.P;
    if (heatCv.width !== w || heatCv.height !== h) { heatCv.width = w; heatCv.height = h; }
    const hc = heatCv.getContext('2d');
    const img = hc.createImageData(w, h);
    const d = img.data;
    for (let i = 0; i < n; i++) {
      let r, g, b;
      if (S.P.obstacle[i]) { r = 34; g = 40; b = 54; }
      else {
        if (S.showTemp) {
          const li = clamp(Math.round(255 * Math.sqrt(S.T[i] / S.ref.tmax)), 0, 255) * 3;
          r = LUT[li]; g = LUT[li + 1]; b = LUT[li + 2];
        } else { r = 30; g = 36; b = 50; }
        const m = S.mat[i];
        if (m === 1) { r = r * 0.55 + 190 * 0.45; g = g * 0.55 + 200 * 0.45; b = b * 0.55 + 218 * 0.45; }
        else if (m === 2) { r = r * 0.5 + 230 * 0.5; g = g * 0.5 + 140 * 0.5; b = b * 0.5 + 85 * 0.5; }
      }
      d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
    }
    hc.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(heatCv, view.ox, view.oy, view.cs * w, view.cs * h);

    // material outlines
    ctx.save();
    ctx.translate(view.ox, view.oy); ctx.scale(view.cs, view.cs);
    ctx.lineWidth = Math.max(1, view.cs * 0.12) / view.cs;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.stroke(edgePath);
    ctx.strokeStyle = 'rgba(120,140,170,0.6)'; ctx.stroke(edgeKinds);
    // islands (not connected to the sink): dotted overlay
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let i = 0; i < n; i++) {
      if ((S.mat[i] === 1 || S.mat[i] === 2) && !S.conn[i]) ctx.fillRect(i % w + 0.3, ((i / w) | 0) + 0.3, 0.4, 0.4);
    }
    ctx.restore();

    // heat sinks
    ctx.fillStyle = '#4cc9f0';
    S.st.sinks.forEach((s) => {
      const t = view.cs * (s.to - s.from + 1), th = 6;
      if (s.side === 'bottom') ctx.fillRect(view.ox + view.cs * s.from, view.oy + view.cs * h, t, th);
      else if (s.side === 'top') ctx.fillRect(view.ox + view.cs * s.from, view.oy - th, t, th);
      else if (s.side === 'left') ctx.fillRect(view.ox - th, view.oy + view.cs * s.from, th, t);
      else ctx.fillRect(view.ox + view.cs * w, view.oy + view.cs * s.from, th, t);
    });
    ctx.fillStyle = '#4cc9f0'; ctx.font = '12px system-ui'; ctx.textAlign = 'center';
    const s0 = S.st.sinks[0], mid = (s0.from + s0.to + 1) / 2 * view.cs;
    if (s0.side === 'bottom') ctx.fillText(S.st.sinkLabel || '放熱窓', view.ox + mid, view.oy + view.cs * h + 20);
    else if (s0.side === 'top') ctx.fillText(S.st.sinkLabel || '放熱窓', view.ox + mid, view.oy - 10);
    else if (s0.side === 'right') { ctx.textAlign = 'left'; ctx.fillText(S.st.sinkLabel || '放熱窓', view.ox + view.cs * w + 10, view.oy + mid + 4); }
    else { ctx.textAlign = 'right'; ctx.fillText(S.st.sinkLabel || '放熱窓', view.ox - 10, view.oy + mid + 4); }

    // frame
    ctx.strokeStyle = '#2a3a54'; ctx.lineWidth = 1;
    ctx.strokeRect(view.ox - 0.5, view.oy - 0.5, view.cs * w + 1, view.cs * h + 1);

    // hottest cell
    if (S.ev && S.ev.hot >= 0) {
      const hx = view.ox + ((S.ev.hot % w) + 0.5) * view.cs, hy = view.oy + (((S.ev.hot / w) | 0) + 0.5) * view.cs;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(hx, hy, view.cs * (0.9 + 0.15 * Math.sin(time * 5)), 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = '600 11px system-ui'; ctx.textAlign = 'left';
      ctx.fillText(`最高温 ${(S.ev.tmax / S.ref.tmax * 100).toFixed(0)}%`, hx + view.cs * 1.2, hy - view.cs * 0.8);
    }

    // straight-line preview
    if (S.line && S.hover) {
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.setLineDash([5, 4]); ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(view.ox + (S.line.x + 0.5) * view.cs, view.oy + (S.line.y + 0.5) * view.cs);
      ctx.lineTo(view.ox + (S.hover.x + 0.5) * view.cs, view.oy + (S.hover.y + 0.5) * view.cs);
      ctx.stroke(); ctx.setLineDash([]);
    } else if (S.hover && !S.stroke) {
      // brush outline
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1;
      const r = S.brush;
      ctx.strokeRect(view.ox + (S.hover.x - r) * view.cs, view.oy + (S.hover.y - r) * view.cs, (2 * r + 1) * view.cs, (2 * r + 1) * view.cs);
    }
  }

  // ------------------------------------------------------------------ heat-flow particles
  const NP = 900;
  const px = new Float32Array(NP), py = new Float32Array(NP);
  let qmaxCell = 1;
  function spawn(k) {
    const { w, h, q, obstacle } = S.P;
    for (let t = 0; t < 40; t++) {
      const x = Math.random() * w, y = Math.random() * h;
      const i = (y | 0) * w + (x | 0);
      if (!obstacle[i] && q[i] > Math.random() * qmaxCell) { px[k] = x; py[k] = y; return; }
    }
    px[k] = Math.random() * w; py[k] = Math.random() * h;
  }
  function initParticles() {
    qmaxCell = 0;
    for (let i = 0; i < S.P.n; i++) qmaxCell = Math.max(qmaxCell, S.P.q[i]);
    for (let k = 0; k < NP; k++) spawn(k);
  }
  function stepParticles() {
    fctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    if (!S.showFlux) { fctx.clearRect(0, 0, view.w, view.h); return; }
    fctx.globalCompositeOperation = 'destination-out';
    fctx.fillStyle = 'rgba(0,0,0,0.16)'; fctx.fillRect(0, 0, view.w, view.h);
    fctx.globalCompositeOperation = 'source-over';
    fctx.strokeStyle = 'rgba(255,255,255,0.85)'; fctx.lineWidth = 1.3; fctx.lineCap = 'round';
    const { w, h } = S.P, { fx, fy } = S.flux;
    fctx.beginPath();
    for (let k = 0; k < NP; k++) {
      const ix = px[k] | 0, iy = py[k] | 0;
      if (ix < 0 || iy < 0 || ix >= w || iy >= h) { spawn(k); continue; }
      const i = iy * w + ix;
      const mag = Math.hypot(fx[i], fy[i]);
      if (mag < 1e-9 || S.P.obstacle[i]) { if (Math.random() < 0.05) spawn(k); continue; }
      const v = 0.03 + 0.5 * Math.sqrt(mag / S.maxFlux);
      const nx = px[k] + (fx[i] / mag) * v, ny = py[k] + (fy[i] / mag) * v;
      fctx.moveTo(view.ox + px[k] * view.cs, view.oy + py[k] * view.cs);
      fctx.lineTo(view.ox + nx * view.cs, view.oy + ny * view.cs);
      px[k] = nx; py[k] = ny;
    }
    fctx.stroke();
  }

  // ------------------------------------------------------------------ painting
  function cellAt(e) {
    const r = cv.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left - view.ox) / view.cs), y = Math.floor((e.clientY - r.top - view.oy) / view.cs);
    if (x < 0 || y < 0 || x >= S.P.w || y >= S.P.h) return null;
    return { x, y };
  }

  function paintCell(x, y, id) {
    const { w, h } = S.P;
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (S.P.obstacle[i] || S.mat[i] === id) return;
    const delta = H.COST_OF[id] - H.COST_OF[S.mat[i]];
    if (delta > 0 && S.cost + delta > S.st.budget) { S.stroke.blocked = true; return; }
    if (!S.stroke.pushed) { S.undo.push(Uint8Array.from(S.mat)); S.redo = []; if (S.undo.length > 100) S.undo.shift(); S.stroke.pushed = true; }
    S.mat[i] = id; S.cost += delta; S.dirty = true; S.submitted = false;
  }
  function paintBrush(cx, cy, id) {
    const r = S.brush;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (r === 2 && Math.abs(dx) === 2 && Math.abs(dy) === 2) continue; // rounded corners
        paintCell(cx + dx, cy + dy, id);
      }
    }
  }
  function paintLine(a, b, id) {
    let x0 = a.x, y0 = a.y; const x1 = b.x, y1 = b.y;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      paintBrush(x0, y0, id);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('pointerdown', (e) => {
    const c = cellAt(e); if (!c) return;
    cv.setPointerCapture(e.pointerId);
    const erase = e.button === 2 || S.erase;
    S.stroke = { erase, last: c, pushed: false, blocked: false };
    const id = erase ? 0 : S.matId;
    if (e.shiftKey) { S.line = c; S.stroke.lineMode = true; }
    else paintBrush(c.x, c.y, id);
  });
  cv.addEventListener('pointermove', (e) => {
    const c = cellAt(e);
    S.hover = c;
    showCellInfo(c);
    if (!S.stroke || !c) return;
    if (S.stroke.lineMode) return;
    paintLine(S.stroke.last, c, S.stroke.erase ? 0 : S.matId);
    S.stroke.last = c;
  });
  cv.addEventListener('pointerup', (e) => {
    if (!S.stroke) return;
    const c = cellAt(e);
    if (S.stroke.lineMode && c && S.line) paintLine(S.line, c, S.stroke.erase ? 0 : S.matId);
    if (S.stroke.blocked) toast('予算が足りません');
    S.stroke = null; S.line = null;
  });
  cv.addEventListener('pointerleave', () => { S.hover = null; });

  function showCellInfo(c) {
    const el = $('cellInfo');
    if (!c) { el.textContent = 'マウスを重ねると温度が出ます'; return; }
    const i = c.y * S.P.w + c.x;
    const name = S.P.obstacle[i] ? '断熱(穴)' : H.MATS.find((m) => m.id === S.mat[i]).label;
    el.textContent = `(${c.x}, ${c.y}) ${name} — 温度 ${(S.T[i] / S.ref.tmax * 100).toFixed(1)}%`;
  }

  function undo() {
    if (!S.undo.length) return;
    S.redo.push(Uint8Array.from(S.mat)); S.mat = S.undo.pop(); S.dirty = true;
  }
  function redo() {
    if (!S.redo.length) return;
    S.undo.push(Uint8Array.from(S.mat)); S.mat = S.redo.pop(); S.dirty = true;
  }

  $('undoBtn').onclick = undo;
  $('redoBtn').onclick = redo;
  $('clearBtn').onclick = () => {
    if (!S.mat.some((v) => v)) return;
    S.undo.push(Uint8Array.from(S.mat)); S.redo = []; S.mat.fill(0); S.dirty = true;
  };
  $('chkTemp').onchange = (e) => { S.showTemp = e.target.checked; };
  $('chkFlux').onchange = (e) => { S.showFlux = e.target.checked; };
  $('helpBtn').onclick = (e) => { e.preventDefault(); $('helpDlg').showModal(); };
  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (e.key === '1') { S.matId = 1; S.erase = false; }
    else if (e.key === '2') { S.matId = 2; S.erase = false; }
    else if (e.key.toLowerCase() === 'e') S.erase = !S.erase;
    else if (e.key === '[') S.brush = Math.max(0, S.brush - 1);
    else if (e.key === ']') S.brush = Math.min(2, S.brush + 1);
    else return;
    refreshPalette();
  });

  // ------------------------------------------------------------------ submit
  function hints() {
    const out = [];
    const { w, h } = S.P;
    // 1) hottest cell far from any material
    let dmin = 99;
    const hx = S.ev.hot % w, hy = (S.ev.hot / w) | 0;
    for (let r = 1; r <= 30 && dmin === 99; r++) {
      for (let dy = -r; dy <= r && dmin === 99; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = hx + dx, y = hy + dy;
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const m = S.mat[y * w + x];
          if (m === 1 || m === 2) { dmin = r; break; }
        }
      }
    }
    if (dmin >= 5) out.push(`最も熱い所は、材料から ${dmin} セル離れています。樹脂の中で熱が歩く距離が2倍になると、温度上昇は<b>約4倍</b>(距離の2乗)。枝をもう1本伸ばした方が効きます。`);
    // 2) trunk bottleneck: temperature drop inside the connected material
    let tRoot = 0, nRoot = 0, tTip = 0;
    for (let i = 0; i < S.P.n; i++) {
      if (!S.conn[i]) continue;
      tTip = Math.max(tTip, S.T[i]);
      const x = i % w, y = (i / w) | 0;
      const nearSink = S.P.sink[i];
      if (nearSink) { tRoot += S.T[i]; nRoot++; }
      void x; void y;
    }
    if (nRoot) tRoot /= nRoot;
    if (nRoot && tTip - tRoot > 0.6 * S.ev.tmax) out.push('材料の内部でも大きな温度差が出ています。<b>根元には全体の熱が集まる</b>ので、根元ほど太く(または銅に)、先端ほど細くすると効率が上がります。');
    // 3) islands
    const isl = islands();
    if (isl > 0) out.push(`放熱窓につながっていない材料が ${isl} セルあります。つなげるか、消してコストを減らしましょう。`);
    // 4) copper
    let cu = 0; for (let i = 0; i < S.P.n; i++) if (S.mat[i] === 2) cu++;
    if (cu === 0) out.push('銅(熱伝導率が高いがコストも3倍)は未使用です。<b>熱が集中する根元だけ銅</b>にすると効率が良くなることがあります。');
    return out.slice(0, 3);
  }

  function shareText() {
    const st = S.st, f = factor(), sc = scoreNow();
    const lines = [`Heat Lab「${st.id}. ${st.name}」で熱の通り道を設計しました!`,
      `冷却 ×${f.toFixed(1)} / 材料コスト ${S.cost} / スコア ${sc}`, '#HeatLab'];
    const params = new URLSearchParams({ text: lines.join('\n') });
    if (/^https?:$/.test(location.protocol)) params.set('url', location.href.split('#')[0]);
    return `https://x.com/intent/post?${params.toString()}`;
  }
  function share() { window.open(shareText(), '_blank', 'noopener'); }

  $('submitBtn').onclick = () => {
    const sc = scoreNow(); if (sc === null) return;
    const st = S.st, f = factor();
    S.submitted = true;
    S.saved.designs[st.id] = Array.from(S.mat);
    const prev = S.saved.best[st.id];
    let msg = '';
    if (!prev || sc > prev.score) { S.saved.best[st.id] = { score: sc, factor: f, cost: S.cost }; msg = ' <b class="pass">ベスト更新!</b>'; }
    persist(); buildTabs(); updatePanel();
    const hs = hints().map((t) => `<li class="hint-li">${t}</li>`).join('');
    $('reportCard').hidden = false;
    $('report').innerHTML = `
      <p class="pass"><b>合格</b> — 冷却 ×${f.toFixed(1)}(最高温 ${(100 / f).toFixed(0)}%) / コスト ${S.cost} / スコア <b>${sc}</b>${msg}</p>
      <div class="explain"><b>ヒント</b><ul>${hs || '<li>すばらしい設計です。材料を減らして効率を上げられるか試してみよう。</li>'}</ul></div>`;
    $('reportCard').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    $('shareTop').hidden = false;
  };
  $('shareBtn').onclick = share;
  $('shareTop').onclick = share;

  // ------------------------------------------------------------------ main loop
  let busy = false;
  function frame(now) {
    if (S.dirty && !busy) {
      busy = true; S.dirty = false;
      recalc();
      if (!S.submitted) { $('shareTop').hidden = true; $('reportCard').hidden = true; }
      busy = false;
    }
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);
    ctx.fillStyle = '#0f1722'; ctx.fillRect(0, 0, view.w, view.h);
    drawHeat(now / 1000);
    stepParticles();
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------ boot
  load();
  buildPalette();
  selectStage(0);
  requestAnimationFrame(frame);
  if (!S.saved.seenHelp) {
    S.saved.seenHelp = true; persist();
    try { $('helpDlg').showModal(); } catch (e) { /* ignore */ }
  }
  window.__heat = { S, H, selectStage, recalc };
})();
