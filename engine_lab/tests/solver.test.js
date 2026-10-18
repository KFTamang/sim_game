// node tests/solver.test.js
const E = require('../js/solver.js'), { STAGES } = require('../js/stages.js');
let failed = 0;
function test(name, fn) { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n    ', e.message); } }
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };

test('crank geometry: V(TDC) = clearance volume, V(BDC) = clearance + displacement', () => {
  const r = 10, Vc = E.VD / (r - 1);
  assert(Math.abs(E.volume(0, r) - Vc) < 1e-9 && Math.abs(E.volume(180, r) - (Vc + E.VD)) < 1e-9 && Math.abs(E.volume(-180, r) - (Vc + E.VD)) < 1e-9, 'geometry');
});

test('energy balance: every joule of fuel is accounted for', () => {
  for (const q of [{}, { r: 13, ivc: 70 }, { boost: 1.8, r: 9 }, { lambda: 1.3 }]) {
    const e = E.simulate(q).energy, sum = e.work + e.friction + e.pumping + e.wall + e.exhaust + e.unburned;
    assert(Math.abs(sum / e.fuel - 1) < 1e-9, `sum ${sum / e.fuel} for ${JSON.stringify(q)}`);
  }
});

test('realistic numbers: ~35 % brake efficiency and 10-12 bar BMEP at r=10.5, full load', () => {
  const r = E.simulate({ r: 10.5 });
  assert(r.eta > 0.31 && r.eta < 0.40 && r.bmep / 1e5 > 9 && r.bmep / 1e5 < 13, `eta ${r.eta} bmep ${r.bmep / 1e5}`);
  assert(r.pmax / 1e5 > 40 && r.pmax / 1e5 < 90, 'pmax ' + r.pmax / 1e5);
});

test('Otto: efficiency rises with compression ratio; 91 octane knocks above ~11.5', () => {
  let prev = 0;
  for (const r of [6, 8, 10, 11]) { const e = E.simulate({ r }).eta; assert(e > prev, `eta(${r}) = ${e}`); prev = e; }
  assert(!E.simulate({ r: 11 }).knock && E.simulate({ r: 12 }).knock, 'knock limit');
  assert(!E.simulate({ r: 12, octane: 98 }).knock, 'higher octane allows more compression');
});

test('ignition timing: torque peaks in the middle (MBT), too late and too early both lose', () => {
  const f = (spark) => E.simulate({ r: 10.5, spark }).bmep;
  assert(f(18) > f(0) * 1.08 && f(18) > f(42) * 1.05, `${f(0)} ${f(18)} ${f(42)}`);
});

test('Miller cycle: late intake closing cuts knock (lower effective compression) and trapped mass', () => {
  const a = E.simulate({ r: 13, ivc: 20 }), b = E.simulate({ r: 13, ivc: 80 });
  assert(b.knockI < a.knockI * 0.6 && b.bmep < a.bmep, `knock ${a.knockI} -> ${b.knockI}, bmep ${a.bmep} -> ${b.bmep}`);
});

test('turbo: boost raises BMEP strongly and raises knock tendency', () => {
  const a = E.simulate({ r: 9 }), b = E.simulate({ r: 9, boost: 1.6 });
  assert(b.bmep > a.bmep * 1.4 && b.knockI > a.knockI, `bmep ${a.bmep} -> ${b.bmep}`);
});

test('throttling costs efficiency (pumping loss) and lean burn recovers some of it', () => {
  const full = E.simulate({}), part = E.simulate({ throttle: 0.4 });
  assert(part.eta < full.eta * 0.8 && part.pmep < full.pmep, 'throttling');
});

test('stage reference settings score about 1000, bad settings score less, knock scores 0', () => {
  const [s1, s2, s3, s4] = STAGES;
  assert(Math.abs(E.evaluate(s1, { r: 11.2 }).score - 1000) <= 30, 'stage 1 ' + E.evaluate(s1, { r: 11.2 }).score);
  assert(E.evaluate(s1, { r: 14 }).score === 0 && E.evaluate(s1, { r: 14 }).r.knock, 'stage 1 knock');
  assert(E.evaluate(s2, { spark: 18 }).score > 950 && E.evaluate(s2, { spark: 0 }).score < 50, 'stage 2');
  assert(E.evaluate(s3, { ivc: 56, evo: 32 }).valid && E.evaluate(s3, { ivc: 56, evo: 32 }).score > 950, 'stage 3 ' + E.evaluate(s3, { ivc: 56, evo: 32 }).score);
  assert(!E.evaluate(s3, { ivc: 90, evo: 32 }).valid, 'stage 3 needs enough power');
  assert(E.evaluate(s4, { r: 8.8, spark: 13, ivc: 50, evo: 30, lambda: 1.07, boost: 1.96 }).score > 950, 'stage 4 ' + E.evaluate(s4, { r: 8.8, spark: 13, ivc: 50, evo: 30, lambda: 1.07, boost: 1.96 }).score);
});

test('simulation is fast enough for live sliders', () => {
  const t0 = Date.now(); for (let i = 0; i < 200; i++) E.simulate({ r: 10 }); assert((Date.now() - t0) / 200 < 5, 'slow');
});
process.exit(failed ? 1 : 0);
