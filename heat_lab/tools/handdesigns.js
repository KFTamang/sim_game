// node tools/handdesigns.js — evaluates hand-made comb/strip designs per stage; used to set budgets and targets.
const H = require('../js/solver.js');
const { STAGES } = require('../js/stages.js');
function mk(si) { const st = STAGES[si]; const P = H.makeProblem(st); return { st, P, ref: H.reference(P) }; }
function ev(c, mat) { const T = new Float64Array(c.P.n); const r = H.evaluate(c.P, mat, T, { tol: 1e-8 }); return `cost ${r.cost} x${(c.ref.tmax / r.tmax).toFixed(1)} eff ${(((c.ref.tmax / r.tmax) - 1) / r.cost * 10000).toFixed(0)}`; }
const rect = (mat, w, x0, y0, x1, y1, id, P) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!P.obstacle[y * w + x]) mat[y * w + x] = id; };

// stage 1 mixes
{ const c = mk(0), w = 40;
  for (const [tw, id] of [[2, 1], [3, 1], [4, 1], [2, 2], [3, 2]]) for (const sp of [13, 20]) { const m = new Uint8Array(c.P.n);
    rect(m, w, 20 - (tw >> 1), 0, 20 - (tw >> 1) + tw - 1, 39, id, c.P);
    for (let y = 38; y >= 0; y -= sp) rect(m, w, 0, y, 39, y, 1, c.P);
    console.log(`S1 trunk${tw} mat${id} sp${sp}:`, ev(c, m)); } }
// stage 2: bottom trunk + vertical branches
{ const c = mk(1), w = 40;
  for (const [tw, sp] of [[2, 20], [3, 13], [3, 20], [4, 13]]) { const m = new Uint8Array(c.P.n);
    rect(m, w, 0, 40 - tw, 39, 39, 1, c.P);
    for (let x = 39; x >= 0; x -= sp) rect(m, w, x, 0, x, 39, 1, c.P);
    console.log(`S2 trunk${tw} sp${sp}:`, ev(c, m)); } }
// stage 3: plate + strip
{ const c = mk(2), w = 40;
  for (const sw of [1, 2, 3]) for (const pl of [0, 1]) { const m = new Uint8Array(c.P.n);
    if (pl) rect(m, w, 5, 5, 12, 12, 1, c.P);
    rect(m, w, 12, 8, 39, 8 + sw - 1, 1, c.P);
    rect(m, w, 39 - sw + 1, 8, 39, 33, 1, c.P);
    console.log(`S3 strip${sw} plate${pl}:`, ev(c, m)); } }
// stage 4
{ const c = mk(3), w = 44;
  for (const [tw, sp] of [[2, 14], [3, 11]]) { const m = new Uint8Array(c.P.n);
    rect(m, w, 21, 0, 21 + tw - 1, 43, 1, c.P);                    // vertical trunk
    rect(m, w, 0, 36, 21, 36 + tw - 1, 1, c.P);                    // left feed along the bottom gap
    rect(m, w, 21, 5, 43, 5 + tw - 1, 1, c.P);                     // right feed along the top gap
    for (let x = 0; x < 12; x += sp) rect(m, w, x, 30, x, 43, 1, c.P);
    for (let x = 0; x < 12; x += sp) rect(m, w, x, 0, x, 36, 1, c.P);
    for (let x = 30; x < 44; x += sp) rect(m, w, x, 5, x, 43, 1, c.P);
    for (let x = 30; x < 44; x += sp) rect(m, w, x, 0, x, 5, 1, c.P);
    console.log(`S4 trunk${tw} sp${sp}:`, ev(c, m)); } }
