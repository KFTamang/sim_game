/*
 * solver.js — Entropy Lab: a gas of independent particles in a 2-D box.
 *
 * Every particle has the same speed. The gas starts as a narrow, almost parallel beam (a very
 * ordered, low-entropy state). The player paints scatterers. We watch the *coarse-grained*
 * entropy  S = -sum p ln p  over bins of (position cell x direction), normalised so that
 * 100 % is the entropy of a gas spread evenly over everything.
 *
 *   MIRROR (1): specular reflection. Deterministic and exactly time-reversible.
 *   ROUGH  (2): diffuse reflection (Lambert's cosine law): the particle forgets where it came
 *               from. Random, so it cannot be undone.
 *
 * Score: how fast S reaches 90 % of the equilibrium value.
 */
(function (root) {
  'use strict';

  const MIRROR = 1, ROUGH = 2;
  const COST_OF = [0, 1, 3];
  const DT = 0.25;            // time step
  const SPEED = 2;            // cells per time unit (step = SPEED*DT = 0.5 cell < 1, so no tunnelling)
  const NP = 1000;            // particles
  const GX = 6, GY = 4, GA = 8;   // entropy bins: position cells (GX x GY) x direction bins
  const TMAX = 400;           // give up after this much time
  const FRAC = 0.9;           // "equilibrated" = 90 % of the equilibrium entropy
  const SEED = 12345;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeProblem(st) {
    const { w, h } = st;
    const fixed = new Uint8Array(w * h);
    for (const r of st.walls || []) for (let y = r[1]; y <= r[3]; y++) for (let x = r[0]; x <= r[2]; x++) fixed[y * w + x] = MIRROR;
    const build = new Uint8Array(w * h);
    const b = st.build;
    for (let y = b[1]; y <= b[3]; y++) for (let x = b[0]; x <= b[2]; x++) if (!fixed[y * w + x]) build[y * w + x] = 1;
    const P = { st, w, h, n: w * h, fixed, build, seq: 0 };
    P.seq = equilibriumEntropy(P);
    return P;
  }

  // ---- binning
  function binOf(P, x, y, vx, vy) {
    let gx = Math.floor((x / P.w) * GX), gy = Math.floor((y / P.h) * GY);
    if (gx < 0) gx = 0; else if (gx >= GX) gx = GX - 1;
    if (gy < 0) gy = 0; else if (gy >= GY) gy = GY - 1;
    let a = Math.floor(((Math.atan2(vy, vx) + Math.PI) / (2 * Math.PI)) * GA);
    if (a >= GA) a = GA - 1; else if (a < 0) a = 0;
    return (gy * GX + gx) * GA + a;
  }
  function entropyOf(P, px, py, pvx, pvy) {
    const cnt = new Float64Array(GX * GY * GA);
    const n = px.length;
    for (let i = 0; i < n; i++) cnt[binOf(P, px[i], py[i], pvx[i], pvy[i])]++;
    let s = 0;
    for (let k = 0; k < cnt.length; k++) if (cnt[k] > 0) { const p = cnt[k] / n; s -= p * Math.log(p); }
    return s;
  }
  // Entropy of NP particles drawn from the true equilibrium (uniform over free cells and angles):
  // includes the small bias of a finite sample, so 100 % is really "fully mixed".
  function equilibriumEntropy(P) {
    const free = [];
    for (let i = 0; i < P.n; i++) if (!P.fixed[i]) free.push(i);
    let tot = 0;
    for (let rep = 0; rep < 4; rep++) {
      const rnd = mulberry32(777 + rep);
      const px = new Float64Array(NP), py = new Float64Array(NP), vx = new Float64Array(NP), vy = new Float64Array(NP);
      for (let i = 0; i < NP; i++) {
        const c = free[(rnd() * free.length) | 0];
        px[i] = (c % P.w) + rnd(); py[i] = ((c / P.w) | 0) + rnd();
        const a = rnd() * 2 * Math.PI; vx[i] = Math.cos(a); vy[i] = Math.sin(a);
      }
      tot += entropyOf(P, px, py, vx, vy);
    }
    return tot / 4;
  }

  // ---- state
  function initState(P) {
    const st = P.st, rnd = mulberry32(SEED);
    const s = { P, t: 0, rnd, px: new Float64Array(NP), py: new Float64Array(NP), vx: new Float64Array(NP), vy: new Float64Array(NP) };
    const [x0, y0, x1, y1] = st.source;
    for (let i = 0; i < NP; i++) {
      s.px[i] = x0 + rnd() * (x1 - x0 + 1);
      s.py[i] = y0 + rnd() * (y1 - y0 + 1);
      const a = st.angle + (rnd() + rnd() + rnd() - 1.5) * 0.04;
      s.vx[i] = Math.cos(a); s.vy[i] = Math.sin(a);
    }
    return s;
  }

  function solidAt(P, mat, x, y) {
    const cx = Math.floor(x), cy = Math.floor(y);
    if (cx < 0 || cy < 0 || cx >= P.w || cy >= P.h) return MIRROR;
    const i = cy * P.w + cx;
    return P.fixed[i] || mat[i];
  }

  // Surface normals. A pixel staircase would only ever reflect along the two axes, so a particle
  // could never get a new direction. Instead the outward normal of a solid cell is the direction
  // away from the (blurred) solid mass around it: a disc of cells then reflects like a round
  // mirror and a diagonal line like a 45-degree mirror.
  const STEP = SPEED * DT;
  const R = 3;
  function prepare(P, mat) {
    const w = P.w, h = P.h, nxA = new Float32Array(P.n), nyA = new Float32Array(P.n), kind = new Uint8Array(P.n);
    const sol = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 1 : (P.fixed[y * w + x] || mat[y * w + x] ? 1 : 0));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, m = P.fixed[i] || mat[i];
      if (!m) continue;
      kind[i] = m;
      let gx = 0, gy = 0;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        if (!dx && !dy) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 > R * R + 1) continue;
        if (sol(x + dx, y + dy)) { const wgt = 1 / d2; gx += dx * wgt; gy += dy * wgt; }
      }
      const L = Math.hypot(gx, gy);
      if (L > 0.35) { nxA[i] = -gx / L; nyA[i] = -gy / L; } else { nxA[i] = 0; nyA[i] = 0; }   // 0 => isolated: radial from the cell centre
    }
    return { nxA, nyA, kind };
  }

  function advance(s, mat, steps) {
    const P = s.P, { px, py, vx, vy } = s;
    if (!s.prep || s.prepMat !== mat) { s.prep = prepare(P, mat); s.prepMat = mat; }
    const { nxA, nyA } = s.prep;
    const w = P.w, h = P.h;
    for (let k = 0; k < steps; k++) {
      for (let i = 0; i < NP; i++) {
        const nx = px[i] + vx[i] * STEP, ny = py[i] + vy[i] * STEP;
        const cx = Math.floor(nx), cy = Math.floor(ny);
        let m, ci = -1;
        if (cx < 0 || cy < 0 || cx >= w || cy >= h) m = MIRROR; else { ci = cy * w + cx; m = P.fixed[ci] || mat[ci]; }
        if (!m) { px[i] = nx; py[i] = ny; continue; }
        // outward normal at the surface that was hit
        let ox, oy;
        if (ci < 0) {   // outside the box: axis-aligned
          ox = cx < 0 ? 1 : cx >= w ? -1 : 0; oy = cy < 0 ? 1 : cy >= h ? -1 : 0;
        } else {
          ox = nxA[ci]; oy = nyA[ci];
          if (ox === 0 && oy === 0) { ox = px[i] - (cx + 0.5); oy = py[i] - (cy + 0.5); const L0 = Math.hypot(ox, oy) || 1; ox /= L0; oy /= L0; }
        }
        const L = Math.hypot(ox, oy) || 1; ox /= L; oy /= L;
        if (m === ROUGH) diffuse(s, i, ox, oy);
        else {
          const dot = vx[i] * ox + vy[i] * oy;
          if (dot < 0) { vx[i] -= 2 * dot * ox; vy[i] -= 2 * dot * oy; }
          else { vx[i] = -vx[i]; vy[i] = -vy[i]; }   // grazing from inside a jagged spot: just turn round
        }
      }
      s.t += DT;
    }
  }

  // diffuse re-emission around the outward normal (nx, ny), Lambert cosine law
  function diffuse(s, i, nx, ny) {
    const u = s.rnd() * 2 - 1;                 // sin(theta) uniform => cosine-law distribution
    const c = Math.sqrt(1 - u * u);
    s.vx[i] = nx * c - ny * u;
    s.vy[i] = ny * c + nx * u;
  }

  const entropyNow = (s) => entropyOf(s.P, s.px, s.py, s.vx, s.vy) / s.P.seq;
  function reverse(s) { for (let i = 0; i < NP; i++) { s.vx[i] = -s.vx[i]; s.vy[i] = -s.vy[i]; } }

  // run the whole experiment; returns the entropy curve (1 sample per time unit) and t90
  function simulate(P, mat, opts) {
    opts = opts || {};
    const tmax = opts.tmax || TMAX;
    const s = initState(P);
    const series = [entropyNow(s)];
    let t90 = Infinity;
    const per = Math.round(1 / DT);
    for (let t = 1; t <= tmax; t++) {
      advance(s, mat, per);
      const e = entropyNow(s);
      series.push(e);
      if (e >= FRAC && t90 === Infinity) { t90 = t; if (!opts.full) break; }
    }
    return { t90, series, final: series[series.length - 1] };
  }

  function costOf(mat) { let c = 0; for (let i = 0; i < mat.length; i++) c += COST_OF[mat[i]]; return c; }

  function scoreOf(P, t90) {
    if (!Number.isFinite(t90)) return 0;
    return Math.round((1000 * P.st.tRef) / t90);
  }

  const api = { MIRROR, ROUGH, COST_OF, DT, NP, GX, GY, GA, TMAX, FRAC, makeProblem, initState, advance, entropyNow, reverse, simulate, costOf, scoreOf, solidAt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Entropy = api;
})(typeof window !== 'undefined' ? window : globalThis);
