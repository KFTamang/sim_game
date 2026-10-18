const M = require('../js/solver.js');
const { STAGES } = require('../js/stages.js');
const st = STAGES[3];
const P = M.makeProblem(st);
const [bx0, by0, bx1, by1] = st.build;
function run(name, fn) { const m = new Uint8Array(P.n); fn(m); const r = M.solve(P, m); console.log(name.padEnd(34), 'cost', M.costOf(P, m), 'top', r.bzone.toFixed(3), 'bottom', r.bzone2.toFixed(3), 'ratio', (r.bzone / r.bzone2).toFixed(2), 'v/cost', (r.bzone / M.costOf(P, m)).toFixed(5)); }
const seq = (order, wcell, rows, ironBack) => (m) => {
  for (let x = bx0; x <= bx1; x++) { const k = Math.floor((x - bx0) / wcell) % order.length; for (const y of rows) m[y * P.w + x] = order[k]; }
  if (ironBack) for (let x = bx0; x <= bx1; x++) m[(rows[rows.length - 1] + 1) * P.w + x] = 1;
};
const rows2 = [16, 17, 18, 19], rows4 = [14, 15, 16, 17, 18, 19, 20, 21];
const [R, L, D, U] = [M.MAG_R, M.MAG_L, M.MAG_D, M.MAG_U];
run('all up (top row 4)', seq([U], 4, rows2));
run('all up + iron under', seq([U], 4, rows2, true));
for (const w of [2, 3, 4]) {
  run(`halbach ccw w${w}`, seq([R, U, L, D], w, rows2));
  run(`halbach cw w${w}`, seq([R, D, L, U], w, rows2));
  run(`halbach ccw w${w} 4rows`, seq([R, U, L, D], w, [16, 17]));
}
run('alternate U/D w4', seq([U, D], 4, rows2));
run('alternate U/D w4 + iron under', seq([U, D], 4, rows2, true));
