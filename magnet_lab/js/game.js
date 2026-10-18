/*
 * game.js — Magnet Lab UI: paint iron and magnets, watch the flux lines, submit a score.
 */
(function () {
  'use strict';

  const M = window.Mag;
  const STAGES = window.MagStages.STAGES;
  const $ = (id) => document.getElementById(id);
  const cv = $('cv'), ctx = cv.getContext('2d');

  const S = {
    idx: 0, st: null, P: null, ref: 1,
    mat: null, sol: null, cost: 0, lines: null, satCount: 0, unused: 0,
    undo: [], redo: [],
    matId: 1, brush: 1, erase: false, showB: true, showLines: true,
    stroke: null, hover: null, dirty: false, dirtyAt: 0, line: null,
    submitted: false,
    saved: { designs: {}, best: {}, seenHelp: false },
  };
  const view = { cs: 12, ox: 0, oy: 0, w: 0, h: 0, dpr: 1, base: null };

  const KEY = 'magnetlab.v1';
  function load() { try { const raw = localStorage.getItem(KEY); if (raw) Object.assign(S.saved, JSON.parse(raw)); } catch (e) { /* ignore */ } }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(S.saved)); } catch (e) { /* ignore */ } }

  const STOPS = [[0, 0, 4], [27, 12, 65], [74, 12, 107], [120, 28, 109], [165, 44, 96], [207, 68, 70], [237, 105, 37], [251, 155, 6], [247, 209, 61], [252, 255, 164]];
  const LUT = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * (STOPS.length - 1), a = Math.min(STOPS.length - 2, Math.floor(t)), f = t - a;
    for (let c = 0; c < 3; c++) LUT[i * 3 + c] = Math.round(STOPS[a][c] + (STOPS[a + 1][c] - STOPS[a][c]) * f);
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function toast(msg, ms = 1600) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
  }
  const fmtV = (v) => (S.st.kind === 'shield' ? `×${v.toFixed(1)}` : `${v.toFixed(2)} T`);
  const bScale = () => S.st.bScale || 2.0;

  // ------------------------------------------------------------------ zoom (shared helper)
  const Z = window.ViewZoom.attach(cv, { onChange: () => applyZoom(), cancel: cancelStroke });
  function cancelStroke() {
    if (!S.stroke) return;
    if (S.stroke.pushed) { S.mat = S.undo.pop(); S.dirty = true; S.dirtyAt = 0; }
    S.stroke = null; S.line = null;
  }
  function applyZoom() {
    if (!view.base) return;
    view.cs = view.base.cs * Z.k; view.ox = view.base.ox * Z.k + Z.tx; view.oy = view.base.oy * Z.k + Z.ty;
  }

  // ------------------------------------------------------------------ stage
  function selectStage(i) {
    S.idx = i; S.st = STAGES[i];
    S.P = M.makeProblem(S.st);
    S.ref = S.st.kind === 'shield' ? M.reference(S.P) : 1;
    const saved = S.saved.designs[S.st.id];
    S.mat = new Uint8Array(S.P.n);
    if (saved && saved.length === S.P.n) for (let k = 0; k < S.P.n; k++) if (!S.P.fixed[k]) S.mat[k] = saved[k];
    S.sol = null;
    S.undo = []; S.redo = []; S.submitted = false;
    if (!S.st.tools.includes(S.matId) && !S.erase) S.matId = S.st.tools[0];
    Z.reset();
    $('reportCard').hidden = true; $('shareTop').hidden = true;
    buildPalette();
    resize();
    recalc();
  }

  function recalc() {
    S.cost = M.costOf(S.P, S.mat);
    S.sol = M.solve(S.P, S.mat, S.sol && S.sol.A ? { A: S.sol.A, Bu: S.sol.Bu, nu: S.sol.nu } : null, {});
    S.dirty = false;
    // flux lines
    const A = S.sol.A;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < A.length; i++) { if (A[i] < lo) lo = A[i]; if (A[i] > hi) hi = A[i]; }
    const n = 34, levels = [];
    for (let k = 1; k < n; k++) levels.push(lo + ((hi - lo) * k) / n);
    S.lines = M.contours(S.P, A, levels);
    // saturation & unused iron
    let sat = 0, unused = 0;
    const B = S.sol.B.bm, mm = S.sol.mat;
    for (let i = 0; i < S.P.n; i++) if (mm[i] === M.IRON && !S.P.fixed[i]) { if (B[i] > M.BS) sat++; if (B[i] < 0.04 * bScale() * 0.25) unused++; }
    S.satCount = sat; S.unused = unused;
    buildBImage();
    updatePanel();
  }

  function value() { return M.valueOf(S.st, S.sol, S.ref); }
  function ratio() { return M.ratioOf(S.sol); }
  function scoreNow() { return S.cost > 0 ? M.scoreOf(S.st, S.sol, S.ref, S.cost) : null; }

  // ------------------------------------------------------------------ panel
  function updatePanel() {
    const st = S.st, v = value(), sc = scoreNow();
    $('stageName').textContent = `${st.id}. ${st.name}`;
    $('stageBrief').textContent = st.brief;
    $('valLbl').textContent = st.kind === 'shield' ? '遮蔽(外部磁場 ÷ 内部磁場)' : '測定ゾーンの磁束密度';
    $('valNow').textContent = fmtV(v);
    $('tgtVal').textContent = fmtV(st.target);
    $('budVal').textContent = st.budget;
    const maxV = Math.max(st.target * 1.8, v);
    $('facBar').style.width = `${clamp((v / maxV) * 100, 0, 100)}%`;
    $('facBar').style.background = v >= st.target ? 'var(--ok)' : 'var(--ten)';
    $('tgtMark').style.left = `${(st.target / maxV) * 100}%`;
    $('ratioMeter').hidden = !st.minRatio;
    if (st.minRatio) {
      const r = ratio(), rm = Math.max(st.minRatio * 1.8, Number.isFinite(r) ? r : 0);
      $('ratioNow').textContent = Number.isFinite(r) ? `×${r.toFixed(1)}` : '—';
      $('ratioNeed').textContent = st.minRatio;
      $('ratioBar').style.width = `${clamp(((Number.isFinite(r) ? r : 0) / rm) * 100, 0, 100)}%`;
      $('ratioBar').style.background = r >= st.minRatio ? 'var(--ok)' : 'var(--ten)';
      $('ratioMark').style.left = `${(st.minRatio / rm) * 100}%`;
    }
    $('costVal').textContent = S.cost;
    $('costBar').style.width = `${clamp((S.cost / st.budget) * 100, 0, 100)}%`;
    $('costBar').style.background = S.cost >= st.budget ? 'var(--bad)' : 'var(--ten)';
    $('scoreVal').textContent = sc === null ? '—' : sc;
    const best = S.saved.best[st.id];
    $('bestVal').textContent = best ? `${best.score}(${best.text} / コスト ${best.cost})` : '—';
    $('legMax').textContent = `${bScale().toFixed(1)} T`;
    const el = $('status');
    let cls = '', msg;
    if (S.cost === 0) msg = st.kind === 'shield' ? '外部磁場の中に、鉄を置いて測定ゾーンを守ろう。' : '鉄(や磁石)を塗って、磁束の通り道を作ろう。';
    else if (v < st.target) msg = `目標まであと ${st.kind === 'shield' ? '×' + (st.target - v).toFixed(1) : (st.target - v).toFixed(2) + ' T'}。` + (S.satCount > 0 ? `鉄の ${S.satCount} セルが飽和中(赤)。そこがボトルネック。` : '磁力線がどこで漏れているか見てみよう。');
    else if (st.minRatio && ratio() < st.minRatio) msg = `磁場は十分ですが、片側への偏りが足りません(×${ratio().toFixed(1)} / 必要 ×${st.minRatio})。反対側へ漏れる磁束を打ち消そう。`;
    else if (sc === null) msg = '予算を超えています。';
    else { cls = 'ok'; msg = '目標クリア! 「提出」で記録できます。材料を減らしてさらに高得点を狙おう。'; }
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

  const MAT_COL = { 1: '#aab4c6' };
  function buildPalette() {
    const ms = $('matSeg'); ms.innerHTML = '';
    S.st.tools.forEach((id) => {
      const m = M.MATS.find((q) => q.id === id);
      const b = document.createElement('button');
      const sw = id === M.IRON ? `<span class="sw" style="background:#aab4c6"></span>` : '';
      b.innerHTML = `${sw}${m.label}`;
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
    document.querySelectorAll('#matSeg button').forEach((b) => b.classList.toggle('on', S.erase ? b.dataset.id === 'erase' : +b.dataset.id === S.matId));
    document.querySelectorAll('#brushSeg button').forEach((b) => b.classList.toggle('on', +b.dataset.r === S.brush));
    const m = M.MATS.find((q) => q.id === S.matId);
    $('matInfo').textContent = S.erase ? '塗った材料を消します。'
      : (m.id === M.IRON ? '軟鉄: 比透磁率 約800、約1.6 Tで飽和。1セルあたりコスト 1'
        : `${m.label}: 残留磁束密度 ${M.BR} T(矢印が N 極へ向かう向き)。1セルあたりコスト ${m.cost}`);
  }

  // ------------------------------------------------------------------ view
  function resize() {
    const r = cv.parentElement.getBoundingClientRect();
    view.dpr = window.devicePixelRatio || 1;
    view.w = Math.max(1, r.width); view.h = Math.max(1, r.height);
    Z.setSize(view.w, view.h);
    cv.width = Math.round(view.w * view.dpr); cv.height = Math.round(view.h * view.dpr);
    if (!S.P) return;
    const pad = 20;
    const cs0 = Math.max(2, Math.min((view.w - pad * 2) / S.P.w, (view.h - pad * 2) / S.P.h));
    view.base = { cs: cs0, ox: (view.w - cs0 * S.P.w) / 2, oy: (view.h - cs0 * S.P.h) / 2 };
    applyZoom();
  }
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(() => resize()).observe(cv.parentElement);

  // |B| colour image, one pixel per cell
  const bCv = document.createElement('canvas');
  function buildBImage() {
    const { w, h } = S.P;
    bCv.width = w; bCv.height = h;
    const bctx = bCv.getContext('2d'), img = bctx.createImageData(w, h);
    const B = S.sol.B.bm;
    for (let i = 0; i < w * h; i++) {
      const t = Math.sqrt(clamp(B[i] / bScale(), 0, 1));
      const k = Math.round(t * 255) * 3;
      img.data[i * 4] = LUT[k]; img.data[i * 4 + 1] = LUT[k + 1]; img.data[i * 4 + 2] = LUT[k + 2]; img.data[i * 4 + 3] = 255;
    }
    bctx.putImageData(img, 0, 0);
  }

  function arrowPath(c, cx, cy, dx, dy, s) {
    const px = -dy, py = dx;
    c.beginPath();
    c.moveTo(cx - dx * s * 0.34, cy - dy * s * 0.34); c.lineTo(cx + dx * s * 0.28, cy + dy * s * 0.28);
    c.moveTo(cx + dx * s * 0.34, cy + dy * s * 0.34);
    c.lineTo(cx + dx * s * 0.08 + px * s * 0.2, cy + dy * s * 0.08 + py * s * 0.2);
    c.moveTo(cx + dx * s * 0.34, cy + dy * s * 0.34);
    c.lineTo(cx + dx * s * 0.08 - px * s * 0.2, cy + dy * s * 0.08 - py * s * 0.2);
    c.stroke();
  }

  function draw() {
    const { w, h } = S.P, cs = view.cs;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.fillStyle = '#0f1722'; ctx.fillRect(0, 0, view.w, view.h);
    // background: field magnitude or flat
    if (S.showB) { ctx.imageSmoothingEnabled = true; ctx.drawImage(bCv, view.ox, view.oy, cs * w, cs * h); }
    else { ctx.fillStyle = '#131c2a'; ctx.fillRect(view.ox, view.oy, cs * w, cs * h); }
    // cells that cannot be edited are slightly dimmed
    ctx.fillStyle = 'rgba(8,12,20,0.35)';
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (S.P.fixed[i] && !S.P.fmat[i] && !inZone(i)) ctx.fillRect(view.ox + x * cs, view.oy + y * cs, cs + 0.5, cs + 0.5);
    }
    // iron and magnets
    const mm = S.sol.mat, Bm = S.sol.B.bm;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x, m = mm[i];
        if (!m) continue;
        const X = view.ox + x * cs, Y = view.oy + y * cs;
        if (m === M.IRON) {
          const sat = Bm[i] > M.BS;
          ctx.fillStyle = sat ? 'rgba(255,80,60,0.82)' : 'rgba(170,182,200,0.72)';
          ctx.fillRect(X, Y, cs, cs);
        } else {
          const d = M.MATS.find((q) => q.id === m).dir;
          const g = ctx.createLinearGradient(X + cs / 2 - d[0] * cs / 2, Y + cs / 2 - d[1] * cs / 2, X + cs / 2 + d[0] * cs / 2, Y + cs / 2 + d[1] * cs / 2);
          g.addColorStop(0, '#3b6fd6'); g.addColorStop(0.5, '#7b6aa0'); g.addColorStop(1, '#e0453a');
          ctx.fillStyle = g; ctx.fillRect(X, Y, cs, cs);
          ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, cs * 0.09); ctx.lineCap = 'round';
          arrowPath(ctx, X + cs / 2, Y + cs / 2, d[0], d[1], cs);
        }
        if (!S.P.fixed[i]) { ctx.strokeStyle = 'rgba(10,16,24,0.55)'; ctx.lineWidth = 1; ctx.strokeRect(X + 0.5, Y + 0.5, cs - 1, cs - 1); }
      }
    }
    // flux lines
    if (S.showLines && S.lines) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = Math.max(0.8, cs * 0.06); ctx.lineCap = 'butt';
      ctx.beginPath();
      for (const segs of S.lines) for (const [a, b] of segs) { ctx.moveTo(view.ox + a[0] * cs, view.oy + a[1] * cs); ctx.lineTo(view.ox + b[0] * cs, view.oy + b[1] * cs); }
      ctx.stroke();
    }
    // zones
    const zr = (idx, col, label) => {
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (const i of idx) { const x = i % w, y = (i / w) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.strokeRect(view.ox + x0 * cs, view.oy + y0 * cs, (x1 - x0 + 1) * cs, (y1 - y0 + 1) * cs);
      ctx.setLineDash([]);
      ctx.fillStyle = col; ctx.font = `600 ${Math.max(10, cs * 0.7)}px system-ui`; ctx.textAlign = 'left';
      ctx.fillText(label, view.ox + x0 * cs, view.oy + y0 * cs - 4);
    };
    zr(S.P.zone, '#5eead4', S.st.kind === 'shield' ? '守る場所' : '測定ゾーン');
    if (S.P.zone2.length) zr(S.P.zone2, '#fdba74', '漏れ(小さく)');
    // frame
    ctx.strokeStyle = '#3b4d6b'; ctx.lineWidth = 1.5; ctx.strokeRect(view.ox, view.oy, cs * w, cs * h);
    // brush preview
    if (S.hover && !S.stroke) {
      const r = S.brush;
      ctx.strokeStyle = '#ffb703'; ctx.lineWidth = 2;
      ctx.strokeRect(view.ox + (S.hover.x - r) * cs, view.oy + (S.hover.y - r) * cs, (2 * r + 1) * cs, (2 * r + 1) * cs);
    }
    if (S.line && S.hover) {
      ctx.strokeStyle = '#ffb70388'; ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(view.ox + (S.line.x + 0.5) * cs, view.oy + (S.line.y + 0.5) * cs);
      ctx.lineTo(view.ox + (S.hover.x + 0.5) * cs, view.oy + (S.hover.y + 0.5) * cs); ctx.stroke();
    }
  }
  const inZone = (i) => { const z = S.P.zone, z2 = S.P.zone2; for (let k = 0; k < z.length; k++) if (z[k] === i) return true; for (let k = 0; k < z2.length; k++) if (z2[k] === i) return true; return false; };

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
    if (S.P.fixed[i] || S.mat[i] === id) return;
    const delta = M.COST_OF[id] - M.COST_OF[S.mat[i]];
    if (delta > 0 && S.cost + delta > S.st.budget) { S.stroke.blocked = true; return; }
    if (!S.stroke.pushed) { S.undo.push(Uint8Array.from(S.mat)); S.redo = []; if (S.undo.length > 100) S.undo.shift(); S.stroke.pushed = true; }
    S.mat[i] = id; S.cost += delta; markDirty();
  }
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
    if (!c || !S.sol) { el.textContent = 'マウスを重ねると磁束密度が出ます'; return; }
    const i = c.y * S.P.w + c.x, m = S.sol.mat[i];
    const name = m ? M.MATS.find((q) => q.id === m).label : '空気';
    const b = S.sol.B.bm[i];
    el.textContent = `(${c.x}, ${c.y}) ${name} — |B| = ${b.toFixed(3)} T${m === M.IRON && b > M.BS ? '(飽和)' : ''}`;
  }

  function undo() { if (!S.undo.length) return; S.redo.push(Uint8Array.from(S.mat)); S.mat = S.undo.pop(); markDirty(); S.dirtyAt = 0; }
  function redo() { if (!S.redo.length) return; S.undo.push(Uint8Array.from(S.mat)); S.mat = S.redo.pop(); markDirty(); S.dirtyAt = 0; }
  $('undoBtn').onclick = undo;
  $('redoBtn').onclick = redo;
  $('clearBtn').onclick = () => {
    if (!S.mat.some((v) => v)) return;
    S.undo.push(Uint8Array.from(S.mat)); S.redo = []; S.mat.fill(0); markDirty(); S.dirtyAt = 0;
  };
  $('chkB').onchange = (e) => { S.showB = e.target.checked; };
  $('chkLines').onchange = (e) => { S.showLines = e.target.checked; };
  $('helpBtn').onclick = (e) => { e.preventDefault(); $('helpDlg').showModal(); };
  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    const ti = '12345'.indexOf(e.key);
    if (ti >= 0) { if (ti < S.st.tools.length) { S.matId = S.st.tools[ti]; S.erase = false; } }
    else if (e.key.toLowerCase() === 'e') S.erase = !S.erase;
    else if (e.key === '[') S.brush = Math.max(0, S.brush - 1);
    else if (e.key === ']') S.brush = Math.min(2, S.brush + 1);
    else return;
    refreshPalette();
  });

  // ------------------------------------------------------------------ submit
  function hints() {
    const out = [], st = S.st;
    if (S.satCount > 0) out.push(`鉄の <b>${S.satCount} セル</b>が飽和(赤)しています。鉄は約1.6 Tを超えると磁束をほとんど通さなくなり、<b>その細い所がボトルネック</b>になります。流す磁束に見合う太さにしましょう。`);
    if (S.unused >= 6) out.push(`磁束がほとんど通っていない鉄が <b>${S.unused} セル</b>あります。通り道から外れた鉄は、コストを食うだけで働いていません。`);
    if (st.kind === 'shield') out.push('鉄は磁束を「吸い込んで」測定ゾーンの外へ迂回させます。厚い1枚は内側で飽和しやすく、<b>薄い殻を空気の隙間をあけて何重か</b>にすると、少ない鉄でも遮蔽が大きく伸びます(マルチレイヤー)。');
    else if (st.id === 1) out.push('磁束は閉じた輪になります。ギャップを通った後の<b>戻りの道</b>が細い・遠いと損失が増えます。逆に、行きと戻りの鉄が近すぎると、ギャップを飛ばして<b>短絡</b>します。');
    else if (st.id === 3) out.push('磁極を先細りにすると、同じ磁束が狭い面を通るので磁束密度が上がります(面積比)。ただし先端が1.6 T付近で飽和し、それ以上は上がりません。');
    else if (st.id === 4) out.push('磁化の向きを <b>→ ↑ ← ↓</b> と90°ずつ回しながら並べると、片側の磁束が強め合い、反対側は打ち消し合います(ハルバッハ配列)。');
    return out.slice(0, 3);
  }

  function shareText() {
    const st = S.st, sc = scoreNow();
    const lines = [`Magnet Lab「${st.id}. ${st.name}」で磁気回路を設計しました!`,
      `${st.kind === 'shield' ? '遮蔽' : '磁束密度'} ${fmtV(value())} / 材料コスト ${S.cost} / スコア ${sc}`, '#MagnetLab'];
    const params = new URLSearchParams({ text: lines.join('\n') });
    if (/^https?:$/.test(location.protocol)) params.set('url', location.href.split('#')[0]);
    return `https://x.com/intent/post?${params.toString()}`;
  }
  const share = () => window.open(shareText(), '_blank', 'noopener');
  $('shareBtn').onclick = share;
  $('shareTop').onclick = share;

  $('submitBtn').onclick = () => {
    if (S.dirty) recalc();
    const sc = scoreNow(); if (sc === null) return;
    const st = S.st;
    S.submitted = true;
    S.saved.designs[st.id] = Array.from(S.mat);
    const prev = S.saved.best[st.id];
    let msg = '';
    if (!prev || sc > prev.score) { S.saved.best[st.id] = { score: sc, text: fmtV(value()), cost: S.cost }; msg = ' <b class="pass">ベスト更新!</b>'; }
    persist(); buildTabs(); updatePanel();
    const hs = hints().map((t) => `<li class="hint-li">${t}</li>`).join('');
    $('reportCard').hidden = false;
    $('report').innerHTML = `
      <p class="pass"><b>合格</b> — ${fmtV(value())} / コスト ${S.cost} / スコア <b>${sc}</b>${msg}</p>
      <div class="explain"><b>ヒント</b><ul>${hs || '<li>すばらしい設計です。材料を減らして効率を上げられるか試してみよう。</li>'}</ul></div>`;
    $('reportCard').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    $('shareTop').hidden = false;
  };

  // ------------------------------------------------------------------ main loop
  function frame(now) {
    if (S.dirty && now - S.dirtyAt > (S.stroke ? 90 : 0)) { S.dirtyAt = now; recalc(); }
    draw();
    requestAnimationFrame(frame);
  }

  load();
  selectStage(0);
  requestAnimationFrame(frame);
  if (!S.saved.seenHelp) {
    S.saved.seenHelp = true; persist();
    try { $('helpDlg').showModal(); } catch (e) { /* ignore */ }
  }
  window.__mag = { S, M, selectStage, recalc };
})();
