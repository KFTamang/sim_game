/*
 * game.js — Crash Lab UI: paint a crushable structure, see the predicted deceleration
 * curve live, run a slow-motion crash test and submit a score.
 */
(function () {
  'use strict';

  const C = window.Crash;
  const STAGES = window.CrashStages.STAGES;
  const $ = (id) => document.getElementById(id);
  const cv = $('cv'), ctx = cv.getContext('2d');
  const gp = $('gplot'), gctx = gp.getContext('2d');
  const G = 9.81;

  const S = {
    idx: 0, st: null, P: null, mat: null, res: null, cost: 0,
    undo: [], redo: [],
    matId: 2, brush: 1, erase: false, mirror: false, showUse: true,
    stroke: null, hover: null, dirty: false, dirtyAt: 0, line: null,
    play: null, submitted: false,
    saved: { designs: {}, best: {}, seenHelp: false },
  };
  const view = { cs: 20, ox: 0, oy: 0, w: 0, h: 0, dpr: 1 };
  const MAT_COL = { 1: '#b9c4d6', 2: '#7aa2d6', 3: '#d6a45a' };
  const CAB_W = 3, WALL_W = 1.2;
  const TIME_SCALE = 0.03;     // simulated seconds per real second during playback

  // ------------------------------------------------------------------ storage
  const KEY = 'crashlab.v1';
  function load() { try { const raw = localStorage.getItem(KEY); if (raw) Object.assign(S.saved, JSON.parse(raw)); } catch (e) { /* ignore */ } }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(S.saved)); } catch (e) { /* ignore */ } }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function toast(msg, ms = 1600) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
  }

  // ------------------------------------------------------------------ stage
  function selectStage(i) {
    stopPlay();
    S.idx = i; S.st = STAGES[i];
    S.P = C.makeProblem(S.st);
    const n = S.P.w * S.P.h;
    const saved = S.saved.designs[S.st.id];
    S.mat = new Uint8Array(n);
    if (saved && saved.length === n) S.mat.set(saved);
    S.undo = []; S.redo = []; S.submitted = false;
    $('reportCard').hidden = true; $('shareTop').hidden = true;
    resize();
    recalc();
  }

  function recalc() {
    S.cost = C.costOf(S.mat);
    S.res = S.cost > 0 ? C.simulate(S.P, S.mat, {}) : null;
    S.dirty = false;
    updatePanel();
  }
  function scoreNow() { return S.res ? C.scoreOf(S.res, S.cost, S.st.budget) : 0; }
  function touchesCabin() {
    const { w, h } = S.P;
    for (let j = 0; j < h; j++) if (S.mat[j * w + w - 1]) return true;
    return false;
  }

  // ------------------------------------------------------------------ panel
  function updatePanel() {
    const st = S.st, r = S.res, sc = scoreNow();
    $('stageName').textContent = `${st.id}. ${st.name}`;
    $('stageBrief').textContent = st.brief;
    $('gLim').textContent = st.gLimit;
    $('budVal').textContent = st.budget;
    const gmax = st.gLimit * 1.6;
    const pk = r ? r.peakG : 0;
    $('gVal').textContent = r ? (pk > 999 ? '999+' : pk.toFixed(1)) : '—';
    $('gBar').style.width = `${clamp((pk / gmax) * 100, 0, 100)}%`;
    $('gBar').style.background = r && pk <= st.gLimit ? 'var(--ok)' : 'var(--bad)';
    $('gMark').style.left = `${(st.gLimit / gmax) * 100}%`;
    $('costVal').textContent = S.cost;
    $('costBar').style.width = `${clamp((S.cost / st.budget) * 100, 0, 100)}%`;
    $('costBar').style.background = S.cost >= st.budget ? 'var(--bad)' : 'var(--ten)';
    $('strokeVal').textContent = r ? `${(r.stroke * 100).toFixed(0)} cm / ${(S.P.w * C.CELL * 100).toFixed(0)} cm` : '—';
    $('etaVal').textContent = r ? `${(r.eta * 100).toFixed(0)}%` : '—';
    $('scoreVal').textContent = sc > 0 ? sc : '—';
    const best = S.saved.best[st.id];
    $('bestVal').textContent = best ? `${best.score}(${best.peak.toFixed(1)} G / コスト ${best.cost})` : '—';
    const el = $('status');
    let cls = '', msg;
    if (!r) msg = '壁(左)と乗員室(右)の間に材料を塗って、衝撃を受け止める構造を作ろう。';
    else if (!touchesCabin()) { cls = 'bad'; msg = '右端(乗員室)に材料がつながっていません。乗員室は止まらずに壁へ激突します。'; }
    else if (r.hitWall || r.stoppedAt < 0) { cls = 'bad'; msg = '底づき! 構造が潰れきっても止まれず、乗員室が壁に激突しました。もっと強い材料か、並列の本数を増やそう。'; }
    else if (r.peakG > st.gLimit) { cls = 'bad'; msg = `最大Gが上限を ${(r.peakG - st.gLimit).toFixed(1)} G 超過。` + (r.stroke > 0.9 * S.P.smax ? '潰れ代をほぼ使い切っています。力を増やして底づきの手前で止めよう。' : '力が大きすぎます。弱い材料にする・本数を減らすと潰れ代を長く使えます。'); }
    else { cls = 'ok'; msg = '合格! 「衝突テスト」で記録できます。材料を減らす・Gを下げる、で高得点を狙おう。'; }
    el.className = `status ${cls}`; el.textContent = msg;
    $('testBtn').disabled = !r || !!S.play;
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

  function buildPalette() {
    const ms = $('matSeg'); ms.innerHTML = '';
    C.MATS.filter((m) => m.id > 0).forEach((m) => {
      const b = document.createElement('button');
      b.innerHTML = `<span class="sw" style="background:${MAT_COL[m.id]}"></span>${m.label}`;
      b.dataset.id = m.id;
      b.onclick = () => { S.matId = m.id; S.erase = false; refreshPalette(); };
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
    const m = C.MATS.find((q) => q.id === S.matId);
    $('matInfo').textContent = S.erase ? '塗った材料を消します。'
      : `${m.label}: 潰れ始める力(1本あたり) ${(m.P / 1000).toFixed(0)} kN・1セルあたりコスト ${m.cost}(重さも比例)`;
  }

  // ------------------------------------------------------------------ view
  function resize() {
    const r = cv.parentElement.getBoundingClientRect();
    view.dpr = window.devicePixelRatio || 1;
    view.w = Math.max(200, r.width); view.h = Math.max(160, r.height);
    cv.width = Math.round(view.w * view.dpr); cv.height = Math.round(view.h * view.dpr);
    const gr = gp.getBoundingClientRect();
    gp.width = Math.round(gr.width * view.dpr); gp.height = Math.round(gr.height * view.dpr);
    view.gw = gr.width; view.gh = gr.height;
    if (!S.P) return;
    const pad = 24, span = S.P.w + CAB_W + WALL_W + 0.6;
    view.cs = Math.min((view.w - pad * 2) / span, (view.h - pad * 2) / S.P.h);
    view.ox = (view.w - view.cs * span) / 2 + (WALL_W + 0.3) * view.cs;   // pixel x of world x = 0
    view.oy = (view.h - view.cs * S.P.h) / 2;
  }
  window.addEventListener('resize', resize);
  const px = (x) => view.ox + x * view.cs;
  const py = (y) => view.oy + y * view.cs;

  function usageColor(u, a) {
    // 0 = untouched (blue) ... 1 = crushed to the limit (red)
    const t = clamp(u / C.LOCK, 0, 1);
    const stops = [[37, 99, 235], [34, 197, 94], [250, 204, 21], [239, 68, 68]];
    const f = t * 3, k = Math.min(2, Math.floor(f)), r = f - k;
    const c = stops[k].map((v, i) => Math.round(v + (stops[k + 1][i] - v) * r));
    return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  }

  // ------------------------------------------------------------------ drawing
  function drawStatic(Xc) {
    const { w, h } = S.P;
    // corridor walls (top / bottom)
    ctx.fillStyle = '#243247';
    ctx.fillRect(px(-WALL_W - 0.3), py(-0.35), (w + CAB_W + WALL_W + 0.6) * view.cs, 0.35 * view.cs);
    ctx.fillRect(px(-WALL_W - 0.3), py(h), (w + CAB_W + WALL_W + 0.6) * view.cs, 0.35 * view.cs);
    // barrier
    for (const [a, b] of S.P.walls) {
      ctx.fillStyle = '#5b4636';
      ctx.fillRect(px(-WALL_W), py(a), WALL_W * view.cs, (b - a) * view.cs);
      ctx.strokeStyle = '#8a6c52'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let y = a; y < b; y += 0.5) { ctx.moveTo(px(-WALL_W), py(y) + 0.5 * view.cs); ctx.lineTo(px(0), py(y)); }
      ctx.stroke();
    }
    // open space where there is no barrier
    ctx.fillStyle = '#ffffff10';
    let y0 = 0;
    const segs = S.P.walls.slice().sort((p, q) => p[0] - q[0]);
    const gaps = [];
    for (const [a, b] of segs) { if (a > y0) gaps.push([y0, a]); y0 = Math.max(y0, b); }
    if (y0 < h) gaps.push([y0, h]);
    for (const [a, b] of gaps) {
      ctx.fillRect(px(-WALL_W), py(a), WALL_W * view.cs, (b - a) * view.cs);
      ctx.fillStyle = '#ffffff50'; ctx.font = `${Math.max(10, view.cs * 0.5)}px system-ui`; ctx.textAlign = 'center';
      ctx.fillText('空き', px(-WALL_W / 2), py((a + b) / 2) + 4);
      ctx.fillStyle = '#ffffff10';
    }
    // cabin (rigid body, moves with Xc)
    const cx = px(Xc / C.CELL);
    ctx.fillStyle = '#26364f'; ctx.strokeStyle = '#4b6286'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(cx, py(0), CAB_W * view.cs, h * view.cs, 8); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#dbe6f5'; ctx.textAlign = 'center'; ctx.font = `600 ${Math.max(11, view.cs * 0.6)}px system-ui`;
    ctx.fillText('乗員室', cx + CAB_W * view.cs / 2, py(h / 2) - 0.8 * view.cs);
    ctx.fillStyle = '#8fa3bd'; ctx.font = `${Math.max(10, view.cs * 0.5)}px system-ui`;
    ctx.fillText(`${S.P.M} kg`, cx + CAB_W * view.cs / 2, py(h / 2) - 0.1 * view.cs);
    ctx.fillText(`${(S.P.v0 * 3.6).toFixed(0)} km/h`, cx + CAB_W * view.cs / 2, py(h / 2) + 0.7 * view.cs);
    ctx.beginPath(); ctx.arc(cx + CAB_W * view.cs / 2, py(h / 2) + 1.7 * view.cs, 0.35 * view.cs, 0, 7);
    ctx.fillStyle = '#ffcf9e'; ctx.fill();
  }

  function drawDesign() {
    const { w, h } = S.P;
    ctx.strokeStyle = '#ffffff12'; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 0; i <= w; i++) { ctx.moveTo(px(i), py(0)); ctx.lineTo(px(i), py(h)); }
    for (let j = 0; j <= h; j++) { ctx.moveTo(px(0), py(j)); ctx.lineTo(px(w), py(j)); }
    ctx.stroke();
    const use = S.showUse && S.res ? S.res.cellUse : null;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const m = S.mat[j * w + i]; if (!m) continue;
        ctx.fillStyle = MAT_COL[m]; ctx.fillRect(px(i), py(j), view.cs, view.cs);
        if (use) { ctx.fillStyle = usageColor(use[j * w + i], 0.55); ctx.fillRect(px(i), py(j), view.cs, view.cs); }
        // diagonals hint the lattice
        ctx.strokeStyle = '#00000040'; ctx.beginPath();
        ctx.moveTo(px(i), py(j)); ctx.lineTo(px(i + 1), py(j + 1)); ctx.moveTo(px(i + 1), py(j)); ctx.lineTo(px(i), py(j + 1)); ctx.stroke();
        ctx.strokeStyle = '#0a1018'; ctx.lineWidth = 1.5; ctx.strokeRect(px(i), py(j), view.cs, view.cs); ctx.lineWidth = 1;
      }
    }
    if (S.hover && !S.play) {
      ctx.strokeStyle = '#ffb703'; ctx.lineWidth = 2;
      const r = S.brush;
      ctx.strokeRect(px(S.hover.x - r), py(S.hover.y - r), view.cs * (2 * r + 1), view.cs * (2 * r + 1)); ctx.lineWidth = 1;
    }
  }

  function interp(frames, t) {
    let k = 0;
    while (k < frames.length - 2 && frames[k + 1].t < t) k++;
    const a = frames[k], b = frames[Math.min(k + 1, frames.length - 1)];
    const f = b.t > a.t ? clamp((t - a.t) / (b.t - a.t), 0, 1) : 0;
    return { a, b, f, k };
  }

  function drawPlay(t) {
    const res = S.play.res, fr = res.frames, { w, h } = S.P;
    const { a, b, f, k } = interp(fr, t);
    const pos = (i) => [a.px[2 * i] + (b.px[2 * i] - a.px[2 * i]) * f, a.px[2 * i + 1] + (b.px[2 * i + 1] - a.px[2 * i + 1]) * f];
    const nid = res.S.nid;
    const Xc = a.Xc + (b.Xc - a.Xc) * f;
    drawStatic(Xc);
    const u = C.CELL;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const m = S.mat[j * w + i]; if (!m) continue;
        const q = [nid[j * (w + 1) + i], nid[j * (w + 1) + i + 1], nid[(j + 1) * (w + 1) + i + 1], nid[(j + 1) * (w + 1) + i]].map(pos);
        // area ratio -> crushed colour
        let ar = 0;
        for (let s = 0; s < 4; s++) { const p0 = q[s], p1 = q[(s + 1) % 4]; ar += p0[0] * p1[1] - p1[0] * p0[1]; }
        const ratio = clamp(Math.abs(ar) / 2 / (u * u), 0, 1.2);
        ctx.beginPath();
        q.forEach(([x, y], s) => (s ? ctx.lineTo(px(x / u), py(y / u)) : ctx.moveTo(px(x / u), py(y / u))));
        ctx.closePath();
        ctx.fillStyle = MAT_COL[m]; ctx.fill();
        ctx.fillStyle = usageColor(clamp((1 - ratio) / (1 - 0.35) * C.LOCK, 0, C.LOCK), 0.6); ctx.fill();
        ctx.strokeStyle = '#0a1018'; ctx.lineWidth = 1.2; ctx.stroke();
      }
    }
    // readout
    const ri = nearestIndex(res.t, t);
    const g = res.acc[ri] || 0;
    const v = Math.max(0, -(a.Vc + (b.Vc - a.Vc) * f));
    $('readout').innerHTML = `t = ${(t * 1000).toFixed(0)} ms<br>乗員室の速度 ${v.toFixed(1)} m/s<br>減速度 <b style="color:${g > S.st.gLimit ? '#ff6b6b' : '#4ade80'}">${g.toFixed(1)} G</b>`;
  }
  function nearestIndex(arr, t) {
    let lo = 0, hi = arr.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < t) lo = m + 1; else hi = m; }
    return lo;
  }

  function drawGraph(tPlay) {
    const W = view.gw, H = view.gh;
    gctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    gctx.clearRect(0, 0, W, H);
    gctx.fillStyle = '#0c131e'; gctx.fillRect(0, 0, W, H);
    const L = 46, R = 12, T = 12, B = 22;
    const r = S.res;
    gctx.font = '11px system-ui'; gctx.fillStyle = '#8fa3bd';
    if (!r) { gctx.textAlign = 'center'; gctx.fillText('材料を塗ると、乗員室の減速度(G)の波形がここに出ます', W / 2, H / 2); return; }
    const tEnd = Math.max(0.06, (r.stoppedAt > 0 ? r.stoppedAt : r.t[r.t.length - 1]) * 1.12);
    const gIdeal = (S.P.v0 * S.P.v0) / (2 * S.P.smax) / G;
    const gTop = Math.min(S.st.gLimit * 2.2, Math.max(S.st.gLimit * 1.3, r.peakG * 1.1));
    const X = (t) => L + (t / tEnd) * (W - L - R);
    const Y = (g) => T + (1 - clamp(g / gTop, -0.05, 1.02)) * (H - T - B);
    // grid
    gctx.strokeStyle = '#ffffff14'; gctx.lineWidth = 1; gctx.textAlign = 'right';
    const step = gTop > 100 ? 40 : 10;
    for (let g = 0; g <= gTop; g += step) { gctx.beginPath(); gctx.moveTo(L, Y(g)); gctx.lineTo(W - R, Y(g)); gctx.stroke(); gctx.fillText(`${g}`, L - 6, Y(g) + 4); }
    gctx.textAlign = 'center';
    for (let t = 0; t <= tEnd; t += 0.02) gctx.fillText(`${(t * 1000).toFixed(0)}ms`, X(t), H - 6);
    // limit and ideal
    gctx.setLineDash([5, 4]); gctx.lineWidth = 1.5;
    gctx.strokeStyle = '#ff6b6b'; gctx.beginPath(); gctx.moveTo(L, Y(S.st.gLimit)); gctx.lineTo(W - R, Y(S.st.gLimit)); gctx.stroke();
    gctx.strokeStyle = '#4ade80'; gctx.beginPath(); gctx.moveTo(L, Y(gIdeal)); gctx.lineTo(W - R, Y(gIdeal)); gctx.stroke();
    gctx.setLineDash([]);
    gctx.textAlign = 'left';
    gctx.fillStyle = '#ff6b6b'; gctx.fillText(`上限 ${S.st.gLimit} G`, L + 6, Y(S.st.gLimit) - 4);
    gctx.fillStyle = '#4ade80'; gctx.fillText(`理想 ${gIdeal.toFixed(1)} G(一定の力で潰れ代を使い切る)`, L + 6, Y(gIdeal) + 13);
    // curve
    gctx.beginPath(); gctx.moveTo(X(0), Y(0));
    for (let i = 0; i < r.t.length; i++) gctx.lineTo(X(r.t[i]), Y(r.acc[i]));
    gctx.lineTo(X(r.t[r.t.length - 1]), Y(0)); gctx.closePath();
    gctx.fillStyle = 'rgba(255,183,3,.18)'; gctx.fill();
    gctx.beginPath();
    for (let i = 0; i < r.t.length; i++) (i ? gctx.lineTo : gctx.moveTo).call(gctx, X(r.t[i]), Y(r.acc[i]));
    gctx.strokeStyle = '#ffb703'; gctx.lineWidth = 2; gctx.stroke();
    gctx.fillStyle = '#8fa3bd'; gctx.textAlign = 'right'; gctx.fillText('G', L - 6, T + 2);
    if (tPlay != null) {
      gctx.strokeStyle = '#fff'; gctx.lineWidth = 1; gctx.beginPath(); gctx.moveTo(X(tPlay), T); gctx.lineTo(X(tPlay), H - B); gctx.stroke();
    }
  }

  // ------------------------------------------------------------------ painting
  function cellAt(e) {
    const r = cv.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left - view.ox) / view.cs), y = Math.floor((e.clientY - r.top - view.oy) / view.cs);
    if (x < 0 || y < 0 || x >= S.P.w || y >= S.P.h) return null;
    return { x, y };
  }
  function setCell(x, y, id) {
    const { w, h } = S.P;
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (S.mat[i] === id) return;
    const delta = C.COST_OF[id] - C.COST_OF[S.mat[i]];
    if (delta > 0 && S.cost + delta > S.st.budget) { S.stroke.blocked = true; return; }
    if (!S.stroke.pushed) { S.undo.push(Uint8Array.from(S.mat)); S.redo = []; if (S.undo.length > 100) S.undo.shift(); S.stroke.pushed = true; }
    S.mat[i] = id; S.cost += delta; markDirty();
  }
  function paintCell(x, y, id) { setCell(x, y, id); if (S.mirror) setCell(x, S.P.h - 1 - y, id); }
  function paintBrush(cx, cy, id) {
    const r = S.brush;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (r === 2 && Math.abs(dx) === 2 && Math.abs(dy) === 2) continue;
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
  function markDirty() { S.dirty = true; S.dirtyAt = performance.now(); S.submitted = false; $('reportCard').hidden = true; $('shareTop').hidden = true; }

  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('pointerdown', (e) => {
    if (S.play) stopPlay();
    const c = cellAt(e); if (!c) return;
    cv.setPointerCapture(e.pointerId);
    const erase = e.button === 2 || S.erase;
    S.stroke = { erase, last: c, pushed: false, blocked: false };
    const id = erase ? 0 : S.matId;
    if (e.shiftKey) { S.line = c; S.stroke.lineMode = true; } else paintBrush(c.x, c.y, id);
  });
  cv.addEventListener('pointermove', (e) => {
    const c = cellAt(e); S.hover = c; showCellInfo(c);
    if (!S.stroke || !c || S.stroke.lineMode) return;
    paintLine(S.stroke.last, c, S.stroke.erase ? 0 : S.matId);
    S.stroke.last = c;
  });
  cv.addEventListener('pointerup', (e) => {
    if (!S.stroke) return;
    const c = cellAt(e);
    if (S.stroke.lineMode && c && S.line) paintLine(S.line, c, S.stroke.erase ? 0 : S.matId);
    if (S.stroke.blocked) toast('予算が足りません');
    S.stroke = null; S.line = null; S.dirtyAt = 0;
  });
  cv.addEventListener('pointerleave', () => { S.hover = null; });

  function showCellInfo(c) {
    const el = $('cellInfo');
    if (!c) { el.textContent = 'マウスを重ねると材料と潰れ具合が出ます'; return; }
    const i = c.y * S.P.w + c.x, m = S.mat[i];
    const name = m ? C.MATS.find((q) => q.id === m).label : '空き';
    const u = S.res && m ? ` — 最大の潰れ ${(S.res.cellUse[i] * 100).toFixed(0)}%` : '';
    el.textContent = `(${c.x}, ${c.y}) ${name}${u}`;
  }

  function undo() { if (!S.undo.length) return; S.redo.push(Uint8Array.from(S.mat)); S.mat = S.undo.pop(); markDirty(); S.dirtyAt = 0; }
  function redo() { if (!S.redo.length) return; S.undo.push(Uint8Array.from(S.mat)); S.mat = S.redo.pop(); markDirty(); S.dirtyAt = 0; }
  $('undoBtn').onclick = undo;
  $('redoBtn').onclick = redo;
  $('clearBtn').onclick = () => { if (!S.mat.some((v) => v)) return; S.undo.push(Uint8Array.from(S.mat)); S.redo = []; S.mat.fill(0); markDirty(); S.dirtyAt = 0; };
  $('chkUse').onchange = (e) => { S.showUse = e.target.checked; };
  $('chkMirror').onchange = (e) => { S.mirror = e.target.checked; };
  $('helpBtn').onclick = (e) => { e.preventDefault(); $('helpDlg').showModal(); };
  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (e.key === '1' || e.key === '2' || e.key === '3') { S.matId = +e.key; S.erase = false; }
    else if (e.key.toLowerCase() === 'e') S.erase = !S.erase;
    else if (e.key === '[') S.brush = Math.max(0, S.brush - 1);
    else if (e.key === ']') S.brush = Math.min(2, S.brush + 1);
    else return;
    refreshPalette();
  });

  // ------------------------------------------------------------------ crash test & report
  function startTest() {
    if (!S.res || S.play) return;
    if (S.dirty) recalc();
    const res = C.simulate(S.P, S.mat, { frames: 150 });
    if (!res.frames.length) return;
    S.play = { res, start: performance.now(), tEnd: res.frames[res.frames.length - 1].t };
    $('skipBtn').hidden = false; $('testBtn').disabled = true;
    $('reportCard').hidden = true; $('shareTop').hidden = true;
  }
  function stopPlay() {
    if (!S.play) return;
    S.play = null; $('skipBtn').hidden = true; $('readout').innerHTML = '';
    $('testBtn').disabled = !S.res;
  }
  $('testBtn').onclick = startTest;
  $('skipBtn').onclick = () => { if (S.play) finishTest(); };

  function hints(r) {
    const out = [];
    const st = S.st, P = S.P;
    const used = [];
    let unused = 0, total = 0;
    for (let i = 0; i < S.mat.length; i++) if (S.mat[i]) { total++; if (r.cellUse[i] < 0.05) unused++; }
    if (unused >= 3) out.push(`<b>${unused} セル</b>(潰れ具合の表示で青い所)は、衝突中ほとんど潰れていません。荷重の通り道から外れた材料は<b>コストを食う重りでしかない</b>ので、消して軽くしましょう。`);
    const gMean = r.stoppedAt > 0 ? P.v0 / r.stoppedAt / G : 0;
    if (gMean > 0 && r.peakG > 1.4 * gMean && !r.hitWall) out.push(`最大G(${r.peakG.toFixed(1)})は平均(${gMean.toFixed(1)})の ${(r.peakG / gMean).toFixed(1)} 倍。部材は<b>座屈する瞬間に最大の力</b>を出し、その後は力が下がります。初期の山を削るには、壁側を弱い材料にして、奥ほど強くする(<b>段階的に硬く</b>)のが定石です。`);
    if (!r.hitWall && r.stroke < 0.55 * P.smax) out.push(`潰れ代の ${(100 * r.stroke / P.smax).toFixed(0)}% しか使っていません。吸収するエネルギーは<b>力 × 距離</b>。距離を使い切るほど必要な力(=G)は小さくできます。もっと弱く・細くして長く潰しましょう。`);
    if (r.hitWall) out.push('潰れ代を使い切って壁に当たると、Gは一気に跳ね上がります(底づき)。<b>止めるのに足りる力</b>を出せる材料量にしましょう。');
    let hs = 0; for (let i = 0; i < S.mat.length; i++) if (S.mat[i] === 3) hs++;
    if (hs === 0 && out.length < 3) out.push('高張力鋼(1セル4コスト)は未使用です。<b>力が足りない所だけ強い材料</b>にする手もあります。逆に、弱い材料を並列に増やすと潰れ方が安定することもあります。');
    return out.slice(0, 3);
  }

  function shareText() {
    const st = S.st, r = S.res, sc = scoreNow();
    const lines = [`Crash Lab「${st.id}. ${st.name}」でクラッシャブル構造を設計しました!`,
      `最大 ${r.peakG.toFixed(1)} G / 材料コスト ${S.cost} / スコア ${sc}`, '#CrashLab'];
    const params = new URLSearchParams({ text: lines.join('\n') });
    if (/^https?:$/.test(location.protocol)) params.set('url', location.href.split('#')[0]);
    return `https://x.com/intent/post?${params.toString()}`;
  }
  const share = () => window.open(shareText(), '_blank', 'noopener');
  $('shareBtn').onclick = share;
  $('shareTop').onclick = share;

  function finishTest() {
    const r = S.play ? S.play.res : S.res;
    stopPlay();
    S.res = r; updatePanel();
    const sc = scoreNow(), st = S.st;
    S.submitted = true;
    S.saved.designs[st.id] = Array.from(S.mat);
    let msg = '';
    if (sc > 0) {
      const prev = S.saved.best[st.id];
      if (!prev || sc > prev.score) { S.saved.best[st.id] = { score: sc, peak: r.peakG, cost: S.cost }; msg = ' <b class="pass">ベスト更新!</b>'; }
    }
    persist(); buildTabs(); updatePanel();
    const hs = hints(r).map((t) => `<li class="hint-li">${t}</li>`).join('');
    $('reportCard').hidden = false;
    $('report').innerHTML = sc > 0
      ? `<p class="pass"><b>合格</b> — 最大 ${r.peakG.toFixed(1)} G(上限 ${st.gLimit}) / 潰れ ${(r.stroke * 100).toFixed(0)} cm / コスト ${S.cost} / スコア <b>${sc}</b>${msg}</p>
         <div class="explain"><b>ヒント</b><ul>${hs || '<li>すばらしい設計です。材料を減らして軽くできるか試そう。</li>'}</ul></div>`
      : `<p class="fail"><b>不合格</b> — 最大 ${r.peakG > 999 ? '999+' : r.peakG.toFixed(1)} G(上限 ${st.gLimit})${S.cost > st.budget ? ' / 予算超過' : ''}</p>
         <div class="explain"><b>ヒント</b><ul>${hs || '<li>グラフの形を見て、山が高い所の原因を考えよう。</li>'}</ul></div>`;
    $('reportCard').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (sc > 0) $('shareTop').hidden = false;
  }

  // ------------------------------------------------------------------ main loop
  function frame(now) {
    if (S.dirty && !S.stroke && now - S.dirtyAt > 120) recalc();
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);
    ctx.fillStyle = '#0f1722'; ctx.fillRect(0, 0, view.w, view.h);
    let tPlay = null;
    if (S.play) {
      tPlay = Math.min(S.play.tEnd, ((now - S.play.start) / 1000) * TIME_SCALE);
      drawPlay(tPlay);
      if (tPlay >= S.play.tEnd && now - S.play.start > (S.play.tEnd / TIME_SCALE) * 1000 + 600) finishTest();
    } else {
      drawStatic(S.P.w * C.CELL);
      drawDesign();
    }
    drawGraph(tPlay);
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
  window.__crash = { S, C, selectStage, recalc, startTest };
})();
