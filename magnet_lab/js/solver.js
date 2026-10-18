/*
 * solver.js — 2D magnetostatics on a cell grid (out-of-plane vector potential A).
 *
 *   B = ( -dA/dy , dA/dx )  (screen axes: x right, y DOWN)
 *   -div( nu grad A ) = div( nu * (-Bry, Brx) )        nu = 1/(mu0 mu_r) normalised so air = 1
 *
 * Br is the remanent flux density of permanent-magnet cells. Iron is nonlinear:
 *   H(B) = B/(mu0 mu_r0) + Hs (B/Bs)^q      (saturates around Bs ~ 1.6 T)
 * solved by damped successive substitution; each linear step is a Jacobi-PCG with warm start.
 * The outer box is a flux-parallel boundary (A prescribed), optionally carrying a uniform
 * external field. Units: B in tesla, A in tesla * cell.
 *
 * Works in the browser (window.Mag) and in node (module.exports).
 */
(function (root) {
  'use strict';

  const AIR = 0, IRON = 1, MAG_R = 2, MAG_L = 3, MAG_D = 4, MAG_U = 5;  // magnets: direction of magnetisation on screen
  const MATS = [
    { id: AIR, key: 'air', label: '空気', cost: 0 },
    { id: IRON, key: 'iron', label: '軟鉄', cost: 1 },
    { id: MAG_R, key: 'magR', label: '磁石 →', cost: 4, dir: [1, 0] },
    { id: MAG_L, key: 'magL', label: '磁石 ←', cost: 4, dir: [-1, 0] },
    { id: MAG_U, key: 'magU', label: '磁石 ↑', cost: 4, dir: [0, -1] },
    { id: MAG_D, key: 'magD', label: '磁石 ↓', cost: 4, dir: [0, 1] },
  ];
  const COST_OF = new Float64Array(8);
  MATS.forEach((m) => { COST_OF[m.id] = m.cost; });
  const isMag = (m) => m >= MAG_R;

  const BR = 1.2;          // remanence of the permanent magnets [T]
  const MU_MAG = 1.05;     // magnet relative permeability
  const MU_R0 = 800;       // iron initial relative permeability
  const BS = 1.6;          // iron saturation knee [T]
  const HS = 0.010;        // mu0 * Hs [T]
  const QSAT = 10;

  // beyond the knee BK (where the differential permeability reaches that of air) iron behaves like air
  const BK = BS * Math.pow((1 - 1 / MU_R0) * BS / (HS * QSAT), 1 / (QSAT - 1));
  const H_BK = BK / MU_R0 + HS * Math.pow(BK / BS, QSAT);
  const nuIron = (B) => (B <= BK ? 1 / MU_R0 + (HS / BS) * Math.pow(B / BS, QSAT - 1) : (H_BK + (B - BK)) / B);

  /**
   * stage: { w, h, fixed?: [[x0,y0,x1,y1,mat]], ext?: [Bx,By], zone:[x0,y0,x1,y1] }
   * `fixed` cells cannot be edited by the player.
   */
  function makeProblem(stage) {
    const w = stage.w, h = stage.h, n = w * h;
    const fixed = new Uint8Array(n), fmat = new Uint8Array(n);
    (stage.fixed || []).forEach(([x0, y0, x1, y1, m]) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { fixed[y * w + x] = 1; fmat[y * w + x] = m; }
    });
    const rect = (r) => { const a = []; for (let y = r[1]; y <= r[3]; y++) for (let x = r[0]; x <= r[2]; x++) a.push(y * w + x); return a; };
    // everything outside the build area, and the measuring zones, cannot be edited
    if (stage.build) {
      const [bx0, by0, bx1, by1] = stage.build;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!(x >= bx0 && x <= bx1 && y >= by0 && y <= by1) && !fixed[y * w + x]) { fixed[y * w + x] = 1; fmat[y * w + x] = AIR; }
      }
    }
    const zone = rect(stage.zone);
    const zone2 = stage.zone2 ? rect(stage.zone2) : [];
    for (const i of zone.concat(zone2)) if (!fixed[i]) { fixed[i] = 1; fmat[i] = AIR; }
    const ext = stage.ext || [0, 0];
    // boundary potential: A = -Bx0*y + By0*x  (cell-centre coordinates, boundary half a cell outside)
    const aB = (x, y) => -ext[0] * y + ext[1] * x;
    return { w, h, n, fixed, fmat, zone: Int32Array.from(zone), zone2: Int32Array.from(zone2), ext, aB, stage };
  }

  /** combined material grid: fixed cells override the player's */
  function merged(P, mat) {
    const m = new Uint8Array(P.n);
    for (let i = 0; i < P.n; i++) m[i] = P.fixed[i] ? P.fmat[i] : mat[i];
    return m;
  }

  function sourceOf(m) {   // Br-vector of a cell in screen axes
    if (m === MAG_R) return [BR, 0];
    if (m === MAG_L) return [-BR, 0];
    if (m === MAG_U) return [0, -BR];
    if (m === MAG_D) return [0, BR];
    return [0, 0];
  }

  /** assemble conductances (harmonic mean of nu) and the right-hand side for the given nu field */
  function assemble(P, M, nu) {
    const { w, h, n } = P;
    const gR = new Float64Array(n), gD = new Float64Array(n), diag = new Float64Array(n), b = new Float64Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (x < w - 1) gR[i] = (2 * nu[i] * nu[i + 1]) / (nu[i] + nu[i + 1]);
        if (y < h - 1) gD[i] = (2 * nu[i] * nu[i + w]) / (nu[i] + nu[i + w]);
      }
    }
    // magnetisation source: Br-perp = (-Bry, Brx). Across a face the tangential H is continuous, which
    // gives a face source of g_face * mean(Br-perp) (g_face = harmonic-mean nu), not nu * mean.
    const Sx = new Float64Array(n), Sy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      if (M[i] >= MAG_R) { const [bx, by] = sourceOf(M[i]); Sx[i] = -by; Sy[i] = bx; }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let d = gR[i] + gD[i];
        if (x > 0) d += gR[i - 1];
        if (y > 0) d += gD[i - w];
        let bb = 0;
        const xe = x < w - 1 ? 0.5 * gR[i] * (Sx[i] + Sx[i + 1]) : nu[i] * Sx[i];
        const xw = x > 0 ? 0.5 * gR[i - 1] * (Sx[i] + Sx[i - 1]) : nu[i] * Sx[i];
        const ys = y < h - 1 ? 0.5 * gD[i] * (Sy[i] + Sy[i + w]) : nu[i] * Sy[i];
        const yn = y > 0 ? 0.5 * gD[i - w] * (Sy[i] + Sy[i - w]) : nu[i] * Sy[i];
        bb = (xe - xw) + (ys - yn);
        // Dirichlet faces (half a cell away)
        if (x === 0) { d += 2 * nu[i]; bb += 2 * nu[i] * P.aB(-0.5, y); }
        if (x === w - 1) { d += 2 * nu[i]; bb += 2 * nu[i] * P.aB(w - 0.5, y); }
        if (y === 0) { d += 2 * nu[i]; bb += 2 * nu[i] * P.aB(x, -0.5); }
        if (y === h - 1) { d += 2 * nu[i]; bb += 2 * nu[i] * P.aB(x, h - 0.5); }
        diag[i] = d; b[i] = bb;
      }
    }
    return { gR, gD, diag, b, nu };
  }

  function applyA(P, A, x, out) {
    const { w, h } = P;
    const { gR, gD, diag } = A;
    for (let y = 0; y < h; y++) {
      for (let c = 0; c < w; c++) {
        const i = y * w + c;
        let s = diag[i] * x[i];
        if (c < w - 1) s -= gR[i] * x[i + 1];
        if (c > 0) s -= gR[i - 1] * x[i - 1];
        if (y < h - 1) s -= gD[i] * x[i + w];
        if (y > 0) s -= gD[i - w] * x[i - w];
        out[i] = s;
      }
    }
  }

  function pcg(P, A, x, tol, maxIter) {
    const n = P.n;
    const r = new Float64Array(n), z = new Float64Array(n), p = new Float64Array(n), Ap = new Float64Array(n);
    applyA(P, A, x, Ap);
    let bn = 0;
    for (let i = 0; i < n; i++) { r[i] = A.b[i] - Ap[i]; bn += A.b[i] * A.b[i]; }
    bn = Math.sqrt(bn) || 1;
    let rz = 0;
    for (let i = 0; i < n; i++) { z[i] = r[i] / A.diag[i]; p[i] = z[i]; rz += r[i] * z[i]; }
    let it = 0, res = 0;
    for (; it < maxIter; it++) {
      let rn = 0;
      for (let i = 0; i < n; i++) rn += r[i] * r[i];
      res = Math.sqrt(rn) / bn;
      if (res < tol) break;
      applyA(P, A, p, Ap);
      let pAp = 0;
      for (let i = 0; i < n; i++) pAp += p[i] * Ap[i];
      const alpha = rz / pAp;
      let rzNew = 0;
      for (let i = 0; i < n; i++) { x[i] += alpha * p[i]; r[i] -= alpha * Ap[i]; z[i] = r[i] / A.diag[i]; rzNew += r[i] * z[i]; }
      const beta = rzNew / rz; rz = rzNew;
      for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
    }
    return { iters: it, residual: res };
  }

  /** flux density at the cell centres (screen axes) */
  function fieldOf(P, A) {
    const { w, h, n } = P;
    const bx = new Float32Array(n), by = new Float32Array(n), bm = new Float32Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const aE = x < w - 1 ? A[i + 1] : P.aB(w - 0.5, y), dE = x < w - 1 ? 1 : 0.5;
        const aW = x > 0 ? A[i - 1] : P.aB(-0.5, y), dW = x > 0 ? 1 : 0.5;
        const aS = y < h - 1 ? A[i + w] : P.aB(x, h - 0.5), dS = y < h - 1 ? 1 : 0.5;
        const aN = y > 0 ? A[i - w] : P.aB(x, -0.5), dN = y > 0 ? 1 : 0.5;
        const dAdx = (aE - aW) / (dE + dW), dAdy = (aS - aN) / (dS + dN);
        bx[i] = -dAdy; by[i] = dAdx; bm[i] = Math.hypot(bx[i], by[i]);
      }
    }
    return { bx, by, bm };
  }

  /**
   * Solve the (nonlinear) problem. state (optional) = { A, nu } from a previous solve (warm start).
   * Returns { A, nu, B:{bx,by,bm}, mat, outer, cg, bzone, ... }.
   */
  function solve(P, mat, state, opts) {
    opts = opts || {};
    const M = merged(P, mat);
    const n = P.n;
    const A = state && state.A ? state.A : new Float64Array(n);
    const nu = state && state.nu ? Float64Array.from(state.nu) : new Float64Array(n);
    const base = new Float64Array(n);
    for (let i = 0; i < n; i++) base[i] = M[i] === IRON ? 0 : (M[i] >= MAG_R ? 1 / MU_MAG : 1);
    const hasIron = M.some((v) => v === IRON);
    // nonlinear iteration is relaxed on |B| (not on nu): nu(B) is extremely steep near saturation
    const Bu = state && state.Bu ? Float64Array.from(state.Bu) : new Float64Array(n).fill(0.2);
    for (let i = 0; i < n; i++) nu[i] = M[i] === IRON ? nuIron(Bu[i]) : base[i];
    let outer = 0, cg = 0, field = null, w = 0.6, prev = Infinity;
    const maxOuter = hasIron ? (opts.maxOuter || 80) : 1;
    for (; outer < maxOuter; outer++) {
      const Asys = assemble(P, M, nu);
      const r = pcg(P, Asys, A, opts.tol || 1e-7, opts.maxIter || 3000);
      cg += r.iters;
      field = fieldOf(P, A);
      if (!hasIron) { outer++; break; }
      let dmax = 0;
      for (let i = 0; i < n; i++) if (M[i] === IRON) dmax = Math.max(dmax, Math.abs(field.bm[i] - Bu[i]));
      if (dmax < (opts.nlTol || 4e-3)) { outer++; break; }
      w = dmax > prev ? Math.max(0.08, w * 0.6) : Math.min(0.8, w * 1.12);
      prev = dmax;
      for (let i = 0; i < n; i++) {
        if (M[i] !== IRON) continue;
        Bu[i] += w * (field.bm[i] - Bu[i]);
        nu[i] = nuIron(Bu[i]);
      }
    }
    field.Bu = Bu;
    return { A, nu, Bu, B: field, mat: M, outer, cg, ...zoneStats(P, field) };
  }

  function zoneStats(P, field) {
    let s = 0, s2 = 0;
    for (let k = 0; k < P.zone.length; k++) s += field.bm[P.zone[k]];
    for (let k = 0; k < P.zone2.length; k++) s2 += field.bm[P.zone2[k]];
    let sat = 0;
    return { bzone: s / P.zone.length, bzone2: P.zone2.length ? s2 / P.zone2.length : 0, sat };
  }

  function costOf(P, mat) {
    let c = 0;
    for (let i = 0; i < mat.length; i++) if (!P.fixed[i]) c += COST_OF[mat[i]];
    return c;
  }

  /** reference field in the zone with nothing added by the player */
  function reference(P) {
    return solve(P, new Uint8Array(P.n), null, { tol: 1e-9 }).bzone;
  }

  /** flux lines: contour levels of A -> list of polylines (cell coordinates, centre = i+0.5) */
  function contours(P, A, levels) {
    const { w, h } = P;
    const out = [];
    for (const L of levels) {
      const segs = [];
      for (let y = 0; y < h - 1; y++) {
        for (let x = 0; x < w - 1; x++) {
          const a = A[y * w + x], b = A[y * w + x + 1], c = A[(y + 1) * w + x + 1], d = A[(y + 1) * w + x];
          let code = 0;
          if (a > L) code |= 1; if (b > L) code |= 2; if (c > L) code |= 4; if (d > L) code |= 8;
          if (code === 0 || code === 15) continue;
          const p = (v0, v1, x0, y0, x1, y1) => { const t = (L - v0) / (v1 - v0); return [x0 + (x1 - x0) * t + 0.5, y0 + (y1 - y0) * t + 0.5]; };
          const top = () => p(a, b, x, y, x + 1, y), right = () => p(b, c, x + 1, y, x + 1, y + 1);
          const bot = () => p(d, c, x, y + 1, x + 1, y + 1), left = () => p(a, d, x, y, x, y + 1);
          switch (code) {
            case 1: case 14: segs.push([left(), top()]); break;
            case 2: case 13: segs.push([top(), right()]); break;
            case 3: case 12: segs.push([left(), right()]); break;
            case 4: case 11: segs.push([right(), bot()]); break;
            case 6: case 9: segs.push([top(), bot()]); break;
            case 7: case 8: segs.push([left(), bot()]); break;
            case 5: segs.push([left(), top()], [right(), bot()]); break;
            case 10: segs.push([top(), right()], [left(), bot()]); break;
            default: break;
          }
        }
      }
      out.push(segs);
    }
    return out;
  }

  /** value of a solution for the stage (gain: tesla; shield: reference / field) */
  function valueOf(stage, sol, ref) {
    return stage.kind === 'shield' ? ref / Math.max(sol.bzone, 1e-9) : sol.bzone;
  }
  function ratioOf(sol) { return sol.bzone2 > 0 ? sol.bzone / Math.max(sol.bzone2, 1e-9) : Infinity; }
  /** null when the design does not qualify; otherwise the score */
  function scoreOf(stage, sol, ref, cost) {
    const v = valueOf(stage, sol, ref);
    if (cost <= 0 || cost > stage.budget || v < stage.target) return null;
    if (stage.minRatio && ratioOf(sol) < stage.minRatio) return null;
    return Math.round(1000 * (v / cost) / stage.scoreRef);
  }

  const api = { valueOf, ratioOf, scoreOf, MATS, COST_OF, isMag, BR, BS, MU_R0, AIR, IRON, MAG_R, MAG_L, MAG_U, MAG_D,
    makeProblem, merged, assemble, solve, fieldOf, zoneStats, costOf, reference, contours };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Mag = api;
})(typeof window !== 'undefined' ? window : globalThis);
