/*
 * game.js — Trebuchet Lab UI: sliders -> physics -> animated close-up (top) + whole-flight strip (bottom).
 */
(function () {
  'use strict';

  const T = window.Trebuchet;
  const STAGES = window.TrebStages.STAGES;
  const $ = (id) => document.getElementById(id);
  const cv = $('cv'), ctx = cv.getContext('2d');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const D2R = Math.PI / 180;

  const S = {
    idx: 0, st: null, par: {}, ev: null, T: 0, playing: false, submitted: false,
    tries: {}, saved: { designs: {}, best: {}, seenHelp: false }, vw: null,
  };
  const view = { w: 0, h: 0, dpr: 1 };

  const KEY = 'trebuchetlab.v1';
  function load() { try { const raw = localStorage.getItem(KEY); if (raw) Object.assign(S.saved, JSON.parse(raw)); } catch (e) { /* ignore */ } }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(S.saved)); } catch (e) { /* ignore */ } }
  function toast(msg, ms = 1600) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms); }

  const PINFO = {
    a: ['短い腕(錘側)の長さ a', ' m', 1, '支点から錘までの距離。長いほど錘が深く落ちるが、長い腕は短くなる。長すぎると錘が地面に当たる。'],
    s: ['スリングの長さ', ' m', 1, '腕の先端から弾までの紐の長さ。長いほど先端より速く振れるが、長すぎると地面を引きずる。'],
    c: ['吊り棒の長さ c', ' m(0 = 固定式)', 1, '0 なら錘は腕に固定。0 より大きいと、ヒンジで吊り下げられて真下へ落ちる。長すぎると錘が地面に当たる。'],
    rel: ['放出角(ピンの角度)', '°', 0, 'スリングが腕の延長線に対してこの角度になった瞬間に、弾が外れる。小さいほど遅く、大きいほど早く放出。'],
    M: ['錘の質量', ' kg', 0, '重いほど大きなエネルギーを蓄えられる。'],
  };
  const FIXLBL = { H: '支点の高さ', L: '腕の全長', M: '錘', m: '弾', a: '短い腕', s: 'スリング', c: '吊り棒' };
  const FIXUNIT = { H: 'm', L: 'm', M: 'kg', m: 'kg', a: 'm', s: 'm', c: 'm' };

  // ------------------------------------------------------------------ stage
  function selectStage(i) {
    S.idx = i; S.st = STAGES[i];
    S.par = Object.assign({}, S.st.start);
    const saved = S.saved.designs[S.st.id];
    if (saved) for (const k of Object.keys(S.st.free)) if (typeof saved[k] === 'number') S.par[k] = saved[k];
    S.submitted = false; S.T = 0; S.playing = false;
    $('reportCard').hidden = true; $('shareTop').hidden = true;
    buildSliders(); recalc(); resize();
  }
  const fullPar = () => Object.assign({}, S.st.fixed, S.par);

  function recalc() {
    S.ev = T.evaluate(S.st, S.par);
    buildView();
    updatePanel();
  }
  let recalcQueued = false;
  function queueRecalc() { if (recalcQueued) return; recalcQueued = true; requestAnimationFrame(() => { recalcQueued = false; S.T = 0; S.playing = false; recalc(); }); }

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
      inp.oninput = () => { S.par[k] = +inp.value; S.submitted = false; $('reportCard').hidden = true; $('shareTop').hidden = true; syncValues(); queueRecalc(); };
      inp.onchange = () => { fire(); };
    }
    const fx = Object.keys(S.st.fixed).filter((k) => FIXLBL[k]).map((k) => `${FIXLBL[k]} ${S.st.fixed[k]} ${FIXUNIT[k]}`).join(' / ');
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
    const isT = st.objective === 'target';
    $('objLbl').textContent = isT ? `目標 ${st.target} m との差` : '飛距離';
    if (ev.valid) {
      $('objVal').textContent = isT ? `${ev.err >= 0 ? '+' : '−'}${Math.abs(ev.err).toFixed(1)} m` : `${ev.value.toFixed(1)} m`;
      $('objSub').textContent = isT ? `(着弾 ${ev.value.toFixed(1)} m)` : '';
    } else { $('objVal').textContent = '—'; $('objSub').textContent = ''; }
    const frac = !ev.valid ? 0 : isT ? 1 - Math.min(1, Math.abs(ev.err) / 20) : clamp((ev.value - st.floor) / (st.ref - st.floor), 0, 1.15) / 1.15;
    $('objBar').style.width = `${frac * 100}%`;
    $('objBar').style.background = ev.valid ? 'var(--ok)' : 'var(--bad)';
    $('etaVal').textContent = ev.valid ? `${(r.eta * 100).toFixed(0)} %` : '—';
    $('etaBar').style.width = `${ev.valid ? clamp(r.eta, 0, 1) * 100 : 0}%`;
    $('scoreVal').textContent = ev.valid ? ev.score : '—';
    const best = S.saved.best[st.id];
    $('bestVal').textContent = best ? `${best.score}(${best.value.toFixed(1)} m)` : '—';
    const el = $('status');
    let cls = '', msg;
    if (!ev.valid) msg = `🚫 ${ev.note}`;
    else if (isT) {
      if (Math.abs(ev.err) <= 0.5) { cls = 'ok'; msg = '命中! 「提出」で記録できます。'; }
      else msg = ev.err > 0 ? `目標より ${ev.err.toFixed(1)} m 遠くへ飛びます。錘を軽くする、または放出角を調整しよう。` : `目標の ${(-ev.err).toFixed(1)} m 手前に落ちます。錘を重くする、または放出角を調整しよう。`;
    } else if (ev.score >= 1000) { cls = 'ok'; msg = 'ほぼ最適です! 「提出」で記録できます。'; }
    else if (ev.score > 0) { cls = 'ok'; msg = `OK。まだ伸びしろがあります(スコア ${ev.score})。ほかの設定も動かしてみよう。`; }
    else msg = '基準より近い距離です。スライダーを動かして改善しよう。';
    el.className = `status ${cls}`; el.textContent = msg;
    $('submitBtn').disabled = !(ev.valid && ev.score > 0);
    if (ev.valid) {
      const R = r.rel;
      $('numbers').innerHTML = `放出速度 ${R.speed.toFixed(1)} m/s(時速 ${(R.speed * 3.6).toFixed(0)} km)<br>放出角度 ${R.angle.toFixed(0)}° / 高さ ${R.y.toFixed(1)} m<br>放出まで ${R.t.toFixed(2)} 秒 / 滞空 ${R.tf.toFixed(1)} 秒<br>最高点の高さ ${r.apex.toFixed(0)} m`;
    } else $('numbers').innerHTML = '放出されませんでした。';
    const tr = (S.tries[st.id] || []).map((v) => (v == null ? '失敗' : v.toFixed(0) + ' m')).join(' → ');
    $('tries').textContent = tr ? `試行: ${tr}` : '';
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

  // ------------------------------------------------------------------ geometry for the views
  function qAt(h, i) { return [h.q[3 * i], h.q[3 * i + 1], h.q[3 * i + 2]]; }
  function poseAt(time) {
    const h = S.ev.r.hist, n = h.ph.length;
    const f = clamp(time / h.dt, 0, n - 1), i = Math.min(n - 2, Math.floor(f)), k = f - i;
    if (n < 2) return { q: qAt(h, 0), ph: h.ph[0], i: 0 };
    const a = qAt(h, i), b = qAt(h, i + 1);
    return { q: a.map((v, j) => v + (b[j] - v) * k), ph: h.ph[i], i: Math.round(f) };
  }
  function tThrow() { const h = S.ev.r.hist; return h ? (h.ph.length - 1) * h.dt : 0; }

  function buildView() {
    const r = S.ev.r, p = r.par, h = r.hist;
    if (!h) { S.vw = null; return; }
    let x0 = -3, x1 = 3, y1 = p.H + 2;
    const add = (pt, m) => { x0 = Math.min(x0, pt[0] - m); x1 = Math.max(x1, pt[0] + m); y1 = Math.max(y1, pt[1] + m); };
    const n = h.ph.length;
    for (let i = 0; i < n; i += 2) {
      const ps = T.positions(qAt(h, i), p);
      add(ps.tip, 1); add(ps.pr, 1); add(ps.cw, p.rcw + 0.3); add(ps.sh, 0.5);
    }
    S.vw = { x0: x0 - 1, x1: x1 + 1, y1: y1 + 1.5 };
    // far strip extents
    let xr = 60, apex = 25;
    if (S.ev.valid) { xr = Math.max(xr, r.range * 1.08); apex = Math.max(apex, r.apex); }
    if (S.st.objective === 'target') xr = Math.max(xr, S.st.target * 1.12);
    for (const v of S.tries[S.st.id] || []) if (v) xr = Math.max(xr, v * 1.08);
    const bst = S.saved.best[S.st.id]; if (bst && S.st.objective === 'range') xr = Math.max(xr, bst.value * 1.04);
    S.vw.xr = xr; S.vw.apex = apex;
  }

  // ------------------------------------------------------------------ drawing
  function line(x0, y0, x1, y1, col, w, dash) {
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.setLineDash(dash || []); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.setLineDash([]);
  }
  function drawCloseup(ax, ay, aw, ah, q, ph, time) {
    const r = S.ev.r, p = r.par, v = S.vw;
    const bw = v.x1 - v.x0, bh = v.y1 + 1;
    const sc = Math.max(2, Math.min((aw - 12) / bw, (ah - 26) / bh));
    const ox = ax + aw / 2 - ((v.x0 + v.x1) / 2) * sc, oy = ay + ah - 8 - (ah - 26 - bh * sc) / 2 - 0;
    const X = (x) => ox + x * sc, Y = (y) => oy - y * sc;
    ctx.save(); ctx.beginPath(); ctx.rect(ax, ay, aw, ah); ctx.clip();
    // sky
    const g = ctx.createLinearGradient(0, ay, 0, ay + ah); g.addColorStop(0, '#16263d'); g.addColorStop(1, '#223552');
    ctx.fillStyle = g; ctx.fillRect(ax, ay, aw, ah);
    // ground
    ctx.fillStyle = '#2d4030'; ctx.fillRect(ax, Y(0), aw, ay + ah - Y(0));
    line(ax, Y(0), ax + aw, Y(0), '#5f8a5b', 2);
    // tower
    const lw = Math.max(2, 0.28 * sc);
    line(X(-2.6), Y(0), X(0), Y(p.H), '#7a5a3a', lw); line(X(2.6), Y(0), X(0), Y(p.H), '#7a5a3a', lw);
    line(X(-1.4), Y(p.H * 0.45), X(1.4), Y(p.H * 0.45), '#6a4d31', lw * 0.6);
    // stored positions
    const ps = T.positions(q, p);
    const released = time > tThrow() && S.ev.valid;
    // trail of the projectile (before release)
    const hh = r.hist, nUp = Math.min(hh.ph.length - 1, Math.floor(Math.min(time, tThrow()) / hh.dt));
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let i = 0; i <= nUp; i++) { const pp = T.positions(qAt(hh, i), p).pr; if (i === 0) ctx.moveTo(X(pp[0]), Y(pp[1])); else ctx.lineTo(X(pp[0]), Y(pp[1])); }
    ctx.stroke();
    // release line (sling direction at which the pin lets go)
    if (!released && ph !== 0) {
      const ang = q[0] + (S.par.rel !== undefined ? S.par.rel : p.rel) * D2R;
      const ex = ps.tip[0] - Math.sin(ang) * p.s, ey = ps.tip[1] - Math.cos(ang) * p.s;
      line(X(ps.tip[0]), Y(ps.tip[1]), X(ex), Y(ey), 'rgba(255,183,3,0.55)', 1.5, [5, 4]);
      ctx.fillStyle = 'rgba(255,183,3,0.9)'; ctx.font = '11px system-ui'; ctx.textAlign = 'center';
      ctx.fillText('放出ライン', X(ex), Y(ey) - 6);
    }
    // arm
    line(X(ps.sh[0]), Y(ps.sh[1]), X(ps.tip[0]), Y(ps.tip[1]), '#c08a4c', Math.max(3, 0.42 * sc));
    // counterweight
    const cwAng = p.fixed ? q[0] : q[1];
    if (!p.fixed) line(X(ps.sh[0]), Y(ps.sh[1]), X(ps.cw[0]), Y(ps.cw[1]), '#9aa6b8', Math.max(2, 0.16 * sc));
    ctx.save(); ctx.translate(X(ps.cw[0]), Y(ps.cw[1])); ctx.rotate(-cwAng);
    const hw = p.rcw * sc;
    ctx.fillStyle = '#556377'; ctx.fillRect(-hw, -hw, 2 * hw, 2 * hw);
    ctx.strokeStyle = '#8c9bb3'; ctx.lineWidth = 2; ctx.strokeRect(-hw, -hw, 2 * hw, 2 * hw);
    ctx.fillStyle = '#c9d3e3'; ctx.font = `600 ${Math.max(9, Math.min(13, hw * 0.75))}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`${p.M}kg`, 0, 0); ctx.textBaseline = 'alphabetic';
    ctx.restore();
    // pivot
    ctx.fillStyle = '#e6edf6'; ctx.beginPath(); ctx.arc(X(0), Y(p.H), Math.max(3, 0.3 * sc), 0, 7); ctx.fill();
    // sling + projectile
    if (!released) {
      line(X(ps.tip[0]), Y(ps.tip[1]), X(ps.pr[0]), Y(ps.pr[1]), '#f1e6c8', 1.8);
      ctx.fillStyle = '#ffe9a8'; ctx.beginPath(); ctx.arc(X(ps.pr[0]), Y(ps.pr[1]), Math.max(4, 0.5 * sc), 0, 7); ctx.fill();
      ctx.strokeStyle = '#8a6d1f'; ctx.lineWidth = 1.5; ctx.stroke();
    } else {
      const R = S.ev.r.rel, tau = (time - tThrow()) * FLIGHT_SPEED, pp = T.flight(S.ev.r, Math.min(tau, R.tf));
      ctx.fillStyle = '#ffe9a8'; ctx.beginPath(); ctx.arc(X(pp[0]), Y(pp[1]), Math.max(4, 0.5 * sc), 0, 7); ctx.fill();
      // sling dangling
      line(X(ps.tip[0]), Y(ps.tip[1]), X(ps.pr[0]), Y(ps.pr[1]), 'rgba(241,230,200,0.4)', 1.5);
    }
    // failure flash
    if (time > tThrow() && !S.ev.valid && S.ev.r.fail === 'cw') {
      ctx.strokeStyle = '#ff6b6b'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(X(ps.cw[0]), Y(ps.cw[1]), hw * 1.5, 0, 7); ctx.stroke();
    }
    ctx.fillStyle = '#8fa3bd'; ctx.font = '11px system-ui'; ctx.textAlign = 'left';
    ctx.textAlign = 'right'; ctx.fillText(`支点 高さ ${p.H} m`, X(0) - 10, Y(p.H) + 4); ctx.textAlign = 'left';
    ctx.fillText(`${Math.round(bw)} m 幅`, ax + 8, ay + 16);
    ctx.restore();
  }

  const FLIGHT_SPEED = 2.0;
  function drawFar(ax, ay, aw, ah, time) {
    const r = S.ev.r, p = r.par, v = S.vw, st = S.st;
    ctx.save(); ctx.beginPath(); ctx.rect(ax, ay, aw, ah); ctx.clip();
    ctx.fillStyle = '#0c1522'; ctx.fillRect(ax, ay, aw, ah);
    const xl = -14, xr = v.xr;
    const sc = Math.max(0.2, Math.min((aw - 24) / (xr - xl), (ah - 34) / (v.apex + 6)));
    const gy = ay + ah - 20, ox = ax + 12 - xl * sc;
    const X = (x) => ox + x * sc, Y = (y) => gy - y * sc;
    ctx.fillStyle = '#2d4030'; ctx.fillRect(ax, gy, aw, ay + ah - gy);
    line(ax, gy, ax + aw, gy, '#5f8a5b', 2);
    // ruler
    const step = xr > 450 ? 100 : xr > 180 ? 50 : 25;
    ctx.fillStyle = '#7d8fa8'; ctx.font = '10px system-ui'; ctx.textAlign = 'center';
    for (let x = 0; x <= xr; x += step) { line(X(x), gy, X(x), gy + 5, '#7d8fa8', 1); ctx.fillText(`${x}`, X(x), gy + 15); }
    ctx.textAlign = 'left'; ctx.fillText('m', X(xr) - 8, gy + 15);
    // tower silhouette
    const tp = T.positions(poseAt(Math.min(time, tThrow())).q, p);
    line(X(-0.6), gy, X(0), Y(p.H), '#7a5a3a', 2); line(X(0.6), gy, X(0), Y(p.H), '#7a5a3a', 2);
    line(X(tp.sh[0]), Y(tp.sh[1]), X(tp.tip[0]), Y(tp.tip[1]), '#c08a4c', 2.5);
    // target
    if (st.objective === 'target') {
      const tx = X(st.target), wh = Math.max(14, 9 * sc);
      ctx.fillStyle = '#8b5e3c'; ctx.fillRect(tx - 5, gy - wh, 10, wh);
      ctx.fillStyle = '#ff6b6b'; ctx.fillRect(tx - 5, gy - wh - 8, 14, 8);
      ctx.fillStyle = '#ffd1d1'; ctx.font = '600 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText(`目標 ${st.target} m`, tx, gy - wh - 12);
    }
    // best + previous tries
    const bst = S.saved.best[st.id];
    if (bst && st.objective === 'range') { const bx = X(bst.value); line(bx, gy - 10, bx, gy, '#ffb703', 2); ctx.fillStyle = '#ffb703'; ctx.font = '10px system-ui'; ctx.textAlign = 'center'; ctx.fillText(`ベスト ${bst.value.toFixed(0)}`, bx, gy - 14); }
    const tries = S.tries[st.id] || [];
    tries.forEach((vv) => { if (vv == null) return; ctx.fillStyle = 'rgba(160,180,210,0.5)'; ctx.beginPath(); ctx.moveTo(X(vv), gy); ctx.lineTo(X(vv) - 4, gy - 8); ctx.lineTo(X(vv) + 4, gy - 8); ctx.closePath(); ctx.fill(); });
    // predicted path (dashed)
    if (S.ev.valid) {
      const R = r.rel;
      ctx.strokeStyle = 'rgba(255,183,3,0.55)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]); ctx.beginPath();
      for (let k = 0; k <= 60; k++) { const pp = T.flight(r, R.tf * k / 60); if (k === 0) ctx.moveTo(X(pp[0]), Y(pp[1])); else ctx.lineTo(X(pp[0]), Y(pp[1])); }
      ctx.stroke(); ctx.setLineDash([]);
      const lx = X(r.range);
      ctx.strokeStyle = '#ff6b6b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(lx - 5, gy - 5); ctx.lineTo(lx + 5, gy + 5); ctx.moveTo(lx + 5, gy - 5); ctx.lineTo(lx - 5, gy + 5); ctx.stroke();
      ctx.fillStyle = '#ffd1d1'; ctx.font = '600 12px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(`${r.range.toFixed(1)} m`, clamp(lx, ax + 30, ax + aw - 30), gy - 12);
    }
    // moving projectile
    let pos;
    if (time <= tThrow() || !S.ev.valid) pos = T.positions(poseAt(Math.min(time, tThrow())).q, p).pr;
    else pos = T.flight(r, Math.min((time - tThrow()) * FLIGHT_SPEED, r.rel.tf));
    ctx.fillStyle = '#ffe9a8'; ctx.beginPath(); ctx.arc(X(pos[0]), Y(Math.max(0, pos[1])), 4, 0, 7); ctx.fill();
    ctx.fillStyle = '#7d8fa8'; ctx.font = '11px system-ui'; ctx.textAlign = 'left'; ctx.fillText('全体図(点線 = 予想軌道)', ax + 8, ay + 14);
    ctx.restore();
  }

  function frame(now) {
    frame.last = frame.last || now;
    const dt = Math.min(0.1, (now - frame.last) / 1000); frame.last = now;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.fillStyle = '#0f1722'; ctx.fillRect(0, 0, view.w, view.h);
    if (S.ev && S.vw && S.ev.r.hist) {
      if (S.playing) {
        S.T += dt;
        const end = tThrow() + (S.ev.valid ? S.ev.r.rel.tf / FLIGHT_SPEED : 0.6) + 0.4;
        if (S.T >= end) { S.playing = false; S.T = end; }
      }
      const h1 = Math.round(view.h * 0.6);
      const pose = poseAt(Math.min(S.T, tThrow()));
      drawCloseup(0, 0, view.w, h1, pose.q, pose.ph, S.T);
      drawFar(0, h1, view.w, view.h - h1, S.T);
      if (S.T > tThrow() && !S.ev.valid) {
        ctx.fillStyle = 'rgba(255,107,107,0.92)'; ctx.font = '600 13px system-ui'; ctx.textAlign = 'center';
        ctx.fillText(S.ev.note, view.w / 2, 24);
      }
    }
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
  function fire() {
    if (!S.ev) return;
    S.T = 0; S.playing = true;
    const arr = (S.tries[S.st.id] = S.tries[S.st.id] || []);
    arr.push(S.ev.valid ? S.ev.value : null); if (arr.length > 6) arr.shift();
    buildView(); updatePanel();
  }
  $('fireBtn').onclick = fire;
  cv.addEventListener('pointerdown', () => { if (!S.playing) fire(); });
  $('resetBtn').onclick = () => { S.par = Object.assign({}, S.st.start); S.T = 0; S.playing = false; buildSliders(); recalc(); };
  $('helpBtn').onclick = (e) => { e.preventDefault(); $('helpDlg').showModal(); };
  $('techBtn').onclick = (e) => { e.preventDefault(); $('techDlg').showModal(); };
  $('techDlg').addEventListener('click', (e) => { if (e.target === $('techDlg')) $('techDlg').close(); });

  // ------------------------------------------------------------------ submit
  function hints() {
    const ev = S.ev, r = ev.r, R = r.rel, st = S.st, out = [];
    if (st.id === 1) out.push('錘が落ちる高さ(≈ 2a)が大きいほど蓄えられるエネルギー M g Δh は増えますが、錘と腕そのものを振り回すエネルギーも増えます。弾の速さは v ≈ ω·b なので、短い腕を伸ばすと長い腕(b)が縮んで先端が遅くなる、という引き合いです。');
    if (st.id === 2) out.push('スリングは腕を「さらに伸ばした」ものと考えられます。先端の速さ ω·b に、スリングの回転 φ̇·s が足されるので、長いほど弾は速くなりますが、そのぶん回し切るのに時間がかかり、放出角のタイミングが厳しくなります。');
    if (st.id === 3) out.push('固定式の錘は、腕と一緒に円弧を描くので、落ちながら大きな運動エネルギーを持ち続けます。吊り下げ式は錘がほぼ真下へ落ち、そのエネルギーを腕を介して弾へ渡し終えた後は、ほとんど止まっています。これが効率(上のバー)の差になります。');
    if (st.id === 4) out.push('飛距離は R ≈ v² sin2α / g。同じ放出角なら飛距離は速さの2乗に比例し、速さの2乗は錘の重さにほぼ比例します。錘を2倍にすれば、飛距離はおよそ(完全には比例しませんが)倍近くになります。');
    if (st.id === 5) out.push('それぞれ単独のステージでは見つからなかった組み合わせの最適解(例: 吊り棒を長くして、スリングも長くして、放出角を早める)が、全体の効率を最大にします。');
    if (Math.abs(R.angle - 45) > 12) out.push(`放出角度は ${R.angle.toFixed(0)}° でした。空気抵抗がなければ 45° が最も遠くへ飛びます(高さのある放出点では、それよりやや低い角度が最適)。放出角(ピン)の設定を動かして、45° 付近を狙ってみよう。`);
    out.push(`この設計では、錘が失ったエネルギーの ${(r.eta * 100).toFixed(0)}% が弾に渡りました。`);
    return out.slice(0, 3);
  }
  function shareText() {
    const st = S.st, ev = S.ev;
    const lines = [`Trebuchet Lab「${st.id}. ${st.name}」で ${ev.value.toFixed(1)} m 飛ばしました!`, `スコア ${ev.score}`, '#TrebuchetLab'];
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
    if (!prev || ev.score > prev.score) { S.saved.best[st.id] = { score: ev.score, value: ev.value }; msg = ' <b class="pass">ベスト更新!</b>'; }
    persist(); updatePanel();
    const hs = hints().map((t) => `<li class="hint-li">${t}</li>`).join('');
    $('reportCard').hidden = false;
    $('report').innerHTML = `<p class="pass"><b>合格</b> — ${ev.value.toFixed(1)} m / スコア <b>${ev.score}</b>${msg}</p><div class="explain"><b>ヒント</b><ul>${hs}</ul></div>`;
    $('reportCard').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    $('shareTop').hidden = false;
  };

  load();
  selectStage(0);
  requestAnimationFrame(frame);
  if (!S.saved.seenHelp) { S.saved.seenHelp = true; persist(); try { $('helpDlg').showModal(); } catch (e) { /* ignore */ } }
  window.__treb = { S, T, selectStage, recalc, fire };
})();
