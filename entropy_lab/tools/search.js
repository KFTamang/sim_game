// hill-climb: node tools/search.js <stage> <materialId|0=both> [iters]
const E = require('../js/solver.js'), { STAGES } = require('../js/stages.js');
const st = STAGES[+process.argv[2] - 1], P = E.makeProblem(st);
const only = +process.argv[3] || 0, iters = +process.argv[4] || 200;
let seed = 5; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const free = []; for (let i = 0; i < P.n; i++) if (P.build[i]) free.push(i);
const mats = only ? [only] : st.tools;
function randomDesign() {
  const m = new Uint8Array(P.n);
  for (let guard = 0; guard < 400; guard++) {
    const c = free[(rnd() * free.length) | 0], id = mats[(rnd() * mats.length) | 0];
    if (m[c] || E.costOf(m) + E.COST_OF[id] > st.budget) continue; m[c] = id;
  }
  return m;
}
const score = (m) => { const r = E.simulate(P, m, { full: true, tmax: 200 }); return Number.isFinite(r.t90) ? r.t90 : 1000 - r.final * 500; };
let best = randomDesign(), bs = score(best);
for (let it = 0; it < iters; it++) {
  const m = Uint8Array.from(best);
  const k = 1 + ((rnd() * 4) | 0);
  for (let j = 0; j < k; j++) {
    const act = rnd();
    if (act < 0.5) { const idx = []; for (let i = 0; i < P.n; i++) if (m[i]) idx.push(i); if (idx.length) m[idx[(rnd() * idx.length) | 0]] = 0; }
    const c = free[(rnd() * free.length) | 0], id = mats[(rnd() * mats.length) | 0];
    if (!m[c] && E.costOf(m) + E.COST_OF[id] <= st.budget) m[c] = id;
    else if (act < 0.2) { /* nothing */ }
  }
  const s = score(m);
  if (s <= bs) { best = m; bs = s; }
}
console.log('best', bs, 'cost', E.costOf(best));
for (let y = 0; y < P.h; y++) { let row = ''; for (let x = 0; x < P.w; x++) row += P.fixed[y * P.w + x] ? '#' : best[y * P.w + x] === 1 ? 'm' : best[y * P.w + x] === 2 ? 'r' : '.'; console.log(row); }
