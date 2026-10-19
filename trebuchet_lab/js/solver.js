/*
 * solver.js — Trebuchet Lab physics.
 * Planar Lagrangian model, 3 degrees of freedom (all angles measured clockwise from "straight down"):
 *   theta = arm, psi = hinged counterweight rod, phi = sling.   u(b) = (-sin b, -cos b)
 *   pivot P=(0,H);  long tip = P + b u(theta);  short end = P - a u(theta);
 *   counterweight = short end + c u(psi);  projectile = tip + s u(phi)   (sling = massless rigid rod)
 * Phase 1: projectile slides on the ground (constraint y_p = 0, Lagrange multiplier = normal force).
 * Phase 2: free swing until the sling angle (relative to the arm) reaches the release angle.
 * Then ballistic flight (no drag).  Integration: RK4, dt = 1 ms.
 */
(function (root) {
  'use strict';
  const G = 9.81;
  const D2R = Math.PI / 180;

  const DEFAULTS = {
    L: 12,        // total arm length (m)
    a: 2.5,       // short arm (m): pivot -> counterweight side
    H: 7,         // pivot height (m)
    M: 400,       // counterweight mass (kg)
    m: 12,        // projectile mass (kg)
    armMass: 4,   // arm mass per metre (kg/m)
    c: 0,         // hinged counterweight length (m); 0 = fixed to the arm
    s: 6,         // sling length (m)
    rel: -20,     // release angle (deg): sling angle relative to the arm extension
    rcw: 0.6,     // counterweight half size (m): ground clearance check
    h0: 0.3,      // height of the arm tip at rest (m)
  };

  function wrap(x) { while (x > Math.PI) x -= 2 * Math.PI; while (x < -Math.PI) x += 2 * Math.PI; return x; }

  function prep(par) {
    const p = Object.assign({}, DEFAULTS, par);
    p.b = p.L - p.a;
    p.ma = p.armMass * p.L;
    p.d = (p.b - p.a) / 2;                 // arm centre of mass, toward the long end
    p.A = p.ma * (p.L * p.L / 12 + p.d * p.d) + p.M * p.a * p.a + p.m * p.b * p.b;
    p.Mac = p.M * p.a * p.c;
    p.mbs = p.m * p.b * p.s;
    p.Mc2 = p.M * p.c * p.c;
    p.ms2 = p.m * p.s * p.s;
    p.fixed = p.c < 0.02;
    p.kth = p.ma * p.d - p.M * p.a + p.m * p.b;
    return p;
  }

  function solveLin(A, b, n) {
    // Gaussian elimination with partial pivoting; A is n x n (array of arrays), returns x
    for (let i = 0; i < n; i++) {
      let piv = i;
      for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
      if (piv !== i) { const t = A[i]; A[i] = A[piv]; A[piv] = t; const tb = b[i]; b[i] = b[piv]; b[piv] = tb; }
      const d = A[i][i] || 1e-12;
      for (let r = i + 1; r < n; r++) {
        const f = A[r][i] / d;
        if (f === 0) continue;
        for (let k = i; k < n; k++) A[r][k] -= f * A[i][k];
        b[r] -= f * b[i];
      }
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      let sum = b[i];
      for (let k = i + 1; k < n; k++) sum -= A[i][k] * x[k];
      x[i] = sum / (A[i][i] || 1e-12);
    }
    return x;
  }

  // accelerations; phase 1 also returns the ground normal force lam
  function accel(s, p, phase) {
    const th = s[0], ps = s[1], ph = s[2], w0 = s[3], w1 = s[4], w2 = s[5];
    const C1 = Math.cos(th - ps), S1 = Math.sin(th - ps), C2 = Math.cos(th - ph), S2 = Math.sin(th - ph);
    const M = [[p.A, -p.Mac * C1, p.mbs * C2], [-p.Mac * C1, p.Mc2, 0], [p.mbs * C2, 0, p.ms2]];
    const dM = [
      [[0, p.Mac * S1, -p.mbs * S2], [p.Mac * S1, 0, 0], [-p.mbs * S2, 0, 0]],
      [[0, -p.Mac * S1, 0], [-p.Mac * S1, 0, 0], [0, 0, 0]],
      [[0, 0, p.mbs * S2], [0, 0, 0], [p.mbs * S2, 0, 0]],
    ];
    const qd = [w0, w1, w2], cv = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      let sum = 0;
      for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) sum += (dM[k][i][j] - 0.5 * dM[i][j][k]) * qd[j] * qd[k];
      cv[i] = sum;
    }
    const gV = [G * Math.sin(th) * p.kth, G * p.M * p.c * Math.sin(ps), G * p.m * p.s * Math.sin(ph)];
    const rhs = [-cv[0] - gV[0], -cv[1] - gV[1], -cv[2] - gV[2]];
    if (p.fixed) { M[1][1] = 1; M[0][1] = M[1][0] = 0; rhs[1] = 0; }
    if (phase === 2) {
      const x = solveLin(M.map((r) => r.slice()), rhs.slice(), 3);
      return { qdd: x, lam: 0 };
    }
    const Jg = [p.b * Math.sin(th), 0, p.s * Math.sin(ph)];
    const K = [
      [M[0][0], M[0][1], M[0][2], -Jg[0]],
      [M[1][0], M[1][1], M[1][2], -Jg[1]],
      [M[2][0], M[2][1], M[2][2], -Jg[2]],
      [Jg[0], Jg[1], Jg[2], 0],
    ];
    const r4 = [rhs[0], rhs[1], rhs[2], -(p.b * Math.cos(th) * w0 * w0 + p.s * Math.cos(ph) * w2 * w2)];
    const x = solveLin(K, r4, 4);
    return { qdd: [x[0], x[1], x[2]], lam: x[3] };
  }

  function step(s, p, phase, dt) {
    const f = (st) => { const r = accel(st, p, phase); return [st[3], st[4], st[5], r.qdd[0], r.qdd[1], r.qdd[2]]; };
    const add = (a, k, h) => a.map((v, i) => v + h * k[i]);
    const k1 = f(s), k2 = f(add(s, k1, dt / 2)), k3 = f(add(s, k2, dt / 2)), k4 = f(add(s, k3, dt));
    return s.map((v, i) => v + dt / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
  }

  const U = (b) => [-Math.sin(b), -Math.cos(b)];
  function positions(q, p) {
    const u = U(q[0]), v = U(q[1]), w = U(q[2]);
    const tip = [p.b * u[0], p.H + p.b * u[1]];
    const sh = [-p.a * u[0], p.H - p.a * u[1]];
    const cw = [sh[0] + p.c * v[0], sh[1] + p.c * v[1]];
    const pr = [tip[0] + p.s * w[0], tip[1] + p.s * w[1]];
    return { tip, sh, cw, pr, piv: [0, p.H] };
  }
  function projVel(s, p) {
    // d/dt (tip + s u(phi)) ; u'(b) = (-cos b, sin b)
    const th = s[0], ph = s[2];
    return [p.b * (-Math.cos(th)) * s[3] + p.s * (-Math.cos(ph)) * s[5], p.b * Math.sin(th) * s[3] + p.s * Math.sin(ph) * s[5]];
  }

  function energy(s, p) {
    const th = s[0], ps = s[1], ph = s[2], w0 = s[3], w1 = s[4], w2 = s[5];
    const du = (b, w) => [-Math.cos(b) * w, Math.sin(b) * w];
    const vcw = du(th, -p.a * w0), vcw2 = du(ps, p.c * w1);
    const cx = -p.a * -Math.cos(th) * w0 + p.c * -Math.cos(ps) * w1, cy = -p.a * Math.sin(th) * w0 + p.c * Math.sin(ps) * w1;
    const v = projVel(s, p);
    const ke = 0.5 * (p.ma * (p.L * p.L / 12 + p.d * p.d) * w0 * w0) + 0.5 * p.M * (cx * cx + cy * cy) + 0.5 * p.m * (v[0] * v[0] + v[1] * v[1]);
    const pos = positions(s, p);
    const ya = p.H - p.d * Math.cos(th);
    return ke + G * (p.ma * ya + p.M * pos.cw[1] + p.m * pos.pr[1]);
  }

  function simulate(par, opts) {
    opts = opts || {};
    const p = prep(par);
    const out = { valid: false, note: '', par: p, range: 0, hist: null };
    if (p.b < p.H - p.h0 + 0.05) { out.note = '長い腕が短すぎて、先端が地面に届きません。'; return out; }
    const th0 = Math.acos((p.H - p.h0) / p.b);
    const ht = p.H - p.b * Math.cos(th0);
    if (p.s < ht + 0.05) { out.note = 'スリングが短すぎます。'; return out; }
    const ph0 = -Math.acos(ht / p.s);
    let s = [th0, 0, ph0, 0, 0, 0], phase = 1;
    out.th0 = th0;
    const dt = 0.001, relR = p.rel * D2R, REC = 8, TMAX = 9;
    const hist = { dt: dt * REC, q: [], ph: [] };
    const y0cw = positions([th0, 0, ph0], p).cw[1];
    const E0 = energy(s, p);
    let released = false, t = 0, n = 0, liftT = null, minCwY = 1e9, ycwAtRel = y0cw;
    let fail = '';
    while (t < TMAX) {
      if (n % REC === 0) { hist.q.push(s[0], s[1], s[2]); hist.ph.push(phase); }
      s = step(s, p, phase, dt); t += dt; n++;
      const pos = positions(s, p);
      minCwY = Math.min(minCwY, pos.cw[1]);
      if (pos.cw[1] - p.rcw < 0 || pos.sh[1] < 0.2) { fail = 'cw'; break; }
      if (phase === 1) {
        const r = accel(s, p, 1);
        if (r.lam < 0 || pos.tip[1] > p.s * 0.995) { phase = 2; liftT = t; }
        else if (Math.abs(s[0]) > 7) { fail = 'stuck'; break; }
      } else {
        if (pos.pr[1] < 0 && pos.pr[1] < -0.0) { fail = 'ground'; break; }
        const rho = wrap(s[2] - s[0]);
        // release when the sling swings forward past the release angle (after the whip has started)
        if (t - liftT > 0.02 && rho >= relR && s[3] > 0) { released = true; ycwAtRel = pos.cw[1]; break; }
      }
      if (n > 1 && (!isFinite(s[0]) || Math.abs(s[3]) > 200)) { fail = 'nan'; break; }
    }
    hist.q.push(s[0], s[1], s[2]); hist.ph.push(phase);
    out.hist = hist; out.tEnd = t; out.liftT = liftT; out.minCwY = minCwY;
    if (!released) {
      out.note = fail === 'cw' ? 'カウンターウェイトが地面に当たって、腕が止まりました。' :
        fail === 'ground' ? '弾が放出される前に地面へ落ちました(スリングが長すぎる/放出角が合っていない)。' :
        fail === 'stuck' ? '弾が動きませんでした。' : '弾が放出されませんでした(放出角を変えてみよう)。';
      out.fail = fail || 'norel'; return out;
    }
    out.drift = Math.abs(energy(s, p) - E0) / (Math.abs(E0 - G * p.m * 0) + 1);
    const pos = positions(s, p), v = projVel(s, p);
    const y0 = pos.pr[1], x0 = pos.pr[0];
    if (y0 < 0) { out.note = '弾が地面の下で放出されました。'; out.fail = 'ground'; return out; }
    const tf = (v[1] + Math.sqrt(v[1] * v[1] + 2 * G * y0)) / G;
    out.rel = { t, x: x0, y: y0, vx: v[0], vy: v[1], speed: Math.hypot(v[0], v[1]), angle: Math.atan2(v[1], v[0]) / D2R, tf };
    out.range = x0 + v[0] * tf;
    out.apex = y0 + (v[1] > 0 ? v[1] * v[1] / (2 * G) : 0);
    // efficiency: projectile energy / counterweight potential energy released
    const Ep = 0.5 * p.m * (v[0] * v[0] + v[1] * v[1]) + p.m * G * y0;
    const Ecw = p.M * G * (y0cw - ycwAtRel);
    out.eta = Ecw > 0 ? Ep / Ecw : 0;
    out.Ecw = Ecw; out.Ep = Ep;
    out.valid = out.range > 0;
    if (!out.valid) out.note = '弾が後ろへ飛びました。放出角を調整しよう。';
    return out;
  }

  function flight(r, tt) { // projectile position during flight, time tt after release
    const R = r.rel; return [R.x + R.vx * tt, R.y + R.vy * tt - 0.5 * G * tt * tt];
  }

  // stage evaluation: value = range (m) for 'range' stages, error (m) for 'target' stages
  function evaluate(st, par) {
    const r = simulate(Object.assign({}, st.fixed, par));
    const ev = { r, valid: r.valid, value: r.range, score: 0, note: r.note, err: null };
    if (!r.valid) return ev;
    if (st.objective === 'target') {
      ev.err = r.range - st.target;
      ev.score = Math.round(1000 * Math.max(0, Math.min(1, 1 - Math.max(0, Math.abs(ev.err) - 0.5) / 19.5)));
    } else {
      ev.score = Math.round(1000 * Math.max(0, Math.min(1, (r.range - st.floor) / (st.ref - st.floor))));
    }
    return ev;
  }

  const api = { G, DEFAULTS, prep, simulate, evaluate, energy, positions, flight, wrap };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Trebuchet = api;
})(typeof window !== 'undefined' ? window : globalThis);
