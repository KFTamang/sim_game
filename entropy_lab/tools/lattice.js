const E = require('../js/solver.js'), { STAGES } = require('../js/stages.js');
const P = E.makeProblem(STAGES[0]);
function run(name, f) { const m = new Uint8Array(P.n); f(m); const r = E.simulate(P, m, { full: true, tmax: 200 }); console.log(name, 'cost', E.costOf(m), 't90', r.t90, 'final', r.final.toFixed(3), 'at50', r.series[50].toFixed(2), 'at100', r.series[100].toFixed(2)); }
const put = (m, x, y, id = 1) => { if (P.build[y * P.w + x]) m[y * P.w + x] = id; };
for (const sp of [4, 5, 6, 8]) for (const sz of [1, 2]) run(`lattice sp${sp} sz${sz}`, (m) => { for (let y = 3; y < 30; y += sp) for (let x = 9; x < 45; x += sp) for (let a = 0; a < sz; a++) for (let b = 0; b < sz; b++) put(m, x + a + ((y / sp | 0) % 2) * 2, y + b); });
run('diamonds', (m) => { for (const [cx, cy] of [[12, 16], [20, 8], [20, 24], [30, 16], [38, 8], [38, 24]]) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (Math.abs(dx) + Math.abs(dy) <= 2) put(m, cx + dx, cy + dy); });
run('stagger pegs', (m) => { for (let x = 9; x < 45; x += 4) for (let y = 3 + (x % 8 ? 0 : 3); y < 30; y += 6) put(m, x, y); });
