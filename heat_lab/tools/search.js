// node tools/search.js <stageIndex> <budget> [iters]
// Stochastic local search (move low-flux material to the hottest frontier) — an upper-ish
// bound on what a careful player can reach. Used only to calibrate budgets/targets.
const H = require('../js/solver.js');
const { STAGES } = require('../js/stages.js');
const st = STAGES[+process.argv[2]];
const budget = +process.argv[3];
const iters = +(process.argv[4] || 300);
const P = H.makeProblem(st), ref = H.reference(P);
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const nb = (i) => { const x = i % P.w, y = (i / P.w) | 0, o = []; if (x > 0) o.push(i - 1); if (x < P.w - 1) o.push(i + 1); if (y > 0) o.push(i - P.w); if (y < P.h - 1) o.push(i + P.w); return o; };
let mat = new Uint8Array(P.n), T = new Float64Array(P.n);
// start: straight trunk from the sink toward the centre
const sinkCells = []; for (let i = 0; i < P.n; i++) if (P.sink[i]) sinkCells.push(i);
let cost = 0;
let frontier = (m) => { const f = []; for (let i = 0; i < P.n; i++) { if (m[i] || P.obstacle[i]) continue; if (P.sink[i] || nb(i).some((j) => m[j])) f.push(i); } return f; };
// initial greedy fill with random hot-biased growth
let res = H.evaluate(P, mat, T, { tol: 1e-6 });
while (cost < budget) {
  const f = frontier(mat); if (!f.length) break;
  f.sort((a, b) => T[b] - T[a]);
  const pick = f[Math.floor(Math.pow(rnd(), 3) * Math.min(f.length, 8))];
  mat[pick] = 1; cost++; res = H.evaluate(P, mat, T, { tol: 1e-6 });
}
let best = res.tmax;
for (let it = 0; it < iters; it++) {
  const m2 = Uint8Array.from(mat);
  const k = 1 + Math.floor(rnd() * 4);
  // remove cells that are "leaf-like" with low temperature relative neighbours, random choice among cold ones
  const mats = []; for (let i = 0; i < P.n; i++) if (m2[i]) mats.push(i);
  const A = H.assemble(P, mat); const F = H.fluxField(P, A, T);
  mats.sort((a, b) => Math.hypot(F.fx[a], F.fy[a]) - Math.hypot(F.fx[b], F.fy[b]));
  for (let r = 0; r < k; r++) { const c = mats[Math.floor(rnd() * Math.min(mats.length, 12))]; m2[c] = 0; }
  let removed = 0; for (let i = 0; i < P.n; i++) if (mat[i] && !m2[i]) removed++;
  for (let r = 0; r < removed; r++) {
    const f = frontier(m2); if (!f.length) break;
    f.sort((a, b) => T[b] - T[a]);
    m2[f[Math.floor(Math.pow(rnd(), 2) * Math.min(f.length, 10))]] = 1;
  }
  const T2 = Float64Array.from(T);
  const r2 = H.evaluate(P, m2, T2, { tol: 1e-6 });
  if (r2.tmax < best) { best = r2.tmax; mat = m2; T = T2; }
}
console.log(`stage ${st.id} budget ${budget}: factor x${(ref.tmax / best).toFixed(2)} (ref ${ref.tmax.toFixed(0)} -> ${best.toFixed(0)})`);
const rows = []; for (let y = 0; y < P.h; y++) { let s = ''; for (let x = 0; x < P.w; x++) s += P.obstacle[y * P.w + x] ? '#' : mat[y * P.w + x] ? 'o' : '.'; rows.push(s); }
if (process.argv[5]) console.log(rows.join('\n'));
