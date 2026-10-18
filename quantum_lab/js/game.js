/*
 * game.js — Quantum Lab UI: place gates on a circuit, watch Bloch spheres / amplitudes,
 * match the target state (or operation) with as little gate cost as possible.
 */
(function () {
  'use strict';

  const Q = window.Quantum;
  const STAGES = window.QuantumStages.STAGES;
  const $ = (id) => document.getElementById(id);
  const viz = $('viz'), vctx = viz.getContext('2d');
  const svg = $('circuit');
  const NS = 'http://www.w3.org/2000/svg';
  const PASS = 0.999;

  const S = {
    idx: 0, st: null, gates: [], undo: [], redo: [],
    tool: 'H', pending: null, step: 0, playing: null,
    cur: null, fid: 0, cost: 0, parCost: 0,
    tState: null, tU: null, submitted: false,
    saved: { designs: {}, best: {}, seenHelp: false },
  };
  const view = { w: 0, h: 0, dpr: 1 };

  const KEY = 'quantumlab.v1';
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
    const st = S.st;
    S.parCost = Q.costOf(st.par);
    S.tState = st.kind === 'state' ? Q.run(st.n, st.target) : null;
    S.tU = st.kind === 'unitary' ? Q.unitary(st.n, st.target) : null;
    const saved = S.saved.designs[st.id];
    S.gates = saved ? saved.map((g) => ({ ...g })) : [];
    S.undo = []; S.redo = []; S.pending = null; S.submitted = false;
        S.step = st.cols - 1;
    $('reportCard').hidden = true; $('shareTop').hidden = true;
    buildPalette(); buildTabs();
    recalc();
    resize();
  }

  function recalc() {
    const st = S.st;
    S.cost = Q.costOf(S.gates);
    S.curFinal = st.kind === 'state' ? Q.run(st.n, S.gates) : null;
    S.curU = st.kind === 'unitary' ? Q.unitary(st.n, S.gates) : null;
    S.fid = st.kind === 'state' ? Q.stateFidelity(S.tState, S.curFinal) : Q.unitaryFidelity(S.tU, S.curU);
    updateView();
    updatePanel();
    drawCircuit();
  }
  function updateView() {
    S.cur = Q.run(S.st.n, S.gates, S.step);
  }

  function scoreNow() {
    if (S.fid < PASS || S.cost <= 0) return null;
    return Math.round((1000 * S.parCost) / S.cost);
  }

  // ------------------------------------------------------------------ panel
  function updatePanel() {
    const st = S.st, sc = scoreNow();
    $('stageName').textContent = `${st.id}. ${st.name}`;
    $('stageBrief').textContent = st.brief;
    $('fidVal').textContent = `${(S.fid * 100).toFixed(1)}%`;
    $('fidBar').style.width = `${clamp(S.fid * 100, 0, 100)}%`;
    $('fidBar').style.background = S.fid >= PASS ? 'var(--ok)' : 'var(--ten)';
    $('fidMark').style.left = `${PASS * 100}%`;
    $('costVal').textContent = S.cost;
    $('parVal').textContent = S.parCost;
    const cmax = Math.max(S.parCost * 2, S.cost, 1);
    $('costBar').style.width = `${clamp((S.cost / cmax) * 100, 0, 100)}%`;
    $('costBar').style.background = S.cost > S.parCost ? 'var(--ten)' : 'var(--ok)';
    $('parMark').style.left = `${(S.parCost / cmax) * 100}%`;
    $('scoreVal').textContent = sc === null ? '—' : sc;
    const best = S.saved.best[st.id];
    $('bestVal').textContent = best ? `${best.score}(コスト ${best.cost})` : '—';
    const el = $('status');
    let cls = '', msg;
    if (S.gates.length === 0) msg = '下の回路のマスをタップして、ゲートをメニューから選ぼう。';
    else if (S.fid < PASS) msg = `まだ一致していません(${(S.fid * 100).toFixed(1)}%)。球の向き(水色の輪が目標)を見て、足りない回転を考えよう。`;
    else if (S.cost > S.parCost) { cls = 'ok'; msg = `一致! コスト ${S.cost}。もっと少ないゲートで作れる(目安 ${S.parCost})。`; }
    else { cls = 'ok'; msg = '一致!(最小コスト)。「提出」で記録できます。'; }
    el.className = `status ${cls}`; el.textContent = msg;
    $('submitBtn').disabled = sc === null;
    $('stepLbl').textContent = S.step >= S.st.cols - 1 ? '最後' : (S.step < 0 ? '入力' : `列 ${S.step + 1}`);
    buildTabs();
    describeState();
  }

  function describeState() {
    const st = S.st, p = Q.probs(S.cur), n = st.n;
    const items = [];
    for (let i = 0; i < p.length; i++) if (p[i] > 0.005) items.push(`|${i.toString(2).padStart(n, '0')}⟩ ${(p[i] * 100).toFixed(0)}%`);
    $('cellInfo').textContent = `測定すると: ${items.join(' / ')}`;
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

  const TOOLCOL = { H: '#3aa0ff', X: '#ff7a59', Y: '#e879f9', Z: '#4ade80', S: '#fbbf24', Sdg: '#fbbf24', T: '#f59e0b', Tdg: '#f59e0b', CNOT: '#a78bfa', CZ: '#a78bfa', SWAP: '#a78bfa' };
  const gname = (t) => (t === 'CNOT' || t === 'CZ' || t === 'SWAP' ? t : Q.GATES[t].label);
  const GDOC = {
    H: ['H(アダマール)', 'ブロッホ球を「X軸とZ軸の真ん中の軸」まわりに180°回す。|0⟩(北極)→|+⟩(赤道)のように、確定した状態を50:50の重ね合わせに変え、逆に重ね合わせを確定状態に戻す。H を2回かけると元に戻る。基底(Z軸とX軸)の入れ替えにも使う: H X H = Z。', '行列 (1/√2)[[1,1],[1,−1]]'],
    X: ['X(NOT)', 'X軸まわりに180°回す。|0⟩と|1⟩を入れ替える古典の NOT。確率だけでなく位相の向きも反転して見える(Y軸成分・Z軸成分の符号が逆になる)。', '行列 [[0,1],[1,0]]'],
    Y: ['Y', 'Y軸まわりに180°回す。|0⟩と|1⟩を入れ替えつつ位相も付く(X と Z を合わせたもの、位相を除く)。', '行列 [[0,−i],[i,0]]'],
    Z: ['Z(位相反転)', 'Z軸まわりに180°回す。|0⟩はそのまま、|1⟩の符号だけ −1。確率は変わらないが、|+⟩と|−⟩が入れ替わる(赤道上で反対側へ)。', '行列 [[1,0],[0,−1]]'],
    S: ['S', 'Z軸まわりに90°回す(|1⟩の位相に i)。|+⟩ → |+i⟩。S を2回かけると Z。', '行列 [[1,0],[0,i]]'],
    Sdg: ['S†', 'S の逆。Z軸まわりに −90°回す。S と並べると打ち消し合う。', '行列 [[1,0],[0,−i]]'],
    T: ['T', 'Z軸まわりに45°回す(S の半分)。T を2回で S、4回で Z。誤り耐性のある量子計算では作るのが高価なので、ここでもコストは 2。', '行列 [[1,0],[0,e^{iπ/4}]]'],
    Tdg: ['T†', 'T の逆(−45°)。コストは T と同じ 2。', '行列 [[1,0],[0,e^{−iπ/4}]]'],
    CNOT: ['CNOT(制御NOT)', '制御ビット(●)が |1⟩ のときだけ、標的ビット(⊕)を X で反転する。制御ビットが重ね合わせだと、2つのビットが「もつれ」る(H + CNOT でベル状態)。プルダウンで「CNOT → q番号」と選ぶと、選んだ線が制御、番号の線が標的。', '|c,t⟩ → |c, t⊕c⟩'],
    CZ: ['CZ(制御Z)', '両方のビットが |1⟩ のときだけ符号を −1 にする。どちらを制御と呼んでも同じ(対称)。標的側を H で挟むと CNOT になる。', '|11⟩ → −|11⟩'],
    SWAP: ['SWAP', '2つのビットの状態をそのまま入れ替える。コストは 3(CNOT 3個ぶん)。', '|a,b⟩ → |b,a⟩'],
  };
  function showGate(t) {
    S.sel = t;
    document.querySelectorAll('#matSeg .gbtn').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    const d = GDOC[t], g = Q.GATES[t];
    $('matInfo').innerHTML = `<b style="color:${TOOLCOL[t]}">${d[0]}</b>　<span class="dim">コスト ${g.cost}</span><br>${d[1]}<br><span class="dim">${d[2]}</span>`;
  }
  function buildPalette() {   // gate list: click one to read about it (gates are placed from the drop-downs in the circuit)
    const ms = $('matSeg'); ms.innerHTML = '';
    S.st.gates.forEach((t) => {
      const g = Q.GATES[t], b = document.createElement('button');
      b.className = 'gbtn legend'; b.dataset.t = t;
      b.innerHTML = `<b style="color:${TOOLCOL[t]}">${gname(t)}</b><span class="dim">コスト${g.cost}</span>`;
      b.onclick = () => showGate(t);
      ms.appendChild(b);
    });
    showGate(S.st.gates.includes(S.sel) ? S.sel : S.st.gates[0]);
  }

  // ------------------------------------------------------------------ circuit editor (SVG)
  const CW = 58, RH = 56, LBL = 64, TOP = 26;
  function drawCircuit() {
    const st = S.st, n = st.n, cols = st.cols;
    const W = LBL + cols * CW + 8, H = TOP + n * RH + 6;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.style.aspectRatio = `${W} / ${H}`;
    const parts = [];
    // header: press / drag to choose how far to look ("入力" = before any gate)
    parts.push(`<rect x="3" y="2" width="${LBL - 8}" height="20" rx="6" fill="${S.step < 0 ? '#ffb70333' : '#1d2b40'}" stroke="${S.step < 0 ? '#ffb703' : '#2a3a54'}"/><text x="${LBL / 2 - 2}" y="16" text-anchor="middle" font-size="12" fill="${S.step < 0 ? '#ffb703' : '#8fa3bd'}" pointer-events="none">入力</text>`);
    for (let c = 0; c < cols; c++) {
      const x = LBL + c * CW + CW / 2, on = c === S.step;
      parts.push(`<rect x="${LBL + c * CW + 3}" y="2" width="${CW - 6}" height="20" rx="6" fill="${on ? '#ffb70333' : '#1d2b40'}" stroke="${on ? '#ffb703' : '#2a3a54'}" data-step="${c}"/>`);
      parts.push(`<text x="${x}" y="16" text-anchor="middle" font-size="12" fill="${on ? '#ffb703' : '#8fa3bd'}" pointer-events="none">${c + 1}</text>`);
    }
    // wires
    for (let q = 0; q < n; q++) {
      const y = TOP + q * RH + RH / 2;
      parts.push(`<text x="8" y="${y + 5}" font-size="14" fill="#cfd9e8">q${q} |0⟩</text>`);
      parts.push(`<line x1="${LBL}" y1="${y}" x2="${W - 6}" y2="${y}" stroke="#4b6286" stroke-width="2"/>`);
    }
    // step marker line
    const sx = LBL + (S.step + 1) * CW;
    if (S.step < cols - 1) parts.push(`<line x1="${sx}" y1="${TOP - 2}" x2="${sx}" y2="${H - 2}" stroke="#ffb703" stroke-width="2" stroke-dasharray="4 3"/>`);
    // empty cells: a dashed slot with a "+" (the drop-down sits on top)
    for (let c = 0; c < cols; c++) for (let q = 0; q < n; q++) {
      const occ = S.gates.some((g) => g.c === c && (g.q === q || g.k === q));
      if (occ) continue;
      parts.push(`<rect x="${LBL + c * CW + 4}" y="${TOP + q * RH + 6}" width="${CW - 8}" height="${RH - 12}" rx="8" fill="#ffffff08" stroke="#ffffff30" stroke-dasharray="3 3"/>`);
      parts.push(`<text x="${LBL + c * CW + CW / 2}" y="${TOP + q * RH + RH / 2 + 5}" text-anchor="middle" font-size="16" fill="#ffffff55">▾</text>`);
    }
    // gates
    const cx = (c) => LBL + c * CW + CW / 2, cy = (q) => TOP + q * RH + RH / 2;
    for (const g of S.gates) {
      const t = g.type, col = TOOLCOL[t], dim = g.c > S.step ? 0.45 : 1;
      let s = `<g opacity="${dim}" pointer-events="none">`;
      if (Q.GATES[t].qubits === 1) {
        s += `<rect x="${cx(g.c) - 19}" y="${cy(g.q) - 19}" width="38" height="38" rx="8" fill="#13202f" stroke="${col}" stroke-width="2.5"/>`;
        s += `<text x="${cx(g.c)}" y="${cy(g.q) + 6}" text-anchor="middle" font-size="18" font-weight="700" fill="${col}">${Q.GATES[t].label}</text>`;
      } else {
        const y1 = cy(Math.min(g.q, g.k)), y2 = cy(Math.max(g.q, g.k));
        s += `<line x1="${cx(g.c)}" y1="${y1}" x2="${cx(g.c)}" y2="${y2}" stroke="${col}" stroke-width="3"/>`;
        const dot = (q) => `<circle cx="${cx(g.c)}" cy="${cy(q)}" r="6.5" fill="${col}"/>`;
        if (t === 'CNOT') {
          s += dot(g.k);
          s += `<circle cx="${cx(g.c)}" cy="${cy(g.q)}" r="14" fill="#13202f" stroke="${col}" stroke-width="3"/>`;
          s += `<line x1="${cx(g.c) - 14}" y1="${cy(g.q)}" x2="${cx(g.c) + 14}" y2="${cy(g.q)}" stroke="${col}" stroke-width="3"/><line x1="${cx(g.c)}" y1="${cy(g.q) - 14}" x2="${cx(g.c)}" y2="${cy(g.q) + 14}" stroke="${col}" stroke-width="3"/>`;
        } else if (t === 'CZ') { s += dot(g.k) + dot(g.q); }
        else {
          for (const q of [g.q, g.k]) s += `<line x1="${cx(g.c) - 9}" y1="${cy(q) - 9}" x2="${cx(g.c) + 9}" y2="${cy(q) + 9}" stroke="${col}" stroke-width="3.5"/><line x1="${cx(g.c) + 9}" y1="${cy(q) - 9}" x2="${cx(g.c) - 9}" y2="${cy(q) + 9}" stroke="${col}" stroke-width="3.5"/>`;
        }
      }
      parts.push(s + '</g>');
    }
    svg.innerHTML = parts.join('');
    buildSelects(W, H);
  }

  // one drop-down per circuit cell (transparent, laid over the SVG)
  function cellValue(c, q) {
    const g = S.gates.find((x) => x.c === c && (x.q === q || x.k === q));
    if (!g) return '';
    if (Q.GATES[g.type].qubits === 1) return g.type;
    return g.k === q ? `${g.type}:${g.q}` : '@';
  }
  function buildSelects(W, H) {
    const wrap = $("circuitInner");
    let layer = $('cellLayer');
    if (!layer) { layer = document.createElement('div'); layer.id = 'cellLayer'; wrap.appendChild(layer); }
    layer.innerHTML = '';
    const st = S.st, n = st.n;
    for (let c = 0; c < st.cols; c++) for (let q = 0; q < n; q++) {
      const sel = document.createElement('select');
      sel.setAttribute('aria-label', `列${c + 1} q${q}`);
      sel.style.left = `${((LBL + c * CW + 3) / W) * 100}%`;
      sel.style.top = `${((TOP + q * RH + 4) / H) * 100}%`;
      sel.style.width = `${((CW - 6) / W) * 100}%`;
      sel.style.height = `${((RH - 8) / H) * 100}%`;
      const add = (v, label, dis) => { const o = document.createElement('option'); o.value = v; o.textContent = label; if (dis) o.disabled = true; sel.appendChild(o); };
      add('', '— (なし)');
      for (const t of st.gates) {
        const gt = Q.GATES[t];
        if (gt.qubits === 1) add(t, `${gname(t)}(${gt.name.split('(')[0]})`);
        else for (let o = 0; o < n; o++) if (o !== q) add(`${t}:${o}`, `${gname(t)} → q${o}`);
      }
      const cur = cellValue(c, q);
      if (cur === '@') add('@', '(相手側のマス)', true);
      sel.value = cur;
      sel.onchange = () => setCell(c, q, sel.value);
      layer.appendChild(sel);
    }
  }
  function setCell(c, q, v) {
    stopPlay();
    const cur = cellValue(c, q);
    if (v === cur || v === '@') return;
    commit(() => {
      removeAt(c, q);
      if (v === '') return;
      if (v.includes(':')) { const [type, o] = v.split(':'); const t = +o; removeAt(c, t); S.gates.push({ c, type, q: t, k: q }); }
      else S.gates.push({ c, type: v, q });
    });
  }

  // Choose how far to view the circuit: press / drag along the numbered header (or the wire area).
  let dragStep = false;
  function stepFromEvent(e) {
    const r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
    const x = ((e.clientX - r.left) / r.width) * vb.width;
    return clamp(Math.floor((x - LBL) / CW), -1, S.st.cols - 1);
  }
  svg.addEventListener('pointerdown', (e) => {
    const r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
    const y = ((e.clientY - r.top) / r.height) * vb.height;
    if (y > TOP - 2) return;   // below the header: the drop-downs handle it
    dragStep = true; stopPlay();
    try { svg.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    const t = stepFromEvent(e); if (t !== S.step) setStep(t);
  });
  svg.addEventListener('pointermove', (e) => { if (!dragStep) return; const t = stepFromEvent(e); if (t !== S.step) setStep(t); });
  const endDrag = () => { dragStep = false; };
  svg.addEventListener('pointerup', endDrag); svg.addEventListener('pointercancel', endDrag);

  function removeAt(c, q) {
    const before = S.gates.length;
    S.gates = S.gates.filter((g) => !(g.c === c && (g.q === q || g.k === q)));
    return before !== S.gates.length;
  }
  function pushUndo() { S.undo.push(S.gates.map((g) => ({ ...g }))); S.redo = []; if (S.undo.length > 100) S.undo.shift(); }
  function commit(fn) {
    pushUndo(); fn(); S.pending = null; S.submitted = false;
    $('reportCard').hidden = true; $('shareTop').hidden = true;
    recalc();
  }
  function undo() { if (!S.undo.length) return; S.redo.push(S.gates.map((g) => ({ ...g }))); S.gates = S.undo.pop(); S.pending = null; recalc(); }
  function redo() { if (!S.redo.length) return; S.undo.push(S.gates.map((g) => ({ ...g }))); S.gates = S.redo.pop(); S.pending = null; recalc(); }
  $('undoBtn').onclick = undo; $('redoBtn').onclick = redo;
  $('clearBtn').onclick = () => { if (S.gates.length) commit(() => { S.gates = []; }); };
  $('helpBtn').onclick = (e) => { e.preventDefault(); $('helpDlg').showModal(); };

  // step controls
  function setStep(s) { S.step = clamp(s, -1, S.st.cols - 1); updateView(); updatePanel(); drawCircuit(); }
  function stopPlay() { if (S.playing) { clearInterval(S.playing); S.playing = null; $('playBtn').textContent = '▶▶ 再生'; } }
  $('stepBack').onclick = () => { stopPlay(); setStep(S.step - 1); };
  $('stepFwd').onclick = () => { stopPlay(); setStep(S.step + 1); };
  $('playBtn').onclick = () => {
    if (S.playing) { stopPlay(); return; }
    setStep(-1);
    $('playBtn').textContent = '■ 停止';
    S.playing = setInterval(() => { if (S.step >= S.st.cols - 1) { stopPlay(); return; } setStep(S.step + 1); }, 650);
  };
  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    else if (e.key === 'ArrowLeft') { stopPlay(); setStep(S.step - 1); }
    else if (e.key === 'ArrowRight') { stopPlay(); setStep(S.step + 1); }
  });

  // ------------------------------------------------------------------ visualisation (canvas)
  function resize() {
    const r = viz.parentElement.getBoundingClientRect();
    view.dpr = window.devicePixelRatio || 1;
    view.w = Math.max(1, r.width); view.h = Math.max(1, r.height);
    viz.width = Math.round(view.w * view.dpr); viz.height = Math.round(view.h * view.dpr);
    drawViz();
  }
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(() => resize()).observe(viz.parentElement);

  const hue = (re, im) => ((Math.atan2(im, re) / Math.PI) * 180 + 360) % 360;

  function drawBloch(c, cx, cy, r, vec, tvec, label) {
    const yaw = 0.62, tilt = 0.38;
    const P = (x, y, z) => {
      const x1 = x * Math.cos(yaw) - y * Math.sin(yaw), y1 = x * Math.sin(yaw) + y * Math.cos(yaw);
      return { x: cx + r * x1, y: cy + r * (-z * Math.cos(tilt) + y1 * Math.sin(tilt)), d: -y1 * Math.cos(tilt) + z * Math.sin(tilt) };
    };
    c.lineWidth = 1.4;
    c.strokeStyle = '#3b4d6b'; c.beginPath(); c.arc(cx, cy, r, 0, 7); c.stroke();
    // equator
    const ring = (fn, front) => {
      c.beginPath(); let started = false;
      for (let a = 0; a <= 64; a++) {
        const t = (a / 64) * Math.PI * 2, p = fn(t);
        if ((p.d >= 0) !== front) { started = false; continue; }
        if (!started) { c.moveTo(p.x, p.y); started = true; } else c.lineTo(p.x, p.y);
      }
      c.stroke();
    };
    const eq = (t) => P(Math.cos(t), Math.sin(t), 0), mer = (t) => P(Math.cos(t), 0, Math.sin(t)), mer2 = (t) => P(0, Math.cos(t), Math.sin(t));
    c.strokeStyle = '#2f4263'; c.setLineDash([3, 4]);
    for (const f of [eq, mer, mer2]) ring(f, false);
    c.setLineDash([]); c.strokeStyle = '#4b6286';
    for (const f of [eq, mer, mer2]) ring(f, true);
    // axes + labels
    c.fillStyle = '#9fb3cf'; c.font = `${Math.max(10, r * 0.2)}px system-ui`; c.textAlign = 'center';
    const lab = (x, y, z, t) => { const p = P(x * 1.22, y * 1.22, z * 1.22); c.fillText(t, p.x, p.y + 4); };
    lab(0, 0, 1, '|0⟩'); lab(0, 0, -1, '|1⟩'); lab(1, 0, 0, '|+⟩'); lab(-1, 0, 0, '|−⟩'); lab(0, 1, 0, '|+i⟩');
    // target
    if (tvec) {
      const p = P(tvec.x, tvec.y, tvec.z);
      c.strokeStyle = '#5eead4'; c.lineWidth = 2.5; c.beginPath(); c.arc(p.x, p.y, Math.max(7, r * 0.12), 0, 7); c.stroke();
    }
    // state vector
    const len = Math.hypot(vec.x, vec.y, vec.z), p = P(vec.x, vec.y, vec.z), o = P(0, 0, 0);
    c.strokeStyle = len > 0.98 ? '#ffb703' : '#fb923c'; c.lineWidth = 3; c.lineCap = 'round';
    c.beginPath(); c.moveTo(o.x, o.y); c.lineTo(p.x, p.y); c.stroke();
    c.fillStyle = c.strokeStyle; c.beginPath(); c.arc(p.x, p.y, Math.max(4, r * 0.075), 0, 7); c.fill();
    c.fillStyle = '#cfd9e8'; c.font = `600 ${Math.max(11, r * 0.22)}px system-ui`;
    c.fillText(label + (len < 0.95 ? '(もつれ)' : ''), cx, cy + r + Math.max(16, r * 0.3));
  }

  // align the phase of `a` to `b` (global phase is not observable)
  function align(a, b) {
    let re = 0, im = 0;
    for (let i = 0; i < a.length; i += 2) { re += b[i] * a[i] + b[i + 1] * a[i + 1]; im += b[i] * a[i + 1] - b[i + 1] * a[i]; }
    const m = Math.hypot(re, im);
    if (m < 1e-9) return a;
    const cr = re / m, ci = -im / m, out = new Float64Array(a.length);   // multiply by conj(phase)
    for (let i = 0; i < a.length; i += 2) { out[i] = a[i] * cr - a[i + 1] * ci; out[i + 1] = a[i] * ci + a[i + 1] * cr; }
    return out;
  }

  function drawViz() {
    const st = S.st; if (!st || !S.cur) return;
    const c = vctx, W = view.w, H = view.h, n = st.n;
    c.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    c.fillStyle = '#0f1722'; c.fillRect(0, 0, W, H);
    c.lineCap = 'round';
    const dim = Q.dimOf(n);
    if (st.kind === 'state') {
      const cur = S.cur, tgt = S.tState;
      // layout: spheres on the top, amplitude rows below (side by side on wide screens)
      const wide = W > 760 && n <= 2;
      const sphA = wide ? { x: 0, y: 0, w: W * 0.5, h: H } : { x: 0, y: 0, w: W, h: n === 1 ? H * 0.58 : H * 0.46 };
      const ampA = wide ? { x: W * 0.5, y: 0, w: W * 0.5, h: H } : { x: 0, y: sphA.h, w: W, h: H - sphA.h };
      const rad = Math.min(sphA.h * 0.34, (sphA.w / n) * 0.36);
      for (let q = 0; q < n; q++) {
        const cx = sphA.x + (sphA.w / n) * (q + 0.5), cy = sphA.y + sphA.h * 0.46;
        drawBloch(c, cx, cy, rad, Q.bloch(cur, n, q), Q.bloch(tgt, n, q), `q${q}`);
      }
      // amplitudes
      const al = align(cur, tgt);
      const rows = dim, rh = Math.min(26, (ampA.h - 22) / rows), x0 = ampA.x + 56, wbar = ampA.w - 56 - 70;
      c.font = `${Math.max(10, rh * 0.55)}px ui-monospace, Menlo, monospace`; c.textAlign = 'left';
      c.fillStyle = '#8fa3bd'; c.fillText('確率(棒の色 = 位相、水色の枠 = 目標)', ampA.x + 12, ampA.y + 14);
      for (let i = 0; i < rows; i++) {
        const y = ampA.y + 22 + i * rh, pr = al[2 * i] ** 2 + al[2 * i + 1] ** 2, pt = tgt[2 * i] ** 2 + tgt[2 * i + 1] ** 2;
        c.fillStyle = '#9fb3cf'; c.fillText(`|${i.toString(2).padStart(n, '0')}⟩`, ampA.x + 12, y + rh * 0.68);
        c.fillStyle = '#1d2b40'; c.fillRect(x0, y + 2, wbar, rh - 4);
        if (pr > 1e-4) { c.fillStyle = `hsl(${hue(al[2 * i], al[2 * i + 1])} 75% 55%)`; c.fillRect(x0, y + 2, wbar * pr, rh - 4); }
        if (pt > 1e-4) {
          c.strokeStyle = '#5eead4'; c.lineWidth = 2; c.strokeRect(x0, y + 2, wbar * pt, rh - 4);
          // target phase tick
          const th = hue(tgt[2 * i], tgt[2 * i + 1]);
          c.fillStyle = `hsl(${th} 80% 60%)`; c.beginPath(); c.arc(x0 + wbar + 12, y + rh / 2, Math.max(4, rh * 0.22), 0, 7); c.fill();
        }
        c.fillStyle = '#cfd9e8'; c.textAlign = 'right'; c.fillText(`${(pr * 100).toFixed(0)}%`, ampA.x + ampA.w - 6, y + rh * 0.68); c.textAlign = 'left';
      }
    } else {
      // unitary view: two matrices, target and yours (phase aligned)
      const cols = S.curU, tg = S.tU;
      const flat = (u) => { const a = new Float64Array(2 * dim * dim); for (let j = 0; j < dim; j++) for (let i = 0; i < 2 * dim; i++) a[j * 2 * dim + i] = u[j][i]; return a; };
      const fy = flat(cols), ft = flat(tg), fa = align(fy, ft);
      const area = Math.min(H - 110, W / 2 - 60), cell = area / dim;
      const draw = (arr, ox, oy, title) => {
        c.fillStyle = '#cfd9e8'; c.font = '600 13px system-ui'; c.textAlign = 'center'; c.fillText(title, ox + area / 2, oy - 10);
        c.fillStyle = '#13202f'; c.fillRect(ox, oy, area, area);
        c.strokeStyle = '#2a3a54'; c.lineWidth = 1;
        for (let k = 0; k <= dim; k++) { c.beginPath(); c.moveTo(ox + k * cell, oy); c.lineTo(ox + k * cell, oy + area); c.moveTo(ox, oy + k * cell); c.lineTo(ox + area, oy + k * cell); c.stroke(); }
        for (let j = 0; j < dim; j++) for (let i = 0; i < dim; i++) {   // matrix element (row i, column j)
          const re = arr[j * 2 * dim + 2 * i], im = arr[j * 2 * dim + 2 * i + 1], mag = Math.hypot(re, im);
          if (mag < 1e-3) continue;
          c.fillStyle = `hsl(${hue(re, im)} 75% 55%)`; c.beginPath(); c.arc(ox + (j + 0.5) * cell, oy + (i + 0.5) * cell, cell * 0.44 * mag, 0, 7); c.fill();
        }
        c.fillStyle = '#8fa3bd'; c.font = `${Math.max(9, cell * 0.2)}px ui-monospace, monospace`; c.textAlign = 'center';
        for (let k = 0; k < dim; k++) { const t = k.toString(2).padStart(n, '0'); c.fillText(`|${t}⟩`, ox + (k + 0.5) * cell, oy + area + 14); c.textAlign = 'right'; c.fillText(`|${t}⟩`, ox - 4, oy + (k + 0.6) * cell); c.textAlign = 'center'; }
      };
      const oy = 50, gap = (W - 2 * area) / 3;
      draw(ft, gap + 14, oy, '目標の動作');
      draw(fa, 2 * gap + area + 8, oy, 'あなたの回路');
      c.fillStyle = '#8fa3bd'; c.font = '12px system-ui'; c.textAlign = 'center';
      c.fillText('列 = 入力の基底状態、行 = 出力。円の大きさ = 振幅、色 = 位相', W / 2, H - 8);
    }
  }

  // ------------------------------------------------------------------ submit & share
  function hints() {
    const out = [], st = S.st;
    if (S.cost > S.parCost) out.push(`コスト ${S.cost}。最小は ${S.parCost}(${st.par.map((g) => Q.GATES[g.type].label === '●' ? 'CNOT' : Q.GATES[g.type].label).join(' → ')} のようにゲート ${st.par.length} 個)。不要な組(HH, XX, ZZ は何もしない)や冗長な回転を探そう。`);
    const tips = {
      1: 'X は Z軸の反転。ブロッホ球を X軸まわりに180°回す操作。',
      2: 'H で |0⟩(北極)を赤道の |+⟩ へ。S は Z軸まわりに90°(位相 +90°)。',
      3: 'H は X軸と Z軸を入れ替える。「H X H = Z」。基底を替えてから反転し、元に戻すと、別の軸の反転になる(共役)。',
      4: 'T は Z軸まわり45°。S(90°)の半分。コストは S の2倍(誤り耐性のある量子計算で高価なゲート)。',
      5: 'H で |0⟩を重ね合わせ、CNOT で「もう1つのビットにコピー」すると、2ビットが分かちがたくもつれる。',
      6: 'ベル状態は4種類。X や Z を片方のビットに掛けると、ベル状態同士を行き来できる。',
      7: 'CZ は「両方が1」で符号反転。標的ビットを H で挟むと、符号反転(Z)が反転(X)に変わる = CNOT。',
      8: '3回の CNOT(向きを交互に)で2ビットが入れ替わる。XOR を3回使った変数の入れ替えと同じ。',
      9: 'ベル状態に CNOT をもう1つ連ねるだけ。「コピーのコピー」で3ビットがもつれる。',
    };
    out.push(tips[st.id]);
    return out.slice(0, 3);
  }
  function shareText() {
    const st = S.st, sc = scoreNow();
    const lines = [`Quantum Lab「${st.id}. ${st.name}」を量子回路でクリア!`, `コスト ${S.cost}(最小 ${S.parCost}) / スコア ${sc}`, '#QuantumLab'];
    const params = new URLSearchParams({ text: lines.join('\n') });
    if (/^https?:$/.test(location.protocol)) params.set('url', location.href.split('#')[0]);
    return `https://x.com/intent/post?${params.toString()}`;
  }
  const share = () => window.open(shareText(), '_blank', 'noopener');
  $('shareBtn').onclick = share; $('shareTop').onclick = share;

  $('submitBtn').onclick = () => {
    const sc = scoreNow(); if (sc === null) return;
    const st = S.st;
    S.submitted = true;
    S.saved.designs[st.id] = S.gates.map((g) => ({ ...g }));
    const prev = S.saved.best[st.id];
    let msg = '';
    if (!prev || sc > prev.score) { S.saved.best[st.id] = { score: sc, cost: S.cost }; msg = ' <b class="pass">ベスト更新!</b>'; }
    persist(); buildTabs(); updatePanel();
    const hs = hints().map((t) => `<li class="hint-li">${t}</li>`).join('');
    $('reportCard').hidden = false;
    $('report').innerHTML = `
      <p class="pass"><b>合格</b> — コスト ${S.cost}(最小 ${S.parCost}) / スコア <b>${sc}</b>${msg}</p>
      <div class="explain"><b>ヒント</b><ul>${hs}</ul></div>`;
    $('reportCard').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    $('shareTop').hidden = false;
  };

  // ------------------------------------------------------------------ main loop
  function frame() { drawViz(); requestAnimationFrame(frame); }

  load();
  selectStage(0);
  requestAnimationFrame(frame);
  if (!S.saved.seenHelp) { S.saved.seenHelp = true; persist(); try { $('helpDlg').showModal(); } catch (e) { /* ignore */ } }
  window.__quantum = { S, Q, selectStage, recalc, setCell, setStep };
})();
