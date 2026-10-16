const C = require('../js/solver.js');
const P = C.makeProblem({ w: 16, h: 10, v0: 14, M: 1000, gLimit: 40 });
function show(name, fn, P2) {
  const p = P2 || P;
  const mat = new Uint8Array(p.w * p.h); fn(mat, p);
  const r = C.simulate(p, mat);
  const pts = []; for (let i = 0; i < r.acc.length; i += Math.max(1, Math.floor(r.acc.length / 14))) pts.push(r.acc[i].toFixed(0));
  console.log(name.padEnd(28), 'cost', String(C.costOf(mat)).padStart(3), 'peak', r.peakG.toFixed(1).padStart(6), 'stroke', r.stroke.toFixed(2), 'eta', r.eta.toFixed(2), r.pass ? 'PASS' : 'fail', '|', pts.join(' '));
}
const rows = (mt, rs) => (m, p) => { for (const j of rs) for (let i = 0; i < p.w; i++) m[j * p.w + i] = mt; };
show('hs 4 rows', rows(3, [3, 4, 5, 6]));
show('hs 3 rows', rows(3, [3, 4, 5]));
show('st 6 rows', rows(2, [2, 3, 4, 5, 6, 7]));
show('st 8 rows', rows(2, [1, 2, 3, 4, 5, 6, 7, 8]));
show('st 7 rows', rows(2, [1, 2, 3, 4, 5, 6, 7]));
show('al 10 + hs core', (m, p) => { for (let j = 0; j < 10; j++) for (let i = 0; i < 16; i++) m[j * 16 + i] = (j >= 3 && j <= 6) ? 3 : 0; });
// tapered wedge: narrow at front, wide at back
show('wedge st', (m, p) => { for (let i = 0; i < 16; i++) { const half = 1 + Math.floor(i * 4 / 16); for (let j = 5 - half; j < 5 + half; j++) m[j * 16 + i] = 2; } });
// stagger by material: weak front, strong back
show('graded al/st/hs', (m, p) => { for (let i = 0; i < 16; i++) for (let j = 2; j < 8; j++) m[j * 16 + i] = i < 6 ? 1 : (i < 11 ? 2 : 3); });
show('hollow tube st', (m, p) => { for (let i = 0; i < 16; i++) { m[2 * 16 + i] = 2; m[3 * 16 + i] = 2; m[6 * 16 + i] = 2; m[7 * 16 + i] = 2; } });
