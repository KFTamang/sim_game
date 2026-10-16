// hill-climbing to see what scores are reachable: node tools/search.js <stage id> [iters]
const C = require('../js/solver.js');
const { STAGES } = require('../js/stages.js');
const st = STAGES[(+process.argv[2] || 1) - 1];
const iters = +process.argv[3] || 800;
const P = C.makeProblem(st);
const N = st.w * st.h;
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
function evalMat(m) { const r = C.simulate(P, m); const cost = C.costOf(m); return { r, cost, s: C.scoreOf(r, cost, st.budget) }; }
function fitness(e) { return e.s > 0 ? e.s : -1 - e.r.peakG / 100 - Math.max(0, e.cost - st.budget) / 100; }
let best = new Uint8Array(N);
for (let j = 3; j < 7; j++) for (let i = 0; i < st.w; i++) best[j * st.w + i] = 2;
let be = evalMat(best), bf = fitness(be);
for (let it = 0; it < iters; it++) {
  const m = best.slice();
  const nmut = 1 + Math.floor(rnd() * 6);
  for (let q = 0; q < nmut; q++) {
    const x = Math.floor(rnd() * st.w), y = Math.floor(rnd() * st.h), t = Math.floor(rnd() * 4);
    const bw = 1 + Math.floor(rnd() * 3);
    for (let dx = 0; dx < bw; dx++) if (x + dx < st.w) m[y * st.w + x + dx] = t;
  }
  const e = evalMat(m), f = fitness(e);
  if (f >= bf) { best = m; bf = f; be = e; if (it % 5 === 0 || true) process.stdout.write(`it ${it} score ${be.s} peak ${be.r.peakG.toFixed(1)} cost ${be.cost} eta ${be.r.eta.toFixed(2)}\n`); }
}
console.log(`final score ${be.s} peak ${be.r.peakG.toFixed(1)} cost ${be.cost}`);
for (let j = 0; j < st.h; j++) console.log(Array.from(best.slice(j * st.w, (j + 1) * st.w)).map((v) => ' .acs'[v === 0 ? 0 : v === 1 ? 2 : v === 2 ? 3 : 4] || '.').join(''));
