// node tools/calibrate.js [stageIndex]
// Greedy "grow a tree from the sink toward the hottest frontier cell" baseline,
// used to estimate what cooling factor is reachable for a given budget.
const H = require('../js/solver.js');
const { STAGES } = require('../js/stages.js');

function grow(stage, budget, matId, pickMode) {
  const P = H.makeProblem(stage);
  const ref = H.reference(P);
  const mat = new Uint8Array(P.n);
  const T = new Float64Array(P.n);
  const cell = H.COST_OF[matId];
  let cost = 0;
  const nbrs = (i) => {
    const x = i % P.w, y = (i / P.w) | 0, o = [];
    if (x > 0) o.push(i - 1); if (x < P.w - 1) o.push(i + 1);
    if (y > 0) o.push(i - P.w); if (y < P.h - 1) o.push(i + P.w);
    return o;
  };
  let res = H.evaluate(P, mat, T, { tol: 1e-6 });
  while (cost + cell <= budget) {
    // frontier = empty cells touching the sink edge or existing material
    let best = -1, bt = -1;
    for (let i = 0; i < P.n; i++) {
      if (mat[i] || P.obstacle[i]) continue;
      let ok = P.sink[i] && !pickMode.noSink;
      if (!ok) for (const j of nbrs(i)) if (mat[j]) { ok = true; break; }
      if (!ok) continue;
      // score: temperature of the frontier cell (grow toward the hot side)
      const sc = T[i];
      if (sc > bt) { bt = sc; best = i; }
    }
    if (best < 0) break;
    mat[best] = matId; cost += cell;
    res = H.evaluate(P, mat, T, { tol: 1e-6 });
  }
  return { factor: ref.tmax / res.tmax, cost, ref: ref.tmax, tmax: res.tmax, mat, P };
}

const only = process.argv[2] ? [STAGES[+process.argv[2]]] : STAGES;
for (const st of only) {
  const out = [];
  for (const frac of [0.5, 0.75, 1]) {
    const r = grow(st, Math.round(st.budget * frac), 1, {});
    out.push(`budget ${Math.round(st.budget * frac)} -> x${r.factor.toFixed(2)}`);
  }
  console.log(`stage ${st.id} ${st.name} (target x${st.target}, budget ${st.budget}):`, out.join(' | '));
}
