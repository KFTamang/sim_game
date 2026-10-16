/*
 * solver.js — steady-state 2D heat conduction on a cell grid.
 *
 *     div( k grad T ) = -q          (T = 0 on the heat-sink edges, other edges insulated)
 *
 * Finite volumes on unit cells. The conductance between two cells is the harmonic
 * mean of their conductivities, a sink edge is half a cell away from the cell centre.
 * The linear system is symmetric positive definite -> Jacobi-preconditioned CG,
 * warm-started from the previous temperature field so painting stays interactive.
 *
 * Works in the browser (window.Heat) and in node (module.exports).
 */
(function (root) {
  'use strict';

  // material ids used in the grid
  const MATS = [
    { id: 0, key: 'resin', label: '樹脂', k: 1, cost: 0 },
    { id: 1, key: 'al', label: 'アルミ', k: 100, cost: 1 },
    { id: 2, key: 'cu', label: '銅', k: 250, cost: 3 },
    { id: 9, key: 'void', label: '断熱(穴)', k: 0.02, cost: 0 },
  ];
  const K_OF = new Float64Array(10);
  const COST_OF = new Float64Array(10);
  MATS.forEach((m) => { K_OF[m.id] = m.k; COST_OF[m.id] = m.cost; });
  const VOID = 9;

  /**
   * stage: { w, h, heat?(x,y)->q, obstacles?:[[x0,y0,x1,y1]], sinks:[{side,from,to}] }
   * side: 'bottom' | 'top' | 'left' | 'right'  (from/to: inclusive cell index along that edge)
   */
  function makeProblem(stage) {
    const w = stage.w, h = stage.h, n = w * h;
    const q = new Float64Array(n);
    const obstacle = new Uint8Array(n);
    const sink = new Uint8Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) q[y * w + x] = stage.heat ? stage.heat(x, y) : 1;
    }
    (stage.obstacles || []).forEach(([x0, y0, x1, y1]) => {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) { obstacle[y * w + x] = 1; q[y * w + x] = 0; }
      }
    });
    stage.sinks.forEach((s) => {
      for (let t = s.from; t <= s.to; t++) {
        let x, y;
        if (s.side === 'bottom') { x = t; y = h - 1; }
        else if (s.side === 'top') { x = t; y = 0; }
        else if (s.side === 'left') { x = 0; y = t; }
        else { x = w - 1; y = t; }
        sink[y * w + x] = 1;
      }
    });
    let totalQ = 0;
    for (let i = 0; i < n; i++) totalQ += q[i];
    return { w, h, n, q, obstacle, sink, totalQ };
  }

  /** conductances for a material grid */
  function assemble(P, mat) {
    const { w, h, n } = P;
    const k = new Float64Array(n);
    for (let i = 0; i < n; i++) k[i] = K_OF[P.obstacle[i] ? VOID : mat[i]];
    const gR = new Float64Array(n), gD = new Float64Array(n), diag = new Float64Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (x < w - 1) gR[i] = (2 * k[i] * k[i + 1]) / (k[i] + k[i + 1]);
        if (y < h - 1) gD[i] = (2 * k[i] * k[i + w]) / (k[i] + k[i + w]);
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let d = gR[i] + gD[i];
        if (x > 0) d += gR[i - 1];
        if (y > 0) d += gD[i - w];
        if (P.sink[i]) d += 2 * k[i];
        diag[i] = d;
      }
    }
    return { k, gR, gD, diag };
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

  /** Jacobi-PCG. T is the warm start and is updated in place. */
  function solve(P, A, T, opts) {
    const tol = (opts && opts.tol) || 1e-7;
    const maxIter = (opts && opts.maxIter) || 4000;
    const n = P.n;
    const r = new Float64Array(n), z = new Float64Array(n), p = new Float64Array(n), Ap = new Float64Array(n);
    applyA(P, A, T, Ap);
    let bnorm = 0;
    for (let i = 0; i < n; i++) { r[i] = P.q[i] - Ap[i]; bnorm += P.q[i] * P.q[i]; }
    bnorm = Math.sqrt(bnorm) || 1;
    let rz = 0;
    for (let i = 0; i < n; i++) { z[i] = r[i] / A.diag[i]; p[i] = z[i]; rz += r[i] * z[i]; }
    let it = 0, res = 0;
    for (; it < maxIter; it++) {
      let rn = 0;
      for (let i = 0; i < n; i++) rn += r[i] * r[i];
      res = Math.sqrt(rn) / bnorm;
      if (res < tol) break;
      applyA(P, A, p, Ap);
      let pAp = 0;
      for (let i = 0; i < n; i++) pAp += p[i] * Ap[i];
      const alpha = rz / pAp;
      let rzNew = 0;
      for (let i = 0; i < n; i++) {
        T[i] += alpha * p[i];
        r[i] -= alpha * Ap[i];
        z[i] = r[i] / A.diag[i];
        rzNew += r[i] * z[i];
      }
      const beta = rzNew / rz;
      rz = rzNew;
      for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
    }
    return { iters: it, residual: res };
  }

  /** heat leaving through the sink edges (should equal total generation) */
  function sinkFlow(P, A, T) {
    let s = 0;
    for (let i = 0; i < P.n; i++) if (P.sink[i]) s += 2 * A.k[i] * T[i];
    return s;
  }

  /** per-cell heat-flux vector (units: heat per unit length); +x right, +y down */
  function fluxField(P, A, T) {
    const { w, h, n } = P;
    const fx = new Float32Array(n), fy = new Float32Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let a = 0, b = 0;
        if (x < w - 1) a += A.gR[i] * (T[i] - T[i + 1]);
        if (x > 0) a += A.gR[i - 1] * (T[i - 1] - T[i]);
        if (y < h - 1) b += A.gD[i] * (T[i] - T[i + w]);
        if (y > 0) b += A.gD[i - w] * (T[i - w] - T[i]);
        fx[i] = a * 0.5; fy[i] = b * 0.5;
      }
    }
    return { fx, fy };
  }

  /** which high-conductivity cells are connected (4-neighbour) to a sink edge */
  function connectedToSink(P, mat) {
    const { w, h, n } = P;
    const conn = new Uint8Array(n);
    const stack = [];
    for (let i = 0; i < n; i++) {
      if (P.sink[i] && (mat[i] === 1 || mat[i] === 2) && !P.obstacle[i]) { conn[i] = 1; stack.push(i); }
    }
    while (stack.length) {
      const i = stack.pop();
      const x = i % w, y = (i / w) | 0;
      const nb = [];
      if (x > 0) nb.push(i - 1);
      if (x < w - 1) nb.push(i + 1);
      if (y > 0) nb.push(i - w);
      if (y < h - 1) nb.push(i + w);
      for (const j of nb) {
        if (!conn[j] && (mat[j] === 1 || mat[j] === 2) && !P.obstacle[j]) { conn[j] = 1; stack.push(j); }
      }
    }
    return conn;
  }

  function costOf(mat) {
    let c = 0;
    for (let i = 0; i < mat.length; i++) c += COST_OF[mat[i]];
    return c;
  }

  /** temperature field with no added material (the "before" picture) */
  function reference(P) {
    const mat = new Uint8Array(P.n);
    const A = assemble(P, mat);
    const T = new Float64Array(P.n);
    solve(P, A, T, { tol: 1e-9, maxIter: 20000 });
    return summarize(P, T);
  }

  function summarize(P, T) {
    let tmax = -Infinity, hot = -1, sum = 0, wsum = 0;
    for (let i = 0; i < P.n; i++) {
      if (P.obstacle[i]) continue;
      if (T[i] > tmax) { tmax = T[i]; hot = i; }
      sum += T[i] * P.q[i]; wsum += P.q[i];
    }
    return { tmax, hot, tmean: wsum ? sum / wsum : 0 };
  }

  /** full evaluation of a design */
  function evaluate(P, mat, T, opts) {
    const A = assemble(P, mat);
    const info = solve(P, A, T, opts);
    const s = summarize(P, T);
    return { A, T, ...s, ...info, cost: costOf(mat) };
  }

  const api = { MATS, K_OF, COST_OF, VOID, makeProblem, assemble, solve, sinkFlow, fluxField,
    connectedToSink, costOf, reference, summarize, evaluate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Heat = api;
})(typeof window !== 'undefined' ? window : globalThis);
