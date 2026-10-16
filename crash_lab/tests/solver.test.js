// node tests/solver.test.js
const assert = require('assert');
const C = require('../js/solver.js');

let failed = 0;
function test(name, fn) {
  try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n    ', e.message); }
}
const P = C.makeProblem({ w: 16, h: 10, v0: 14, M: 1000, gLimit: 40 });
const rows = (mt, rs, w = 16) => { const m = new Uint8Array(w * 10); for (const j of rs) for (let i = 0; i < w; i++) m[j * w + i] = mt; return m; };

test('a wall-only structure that is not attached to the cabin does not stop the car softly', () => {
  const m = new Uint8Array(160);
  for (let j = 3; j < 7; j++) for (let i = 0; i < 12; i++) m[j * 16 + i] = 3;   // stops short of the cabin
  const r = C.simulate(P, m);
  assert(r.hitWall && !r.pass, `hitWall=${r.hitWall} pass=${r.pass}`);
});

test('too weak a structure bottoms out; strong enough one stops the car', () => {
  const weak = C.simulate(P, rows(1, [4, 5]));
  const good = C.simulate(P, rows(2, [1, 2, 3, 4, 5, 6, 7]));
  assert(weak.hitWall && !weak.pass);
  assert(good.pass && good.peakG > 10 && good.peakG < 40, `peak ${good.peakG}`);
});

test('energy: a stopped car has given its kinetic energy to the structure', () => {
  const r = C.simulate(P, rows(2, [1, 2, 3, 4, 5, 6, 7]));
  const ke = 0.5 * P.M * P.v0 * P.v0;
  assert(r.absorbed > 0.9 * ke && r.absorbed <= ke * 1.001, `${r.absorbed} vs ${ke}`);
});

test('stronger material crushes a shorter distance', () => {
  const a = C.simulate(P, rows(2, [1, 2, 3, 4, 5, 6, 7]));
  const b = C.simulate(P, rows(3, [3, 4, 5, 6]));
  assert(b.pass && a.pass);
  const c = C.simulate(P, rows(3, [1, 2, 3, 4, 5, 6, 7, 8]));   // very strong: short stroke, high G
  assert(c.stroke < a.stroke && c.peakG > a.peakG, `${c.stroke} < ${a.stroke}; ${c.peakG} > ${a.peakG}`);
});

test('deterministic and fast enough to run live', () => {
  const m = rows(2, [1, 2, 3, 4, 5, 6, 7]);
  const t0 = Date.now();
  const a = C.simulate(P, m), b = C.simulate(P, m);
  assert.strictEqual(a.peakG, b.peakG);
  assert((Date.now() - t0) / 2 < 400, `${(Date.now() - t0) / 2} ms`);
});

test('offset barrier: material away from the wall is unused', () => {
  const Po = C.makeProblem({ w: 16, h: 10, v0: 14, M: 1000, walls: [[5, 10]] });
  const m = rows(3, [1, 2, 3, 4, 5, 6, 7, 8]);
  const r = C.simulate(Po, m);
  let top = 0, bot = 0;
  for (let i = 0; i < 16; i++) { top += r.cellUse[1 * 16 + i]; bot += r.cellUse[8 * 16 + i]; }
  assert(bot > top, `bottom ${bot} vs top ${top}`);
});

process.exit(failed ? 1 : 0);
