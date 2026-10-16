/*
 * solver.js — crushable-structure crash simulation (explicit dynamics, 2D).
 *
 * The designer paints cells (a w x h grid). Each painted cell becomes a small lattice:
 * 4 edge bars + 2 diagonal bars between corner nodes. Every bar carries only an axial
 * force with a path-dependent law:
 *   - elastic up to its crush strength P
 *   - then it "buckles": force drops from P to a plateau (BETA * P) as it is crushed
 *   - after crushing to LOCK of its length it bottoms out (very stiff again)
 *   - tension: elastic-plastic, breaks after a large stretch
 * The car (mass M, speed v0) pushes the structure's back plate into a rigid wall.
 * Nodes are confined to a corridor (top/bottom walls). Time integration: symplectic Euler.
 *
 * Works in the browser (window.Crash) and in node (module.exports).
 */
(function (root) {
  'use strict';

  const CELL = 0.05;          // m per cell
  const BETA = 0.6;           // plateau force / peak force
  const DP0 = 0.04;           // softening length (fraction of L0)
  const DY = 0.03;            // elastic strain at the peak (fraction of L0)
  const LOCK = 0.72;          // crush fraction where a bar bottoms out
  const KLOCK = 3;            // extra stiffness multiple once bottomed out
  const ZETA = 0.08;          // damping ratio on bar axial motion
  const BREAK = 0.18;         // tension stretch (fraction of L0) at which a bar breaks
  const G = 9.81;

  // cell materials: P = edge-bar crush strength [N], cost = budget units, mass per cost unit
  const MATS = [
    { id: 0, key: 'none', label: 'なし', P: 0, cost: 0 },
    { id: 1, key: 'al', label: 'アルミ薄板', P: 10000, cost: 1 },
    { id: 2, key: 'st', label: '鋼板', P: 22000, cost: 2 },
    { id: 3, key: 'hs', label: '高張力鋼', P: 42000, cost: 4 },
  ];
  const MASS_PER_COST = 0.9;  // kg
  const P_OF = new Float64Array(8), COST_OF = new Float64Array(8);
  MATS.forEach((m) => { P_OF[m.id] = m.P; COST_OF[m.id] = m.cost; });

  function hash(i, j) {
    let s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  }

  /**
   * stage: { w, h, v0, M, walls?: [[rowFrom,rowTo]] (default whole height), gLimit }
   * rows are measured from the top, in cells; wall covers y in [rowFrom, rowTo] (cell units, may be fractional)
   */
  function makeProblem(stage) {
    return {
      w: stage.w, h: stage.h, v0: stage.v0, M: stage.M,
      walls: stage.walls || [[0, stage.h]],
      gLimit: stage.gLimit || 40,
      smax: stage.w * CELL * (1 - 0.0) * LOCK,   // best-case stroke (a bar can only crush this far)
    };
  }

  function costOf(mat) { let c = 0; for (let i = 0; i < mat.length; i++) c += COST_OF[mat[i]]; return c; }
  function cellCount(mat) { let c = 0; for (let i = 0; i < mat.length; i++) if (mat[i]) c++; return c; }

  /** build nodes and bars from a material grid */
  function build(P, mat) {
    const { w, h } = P;
    const nid = new Int32Array((w + 1) * (h + 1)).fill(-1);
    const nx = [], ny = [], nm = [], ni = [], nj = [];
    const touch = (i, j) => {
      const k = j * (w + 1) + i;
      if (nid[k] < 0) { nid[k] = nx.length; nx.push(i * CELL); ny.push(j * CELL + CELL * 0.012 * hash(i, j)); nm.push(0.06); ni.push(i); nj.push(j); }
      return nid[k];
    };
    const painted = (i, j) => (i >= 0 && i < w && j >= 0 && j < h && mat[j * w + i] > 0);
    const strength = (cells) => {
      let s = 0, n = 0;
      for (const [i, j] of cells) if (painted(i, j)) { s += P_OF[mat[j * w + i]]; n++; }
      return n ? s / n : 0;
    };
    const bars = [];   // [a, b, P]
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const m = mat[j * w + i];
        if (!m) continue;
        const a = touch(i, j), b = touch(i + 1, j), c = touch(i, j + 1), d = touch(i + 1, j + 1);
        const cm = COST_OF[m] * MASS_PER_COST / 4;
        nm[a] += cm; nm[b] += cm; nm[c] += cm; nm[d] += cm;
        const p = P_OF[m];
        const ci = j * w + i;
        bars.push([a, d, p * 0.5, ci, -1], [b, c, p * 0.5, ci, -1]);
        // edges are created once, by the owning cell (shared edges: owner = lower index)
        // top edge (i,j)-(i+1,j): shared with cell (i,j-1)
        if (!painted(i, j - 1)) bars.push([a, b, strength([[i, j]]), ci, -1]);
        else bars.push([a, b, strength([[i, j], [i, j - 1]]), ci, ci - w]);
        // left edge (i,j)-(i,j+1): shared with (i-1,j)
        if (!painted(i - 1, j)) bars.push([a, c, strength([[i, j]]), ci, -1]);
        else bars.push([a, c, strength([[i, j], [i - 1, j]]), ci, ci - 1]);
        // bottom edge only if no cell below owns it
        if (!painted(i, j + 1)) bars.push([c, d, strength([[i, j]]), ci, -1]);
        // right edge only if no cell to the right owns it
        if (!painted(i + 1, j)) bars.push([b, d, strength([[i, j]]), ci, -1]);
      }
    }
    const n = nx.length, nb = bars.length;
    const S = {
      n, nb, nx: Float64Array.from(nx), ny: Float64Array.from(ny), nm: Float64Array.from(nm),
      ni: Int32Array.from(ni), nj: Int32Array.from(nj),
      ba: new Int32Array(nb), bb: new Int32Array(nb), L0: new Float64Array(nb), k: new Float64Array(nb),
      Pb: new Float64Array(nb), cd: new Float64Array(nb), nid, bc1: new Int32Array(nb), bc2: new Int32Array(nb),
    };
    for (let q = 0; q < nb; q++) {
      const [a, b, p, c1, c2] = bars[q];
      S.ba[q] = a; S.bb[q] = b; S.Pb[q] = p; S.bc1[q] = c1; S.bc2[q] = c2;
      S.L0[q] = Math.hypot((S.ni[a] - S.ni[b]) * CELL, (S.nj[a] - S.nj[b]) * CELL);
      S.k[q] = p / (DY * S.L0[q]);
    }
    for (let q = 0; q < nb; q++) {
      const a = S.ba[q], b = S.bb[q];
      const mred = (S.nm[a] * S.nm[b]) / (S.nm[a] + S.nm[b]);
      S.cd[q] = 2 * ZETA * Math.sqrt(S.k[q] * (1 + KLOCK) * mred);
    }
    return S;
  }

  /**
   * Run the crash. opts: { frames: number of frames to keep (0 = none), tmax }
   * returns metrics and (optionally) frames for playback.
   */
  function simulate(P, mat, opts) {
    opts = opts || {};
    const S = build(P, mat);
    const { n, nb } = S;
    const w = P.w, h = P.h;
    const out = { n, nb, ok: n > 0 };
    if (!n) { return { ...out, peakG: Infinity, stroke: 0, eta: 0, pass: false, hitWall: true, t: [], acc: [], absorbed: 0 }; }
    const x = S.nx.slice(), y = S.ny.slice(), vx = new Float64Array(n).fill(-P.v0), vy = new Float64Array(n);
    const fx = new Float64Array(n), fy = new Float64Array(n);
    const att = new Uint8Array(n), passed = new Uint8Array(n);
    let mAtt = 0, nAtt = 0;
    for (let i = 0; i < n; i++) if (S.ni[i] === w) { att[i] = 1; mAtt += S.nm[i]; nAtt++; }
    const Mc = P.M + mAtt;
    const dp = new Float64Array(nb), dead = new Uint8Array(nb), maxc = new Float32Array(nb);
    let stopSnap = null;
    // time step from a stiffness / mass bound
    const lam = new Float64Array(n);
    for (let q = 0; q < nb; q++) {
      const a = S.ba[q], b = S.bb[q], kk = S.k[q] * (1 + KLOCK);
      lam[a] += kk * (1 / S.nm[a] + 1 / S.nm[b]);
      lam[b] += kk * (1 / S.nm[a] + 1 / S.nm[b]);
    }
    let lmax = 1;
    for (let i = 0; i < n; i++) if (lam[i] > lmax) lmax = lam[i];
    const dt = Math.min(2e-5, 0.9 / Math.sqrt(lmax));
    const yTop = 0, yBot = h * CELL;
    const wallLo = P.walls.map((s) => s[0] * CELL), wallHi = P.walls.map((s) => s[1] * CELL);
    const inWall = (yy) => { for (let s = 0; s < wallLo.length; s++) if (yy >= wallLo[s] - 1e-9 && yy <= wallHi[s] + 1e-9) return true; return false; };

    let Xc = w * CELL, Vc = -P.v0;
    const X0 = Xc;
    const tmax = opts.tmax || 0.3;
    const nSteps = Math.ceil(tmax / dt);
    const accHist = [];          // cabin deceleration (m/s^2, positive = decelerating)
    const tHist = [];
    const sampleEvery = Math.max(1, Math.round(1e-4 / dt));
    const keepFrames = opts.frames || 0;
    const frames = [];
    let frameEvery = 0;          // determined once the crash duration is known (we record sparsely first)
    const rec = [];              // raw frame buffer (every recEvery steps), thinned at the end
    const recEvery = Math.max(1, Math.round(4e-4 / dt));
    let stoppedAt = -1, minX = Xc, hitWall = false;
    const KW = 3e8;
    let step = 0;
    for (; step < nSteps; step++) {
      fx.fill(0); fy.fill(0);
      for (let q = 0; q < nb; q++) {
        if (dead[q]) continue;
        const a = S.ba[q], b = S.bb[q];
        let dx = x[a] - x[b], dy = y[a] - y[b];
        let L = Math.sqrt(dx * dx + dy * dy);
        if (L < 1e-9) continue;
        const ux = dx / L, uy = dy / L;
        const L0 = S.L0[q], k = S.k[q], Pp = S.Pb[q];
        const del = L0 - L;                 // compression positive
        if (del > maxc[q] * L0) maxc[q] = del / L0;
        let e = del - dp[q];
        let F = k * e;
        if (F > 0) {
          const env = Pp * (BETA + (1 - BETA) * Math.exp(-Math.max(dp[q], 0) / (DP0 * L0)));
          if (F > env) { dp[q] = del - env / k; F = env; }
        } else if (F < -Pp) {
          dp[q] = del + Pp / k; F = -Pp;
          if (-dp[q] > BREAK * L0) { dead[q] = 1; continue; }
        }
        const dl = del - LOCK * L0;
        if (dl > 0) F += KLOCK * k * dl;
        // damping on the closing speed
        const rvx = vx[a] - vx[b], rvy = vy[a] - vy[b];
        F += S.cd[q] * (-(rvx * ux + rvy * uy));
        const gx = F * ux, gy = F * uy;
        fx[a] += gx; fy[a] += gy; fx[b] -= gx; fy[b] -= gy;
      }
      // cabin
      let Fc = 0;
      for (let i = 0; i < n; i++) if (att[i]) Fc += fx[i];
      if (Xc < 0) { Fc += KW * (-Xc) - 2 * Math.sqrt(KW * Mc) * 0.3 * Math.min(Vc, 0); hitWall = true; }
      Vc += (Fc / Mc) * dt;
      Xc += Vc * dt;
      if (Xc < minX) minX = Xc;
      for (let i = 0; i < n; i++) {
        if (att[i]) {
          x[i] = Xc; vx[i] = Vc; vy[i] = 0;            // rigid bulkhead plate: no slipping along it
        } else {
          vx[i] += (fx[i] / S.nm[i]) * dt; vy[i] += (fy[i] / S.nm[i]) * dt;
          x[i] += vx[i] * dt; y[i] += vy[i] * dt;
          // (no plate clamp)
          if (x[i] < 0 && !passed[i]) {
            if (inWall(y[i])) { x[i] = 0; if (vx[i] < 0) vx[i] = 0; }
            else passed[i] = 1;
          }
        }
        if (y[i] < yTop) { y[i] = yTop; if (vy[i] < 0) vy[i] = 0; }
        else if (y[i] > yBot) { y[i] = yBot; if (vy[i] > 0) vy[i] = 0; }
      }
      if (step % sampleEvery === 0) { accHist.push(Fc / Mc); tHist.push(step * dt); }
      if (keepFrames && step % recEvery === 0) rec.push(snapshot());
      if (stoppedAt < 0 && Vc >= 0) { stoppedAt = step * dt; stopSnap = snapshot(); }
      if (stoppedAt >= 0 && step * dt > stoppedAt + 0.012) break;
    }
    function snapshot() {
      const px = new Float32Array(n * 2), st = new Float32Array(nb);
      for (let i = 0; i < n; i++) { px[2 * i] = x[i]; px[2 * i + 1] = y[i]; }
      for (let q = 0; q < nb; q++) {
        if (dead[q]) { st[q] = -2; continue; }
        const L0 = S.L0[q];
        const dx = x[S.ba[q]] - x[S.bb[q]], dy = y[S.ba[q]] - y[S.bb[q]];
        st[q] = (L0 - Math.sqrt(dx * dx + dy * dy)) / L0;   // current compression fraction
      }
      return { t: step * dt, px, st, Xc, Vc };
    }
    // Fc > 0 pushes the cabin away from the wall = decelerating
    const win = Math.max(1, Math.round(0.003 / (dt * sampleEvery)));
    const filt = new Float64Array(accHist.length);
    let s = 0;
    for (let i = 0; i < accHist.length; i++) {
      s += accHist[i];
      if (i >= win) s -= accHist[i - win];
      filt[i] = s / Math.min(win, i + 1);
    }
    let peak = 0;
    for (let i = 0; i < filt.length; i++) if (filt[i] > peak) peak = filt[i];
    const peakG = peak / G;
    const stroke = X0 - minX;
    const aIdeal = (P.v0 * P.v0) / (2 * P.smax);
    const eta = Math.min(1, aIdeal / Math.max(peak, 1e-9));
    const vEnd = Vc;
    const absorbed = 0.5 * P.M * (P.v0 * P.v0 - vEnd * vEnd);
    const pass = stoppedAt >= 0 && !hitWall && peakG <= P.gLimit;
    // thin the frames to about keepFrames
    if (keepFrames) {
      const stride = Math.max(1, Math.ceil(rec.length / keepFrames));
      for (let i = 0; i < rec.length; i += stride) frames.push(rec[i]);
      if (frames[frames.length - 1] !== rec[rec.length - 1]) frames.push(rec[rec.length - 1]);
    }
    const cellUse = new Float32Array(w * h);
    for (let q = 0; q < nb; q++) {
      const c1 = S.bc1[q], c2 = S.bc2[q];
      if (maxc[q] > cellUse[c1]) cellUse[c1] = maxc[q];
      if (c2 >= 0 && maxc[q] > cellUse[c2]) cellUse[c2] = maxc[q];
    }
    return {
      cellUse, stopSnap, n, nb, S, dt, steps: step, stoppedAt, hitWall, peakG, stroke, eta, pass, absorbed,
      t: tHist, acc: Array.from(filt, (v) => v / G), frames, X0, vEnd,
    };
  }

  /** score: lower peak deceleration and a lighter structure both score higher; fails score 0 */
  function scoreOf(res, cost, budget) {
    if (!res.pass || cost > budget || cost <= 0) return 0;
    return Math.round(1000 * res.eta * (1 + 0.5 * (1 - cost / budget)));
  }

  const api = { scoreOf, CELL, MATS, P_OF, COST_OF, LOCK, BETA, makeProblem, build, simulate, costOf, cellCount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Crash = api;
})(typeof window !== 'undefined' ? window : globalThis);
