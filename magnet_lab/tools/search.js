// hill climbing: node tools/search.js <stage> [iters]
const M = require('../js/solver.js');
const { STAGES } = require('../js/stages.js');
const st = STAGES[(+process.argv[2] || 1) - 1];
const iters = +process.argv[3] || 600;
const P = M.makeProblem(st);
const ref = st.kind === 'shield' ? M.reference(P) : 0;
let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
function value(r) { return st.kind === 'shield' ? ref / r.bzone : r.bzone; }
function ev(m) {
  const r = M.solve(P, m), cost = M.costOf(P, m), v = value(r);
  let ok = v >= st.target && cost <= st.budget && cost > 0;
  if (st.minRatio) ok = ok && r.bzone / Math.max(r.bzone2, 1e-9) >= st.minRatio;
  return { r, cost, v, ok, s: ok ? v / cost : 0 };
}
const fit = (e) => (e.ok ? 1 + e.s : (e.cost > st.budget ? -1 : 0) + e.v / st.target * 0.5 - Math.max(0, e.cost - st.budget) / 1000);
let best = new Uint8Array(P.n);
const [bx0, by0, bx1, by1] = st.build;
let be = ev(best), bf = fit(be);
const tools = st.tools;
for (let it = 0; it < iters; it++) {
  const m = best.slice();
  const nm = 1 + Math.floor(rnd() * 8);
  for (let q = 0; q < nm; q++) {
    const x = bx0 + Math.floor(rnd() * (bx1 - bx0 + 1)), y = by0 + Math.floor(rnd() * (by1 - by0 + 1));
    const t = rnd() < 0.35 ? 0 : tools[Math.floor(rnd() * tools.length)];
    const bw = 1 + Math.floor(rnd() * 4), bh = 1 + Math.floor(rnd() * 4);
    for (let dy = 0; dy < bh; dy++) for (let dx = 0; dx < bw; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx > bx1 || yy > by1 || P.fixed[yy * P.w + xx]) continue;
      m[yy * P.w + xx] = t;
    }
  }
  const e = ev(m), f = fit(e);
  if (f >= bf) { best = m; bf = f; be = e; }
}
console.log(`stage ${st.id} v=${be.v.toFixed(3)} cost=${be.cost} ok=${be.ok} ratio=${(be.r.bzone / Math.max(be.r.bzone2, 1e-9)).toFixed(2)} v/cost=${(be.v / be.cost).toFixed(5)}`);
const ch = '.#>< v^'.split('');   // 0 air,1 iron,2 R,3 L,4 D,5 U
const chars = ['.', '#', '>', '<', 'v', '^'];
for (let y = 0; y < P.h; y++) { let row = ''; for (let x = 0; x < P.w; x++) { const i = y * P.w + x; row += P.fixed[i] ? (P.fmat[i] ? 'M' : (st.zone && false ? 'z' : ' ')) : chars[best[i]]; } console.log(row); }
