// node tests/solver.test.js
const E = require('../js/solver.js'), { STAGES } = require('../js/stages.js');
let failed = 0;
function test(name, fn) { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n    ', e.message); } }
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const put = (P, m, x, y, id) => { if (P.build[y * P.w + x]) m[y * P.w + x] = id; };
const disc = (P, m, cx, cy, r, id) => { for (let y = 0; y < P.h; y++) for (let x = 0; x < P.w; x++) if ((x + .5 - cx) ** 2 + (y + .5 - cy) ** 2 <= r * r) put(P, m, x, y, id); };

test('the beam starts in a low-entropy state and the empty mirror box never mixes it', () => {
  const P = E.makeProblem(STAGES[0]);
  const r = E.simulate(P, new Uint8Array(P.n), { full: true, tmax: 150 });
  assert(r.series[0] < 0.35, `start ${r.series[0]}`);
  assert(r.t90 === Infinity && r.final < 0.6, `final ${r.final}`);
});

test('a few round mirrors randomise the beam (chaotic scattering) — entropy rises toward 100 %', () => {
  const P = E.makeProblem(STAGES[0]), m = new Uint8Array(P.n);
  for (let y = 3; y < 30; y += 6) for (let x = 9; x < 45; x += 6) put(P, m, x + ((y / 6 | 0) % 2) * 2, y, 1);
  assert(E.costOf(m) <= STAGES[0].budget, 'within budget ' + E.costOf(m));
  const r = E.simulate(P, m, { full: true, tmax: 300 });
  assert(r.t90 < STAGES[0].tLimit, `t90 ${r.t90}`);
  assert(r.final > 0.9 && r.final < 1.05, `final ${r.final}`);
});

test('rough walls mix faster than the same shape in mirror', () => {
  const P = E.makeProblem(STAGES[1]), a = new Uint8Array(P.n), b = new Uint8Array(P.n);
  disc(P, a, 14, 16, 2, 1); disc(P, b, 14, 16, 2, 2);
  const ra = E.simulate(P, a, { full: true, tmax: 300 }), rb = E.simulate(P, b, { full: true, tmax: 300 });
  assert(rb.series[40] > ra.series[40], `rough ${rb.series[40]} vs mirror ${ra.series[40]}`);
});

test('stage 2 and 3 are solvable within budget', () => {
  let P = E.makeProblem(STAGES[1]), m = new Uint8Array(P.n);
  disc(P, m, 14, 16.5, 1.6, 2);
  assert(E.costOf(m) <= STAGES[1].budget, 'budget');
  assert(E.simulate(P, m).t90 < STAGES[1].tLimit, 'stage 2');
  P = E.makeProblem(STAGES[2]); m = new Uint8Array(P.n);
  for (let y = 4; y < 29; y += 6) for (let x = 6; x < 45; x += 6) if (Math.abs(x - 23.5) > 2) put(P, m, x, y, 1);
  disc(P, m, 18, 16, 1.2, 2); disc(P, m, 30, 16, 1.2, 2);
  assert(E.costOf(m) <= STAGES[2].budget, 'budget ' + E.costOf(m));
  assert(E.simulate(P, m).t90 < STAGES[2].tLimit, 'stage 3 t90 ' + E.simulate(P, m).t90);
});

test('simulation is deterministic and particles never enter walls', () => {
  const P = E.makeProblem(STAGES[2]), m = new Uint8Array(P.n); disc(P, m, 18, 16, 2, 1);
  const a = E.simulate(P, m, { full: true, tmax: 60 }), b = E.simulate(P, m, { full: true, tmax: 60 });
  assert(a.series.join() === b.series.join(), 'deterministic');
  const s = E.initState(P); E.advance(s, m, 400);
  for (let i = 0; i < E.NP; i++) assert(!E.solidAt(P, m, s.px[i], s.py[i]), 'particle inside a wall');
});

test('mirror-only dynamics keeps every particle speed; rough keeps it too', () => {
  const P = E.makeProblem(STAGES[1]), m = new Uint8Array(P.n); disc(P, m, 14, 16, 2, 2); disc(P, m, 30, 10, 2, 1);
  const s = E.initState(P); E.advance(s, m, 800);
  for (let i = 0; i < E.NP; i++) assert(Math.abs(Math.hypot(s.vx[i], s.vy[i]) - 1) < 1e-9, 'speed changed');
});

test('scoring: faster is better, unreachable is zero', () => {
  const P = E.makeProblem(STAGES[0]);
  assert(E.scoreOf(P, 30) === 1000 && E.scoreOf(P, 60) === 500 && E.scoreOf(P, Infinity) === 0, 'score');
});
process.exit(failed ? 1 : 0);
