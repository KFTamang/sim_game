/*
 * game.js — Entropy Lab UI: paint mirrors / rough walls, run the gas, watch the entropy.
 */
(function () {
  'use strict';

  const E = window.Entropy;
  const STAGES = window.EntropyStages.STAGES;
  const $ = (id) => document.getElementById(id);
  const cv = $('cv'), ctx = cv.getContext('2d');
  const plot = $('plot'), pctx = plot.getContext('2d');

  const S = {
    idx: 0, st: null, P: null, mat: null, cost: 0, undo: [], redo: [],
    matId: 1, brush: 0, erase: false, showBins: false,
    stroke: null, hover: null, dirty: false, line: null, submitted: false,
    pred: null,
    live: { sim: null, running: false, speed: 4, trace: [], revAt: -1, hist: [], replay: false, ticks: 0, acc: 0 },
    saved: { designs: {}, best: {}, seenHelp: false },
  };
  const view = { cs: 12, ox: 0, oy: 0, w: 0, h: 0, dpr: 1 };

  const KEY = 'entropylab.v1';
  function load() { try { const raw = localStorage.getItem(KEY); if (raw) Object.assign(S.saved, JSON.parse(raw)); } catch (e) { /* ignore */ } }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(S.saved)); } catch (e) { /* ignore */ } }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function toast(msg, ms = 1600) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
  }

  // ------------------------------------------------------------------ stage
  function selectStage(i) {
    S.idx = i; S.st = STAGES[i];
    S.P = E.makeProblem(S.st);
    const saved = S.saved.designs[S.st.id];
    S.mat = new Uint8Array(S.P.n);
    if (saved && saved.length === S.P.n) S.mat.set(saved);
    S.undo = []; S.redo = []; S.submitted = false;
    if (!S.st.tools.includes(S.matId)) S.matId = S.st.tools[0];
    S.erase = false;
    Z.reset();
    $('reportCard').hidden = true; $('shareTop').hidden = true;
    buildPalette(); resize(); recalc();
  }

  function recalc() {
    S.cost = E.costOf(S.mat);
    S.pred = E.simulate(S.P, S.mat, { full: true, tmax: S.st.tLimit });
    resetLive();
    updatePanel();
  }

  function scoreNow() {
    if (S.cost <= 0 || S.cost > S.st.budget || !Number.isFinite(S.pred.t90) || S.pred.t90 > S.st.tLimit) return null;
    return E.scoreOf(S.P, S.pred.t90);
  }

  // ------------------------------------------------------------------ panel
  function updatePanel() {
    const st = S.st, sc = scoreNow(), t90 = S.pred.t90, ok = Number.isFinite(t90);
    $('stageName').textContent = `${st.id}. ${st.name}`;
    $('stageBrief').textContent = st.brief;
    $('tLim').textContent = st.tLimit;
    $('tVal').textContent = ok ? t90 : `未達(最大 ${(S.pred.final * 100).toFixed(0)}%)`;
    $('tBar').style.width = ok ? `${clamp((1 - t90 / st.tLimit) * 100, 4, 100)}%` : '0%';
    $('tBar').style.background = ok ? 'var(--ok)' : 'var(--ten)';
    $('budVal').textContent = st.budget; $('costVal').textContent = S.cost;
    $('costBar').style.width = `${clamp((S.cost / st.budget) * 100, 0, 100)}%`;
    $('costBar').style.background = S.cost >= st.budget ? 'var(--bad)' : 'var(--ten)';
    $('scoreVal').textContent = sc === null ? '—' : sc;
    const best = S.saved.best[st.id];
    $('bestVal').textContent = best ? `${best.score}(時間 ${best.t90} / コスト ${best.cost})` : '—';
    const el = $('status');
    let cls = '', msg;
    if (S.cost === 0) msg = '壁がありません。ビームは箱の中を行き来するだけ。▶ 実行して様子を見よう。';
    else if (!ok) msg = `まだ90%に届きません(最大 ${(S.pred.final * 100).toFixed(0)}%)。粒子の向きをもっと散らす壁を足そう。`;
    else { cls = 'ok'; msg = `${t90} で90%に到達。「提出」で記録できます。もっと速くできる?`; }
    el.className = `status ${cls}`; el.textContent = msg;
    $('submitBtn').disabled = sc === null;
    buildTabs();
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

  const MATINFO = { 1: ['鏡', '#c8d3e3', '反射するだけ。コスト 1/セル。丸い形ほど向きを散らす。'], 2: ['ざらざら', '#e08a55', '当たった粒子が来た向きを忘れる。コスト 3/セル。'] };
  function buildPalette() {
    const ms = $('matSeg'); ms.innerHTML = '';
    S.st.tools.forEach((id) => {
      const [label, col] = MATINFO[id];
      const b = document.createElement('button');
      b.innerHTML = `<span class="sw" style="background:${col}"></span>${label}`; b.dataset.id = id;
      b.onclick = () => { S.matId = id; S.erase = false; refreshPalette(); };
      ms.appendChild(b);
    });
    const er = document.createElement('button'); er.textContent = '消しゴム'; er.dataset.id = 'erase';
    er.onclick = () => { S.erase = true; refreshPalette(); }; ms.appendChild(er);
    const bs = $('brushSeg'); bs.innerHTML = '';
    [['点', 0], ['中', 1], ['大', 2]].forEach(([label, r]) => {
      const b = document.createElement('button'); b.textContent = `筆: ${label}`; b.dataset.r = r;
      b.onclick = () => { S.brush = r; refreshPalette(); }; bs.appendChild(b);
    });
    const sp = $('speedSeg'); sp.innerHTML = '';
    [['×1', 1], ['×4', 4], ['×12', 12]].forEach(([label, v]) => {
      const b = document.createElement('button'); b.textContent = `速さ ${label}`; b.dataset.v = v;
      b.onclick = () => { S.live.speed = v; refreshPalette(); }; sp.appendChild(b);
    });
    refreshPalette();
  }
  function refreshPalette() {
    document.querySelectorAll('#matSeg button').forEach((b) => b.classList.toggle('on', S.erase ? b.dataset.id === 'erase' : +b.dataset.id === S.matId));
    document.querySelectorAll('#brushSeg button').forEach((b) => b.classList.toggle('on', +b.dataset.r === S.brush));
    document.querySelectorAll('#speedSeg button').forEach((b) => b.classList.toggle('on', +b.dataset.v === S.live.speed));
    $('matInfo').textContent = S.erase ? '塗った壁を消します。' : MATINFO[S.matId][2];
  }

  // ------------------------------------------------------------------ view
  const Z = window.ViewZoom.attach(cv, { onChange: () => applyZoom(), cancel: cancelStroke });
  function cancelStroke() {
    if (!S.stroke) return;
    if (S.stroke.pushed) { S.mat = S.undo.pop(); S.dirty = true; }
    S.stroke = null; S.line = null;
  }
  function applyZoom() {
    if (!view.base) return;
    view.cs = view.base.cs * Z.k; view.ox = view.base.ox * Z.k + Z.tx; view.oy = view.base.oy * Z.k + Z.ty;
  }
  function resize() {
    const r = cv.parentElement.getBoundingClientRect();
    view.dpr = window.devicePixelRatio || 1;
    view.w = Math.max(1, r.width); view.h = Math.max(1, r.height);
    Z.setSize(view.w, view.h);
    cv.width = Math.round(view.w * view.dpr); cv.height = Math.round(view.h * view.dpr);
    const pr = plot.getBoundingClientRect();
    plot.width = Math.round(pr.width * view.dpr); plot.height = Math.round(150 * view.dpr);
    if (!S.P) return;
    const pad = 20;
    const cs0 = Math.max(2, Math.min((view.w - pad * 2) / S.P.w, (view.h - pad * 2) / S.P.h));
    view.base = { cs: cs0, ox: (view.w - cs0 * S.P.w) / 2, oy: (view.h - cs0 * S.P.h) / 2 };
    applyZoom();
  }
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(() => resize()).observe(cv.parentElement);

  // ------------------------------------------------------------------ live run
  // States are recorded every half time unit so a mirror-only world can be played backwards exactly.
  function snapshot(sim) { const a = new Float32Array(4 * E.NP); a.set(sim.px, 0); a.set(sim.py, E.NP); a.set(sim.vx, 2 * E.NP); a.set(sim.vy, 3 * E.NP); return a; }
  function restore(sim, a) { for (let i = 0; i < E.NP; i++) { sim.px[i] = a[i]; sim.py[i] = a[E.NP + i]; sim.vx[i] = a[2 * E.NP + i]; sim.vy[i] = a[3 * E.NP + i]; } }
  function resetLive() {
    const L = S.live;
    L.sim = E.initState(S.P); L.running = false; L.trace = [E.entropyNow(L.sim)]; L.revAt = -1; L.acc = 0;
    L.replay = false; L.ticks = 0; L.hist = [snapshot(L.sim)];
    $('runBtn').textContent = '▶ 実行';
  }
  function stepLive(dtMs) {
    const L = S.live; if (!L.running) return;
    L.acc += (dtMs / 1000) * L.speed * 6;        // time units per real second = 6 x speed
    const steps = Math.floor(L.acc / E.DT);
    if (steps <= 0) return;
    L.acc -= steps * E.DT;
    if (L.replay) {                              // exact time reversal: play the recorded states backwards
      for (let k = 0; k < steps; k += 2) {
        if (L.hist.length <= 1) { stopLive(); toast('元のビームに戻った! 鏡だけの世界は完全に可逆です', 3200); return; }
        L.hist.pop(); restore(L.sim, L.hist[L.hist.length - 1]); L.sim.t = (L.hist.length - 1) * 0.5;
        if (Math.abs(L.sim.t - Math.round(L.sim.t)) < 1e-6) L.trace.push(E.entropyNow(L.sim));
      }
      return;
    }
    for (let k = 0; k < steps; k++) {
      const before = Math.floor(L.sim.t + 1e-9);
      E.advance(L.sim, S.mat, 1);
      if (++L.ticks % 2 === 0) L.hist.push(snapshot(L.sim));
      if (Math.floor(L.sim.t + 1e-9) > before) L.trace.push(E.entropyNow(L.sim));
    }
    if (L.trace.length > S.st.tLimit + 200) stopLive();
  }
  function stopLive() { S.live.running = false; $('runBtn').textContent = '▶ 実行'; }
  $('runBtn').onclick = () => {
    const L = S.live;
    if (L.trace.length > S.st.tLimit + 150) resetLive();
    if (L.replay && L.hist.length <= 1) resetLive();
    L.running = !L.running; $('runBtn').textContent = L.running ? '⏸ 一時停止' : '▶ 実行';
  };
  $('resetBtn').onclick = () => resetLive();
  $('revBtn').onclick = () => {
    const L = S.live;
    if (L.trace.length < 3 || L.replay) { toast(L.replay ? 'いまは逆再生中' : '先に実行して、少し時間を進めよう'); return; }
    L.revAt = L.trace.length - 1;
    if (S.mat.some((v) => v === E.ROUGH)) {
      E.reverse(L.sim);                           // real dynamics: the rough walls re-randomise, so no way back
      L.hist = [snapshot(L.sim)]; L.ticks = 0;
      toast('向きを反転! でもざらざらの壁は向きを忘れさせるので、戻れない…', 3200);
    } else {
      L.replay = true;
      toast('全粒子の向きを反転! 鏡だけなら来た道を逆にたどる', 2600);
    }
    if (!L.running) { L.running = true; $('runBtn').textContent = '⏸ 一時停止'; }
  };

  // ------------------------------------------------------------------ drawing
  const HUES = []; for (let i = 0; i < 36; i++) HUES.push(`hsl(${i * 10} 90% 62%)`);
  function draw() {
    const { w, h } = S.P;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.fillStyle = '#0f1722'; ctx.fillRect(0, 0, view.w, view.h);
    const X = (x) => view.ox + x * view.cs, Y = (y) => view.oy + y * view.cs;
    ctx.fillStyle = '#131d2c'; ctx.fillRect(X(0), Y(0), view.cs * w, view.cs * h);
    // build area hint
    const b = S.st.build;
    ctx.fillStyle = 'rgba(76,201,240,0.045)'; ctx.fillRect(X(b[0]), Y(b[1]), view.cs * (b[2] - b[0] + 1), view.cs * (b[3] - b[1] + 1));
    // walls and painted cells
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (S.P.fixed[i]) { ctx.fillStyle = '#3a465c'; ctx.fillRect(X(x), Y(y), view.cs + 0.5, view.cs + 0.5); }
      else if (S.mat[i] === 1) { ctx.fillStyle = '#c8d3e3'; ctx.fillRect(X(x), Y(y), view.cs + 0.5, view.cs + 0.5); }
      else if (S.mat[i] === 2) {
        ctx.fillStyle = '#e08a55'; ctx.fillRect(X(x), Y(y), view.cs + 0.5, view.cs + 0.5);
        ctx.fillStyle = '#7a3d1b';
        const d = view.cs * 0.16;
        ctx.fillRect(X(x) + view.cs * 0.2, Y(y) + view.cs * 0.25, d, d); ctx.fillRect(X(x) + view.cs * 0.62, Y(y) + view.cs * 0.55, d, d); ctx.fillRect(X(x) + view.cs * 0.3, Y(y) + view.cs * 0.7, d, d);
      }
    }
    // aggregation bins
    if (S.showBins) {
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      for (let i = 1; i < E.GX; i++) { ctx.beginPath(); ctx.moveTo(X((i / E.GX) * w), Y(0)); ctx.lineTo(X((i / E.GX) * w), Y(h)); ctx.stroke(); }
      for (let j = 1; j < E.GY; j++) { ctx.beginPath(); ctx.moveTo(X(0), Y((j / E.GY) * h)); ctx.lineTo(X(w), Y((j / E.GY) * h)); ctx.stroke(); }
      ctx.setLineDash([]);
    }
    // source
    const sr = S.st.source;
    ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 2; ctx.strokeRect(X(sr[0]), Y(sr[1]), view.cs * (sr[2] - sr[0] + 1), view.cs * (sr[3] - sr[1] + 1));
    ctx.fillStyle = '#4ade80'; ctx.font = '12px system-ui'; ctx.textAlign = 'left';
    ctx.fillText('ビーム →', X(sr[0]), Y(sr[1]) - 6);
    // particles
    const sim = S.live.sim;
    const r = clamp(view.cs * 0.16, 1.2, 3);
    for (let i = 0; i < E.NP; i++) {
      const a = Math.atan2(sim.vy[i], sim.vx[i]);
      ctx.fillStyle = HUES[((Math.round(((a + Math.PI) / (2 * Math.PI)) * 36)) % 36 + 36) % 36];
      ctx.fillRect(X(sim.px[i]) - r, Y(sim.py[i]) - r, 2 * r, 2 * r);
    }
    // frame
    ctx.strokeStyle = '#2a3a54'; ctx.lineWidth = 1; ctx.strokeRect(X(0) - 0.5, Y(0) - 0.5, view.cs * w + 1, view.cs * h + 1);
    // brush outline / line preview
    if (S.line && S.hover) {
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.setLineDash([5, 4]); ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(X(S.line.x + 0.5), Y(S.line.y + 0.5)); ctx.lineTo(X(S.hover.x + 0.5), Y(S.hover.y + 0.5)); ctx.stroke(); ctx.setLineDash([]);
    } else if (S.hover && !S.stroke) {
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1;
      const rr = S.brush; ctx.strokeRect(X(S.hover.x - rr), Y(S.hover.y - rr), (2 * rr + 1) * view.cs, (2 * rr + 1) * view.cs);
    }
    // time label
    ctx.fillStyle = '#9fb3cf'; ctx.font = '600 13px system-ui'; ctx.textAlign = 'right';
    const cur = S.live.trace[S.live.trace.length - 1];
    ctx.fillText(`時間 ${S.live.sim.t.toFixed(0)}  エントロピー ${(cur * 100).toFixed(0)}%`, X(w), Y(0) - 6);
  }

  function drawPlot() {
    const W = plot.width / view.dpr, H = 150;
    pctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    pctx.clearRect(0, 0, W, H);
    const L = 34, B = 20, T = 8, R = 8, tmax = S.st.tLimit;
    const px = (t) => L + (t / tmax) * (W - L - R), py = (v) => H - B - v * (H - B - T);
    pctx.strokeStyle = '#243249'; pctx.lineWidth = 1; pctx.fillStyle = '#7d8fa8'; pctx.font = '10px system-ui'; pctx.textAlign = 'right';
    for (const v of [0, 0.5, 1]) { pctx.beginPath(); pctx.moveTo(L, py(v)); pctx.lineTo(W - R, py(v)); pctx.stroke(); pctx.fillText(`${v * 100}%`, L - 4, py(v) + 3); }
    pctx.strokeStyle = '#4ade80'; pctx.setLineDash([4, 3]); pctx.beginPath(); pctx.moveTo(L, py(E.FRAC)); pctx.lineTo(W - R, py(E.FRAC)); pctx.stroke(); pctx.setLineDash([]);
    pctx.fillStyle = '#4ade80'; pctx.textAlign = 'left'; pctx.fillText('90%', L + 2, py(E.FRAC) - 3);
    pctx.fillStyle = '#7d8fa8'; pctx.textAlign = 'center';
    for (let t = 0; t <= tmax; t += 100) pctx.fillText(t, px(t), H - 5);
    // predicted
    pctx.strokeStyle = '#6c7a90'; pctx.lineWidth = 1.5; pctx.beginPath();
    S.pred.series.forEach((v, t) => { if (t === 0) pctx.moveTo(px(t), py(v)); else pctx.lineTo(px(t), py(v)); });
    pctx.stroke();
    if (Number.isFinite(S.pred.t90)) { pctx.fillStyle = '#4ade80'; pctx.beginPath(); pctx.arc(px(S.pred.t90), py(E.FRAC), 4, 0, 7); pctx.fill(); }
    // live
    const tr = S.live.trace;
    pctx.strokeStyle = '#ffb703'; pctx.lineWidth = 2; pctx.beginPath();
    tr.forEach((v, t) => { if (t === 0) pctx.moveTo(px(t), py(v)); else pctx.lineTo(px(t), py(v)); });
    pctx.stroke();
    if (S.live.revAt >= 0) { pctx.strokeStyle = '#f472b6'; pctx.setLineDash([3, 3]); pctx.beginPath(); pctx.moveTo(px(S.live.revAt), T); pctx.lineTo(px(S.live.revAt), H - B); pctx.stroke(); pctx.setLineDash([]); pctx.fillStyle = '#f472b6'; pctx.textAlign = 'left'; pctx.fillText('反転', px(S.live.revAt) + 3, T + 9); }
    pctx.fillStyle = '#ffb703'; pctx.beginPath(); pctx.arc(px(tr.length - 1), py(tr[tr.length - 1]), 3.5, 0, 7); pctx.fill();
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
    if (!S.P.build[i] || S.mat[i] === id) return;
    const delta = E.COST_OF[id] - E.COST_OF[S.mat[i]];
    if (delta > 0 && S.cost + delta > S.st.budget) { S.stroke.blocked = true; return; }
    if (!S.stroke.pushed) { S.undo.push(Uint8Array.from(S.mat)); S.redo = []; if (S.undo.length > 100) S.undo.shift(); S.stroke.pushed = true; }
    S.mat[i] = id; S.cost += delta; S.dirty = true; S.submitted = false;
  }
  function paintBrush(cx, cy, id) {
    const r = S.brush;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (r === 2 && Math.abs(dx) === 2 && Math.abs(dy) === 2) continue;
      if (r === 1 && dx * dx + dy * dy > 2) continue;
      paintCell(cx + dx, cy + dy, id);
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
    if (e.shiftKey) { S.line = c; S.stroke.lineMode = true; } else paintBrush(c.x, c.y, id);
  });
  cv.addEventListener('pointermove', (e) => {
    const c = cellAt(e); S.hover = c;
    if (!S.stroke || !c || S.stroke.lineMode) return;
    paintLine(S.stroke.last, c, S.stroke.erase ? 0 : S.matId); S.stroke.last = c;
  });
  cv.addEventListener('pointerup', (e) => {
    if (!S.stroke) return;
    const c = cellAt(e);
    if (S.stroke.lineMode && c && S.line) paintLine(S.line, c, S.stroke.erase ? 0 : S.matId);
    if (S.stroke.blocked) toast('予算が足りません');
    S.stroke = null; S.line = null;
  });
  cv.addEventListener('pointerleave', () => { S.hover = null; });

  function undo() { if (!S.undo.length) return; S.redo.push(Uint8Array.from(S.mat)); S.mat = S.undo.pop(); S.dirty = true; }
  function redo() { if (!S.redo.length) return; S.undo.push(Uint8Array.from(S.mat)); S.mat = S.redo.pop(); S.dirty = true; }
  $('undoBtn').onclick = undo; $('redoBtn').onclick = redo;
  $('clearBtn').onclick = () => { if (!S.mat.some((v) => v)) return; S.undo.push(Uint8Array.from(S.mat)); S.redo = []; S.mat.fill(0); S.dirty = true; };
  $('chkBins').onchange = (e) => { S.showBins = e.target.checked; };
  $('helpBtn').onclick = (e) => { e.preventDefault(); $('helpDlg').showModal(); };
  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (e.key === '1' && S.st.tools.includes(1)) { S.matId = 1; S.erase = false; }
    else if (e.key === '2' && S.st.tools.includes(2)) { S.matId = 2; S.erase = false; }
    else if (e.key.toLowerCase() === 'e') S.erase = !S.erase;
    else if (e.key === '[') S.brush = Math.max(0, S.brush - 1);
    else if (e.key === ']') S.brush = Math.min(2, S.brush + 1);
    else if (e.key === ' ') { e.preventDefault(); $('runBtn').click(); return; }
    else return;
    refreshPalette();
  });

  // ------------------------------------------------------------------ submit
  function hints() {
    const out = [];
    let mir = 0, rough = 0, single = 0;
    const { w, h } = S.P;
    for (let i = 0; i < S.P.n; i++) {
      if (S.mat[i] === 1) mir++; else if (S.mat[i] === 2) rough++; else continue;
      const x = i % w, y = (i / w) | 0; let nb = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h && S.mat[yy * w + xx]) nb++; }
      if (nb === 0) single++;
    }
    out.push('鏡は粒子を<b>決まった規則で反射</b>するだけなので、情報は失われません。ほんの少しの角度差が丸い鏡で拡大され(カオス)、見かけ上は混ざる — これが<b>粗視化したエントロピーの増大</b>です。');
    if (rough === 0 && S.st.tools.includes(2)) out.push('ざらざらの壁は未使用です。当たった粒子が向きを忘れるので、少ないセル数でも一気に混ざります(熱浴のイメージ)。');
    if (single < 3 && mir > 8 && S.st.id === 1) out.push('鏡は大きな塊より、<b>ばらばらに置いた小さな丸い障害物</b>の方が、ビームを広い範囲に散らしやすいです(ローレンツガス)。');
    out.push('実行中に「⏪ 時間反転」を押してみよう。鏡だけの世界なら、法則としては逆戻りもできます。でも、ざらざらの壁があると戻れません。');
    return out.slice(0, 3);
  }
  function shareText() {
    const st = S.st, sc = scoreNow();
    const lines = [`Entropy Lab「${st.id}. ${st.name}」でビームを混ぜました!`, `90%到達 ${S.pred.t90} / コスト ${S.cost} / スコア ${sc}`, '#EntropyLab'];
    const params = new URLSearchParams({ text: lines.join('\n') });
    if (/^https?:$/.test(location.protocol)) params.set('url', location.href.split('#')[0]);
    return `https://x.com/intent/post?${params.toString()}`;
  }
  const share = () => window.open(shareText(), '_blank', 'noopener');
  $('shareBtn').onclick = share; $('shareTop').onclick = share;
  $('submitBtn').onclick = () => {
    const sc = scoreNow(); if (sc === null) return;
    const st = S.st;
    S.submitted = true; S.saved.designs[st.id] = Array.from(S.mat);
    const prev = S.saved.best[st.id]; let msg = '';
    if (!prev || sc > prev.score) { S.saved.best[st.id] = { score: sc, t90: S.pred.t90, cost: S.cost }; msg = ' <b class="pass">ベスト更新!</b>'; }
    persist(); buildTabs(); updatePanel();
    const hs = hints().map((t) => `<li class="hint-li">${t}</li>`).join('');
    $('reportCard').hidden = false;
    $('report').innerHTML = `<p class="pass"><b>合格</b> — 90%到達 ${S.pred.t90} / コスト ${S.cost} / スコア <b>${sc}</b>${msg}</p>
      <div class="explain"><b>ヒント</b><ul>${hs}</ul></div>`;
    $('reportCard').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    $('shareTop').hidden = false;
  };

  // ------------------------------------------------------------------ main loop
  let lastT = 0;
  function frame(now) {
    const dt = Math.min(100, now - (lastT || now)); lastT = now;
    if (S.dirty) {
      S.dirty = false; recalc();
      if (!S.submitted) { $('shareTop').hidden = true; $('reportCard').hidden = true; }
    }
    stepLive(dt);
    draw(); drawPlot();
    requestAnimationFrame(frame);
  }

  load();
  selectStage(0);
  requestAnimationFrame(frame);
  if (!S.saved.seenHelp) { S.saved.seenHelp = true; persist(); try { $('helpDlg').showModal(); } catch (e) { /* ignore */ } }
  window.__entropy = { S, E, selectStage, recalc };
})();
