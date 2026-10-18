/*
 * game.js — Engine Lab UI: sliders -> cycle simulation -> animated cylinder + P-V diagram.
 */
(function () {
  'use strict';

  const En = window.Engine;
  const STAGES = window.EngineStages.STAGES;
  const $ = (id) => document.getElementById(id);
  const cv = $('cv'), ctx = cv.getContext('2d');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const bar = (p) => p / 1e5;

  const S = {
    idx: 0, st: null, par: {}, ev: null, th: -360, playing: true, submitted: false,
    saved: { designs: {}, best: {}, seenHelp: false },
  };
  const view = { w: 0, h: 0, dpr: 1 };

  const KEY = 'enginelab.v1';
  function load() { try { const raw = localStorage.getItem(KEY); if (raw) Object.assign(S.saved, JSON.parse(raw)); } catch (e) { /* ignore */ } }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(S.saved)); } catch (e) { /* ignore */ } }
  function toast(msg, ms = 1600) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms); }

  const PINFO = {
    r: ['圧縮比', '', 1, '下死点と上死点の体積の比。高いほど効率が上がるが、ノッキングしやすい。'],
    spark: ['点火時期', '° (上死点前)', 0, '早すぎると圧縮に逆らい、遅すぎると燃え終わる前に膨張が進んでしまう。'],
    ivc: ['吸気弁を閉じる', '° (下死点後)', 0, '遅く閉じるほど実際の圧縮が浅くなる(ミラーサイクル)。吸い込む空気も減る。'],
    evo: ['排気弁を開く', '° (下死点前)', 0, '早く開くと膨張仕事を捨てるが、排気が楽になる。'],
    lambda: ['空気過剰率 λ', '', 2, '1 = ちょうど燃える量。大きいほど薄い混合気(ノックしにくいが出力と燃焼が落ちる)。'],
    boost: ['過給圧', ' bar(絶対圧)', 2, 'ターボで押し込む圧力。出力は増えるが、圧力と温度が上がってノッキングしやすい。'],
  };
  const FIXLBL = { r: '圧縮比', spark: '点火 °BTDC', ivc: '吸気弁閉 °ABDC', evo: '排気弁開 °BBDC', lambda: 'λ', boost: '過給圧 bar', throttle: 'スロットル', rpm: '回転数 rpm', octane: 'オクタン価' };

  // ------------------------------------------------------------------ stage
  function selectStage(i) {
    S.idx = i; S.st = STAGES[i];
    S.par = defaultsFor(S.st);
    const saved = S.saved.designs[S.st.id];
    if (saved) for (const k of Object.keys(S.st.free)) if (typeof saved[k] === 'number') S.par[k] = saved[k];
    S.submitted = false;
    $('reportCard').hidden = true; $('shareTop').hidden = true;
    buildSliders(); recalc(); resize();
  }
  function defaultsFor(st) {
    const q = {};
    // start from a plain, safe engine: the stage's free parameters begin at "reasonable but not optimal" values
    const start = { r: 8, spark: 10, ivc: 20, evo: 60, lambda: 1, boost: 1 };
    if (st.id === 3) { start.ivc = 20; start.evo = 60; }
    if (st.id === 4) { start.r = 8; start.boost = 1.2; start.spark = 15; }
    for (const k of Object.keys(st.free)) { const [a, b, s] = st.free[k]; q[k] = clamp(Math.round(start[k] / s) * s, a, b); }
    return q;
  }
  const fullPar = () => Object.assign({}, S.st.fixed, S.par);

  function recalc() {
    S.ev = En.evaluate(S.st, fullPar());
    updatePanel();
  }

  // ------------------------------------------------------------------ sliders
  function buildSliders() {
    const box = $('sliders'); box.innerHTML = '';
    for (const k of Object.keys(S.st.free)) {
      const [a, b, s] = S.st.free[k], info = PINFO[k];
      const div = document.createElement('div'); div.className = 'sl';
      div.innerHTML = `<div class="sh"><span>${info[0]}</span><b id="v_${k}"></b></div>
        <input type="range" id="s_${k}" min="${a}" max="${b}" step="${s}" value="${S.par[k]}">
        <div class="sd">${info[3]}</div>`;
      box.appendChild(div);
      const inp = div.querySelector('input');
      inp.oninput = () => { S.par[k] = +inp.value; S.submitted = false; $('reportCard').hidden = true; $('shareTop').hidden = true; recalc(); };
    }
    const fx = Object.keys(S.st.fixed).map((k) => `${FIXLBL[k]} ${S.st.fixed[k]}`).join(' / ');
    $('fixedInfo').textContent = `固定: ${fx}`;
    syncValues();
  }
  function syncValues() {
    for (const k of Object.keys(S.st.free)) {
      const info = PINFO[k], v = S.par[k];
      $('v_' + k).textContent = `${(+v).toFixed(info[2])}${info[1]}`;
      $('s_' + k).value = v;
    }
  }

  // ------------------------------------------------------------------ panel
  function updatePanel() {
    const st = S.st, ev = S.ev, r = ev.r;
    syncValues();
    $('stageName').textContent = `${st.id}. ${st.name}`;
    $('stageBrief').textContent = st.brief;
    const isEta = st.objective === 'eta';
    $('objLbl').textContent = isEta ? '正味熱効率' : '平均有効圧(トルク)';
    $('objVal').textContent = isEta ? `${(r.eta * 100).toFixed(1)} %` : `${bar(r.bmep).toFixed(2)} bar`;
    $('objSub').textContent = st.minBmep ? `平均有効圧 ${bar(r.bmep).toFixed(1)} / 必要 ${st.minBmep} bar` : '';
    const frac = clamp((ev.value - st.floor) / (st.ref - st.floor), 0, 1.15);
    $('objBar').style.width = `${(frac / 1.15) * 100}%`;
    $('objBar').style.background = ev.valid ? 'var(--ok)' : 'var(--bad)';
    const kn = r.knockI;
    $('knockVal').textContent = `${(kn * 100).toFixed(0)} %${r.knock ? '  ノック!' : ''}`;
    $('knockBar').style.width = `${clamp(kn / 1.2, 0, 1) * 100}%`;
    $('knockBar').style.background = r.knock ? 'var(--bad)' : (kn > 0.8 ? 'var(--accent)' : 'var(--ten)');
    $('knockMark').style.left = `${(1 / 1.2) * 100}%`;
    $('scoreVal').textContent = ev.valid && ev.score > 0 ? ev.score : (ev.valid ? '0' : '—');
    const best = S.saved.best[st.id];
    $('bestVal').textContent = best ? `${best.score}(${st.objective === 'eta' ? (best.value * 100).toFixed(1) + '%' : best.value.toFixed(2) + ' bar'})` : '—';
    const el = $('status');
    let cls = '', msg;
    if (r.knock) msg = '🔥 ノッキング発生! 未燃ガスが自己着火しました。圧縮・温度・点火進角のどれかを下げよう。';
    else if (!ev.valid) msg = `条件を満たしていません: ${ev.note}`;
    else if (ev.score >= 1000) { cls = 'ok'; msg = 'ほぼ最適です! 「提出」で記録できます。'; }
    else if (ev.score > 0) { cls = 'ok'; msg = `OK。まだ伸びしろがあります(スコア ${ev.score})。ほかの設定も動かしてみよう。`; }
    else msg = '基準より悪い設定です。スライダーを動かして改善しよう。';
    el.className = `status ${cls}`; el.textContent = msg;
    $('submitBtn').disabled = !(ev.valid && ev.score > 0);
    // energy bar
    const e = r.energy, tot = e.fuel;
    const parts = [['work', '正味の仕事', '#4ade80'], ['friction', '摩擦', '#a78bfa'], ['pumping', 'ポンプ損失', '#38bdf8'], ['wall', '冷却損失', '#60a5fa'], ['exhaust', '排気の熱', '#fb923c'], ['unburned', '未燃・不完全燃焼', '#f87171']];
    $('energyBar').innerHTML = parts.map(([k, , c]) => `<div style="width:${(e[k] / tot) * 100}%;background:${c}" title="${(e[k] / tot * 100).toFixed(1)}%"></div>`).join('');
    $('energyLegend').innerHTML = parts.map(([k, l, c]) => `<span><i style="background:${c}"></i>${l} ${(e[k] / tot * 100).toFixed(0)}%</span>`).join('');
    $('numbers').innerHTML = `トルク ${r.torque.toFixed(0)} N·m / 出力 ${r.power.toFixed(0)} kW(${S.st.fixed.rpm || 2500} rpm)<br>最高圧力 ${bar(r.pmax).toFixed(0)} bar / 排気開始時 ${(r.Tevo).toFixed(0)} K<br>図示効率 ${(r.etaInd * 100).toFixed(1)}%(摩擦を除く)`;
    buildTabs();
  }
  function buildTabs() {
    const nav = $('stageTabs'); nav.innerHTML = '';
    STAGES.forEach((st, i) => {
      const b = document.createElement('button'); b.textContent = `${st.id}. ${st.name}`;
      if (i === S.idx) b.className = 'on';
      if (S.saved.best[st.id]) { const s = document.createElement('span'); s.className = 'star'; s.textContent = '★'; b.appendChild(s); }
      b.onclick = () => selectStage(i); nav.appendChild(b);
    });
  }

  // ------------------------------------------------------------------ cycle state at a crank angle
  function stateAt(th) {
    const r = S.ev.r, tr = r.trace, par = r.par;
    const V = En.volume(th, par.r);
    let p, T, xb = 0;
    if (th < r.thIvc) { p = r.pInt; T = r.Tint; }
    else if (th <= r.thEvo) {
      // nearest sample in the closed-cycle trace
      let lo = 0, hi = tr.th.length - 1;
      if (th <= tr.th[0]) { p = r.pIvc; T = r.Tint + 25; xb = 0; }
      else if (th >= tr.th[hi]) { p = tr.p[hi]; T = tr.T[hi]; xb = tr.xb[hi]; }
      else {
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (tr.th[mid] <= th) lo = mid; else hi = mid; }
        const f = (th - tr.th[lo]) / (tr.th[hi] - tr.th[lo]);
        p = tr.p[lo] + (tr.p[hi] - tr.p[lo]) * f; T = tr.T[lo] + (tr.T[hi] - tr.T[lo]) * f; xb = tr.xb[lo] + (tr.xb[hi] - tr.xb[lo]) * f;
      }
    } else {
      const k = Math.exp(-(th - r.thEvo) / 7);
      p = r.pExh + (r.pEvo - r.pExh) * k; T = 700 + (r.Tevo - 700) * k; xb = 1;
    }
    return { th, V, p, T, xb };
  }

  // ------------------------------------------------------------------ drawing
  function tempColor(T) {
    const t = clamp((T - 300) / 2200, 0, 1);
    const stops = [[60, 110, 200], [120, 120, 170], [230, 140, 60], [255, 210, 90], [255, 255, 220]];
    const x = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
    return stops[i].map((c, j) => Math.round(c + (stops[i + 1][j] - c) * f));
  }

  function drawCylinder(ax, ay, aw, ah, s) {
    const r = S.ev.r, par = r.par, rr = par.r;
    const yHead = ay + Math.max(ah * 0.16, 84), kr0 = Math.min(aw * 0.14, ah * 0.1);
    const stroke = Math.min(ah * 0.40, (ah - (yHead - ay) - 2 * kr0 - 50) * 0.7), cw = Math.min(aw * 0.5, ah * 0.36), cx = ax + aw / 2;
    const clear = stroke / (rr - 1);
    const frac = (s.V - r.Vtdc) / (r.Vbdc - r.Vtdc);
    const yCrown = yHead + clear + stroke * frac;
    const x0 = cx - cw / 2, x1 = cx + cw / 2, yBot = yHead + clear + stroke + ah * 0.07;
    // cylinder walls + head
    ctx.fillStyle = '#26354d'; ctx.fillRect(x0 - 10, yHead - 10, cw + 20, 10);
    ctx.fillRect(x0 - 10, yHead - 10, 10, yBot - yHead + 10); ctx.fillRect(x1, yHead - 10, 10, yBot - yHead + 10);
    // gas
    const [R, G, B] = tempColor(s.T);
    ctx.fillStyle = `rgba(${R},${G},${B},0.55)`; ctx.fillRect(x0, yHead, cw, yCrown - yHead);
    // flame
    if (s.xb > 0.002 && s.xb < 0.999) {
      const rad = cw * 0.55 * Math.sqrt(s.xb) + 4;
      ctx.save(); ctx.beginPath(); ctx.rect(x0, yHead, cw, yCrown - yHead); ctx.clip();
      const g = ctx.createRadialGradient(cx, yHead, 2, cx, yHead, rad);
      g.addColorStop(0, 'rgba(255,250,200,0.95)'); g.addColorStop(0.6, 'rgba(255,170,40,0.8)'); g.addColorStop(1, 'rgba(255,90,20,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, yHead, rad, 0, 7); ctx.fill(); ctx.restore();
    }
    // spark plug + flash
    ctx.fillStyle = '#9fb3cf'; ctx.fillRect(cx - 4, yHead - 22, 8, 22);
    if (Math.abs(s.th - r.thSpark) < 5) { ctx.fillStyle = '#fff7a8'; ctx.beginPath(); ctx.arc(cx, yHead + 3, 7, 0, 7); ctx.fill(); }
    // valves
    const intakeOpen = s.th < r.thIvc, exhOpen = s.th > r.thEvo || s.th < -360 + 0;   // simple
    const vw = cw * 0.28, lift = 9;
    const valve = (xc, open, color) => {
      const y = yHead + (open ? lift : 0);
      ctx.fillStyle = color; ctx.fillRect(xc - vw / 2, y - 3, vw, 5); ctx.fillRect(xc - 2, yHead - 24, 4, 24 + (open ? lift : 0));
    };
    valve(x0 + cw * 0.22, intakeOpen, '#60a5fa'); valve(x1 - cw * 0.22, exhOpen, '#fb923c');
    ctx.font = '11px system-ui'; ctx.textAlign = 'center';
    ctx.fillStyle = '#60a5fa'; ctx.fillText('吸気', x0 + cw * 0.22, yHead - 30); ctx.fillStyle = '#fb923c'; ctx.fillText('排気', x1 - cw * 0.22, yHead - 30);
    if (intakeOpen) { ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0 + cw * 0.22, yHead - 44); ctx.lineTo(x0 + cw * 0.22, yHead - 36); ctx.stroke(); }
    // piston
    const ph = ah * 0.07;
    ctx.fillStyle = '#c8d3e3'; ctx.fillRect(x0, yCrown, cw, ph);
    ctx.fillStyle = '#7d8fa8'; ctx.fillRect(x0, yCrown + ph * 0.3, cw, 3); ctx.fillRect(x0, yCrown + ph * 0.6, cw, 3);
    ctx.fillStyle = '#7d8fa8'; ctx.fillRect(cx - 5, yCrown + ph, 10, Math.max(4, yBot + ah * 0.1 - yCrown - ph));
    // crank clock
    const kr = Math.min(aw * 0.14, ah * 0.1), ky = ay + ah - kr - 18;
    ctx.strokeStyle = '#3b4d6b'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, ky, kr, 0, 7); ctx.stroke();
    const phases = [['吸気', -360, -180, '#60a5fa'], ['圧縮', -180, 0, '#a78bfa'], ['膨張', 0, 180, '#fb923c'], ['排気', 180, 360, '#9ca3af']];
    for (const [nm, a, b, c] of phases) {
      ctx.strokeStyle = c; ctx.lineWidth = 4; ctx.beginPath();
      ctx.arc(cx, ky, kr + 6, (a + 90) * Math.PI / 180, (b + 90) * Math.PI / 180); ctx.stroke();
    }
    const ang = (s.th + 90) * Math.PI / 180;     // TDC (0 deg) at the bottom of the clock, increasing clockwise
    ctx.strokeStyle = '#ffb703'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx, ky); ctx.lineTo(cx + kr * Math.cos(ang), ky + kr * Math.sin(ang)); ctx.stroke();
    ctx.fillStyle = '#ffb703'; ctx.beginPath(); ctx.arc(cx + kr * Math.cos(ang), ky + kr * Math.sin(ang), 4, 0, 7); ctx.fill();
    // stroke label
    let name = th2name(s.th, r);
    ctx.fillStyle = '#e6edf6'; ctx.font = '600 14px system-ui'; ctx.textAlign = 'center';
    ctx.fillText(`${name}  クランク角 ${s.th < 0 ? '−' : '+'}${Math.abs(Math.round(s.th))}°`, cx, ay + 14);
    ctx.font = '11px system-ui'; ctx.fillStyle = '#9fb3cf';
    ctx.fillText(`筒内圧 ${bar(s.p).toFixed(1)} bar   ガス温度 ${s.T.toFixed(0)} K`, cx, ay + 30);
  }
  function th2name(th, r) { return th < -180 ? '吸気行程' : th < 0 ? '圧縮行程' : th < r.thEvo ? (s_burning(th, r) ? '燃焼・膨張' : '膨張行程') : '排気行程'; }
  function s_burning(th, r) { return th >= r.thSpark && th < r.th0 + r.burn; }

  function drawPV(ax, ay, aw, ah, s) {
    const r = S.ev.r;
    const L = ax + 44, Rr = ax + aw - 12, T = ay + 14, B = ay + ah - 34;
    const Vmax = r.Vbdc * 1e6 * 1.05, pmaxBar = Math.max(30, Math.ceil(bar(r.pmax) / 10) * 10 + 5);
    const X = (V) => L + (V * 1e6 / Vmax) * (Rr - L), Y = (p) => B - (bar(p) / pmaxBar) * (B - T);
    ctx.strokeStyle = '#243249'; ctx.lineWidth = 1; ctx.fillStyle = '#7d8fa8'; ctx.font = '10px system-ui'; ctx.textAlign = 'right';
    const step = pmaxBar > 60 ? 20 : 10;
    for (let p = 0; p <= pmaxBar; p += step) { ctx.beginPath(); ctx.moveTo(L, Y(p * 1e5)); ctx.lineTo(Rr, Y(p * 1e5)); ctx.stroke(); ctx.fillText(p, L - 4, Y(p * 1e5) + 3); }
    ctx.textAlign = 'center';
    for (let v = 0; v <= Vmax; v += 100) { ctx.fillText(v, X(v / 1e6), B + 12); }
    ctx.fillStyle = '#9fb3cf'; ctx.fillText('体積 V [cm³]', (L + Rr) / 2, B + 26);
    ctx.save(); ctx.translate(ax + 10, (T + B) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('圧力 p [bar]', 0, 0); ctx.restore();
    // loop path
    const tr = r.trace;
    ctx.beginPath();
    ctx.moveTo(X(r.Vivc), Y(r.pIvc));
    for (let i = 0; i < tr.th.length; i++) ctx.lineTo(X(tr.V[i]), Y(tr.p[i]));
    ctx.lineTo(X(r.Vevo), Y(r.pEvo));
    ctx.lineTo(X(r.Vbdc), Y(r.pExh));      // blow-down
    ctx.lineTo(X(r.Vtdc), Y(r.pExh));      // exhaust stroke
    ctx.lineTo(X(r.Vtdc), Y(r.pInt));
    ctx.lineTo(X(r.Vbdc), Y(r.pInt));      // intake stroke
    ctx.lineTo(X(r.Vivc), Y(r.pInt));
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,183,3,0.16)'; ctx.fill();
    ctx.strokeStyle = '#ffb703'; ctx.lineWidth = 2; ctx.stroke();
    // current point
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(X(s.V), Y(s.p), 5, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffb703'; ctx.font = '600 12px system-ui'; ctx.textAlign = 'left';
    ctx.fillText('P-V線図(囲まれた面積 = 仕事)', L + 6, T + 8);
    // knock / limit marker
    if (r.pmax > 90e5) { ctx.strokeStyle = '#ff6b6b'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(L, Y(90e5)); ctx.lineTo(Rr, Y(90e5)); ctx.stroke(); ctx.setLineDash([]); }
  }

  function frame(now) {
    frame.last = frame.last || now;
    const dt = Math.min(0.1, (now - frame.last) / 1000); frame.last = now;
    if (S.playing) { S.th += dt * 150; if (S.th > 360) S.th -= 720; }
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.fillStyle = '#0f1722'; ctx.fillRect(0, 0, view.w, view.h);
    const s = stateAt(S.th);
    const wide = view.w > view.h * 1.2;
    if (wide) { drawCylinder(0, 0, view.w * 0.4, view.h, s); drawPV(view.w * 0.4, 0, view.w * 0.6, view.h, s); }
    else { drawCylinder(0, 0, view.w, view.h * 0.54, s); drawPV(0, view.h * 0.54, view.w, view.h * 0.46, s); }
    requestAnimationFrame(frame);
  }

  function resize() {
    const r = cv.parentElement.getBoundingClientRect();
    view.dpr = window.devicePixelRatio || 1;
    view.w = Math.max(1, r.width); view.h = Math.max(1, r.height);
    cv.width = Math.round(view.w * view.dpr); cv.height = Math.round(view.h * view.dpr);
  }
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(() => resize()).observe(cv.parentElement);

  // ------------------------------------------------------------------ controls
  $('playBtn').onclick = () => { S.playing = !S.playing; $('playBtn').textContent = S.playing ? '⏸ 停止' : '▶ 再生'; };
  $('resetBtn').onclick = () => { S.par = defaultsFor(S.st); buildSliders(); recalc(); };
  $('helpBtn').onclick = (e) => { e.preventDefault(); $('helpDlg').showModal(); };
  cv.addEventListener('pointerdown', (e) => { S.playing = !S.playing; $('playBtn').textContent = S.playing ? '⏸ 停止' : '▶ 再生'; });

  // ------------------------------------------------------------------ submit
  function hints() {
    const r = S.ev.r, e = r.energy, out = [], st = S.st;
    const pct = (k) => (e[k] / e.fuel) * 100;
    if (st.id === 1) out.push('オットーサイクルの理想効率は 1 − 1/r^(γ−1)。圧縮比 8→11 で効率は約 3 ポイント増えますが、増え方はだんだん鈍ります。ノッキングは圧縮で温度が上がり、未燃ガスが火炎の到達前に自己着火する現象です。');
    if (st.id === 2) out.push('点火を早めるほど燃焼は上死点に近づき圧力ピークが高まりますが、上死点前の燃焼はピストンに逆らう仕事になります。トルク最大の点火時期(MBT)は、燃焼の重心が上死点後 8〜10° 付近に来る時、と言われます。');
    if (st.id === 3) out.push('吸気弁を遅く閉じると、一度吸った空気を押し戻す分だけ実際の圧縮が浅くなります(有効圧縮比↓)が、膨張比は幾何学的圧縮比のまま。「圧縮は浅く、膨張は深く」= ミラー/アトキンソンサイクルの考え方です。');
    if (st.id === 4) out.push('ターボ+ミラーサイクルは、「過給で空気を詰め込み、遅閉じで圧縮を浅く保ち、高い膨張比で効率を稼ぐ」現代的な組み合わせです。');
    if (pct('wall') > 18) out.push(`冷却損失が燃料の ${pct('wall').toFixed(0)}% あります。圧縮比や過給を上げると壁面温度差と面積比の悪化で、効率の伸びが鈍る要因になります。`);
    if (pct('exhaust') > 35) out.push(`排気の熱が ${pct('exhaust').toFixed(0)}% あります。膨張比を上げてガスをもっと冷やしてから捨てると、仕事として取り出せます。`);
    if (pct('pumping') > 4) out.push('ポンプ損失が大きめです。スロットルを絞る(部分負荷)と、吸気行程でピストンが真空に逆らう仕事が増えます。');
    return out.slice(0, 3);
  }
  function shareText() {
    const st = S.st, ev = S.ev;
    const val = st.objective === 'eta' ? `熱効率 ${(ev.r.eta * 100).toFixed(1)}%` : `平均有効圧 ${bar(ev.r.bmep).toFixed(1)} bar`;
    const lines = [`Engine Lab「${st.id}. ${st.name}」でエンジンを調整しました!`, `${val} / スコア ${ev.score}`, '#EngineLab'];
    const params = new URLSearchParams({ text: lines.join('\n') });
    if (/^https?:$/.test(location.protocol)) params.set('url', location.href.split('#')[0]);
    return `https://x.com/intent/post?${params.toString()}`;
  }
  const share = () => window.open(shareText(), '_blank', 'noopener');
  $('shareBtn').onclick = share; $('shareTop').onclick = share;
  $('submitBtn').onclick = () => {
    const ev = S.ev; if (!(ev.valid && ev.score > 0)) return;
    const st = S.st;
    S.submitted = true; S.saved.designs[st.id] = Object.assign({}, S.par);
    const prev = S.saved.best[st.id]; let msg = '';
    if (!prev || ev.score > prev.score) { S.saved.best[st.id] = { score: ev.score, value: st.objective === 'eta' ? ev.r.eta : bar(ev.r.bmep) }; msg = ' <b class="pass">ベスト更新!</b>'; }
    persist(); updatePanel();
    const hs = hints().map((t) => `<li class="hint-li">${t}</li>`).join('');
    const val = st.objective === 'eta' ? `熱効率 ${(ev.r.eta * 100).toFixed(1)}%` : `平均有効圧 ${bar(ev.r.bmep).toFixed(2)} bar`;
    $('reportCard').hidden = false;
    $('report').innerHTML = `<p class="pass"><b>合格</b> — ${val} / スコア <b>${ev.score}</b>${msg}</p><div class="explain"><b>ヒント</b><ul>${hs}</ul></div>`;
    $('reportCard').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    $('shareTop').hidden = false;
  };

  load();
  selectStage(0);
  requestAnimationFrame(frame);
  if (!S.saved.seenHelp) { S.saved.seenHelp = true; persist(); try { $('helpDlg').showModal(); } catch (e) { /* ignore */ } }
  window.__engine = { S, En, selectStage, recalc };
})();
