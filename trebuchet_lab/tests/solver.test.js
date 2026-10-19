// node tests/solver.test.js
const T = require('../js/solver.js'), { STAGES } = require('../js/stages.js');
let failed = 0;
function test(name, fn) { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n    ', e.message); } }
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const stage = (id) => STAGES.find((s) => s.id === id);
const run = (id, q) => T.evaluate(stage(id), q);

test('energy is conserved from release of the arm to the moment the sling lets go (drift < 0.1 %)', () => {
  for (const q of [{ rel: -20 }, { rel: -40, s: 9 }, { rel: -34, c: 3, s: 9, a: 4 }, { rel: -10, a: 3, c: 2 }]) {
    const r = T.simulate(Object.assign({ H: 9, L: 14, M: 400, m: 12 }, q));
    assert(r.valid, 'invalid: ' + r.note);
    assert(r.drift < 1e-3, `drift ${r.drift} for ${JSON.stringify(q)}`);
  }
});

test('projectile energy never exceeds the counterweight energy released (efficiency < 1)', () => {
  for (const id of [1, 2, 3, 5]) {
    const ev = run(id, stage(id).start); if (!ev.valid) continue;
    assert(ev.r.eta > 0 && ev.r.eta < 1, `eta ${ev.r.eta}`);
  }
});

test('ballistics: range matches x + vx*t and lands at y = 0', () => {
  const r = T.simulate({ H: 9, L: 14, M: 400, m: 12, a: 4, s: 9, rel: -28 });
  assert(r.valid, r.note);
  const p = T.flight(r, r.rel.tf);
  assert(Math.abs(p[1]) < 1e-6 && Math.abs(p[0] - r.range) < 1e-6, `landing ${p}`);
});

test('a heavier counterweight throws farther (all else equal)', () => {
  const base = Object.assign({}, stage(4).fixed, { rel: -30 });
  let prev = 0;
  for (const M of [300, 400, 500, 600]) { const r = T.simulate(Object.assign({}, base, { M })); assert(r.valid && r.range > prev, `M=${M} range ${r.range}`); prev = r.range; }
});

test('stage 1: an interior optimum for the short arm; too long a short arm hits the ground', () => {
  const best = (a) => { let b = 0; for (let rel = -70; rel <= 40; rel += 2) { const e = run(1, { a, rel }); if (e.valid && e.value > b) b = e.value; } return b; };
  const r2 = best(2), r4 = best(4), r5 = best(5);
  assert(r2 < r4 && r4 < r5 + 1e-9, `${r2} ${r4} ${r5}`);
  assert(best(6) === 0, 'a=6 should hit the ground');
});

test('stage 2: a sling about 10-12 m is better than 5 m or 13 m', () => {
  const best = (s) => { let b = 0; for (let rel = -100; rel <= 40; rel += 2) { const e = run(2, { s, rel }); if (e.valid && e.value > b) b = e.value; } return b; };
  const r5 = best(5), r12 = best(12);
  assert(r12 > r5 * 2, `${r5} ${r12}`);
});

test('stage 3: a long hinged counterweight beats the fixed one; a too-long rod hits the ground', () => {
  const best = (c) => { let b = 0; for (let rel = -100; rel <= 40; rel += 2) { const e = run(3, { c, rel }); if (e.valid && e.value > b) b = e.value; } return b; };
  assert(best(4.4) > best(0) * 1.15, `${best(0)} ${best(4.4)}`);
  assert(best(5.4) === 0, 'c=5.4 should hit the ground');
});

test('stage 4: the target (220 m) is reachable with the allowed counterweight range, score 1000 within 0.5 m', () => {
  const st = stage(4); let best = 0, hit = null;
  for (let M = 240; M <= 340; M += 5) for (let rel = -44; rel <= -14; rel += 2) {
    const e = T.evaluate(st, { M, rel }); if (e.valid && e.score > best) { best = e.score; hit = { M, rel }; }
  }
  assert(best >= 950, `best score ${best} ${JSON.stringify(hit)}`);
});

test('scores: zero at the baseline, increase with range, capped at 1000', () => {
  const st = stage(1);
  assert(T.evaluate(st, { a: 5, rel: -14 }).score > 950, 'optimum should score ~1000');
  assert(T.evaluate(st, st.start).score < 100, 'start is poor');
});

test('determinism', () => {
  const a = T.simulate({ rel: -20 }), b = T.simulate({ rel: -20 });
  assert(a.range === b.range, 'range differs');
});

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
