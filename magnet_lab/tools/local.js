// local search from a hand design: node tools/local.js <iters>
const M = require('../js/solver.js');
const st = { w: 40, h: 30, tools: [1], fixed: [[4, 9, 8, 20, 2]], zone: [20, 12, 21, 17], build: [1, 1, 38, 28] };
const P = M.makeProblem(st);
const budget = +process.argv[3] || 220;
function rect(m, x0, y0, x1, y1, v = 1) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!P.fixed[y * P.w + x]) m[y * P.w + x] = v; }
let best = new Uint8Array(P.n);
rect(best, 9, 12, 19, 17); rect(best, 22, 12, 25, 17); rect(best, 23, 18, 25, 23); rect(best, 2, 22, 25, 23); rect(best, 2, 21, 3, 21);
const ev = (m) => { const r = M.solve(P, m); return { B: r.bzone, cost: M.costOf(P, m) }; };
let be = ev(best);
let seed = 3; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const [bx0, by0, bx1, by1] = st.build;
for (let it = 0; it < (+process.argv[2] || 800); it++) {
  const m = best.slice();
  const k = 1 + Math.floor(rnd() * 3);
  for (let q = 0; q < k; q++) {
    const x = bx0 + Math.floor(rnd() * (bx1 - bx0 + 1)), y = by0 + Math.floor(rnd() * (by1 - by0 + 1));
    if (P.fixed[y * P.w + x]) continue;
    m[y * P.w + x] ^= 1;
  }
  const e = ev(m);
  if (e.cost <= budget && e.B >= be.B) { best = m; be = e; }
}
console.log('B', be.B.toFixed(3), 'cost', be.cost);
for (let y = 0; y < P.h; y++) { let r = ''; for (let x = 0; x < P.w; x++) { const i = y * P.w + x; r += P.fixed[i] ? (P.fmat[i] ? 'M' : (st.zone && i % P.w >= 20 && i % P.w <= 21 && (i / P.w | 0) >= 12 && (i / P.w | 0) <= 17 ? 'z' : ' ')) : (best[i] ? '#' : '.'); } console.log(r); }
