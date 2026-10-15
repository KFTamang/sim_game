/*
 * game.js — Bridge Lab UI: canvas editor, live analysis, load test animation.
 */
(function () {
  'use strict';

  const S = window.Solver, D = window.Design;
  const STAGES = window.Stages.STAGES;
  const $ = (id) => document.getElementById(id);
  const cv = $('cv');
  const ctx = cv.getContext('2d');

  // ------------------------------------------------------------------ state
  const state = {
    stageIdx: 0, stage: null, design: null,
    undo: [], redo: [],
    tool: 'draw', type: 'tube', size: 2,
    res: null,
    hover: null, hoverMember: -1, drag: null,
    sim: null,
    saved: { designs: {}, best: {}, seenHelp: false },
  };
  let view = { s: 40, ox: 0, oy: 0, w: 0, h: 0, dpr: 1 };

  // ------------------------------------------------------------------ storage
  const KEY = 'bridgelab.v1';
  function loadSaved() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(state.saved, JSON.parse(raw));
    } catch (e) { /* storage may be unavailable */ }
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(state.saved)); } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------------ helpers
  const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '∞');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const TYPE_LABEL = { rod: '丸棒', tube: 'パイプ' };
  const sizeLabel = (m) => `${TYPE_LABEL[m.type]} R${(S.RADII[m.size] * 1000).toFixed(0)}mm`;

  function toast(msg, ms = 1800) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, ms);
  }

  // ------------------------------------------------------------------ stage / design
  function selectStage(i) {
    state.stageIdx = i;
    state.stage = STAGES[i];
    const saved = state.saved.designs[state.stage.id];
    state.design = saved && saved.nodes ? saved : D.createDesign(state.stage);
    // make sure all road nodes exist (older saves / safety)
    state.undo = []; state.redo = [];
    state.sim = null;
    $('reportCard').hidden = true;
    resize();
    recalc();
    buildTabs();
  }

  function commit(mutator) {
    state.undo.push(JSON.stringify(state.design));
    if (state.undo.length > 200) state.undo.shift();
    state.redo = [];
    mutator(state.design);
    afterChange();
  }
  function afterChange() {
    state.saved.designs[state.stage.id] = state.design;
    persist();
    recalc();
  }
  function undo() {
    if (!state.undo.length) return;
    state.redo.push(JSON.stringify(state.design));
    state.design = JSON.parse(state.undo.pop());
    afterChange();
  }
  function redo() {
    if (!state.redo.length) return;
    state.undo.push(JSON.stringify(state.design));
    state.design = JSON.parse(state.redo.pop());
    afterChange();
  }

  function scoreOf(res) {
    const st = state.stage;
    if (!res || res.status !== 'ok') return null;
    if (res.capacity < st.required || res.cost > st.budget) return null;
    return Math.round((res.capacity / res.cost) * 1000);
  }

  function recalc() {
    if (state.sim) endSim();
    state.res = S.analyze(state.stage, state.design);
    $('shareTop').hidden = true;
    updatePanel();
  }

  // ------------------------------------------------------------------ panel
  function statusText(res) {
    const st = state.stage;
    switch (res.status) {
      case 'roadBroken': return ['bad', `道路がつながっていません(x=${res.brokenRoad.join(', ')}m 付近)。左右の崖を道路でつなごう。`];
      case 'deckSpan': return ['bad', `道路を支える節点の間隔が ${S.PHYS.MAX_DECK_SPAN}m を超えています(x=${res.longDeck.join(', ')}m 付近)。道路の下か上から部材で支えよう。`];
      case 'unstable': return ['bad', '不安定(機構)です。四角形は潰れます。三角形で固めよう。動く節点を橙色で示しています。'];
      case 'deadFail': return ['bad', '自重だけで壊れます。◎の部材を太くするか、形を見直そう。'];
      default: break;
    }
    if (res.cost > st.budget) return ['bad', '予算オーバーです。細くできる部材や不要な部材を減らそう。'];
    if (res.capacity < st.required) return ['bad', `目標荷重に ${fmt(st.required - res.capacity, 0)} kN 足りません。◎が最初に壊れる部材です。`];
    return ['ok', '合格ラインに到達!「荷重テスト」で壊れ方を確認、さらに効率を上げよう。'];
  }

  function updatePanel() {
    const st = state.stage, res = state.res;
    $('stageName').textContent = `${st.id}. ${st.name}(スパン ${st.span}m)`;
    $('stageBrief').textContent = st.brief + (st.load === 'point' ? ' 荷重: 中央の1点。' : ' 荷重: 路面全体に均等。');
    $('reqVal').textContent = `${st.required} kN`;
    $('budVal').textContent = st.budget;
    const cap = res.status === 'ok' ? res.capacity : 0;
    $('capVal').textContent = res.status === 'ok' ? fmt(cap, 1) : '—';
    $('costVal').textContent = fmt(res.cost, 0);
    const maxCap = Math.max(st.required * 1.6, cap);
    $('capBar').style.width = `${clamp((cap / maxCap) * 100, 0, 100)}%`;
    $('capBar').style.background = cap >= st.required ? 'var(--ok)' : 'var(--ten)';
    $('reqMark').style.left = `${(st.required / maxCap) * 100}%`;
    const maxCost = Math.max(st.budget * 1.2, res.cost);
    $('costBar').style.width = `${clamp((res.cost / maxCost) * 100, 0, 100)}%`;
    $('costBar').style.background = res.cost > st.budget ? 'var(--bad)' : 'var(--ten)';
    const sc = scoreOf(res);
    $('scoreVal').textContent = sc === null ? '—' : sc;
    const best = state.saved.best[st.id];
    $('bestVal').textContent = best ? `${best.score}(耐荷重 ${fmt(best.cap, 0)}kN / コスト ${fmt(best.cost, 0)})` : '—';
    const [cls, msg] = statusText(res);
    const el = $('status');
    el.className = `status ${cls}`;
    el.textContent = msg;
    $('testBtn').disabled = !(res.status === 'ok');
    buildTabs();
  }

  function buildTabs() {
    const nav = $('stageTabs');
    nav.innerHTML = '';
    STAGES.forEach((st, i) => {
      const b = document.createElement('button');
      b.textContent = `${st.id}. ${st.name}`;
      if (i === state.stageIdx) b.className = 'on';
      if (state.saved.best[st.id]) { const s = document.createElement('span'); s.className = 'star'; s.textContent = '★'; b.appendChild(s); }
      b.onclick = () => selectStage(i);
      nav.appendChild(b);
    });
  }

  function buildPalette() {
    const ts = $('typeSeg'); ts.innerHTML = '';
    Object.keys(S.TYPES).forEach((k) => {
      const b = document.createElement('button');
      b.textContent = `${S.TYPES[k].label}`;
      b.dataset.k = k;
      b.title = k === 'tube' ? '中空。軽いのに座屈に強いが、単価が高い' : '中実の棒。安い';
      b.onclick = () => { state.type = k; refreshPalette(); };
      ts.appendChild(b);
    });
    const ss = $('sizeSeg'); ss.innerHTML = '';
    S.RADII.forEach((r, i) => {
      const b = document.createElement('button');
      b.className = 'size';
      b.dataset.k = i;
      const dot = document.createElement('i');
      const px = 4 + i * 3;
      dot.style.width = dot.style.height = `${px}px`;
      b.appendChild(dot);
      b.title = `R${(r * 1000).toFixed(0)}mm`;
      b.onclick = () => { state.size = i; refreshPalette(); };
      ss.appendChild(b);
    });
    const tl = $('toolSeg'); tl.innerHTML = '';
    [['draw', '描く'], ['paint', '塗替'], ['erase', '消す']].forEach(([k, label], i) => {
      const b = document.createElement('button');
      b.textContent = `${label}(${i + 1})`;
      b.dataset.k = k;
      b.onclick = () => { state.tool = k; refreshPalette(); };
      tl.appendChild(b);
    });
    refreshPalette();
  }
  function refreshPalette() {
    document.querySelectorAll('#typeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.k === state.type));
    document.querySelectorAll('#sizeSeg button').forEach((b) => b.classList.toggle('on', +b.dataset.k === state.size));
    document.querySelectorAll('#toolSeg button').forEach((b) => b.classList.toggle('on', b.dataset.k === state.tool));
    const s = S.section(state.type, state.size);
    const price = s.massPerM * S.TYPES[state.type].price;
    const Pe3 = (Math.PI ** 2 * S.PHYS.E * s.I) / 9 / 1000;
    const Py = (S.PHYS.SIGY * s.A) / 1000;
    $('secInfo').textContent = `単価 ${price.toFixed(1)}/m ・ 引張限界 ${Py.toFixed(0)}kN ・ 3mの座屈限界 ${Pe3.toFixed(1)}kN`;
    cv.style.cursor = state.tool === 'draw' ? 'crosshair' : state.tool === 'erase' ? 'not-allowed' : 'pointer';
    $('hint').textContent = state.tool === 'draw' ? '格子点から格子点へドラッグして部材を描く(右クリックで削除)'
      : state.tool === 'paint' ? '部材をクリックして、選択中の太さ・種類に塗り替え' : '部材をクリックして削除';
  }

  function showMemberInfo(k) {
    const card = $('memberCard');
    if (k < 0 || !state.res || state.res.status !== 'ok') { card.hidden = true; return; }
    const m = state.design.members[k], r = state.res.members[k];
    const st = state.stage;
    const N = r.Nd + st.required * r.Nl;
    const u = N >= 0 ? N / r.capT : N / r.capC;
    const rg = Math.sqrt(r.I / r.A);
    const Lb = r.Pe > 0 ? Math.PI * Math.sqrt((S.PHYS.E * r.I) / r.Pe) : r.L;
    card.hidden = false;
    $('memberInfo').innerHTML = `<dl class="kv">
      <dt>種類</dt><dd>${sizeLabel(m)}</dd>
      <dt>長さ</dt><dd>${r.L.toFixed(2)} m${Math.abs(Lb - r.L) > 0.01 ? `(座屈長 ${Lb.toFixed(1)}m)` : ''}</dd>
      <dt>目標荷重時の力</dt><dd>${fmt(Math.abs(N) / 1000, 1)} kN ${N >= 0 ? '引張' : '圧縮'}</dd>
      <dt>限界(引張/圧縮)</dt><dd>${fmt(r.capT / 1000, 0)} / ${fmt(r.capC / 1000, 1)} kN</dd>
      <dt>細長比 L/r</dt><dd>${(Lb / rg).toFixed(0)}</dd>
      <dt>使用率</dt><dd>${fmt(Math.abs(u) * 100, 0)}%${Math.abs(u) > 1 ? ' ⚠' : ''}</dd>
    </dl>`;
  }

  // ------------------------------------------------------------------ view
  function resize() {
    const r = cv.parentElement.getBoundingClientRect();
    view.dpr = window.devicePixelRatio || 1;
    view.w = Math.max(200, r.width); view.h = Math.max(200, r.height);
    cv.width = Math.round(view.w * view.dpr); cv.height = Math.round(view.h * view.dpr);
    const st = state.stage;
    if (!st) return;
    const worldW = st.span + 10;
    const worldH = st.yMax - st.yMin + 5;
    view.s = Math.min(view.w / worldW, view.h / worldH);
    view.ox = view.w / 2 - (st.span / 2) * view.s;
    // vertical: put yMax+1.5 at the top margin
    const top = (view.h - worldH * view.s) / 2;
    view.oy = top + (st.yMax + 2) * view.s;
  }
  const px = (x) => view.ox + x * view.s;
  const py = (y) => view.oy - y * view.s;
  const wx = (X) => (X - view.ox) / view.s;
  const wy = (Y) => (view.oy - Y) / view.s;

  // ------------------------------------------------------------------ input
  function pointerWorld(e) {
    const r = cv.getBoundingClientRect();
    return { x: wx(e.clientX - r.left), y: wy(e.clientY - r.top) };
  }
  function snap(p) {
    const gx = Math.round(p.x), gy = Math.round(p.y);
    if (Math.hypot(p.x - gx, p.y - gy) > 0.6) return null;
    return D.isValidPoint(state.stage, gx, gy) ? { x: gx, y: gy } : null;
  }

  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('pointermove', (e) => {
    if (state.sim) return;
    const p = pointerWorld(e);
    state.hover = snap(p);
    state.hoverMember = D.pickMember(state.design, p.x, p.y, 0.3);
    showMemberInfo(state.hoverMember);
  });
  cv.addEventListener('pointerleave', () => { state.hover = null; state.hoverMember = -1; });
  cv.addEventListener('pointerdown', (e) => {
    if (state.sim) { endSim(); return; }
    cv.setPointerCapture(e.pointerId);
    const p = pointerWorld(e);
    state.hover = snap(p);
    state.hoverMember = D.pickMember(state.design, p.x, p.y, 0.3);
    const tool = e.button === 2 ? 'erase' : state.tool;
    if (tool === 'erase') {
      if (state.hoverMember >= 0) commit((d) => D.removeMember(d, state.hoverMember));
    } else if (tool === 'paint') {
      if (state.hoverMember >= 0) commit((d) => D.paintMember(d, state.hoverMember, state.type, state.size));
    } else if (state.hover) {
      state.drag = { start: state.hover };
    }
  });
  cv.addEventListener('pointerup', () => {
    if (!state.drag) return;
    const a = state.drag.start, b = state.hover;
    state.drag = null;
    if (!b || (a.x === b.x && a.y === b.y)) return;
    let reason = null;
    const trial = D.clone(state.design);
    const r = D.addSegment(state.stage, trial, a, b, state.type, state.size);
    if (!r.ok) reason = r.reason;
    if (reason) { toast(reason); return; }
    commit((d) => { D.addSegment(state.stage, d, a, b, state.type, state.size); });
  });

  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (e.key === '1') { state.tool = 'draw'; refreshPalette(); }
    else if (e.key === '2') { state.tool = 'paint'; refreshPalette(); }
    else if (e.key === '3') { state.tool = 'erase'; refreshPalette(); }
    else if (e.key === 'q') { state.type = 'rod'; refreshPalette(); }
    else if (e.key === 'w') { state.type = 'tube'; refreshPalette(); }
    else if (e.key === ' ') { e.preventDefault(); if (state.sim) endSim(); else startTest(); }
    else if (e.key === 'Escape') { state.drag = null; if (state.sim) endSim(); }
    else if (e.key === 'ArrowUp') { state.size = Math.min(S.RADII.length - 1, state.size + 1); refreshPalette(); }
    else if (e.key === 'ArrowDown') { state.size = Math.max(0, state.size - 1); refreshPalette(); }
  });

  $('undoBtn').onclick = undo;
  $('redoBtn').onclick = redo;
  $('clearBtn').onclick = () => { if (state.design.members.length) commit((d) => { d.members = []; D.cleanup(d); }); };
  $('testBtn').onclick = () => { if (state.sim) endSim(); else startTest(); };
  $('helpBtn').onclick = (e) => { e.preventDefault(); $('helpDlg').showModal(); };
  window.addEventListener('resize', resize);

  // ------------------------------------------------------------------ load test
  function failureSequence(lam, firstId) {
    // progressive failure: remove the overloaded member, re-analyse, repeat
    const seq = [firstId];
    const cur = D.clone(state.design);
    cur.members.forEach((m, i) => { m.id = i; });
    let removeId = firstId;
    for (let n = 0; n < 40; n++) {
      const k = cur.members.findIndex((m) => m.id === removeId);
      if (k < 0) break;
      cur.members.splice(k, 1);
      const res = S.analyze(state.stage, cur);
      if (res.status !== 'ok') break;
      let worst = -1, wu = 1;
      cur.members.forEach((m, i) => {
        const u = Math.abs(S.utilAt(res, i, lam));
        if (u > wu) { wu = u; worst = m.id; }
      });
      if (worst < 0) break;
      seq.push(worst);
      removeId = worst;
    }
    return seq;
  }

  function startTest() {
    const res = state.res;
    if (!res || res.status !== 'ok') return;
    const lamMax = Math.min(res.lambda, 5000);
    // exaggeration so that the sag at failure is clearly visible
    let maxd = 1e-9;
    state.design.nodes.forEach((n, i) => {
      const dd = res.dispDead[i], dl = res.dispLive[i];
      maxd = Math.max(maxd, Math.hypot(dd[0] + lamMax * dl[0], dd[1] + lamMax * dl[1]));
    });
    const exag = clamp(0.8 / maxd, 1, 400);
    state.sim = {
      t: 0, phase: 'ramp', lamMax, exag,
      rampTime: 3.2, flashTime: 0.9,
      seq: failureSequence(lamMax, res.critical),
      failed: new Set(), nextFail: 0, tFail: 0,
      parts: null, cons: null, collapseT: 0,
      reported: false,
    };
    $('testBtn').textContent = '■ 停止 (Space)';
    $('reportCard').hidden = true;
  }

  function endSim() {
    state.sim = null;
    $('testBtn').textContent = '▶ 荷重テスト';
  }

  function buildParticles(sim) {
    const res = state.res, d = state.design;
    sim.parts = d.nodes.map((n, i) => {
      const dd = res.dispDead[i], dl = res.dispLive[i];
      const x = n.x + sim.exag * (dd[0] + sim.lamMax * dl[0]);
      const y = n.y + sim.exag * (dd[1] + sim.lamMax * dl[1]);
      return { x, y, px: x, py: y, fixed: !!n.fixed };
    });
    sim.cons = d.members.map((m, k) => {
      const a = sim.parts[m.a], b = sim.parts[m.b];
      return { a: m.a, b: m.b, L: Math.hypot(a.x - b.x, a.y - b.y), k };
    });
  }

  function stepPBD(sim, dt) {
    const g = -9.81 * 1.5;
    const floor = state.stage.yMin - 2.2;
    for (const p of sim.parts) {
      if (p.fixed) continue;
      const vx = (p.x - p.px) * 0.995, vy = (p.y - p.py) * 0.995;
      p.px = p.x; p.py = p.y;
      p.x += vx; p.y += vy + g * dt * dt;
      if (p.y < floor) { p.y = floor; p.px = p.x; }
    }
    for (let it = 0; it < 30; it++) {
      for (const c of sim.cons) {
        if (sim.failed.has(c.k)) continue;
        const a = sim.parts[c.a], b = sim.parts[c.b];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 1e-9;
        const diff = (dist - c.L) / dist;
        const wa = a.fixed ? 0 : 1, wb = b.fixed ? 0 : 1;
        const ws = wa + wb;
        if (!ws) continue;
        a.x += (dx * diff * wa) / ws; a.y += (dy * diff * wa) / ws;
        b.x -= (dx * diff * wb) / ws; b.y -= (dy * diff * wb) / ws;
      }
    }
  }

  function updateSim(dt) {
    const sim = state.sim;
    if (!sim) return;
    sim.t += dt;
    if (sim.phase === 'ramp') {
      if (sim.t >= sim.rampTime) { sim.phase = 'flash'; sim.t = 0; }
    } else if (sim.phase === 'flash') {
      if (sim.t >= sim.flashTime) {
        sim.phase = 'collapse'; sim.t = 0;
        buildParticles(sim);
        sim.failed.add(sim.seq[0]); sim.nextFail = 1; sim.tFail = 0;
        revealShare();
      }
    } else if (sim.phase === 'collapse') {
      sim.tFail += dt;
      if (sim.nextFail < sim.seq.length && sim.tFail > 0.35) {
        sim.failed.add(sim.seq[sim.nextFail++]); sim.tFail = 0;
      }
      stepPBD(sim, 1 / 120); stepPBD(sim, 1 / 120);
      if (sim.t > 3.5 && !sim.reported) finishTest();
    }
  }

  function finishTest() {
    const sim = state.sim, res = state.res, st = state.stage;
    sim.reported = true;
    sim.phase = 'done';
    const sc = scoreOf(res);
    const m = state.design.members[res.critical], r = res.members[res.critical];
    let why = '';
    if (res.mode === 'tension') {
      why = `<b>引張降伏</b>: 引張材は断面積に比例して強くなります(降伏力 = 降伏応力 × 断面積 = ${fmt(r.capT / 1000, 0)}kN)。細い丸棒でも意外に耐えますが、ここが先に限界に達しました。この部材を太くするか、力を他の部材に分担させよう。`;
    } else if (res.mode === 'buckling') {
      const Lb = Math.PI * Math.sqrt((S.PHYS.E * r.I) / r.Pe);
      why = `<b>座屈</b>: 圧縮材は降伏よりずっと手前(${fmt(r.Pe / 1000, 1)}kN)で曲がって壊れます。座屈荷重は π²EI/L² — <b>長さの2乗に反比例</b>。座屈長 ${Lb.toFixed(1)}m を短くする(途中を支える)、${m.type === 'rod' ? '同じ材料量でも断面二次モーメントが大きい<b>パイプ</b>に替える' : 'さらに太くする'}と大きく改善します。`;
    } else {
      why = `<b>圧縮降伏</b>: 短くて太い圧縮材は座屈せず、材料そのものが押し潰れます。断面積を増やすしかありません。`;
    }
    const ok = sc !== null;
    let bestMsg = '';
    if (ok) {
      const prev = state.saved.best[st.id];
      if (!prev || sc > prev.score) {
        state.saved.best[st.id] = { score: sc, cap: res.capacity, cost: res.cost, design: state.design };
        persist(); bestMsg = ' <b class="pass">ベスト更新!</b>';
        updatePanel();
      }
    }
    $('reportCard').hidden = false;
    $('report').innerHTML = `
      <p class="${ok ? 'pass' : 'fail'}"><b>${ok ? '合格' : '不合格'}</b> — 耐荷重 ${fmt(res.capacity, 1)} kN(目標 ${st.required}kN)${ok ? ` / スコア <b>${sc}</b>` : ''}${bestMsg}</p>
      <p>最初に壊れた部材: ${sizeLabel(m)} 長さ ${r.L.toFixed(1)}m</p>
      <div class="explain">${why}</div>
      <button id="shareBtn" class="share">𝕏 でスコアを投稿</button>`;
    $('shareBtn').onclick = () => shareOnX(st, res, sc);
    $('reportCard').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    $('testBtn').textContent = '▶ 荷重テスト';
  }

  // the share button lives in the header bar so it is always visible, even on short screens
  function revealShare() {
    const st = state.stage, res = state.res, sc = scoreOf(res);
    const b = $('shareTop');
    b.hidden = false;
    b.onclick = () => shareOnX(st, res, sc);
  }

  function shareOnX(st, res, sc) {
    const lines = sc !== null
      ? [`Bridge Lab「${st.id}. ${st.name}」で橋を設計しました!`,
         `耐荷重 ${fmt(res.capacity, 0)}kN / コスト ${fmt(res.cost, 0)} / スコア ${sc}`,
         '#BridgeLab']
      : [`Bridge Lab「${st.id}. ${st.name}」に挑戦中…`,
         `耐荷重 ${fmt(res.capacity, 0)}kN(目標 ${st.required}kN)で崩壊!`,
         '#BridgeLab'];
    const params = new URLSearchParams({ text: lines.join('\n') });
    if (/^https?:$/.test(location.protocol)) params.set('url', location.href.split('#')[0]);
    window.open(`https://x.com/intent/post?${params.toString()}`, '_blank', 'noopener');
  }

  // ------------------------------------------------------------------ drawing
  function mix(a, b, t) { return a.map((v, i) => Math.round(v + (b[i] - v) * t)); }
  function memberColor(u, t) {
    const a = Math.min(1, Math.abs(u));
    if (Math.abs(u) > 1) {
      const f = 0.5 + 0.5 * Math.sin(t * 10);
      return `rgb(255,${Math.round(190 + 60 * f)},${Math.round(40 + 120 * f)})`;
    }
    const base = [146, 160, 178];
    const tgt = u >= 0 ? [40, 150, 255] : [255, 80, 80];
    const c = mix(base, tgt, Math.pow(a, 0.75));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  function nodePos(i, t) {
    const n = state.design.nodes[i];
    const sim = state.sim;
    if (sim && sim.parts && (sim.phase === 'collapse' || sim.phase === 'done')) {
      const p = sim.parts[i];
      return [p.x, p.y];
    }
    if (sim && state.res.status === 'ok') {
      const lam = sim.phase === 'ramp' ? sim.lamMax * easeIn(sim.t / sim.rampTime) : sim.lamMax;
      const dd = state.res.dispDead[i], dl = state.res.dispLive[i];
      return [n.x + sim.exag * (dd[0] + lam * dl[0]), n.y + sim.exag * (dd[1] + lam * dl[1])];
    }
    return [n.x, n.y];
  }
  const easeIn = (t) => clamp(t, 0, 1);

  function draw(time) {
    const st = state.stage, d = state.design, res = state.res;
    if (!st) return;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);

    // sky
    const g = ctx.createLinearGradient(0, 0, 0, view.h);
    g.addColorStop(0, '#16273f'); g.addColorStop(1, '#2a4a6b');
    ctx.fillStyle = g; ctx.fillRect(0, 0, view.w, view.h);

    // water
    const waterY = py(st.yMin - 1.6);
    ctx.fillStyle = '#1b4a6e';
    ctx.fillRect(px(0), waterY, px(st.span) - px(0), view.h - waterY);
    ctx.strokeStyle = '#4f8db5'; ctx.lineWidth = 1;
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      for (let x = 0; x <= st.span; x += 0.25) {
        const y = waterY + k * 7 + Math.sin(x * 1.5 + time * 2 + k) * 2;
        x === 0 ? ctx.moveTo(px(x), y) : ctx.lineTo(px(x), y);
      }
      ctx.stroke();
    }

    // cliffs
    ctx.fillStyle = '#5b4a3a';
    ctx.fillRect(0, py(0), px(0), view.h - py(0));
    ctx.fillRect(px(st.span), py(0), view.w - px(st.span), view.h - py(0));
    ctx.fillStyle = '#4f9a4f';
    ctx.fillRect(0, py(0) - 3, px(0), 6);
    ctx.fillRect(px(st.span), py(0) - 3, view.w - px(st.span), 6);

    // grid
    if (!state.sim) {
      for (let x = 1; x < st.span; x++) {
        for (let y = st.yMin; y <= st.yMax; y++) {
          const near = state.hover && state.hover.x === x && state.hover.y === y;
          ctx.fillStyle = near ? '#ffffffcc' : '#ffffff22';
          ctx.beginPath(); ctx.arc(px(x), py(y), near ? 3.5 : 1.6, 0, Math.PI * 2); ctx.fill();
        }
      }
      for (const X of [0, st.span]) {
        for (let y = 0; y >= -st.anchorDepth; y--) {
          const near = state.hover && state.hover.x === X && state.hover.y === y;
          ctx.fillStyle = near ? '#ffb703' : '#d9c7a6';
          ctx.fillRect(px(X) - 4, py(y) - 4, 8, 8);
        }
      }
    }

    // road strip
    ctx.strokeStyle = '#2b2f36'; ctx.lineWidth = Math.max(5, view.s * 0.2); ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(...nodeXY(0));
    for (let x = 1; x <= st.span; x++) ctx.lineTo(...nodeXY(roadIdx(x)));
    ctx.stroke();
    ctx.setLineDash([6, 8]); ctx.strokeStyle = '#d6c200aa'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(...nodeXY(0));
    for (let x = 1; x <= st.span; x++) ctx.lineTo(...nodeXY(roadIdx(x)));
    ctx.stroke(); ctx.setLineDash([]);

    // members
    const lamShow = state.sim
      ? (state.sim.phase === 'ramp' ? state.sim.lamMax * easeIn(state.sim.t / state.sim.rampTime) : state.sim.lamMax)
      : st.required;
    const okRes = res.status === 'ok';
    d.members.forEach((m, k) => {
      if (state.sim && state.sim.failed.has(k) && state.sim.phase !== 'flash') {
        // broken: draw two stubs
        const [x1, y1] = nodeXY(m.a), [x2, y2] = nodeXY(m.b);
        ctx.strokeStyle = '#ff5d5d99'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 + (x2 - x1) * 0.3, y1 + (y2 - y1) * 0.3); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 + (x1 - x2) * 0.3, y2 + (y1 - y2) * 0.3); ctx.stroke();
        return;
      }
      const [x1, y1] = nodeXY(m.a), [x2, y2] = nodeXY(m.b);
      const w = 2.2 + m.size * 1.5;
      let col = '#7a8798';
      let reach = true;
      if (okRes) {
        reach = res.members[k].reach;
        col = reach ? memberColor(S.utilAt(res, k, lamShow), time) : '#55606e';
      }
      if (state.sim && state.sim.phase === 'flash' && k === res.critical) {
        col = Math.floor(time * 12) % 2 ? '#fff' : '#ff2d55';
      }
      ctx.lineCap = 'round';
      ctx.strokeStyle = col; ctx.lineWidth = w;
      if (!reach) ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.setLineDash([]);
      if (m.type === 'tube') {
        ctx.strokeStyle = '#1b2a3e'; ctx.lineWidth = w * 0.4;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
      if (!state.sim && k === state.hoverMember) {
        ctx.strokeStyle = '#ffffffaa'; ctx.lineWidth = w + 4;
        ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.globalAlpha = 1;
      }
    });

    // nodes
    d.nodes.forEach((n, i) => {
      const [x, y] = nodeXY(i);
      const isPass = n.road && !n.fixed && okRes && !res.reach[i];
      void isPass;
      if (n.fixed) {
        ctx.fillStyle = '#d9c7a6'; ctx.fillRect(x - 5, y - 5, 10, 10);
        return;
      }
      const used = d.members.some((m) => m.a === i || m.b === i);
      if (!used && !n.road) return;
      ctx.fillStyle = n.road ? '#c7d0dc' : '#f1f5fa';
      ctx.beginPath(); ctx.arc(x, y, n.road ? 2.4 : 3.6, 0, Math.PI * 2); ctx.fill();
    });

    // load arrows
    {
      const frac = state.sim ? (state.sim.phase === 'ramp' ? easeIn(state.sim.t / state.sim.rampTime) : 1) : 0.0;
      if (state.sim) {
        ctx.strokeStyle = '#ffb703'; ctx.fillStyle = '#ffb703'; ctx.lineWidth = 2;
        for (let x = 1; x < st.span; x++) {
          if (st.load === 'point' && x !== Math.round(st.span / 2)) continue;
          const [X, Y] = nodeXY(roadIdx(x));
          const len = (st.load === 'point' ? 70 : 34) * frac;
          if (len < 4) continue;
          ctx.beginPath(); ctx.moveTo(X, Y - len - 6); ctx.lineTo(X, Y - 6); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(X, Y - 3); ctx.lineTo(X - 4, Y - 10); ctx.lineTo(X + 4, Y - 10); ctx.closePath(); ctx.fill();
        }
        ctx.fillStyle = '#ffb703'; ctx.font = '600 14px system-ui'; ctx.textAlign = 'center';
        const lamNow = state.sim.phase === 'ramp' ? state.sim.lamMax * frac : state.sim.lamMax;
        ctx.fillText(`荷重 ${lamNow.toFixed(1)} kN`, px(st.span / 2), py(st.yMax + 1.2));
        if (lamNow >= st.required) { ctx.fillStyle = '#4ade80'; ctx.fillText('目標クリア', px(st.span / 2), py(st.yMax + 0.2)); }
      } else if (okRes && res.critical >= 0) {
        // critical member marker
        const m = d.members[res.critical];
        const [x1, y1] = nodeXY(m.a), [x2, y2] = nodeXY(m.b);
        const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
        ctx.strokeStyle = '#ffd60a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy, 9 + Math.sin(time * 4) * 1.2, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.stroke();
      }
    }

    // problems overlays
    if (!state.sim) {
      if (res.status === 'roadBroken') {
        ctx.strokeStyle = '#ff5d5d'; ctx.lineWidth = 4; ctx.setLineDash([5, 5]);
        res.brokenRoad.forEach((x) => { ctx.beginPath(); ctx.moveTo(px(x), py(0) - 8); ctx.lineTo(px(x + 1), py(0) - 8); ctx.stroke(); });
        ctx.setLineDash([]);
      }
      if (res.status === 'deckSpan') {
        ctx.strokeStyle = '#ffd60a'; ctx.lineWidth = 5;
        res.longDeck.forEach((x) => { ctx.beginPath(); ctx.moveTo(px(x), py(0) - 9); ctx.lineTo(px(x + S.PHYS.MAX_DECK_SPAN), py(0) - 9); ctx.stroke(); });
      }
      if (res.status === 'unstable') {
        res.floppy.forEach((i) => {
          const [x, y] = nodeXY(i);
          ctx.strokeStyle = '#ff9f1c'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(x, y, 8 + Math.sin(time * 6) * 2, 0, Math.PI * 2); ctx.stroke();
        });
      }
      // drag preview
      if (state.drag) {
        const a = state.drag.start, b = state.hover;
        if (b) {
          const trial = D.clone(d);
          const ok = !(a.x === b.x && a.y === b.y) && D.addSegment(st, trial, a, b, state.type, state.size).ok;
          ctx.strokeStyle = ok ? '#4ade80' : '#ff5d5d'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
          ctx.beginPath(); ctx.moveTo(px(a.x), py(a.y)); ctx.lineTo(px(b.x), py(b.y)); ctx.stroke(); ctx.setLineDash([]);
          const L = Math.hypot(b.x - a.x, b.y - a.y);
          ctx.fillStyle = '#fff'; ctx.font = '12px system-ui'; ctx.textAlign = 'left';
          ctx.fillText(`${L.toFixed(2)} m`, px(b.x) + 10, py(b.y) - 8);
        } else {
          ctx.fillStyle = '#4ade80'; ctx.beginPath(); ctx.arc(px(a.x), py(a.y), 5, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = '#4ade80'; ctx.beginPath(); ctx.arc(px(a.x), py(a.y), 5, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  const roadIdxCache = {};
  function roadIdx(x) {
    const n = state.design.nodes;
    const c = roadIdxCache[x];
    if (c !== undefined && n[c] && n[c].x === x && n[c].y === 0) return c;
    const i = n.findIndex((q) => q.x === x && q.y === 0);
    roadIdxCache[x] = i;
    return i;
  }
  function nodeXY(i) {
    const [x, y] = nodePos(i);
    return [px(x), py(y)];
  }

  // ------------------------------------------------------------------ main loop
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    updateSim(dt);
    draw(now / 1000);
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------ boot
  loadSaved();
  buildPalette();
  selectStage(0);
  requestAnimationFrame(frame);
  if (!state.saved.seenHelp) {
    state.saved.seenHelp = true; persist();
    try { $('helpDlg').showModal(); } catch (e) { /* dialog unsupported */ }
  }

  // test hooks (used by headless checks)
  window.__bridge = { state, S, D, selectStage, startTest, recalc, get view() { return view; } };
})();
