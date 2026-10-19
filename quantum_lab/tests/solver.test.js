// node tests/solver.test.js
const assert = require('assert');
const Q = require('../js/solver.js');
const { STAGES } = require('../js/stages.js');
let failed = 0;
function test(name, fn) { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n    ', e.message); } }
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);

test('single-qubit gates move the Bloch vector as expected', () => {
  const b = (gates) => Q.bloch(Q.run(1, gates), 1, 0);
  near(b([{ c: 0, type: 'X', q: 0 }]).z, -1, 1e-9);
  near(b([{ c: 0, type: 'H', q: 0 }]).x, 1, 1e-9);
  const sh = b([{ c: 0, type: 'H', q: 0 }, { c: 1, type: 'S', q: 0 }]);
  near(sh.y, 1, 1e-9); near(sh.x, 0, 1e-9);
  const th = b([{ c: 0, type: 'H', q: 0 }, { c: 1, type: 'T', q: 0 }]);
  near(th.x, Math.SQRT1_2, 1e-9); near(th.y, Math.SQRT1_2, 1e-9);
});

test('Bell state: perfect correlation, and each qubit alone is maximally mixed (Bloch vector length 0)', () => {
  const s = Q.run(2, [{ c: 0, type: 'H', q: 0 }, { c: 1, type: 'CNOT', q: 1, k: 0 }]);
  const p = Q.probs(s);
  near(p[0], 0.5, 1e-9); near(p[3], 0.5, 1e-9); near(p[1] + p[2], 0, 1e-9);
  const b = Q.bloch(s, 2, 0);
  near(Math.hypot(b.x, b.y, b.z), 0, 1e-9);
});

test('every stage: the listed par circuit uses only allowed gates and reaches the target exactly', () => {
  for (const st of STAGES) {
    for (const g of st.par) assert(st.gates.includes(g.type), `stage ${st.id}: ${g.type} not allowed`);
    if (st.kind === 'state') {
      near(Q.stateFidelity(Q.run(st.n, st.target), Q.run(st.n, st.par)), 1, 1e-9, `stage ${st.id}`);
    } else {
      near(Q.unitaryFidelity(Q.unitary(st.n, st.target), Q.unitary(st.n, st.par)), 1, 1e-9, `stage ${st.id}`);
    }
  }
});

test('par circuits are distinguishable from wrong circuits (no trivial pass)', () => {
  for (const st of STAGES) {
    const f = st.kind === 'state' ? Q.stateFidelity(Q.run(st.n, st.target), Q.zeroState(st.n)) : Q.unitaryFidelity(Q.unitary(st.n, st.target), Q.unitary(st.n, []));
    assert(f < 0.99, `stage ${st.id}: empty circuit already passes (${f})`);
  }
});

test('HXH = Z, and CNOT = (I x H) CZ (I x H), SWAP = 3 CNOTs', () => {
  near(Q.unitaryFidelity(Q.unitary(1, [{ c: 0, type: 'Z', q: 0 }]), Q.unitary(1, [{ c: 0, type: 'H', q: 0 }, { c: 1, type: 'X', q: 0 }, { c: 2, type: 'H', q: 0 }])), 1, 1e-9);
  const st7 = STAGES[6], st8 = STAGES[7];
  near(Q.unitaryFidelity(Q.unitary(2, st7.target), Q.unitary(2, st7.par)), 1, 1e-9);
  near(Q.unitaryFidelity(Q.unitary(2, st8.target), Q.unitary(2, st8.par)), 1, 1e-9);
});

test('global phase does not matter, but a relative phase does', () => {
  const a = Q.run(1, [{ c: 0, type: 'X', q: 0 }, { c: 1, type: 'Z', q: 0 }, { c: 2, type: 'X', q: 0 }, { c: 3, type: 'Z', q: 0 }]);   // = -I
  near(Q.stateFidelity(a, Q.zeroState(1)), 1, 1e-9);
  const b = Q.run(1, [{ c: 0, type: 'H', q: 0 }, { c: 1, type: 'Z', q: 0 }]), c = Q.run(1, [{ c: 0, type: 'H', q: 0 }]);
  near(Q.stateFidelity(b, c), 0, 1e-9);
});


test("Grover: one round finds 1 of 4 with certainty; 1 of 8 needs about 2 rounds (78 % then 94.5 %, 3rd round overshoots)", () => {
  const { STAGES } = require('../js/stages.js');
  const st = (id) => STAGES.find((x) => x.id === id);
  const p = (id, idx) => Q.probs(Q.run(st(id).n, st(id).target))[idx];
  assert(Math.abs(p(14, 3) - 1) < 1e-12, 'N=4, one round: ' + p(14, 3));
  assert(Math.abs(p(15, 1) - 1) < 1e-12, 'marked |01>: ' + p(15, 1));
  assert(Math.abs(p(16, 7) - 0.78125) < 1e-9, 'N=8 one round: ' + p(16, 7));
  assert(Math.abs(p(17, 7) - 0.9453125) < 1e-9, 'N=8 two rounds: ' + p(17, 7));
  // a third round overshoots: sin^2(7 asin(1/sqrt 8)) ~ 0.33
  const th = Math.asin(1 / Math.sqrt(8));
  assert(Math.abs(Math.sin(7 * th) ** 2 - 0.3301) < 1e-3, 'third round');
  // the oracle only flips the sign of the marked state: probabilities stay uniform
  const pr = Q.probs(Q.run(2, st(11).target));
  assert(pr.every((x) => Math.abs(x - 0.25) < 1e-12), 'oracle keeps probabilities');
});

test('diffusion operator = 2|s><s| - I up to a global phase (inversion about the mean)', () => {
  const { STAGES } = require('../js/stages.js');
  const U = Q.unitary(2, STAGES.find((x) => x.id === 13).target);
  // apply to a vector with amplitudes a_i: result should be 2*mean - a_i (times a global sign)
  const a = [0.1, 0.5, -0.3, 0.7], mean = a.reduce((x, y) => x + y) / 4;
  const out = [0, 0, 0, 0];
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) out[i] += U[j][2 * i] * a[j];
  const want = a.map((x) => 2 * mean - x);
  const sgn = Math.abs(out[0] - want[0]) < 1e-9 ? 1 : -1;
  assert(out.every((x, i) => Math.abs(sgn * x - want[i]) < 1e-9), JSON.stringify([out, want]));
});

process.exit(failed ? 1 : 0);
