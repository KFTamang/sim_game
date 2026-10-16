// node tests/solver.test.js
const assert = require('assert');
const H = require('../js/solver.js');

let failed = 0;
function test(name, fn) {
  try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n    ', e.message); }
}
const near = (a, b, rel, msg) => assert(Math.abs(a - b) <= rel * Math.abs(b), `${msg || ''} ${a} vs ${b}`);

test('1D column: Tmax = q N^2 / (2k) (analytic)', () => {
  const N = 20;
  const P = H.makeProblem({ w: 1, h: N, sinks: [{ side: 'bottom', from: 0, to: 0 }] });
  const mat = new Uint8Array(P.n);
  const r = H.evaluate(P, mat, new Float64Array(P.n), { tol: 1e-12 });
  near(r.tmax, (1 * N * N) / (2 * 1), 1e-6);
});

test('1D column of aluminium: temperature scales as 1/k', () => {
  const N = 20;
  const P = H.makeProblem({ w: 1, h: N, sinks: [{ side: 'bottom', from: 0, to: 0 }] });
  const mat = new Uint8Array(P.n).fill(1);
  const r = H.evaluate(P, mat, new Float64Array(P.n), { tol: 1e-12 });
  near(r.tmax, (N * N) / (2 * 100), 1e-6);
});

test('energy balance: heat through the sink equals heat generated', () => {
  const P = H.makeProblem({ w: 30, h: 24, sinks: [{ side: 'bottom', from: 10, to: 13 }], obstacles: [[5, 5, 8, 15]] });
  const mat = new Uint8Array(P.n);
  for (let x = 0; x < 30; x++) mat[23 * 30 + x] = 1;
  const r = H.evaluate(P, mat, new Float64Array(P.n), { tol: 1e-11 });
  near(H.sinkFlow(P, r.A, r.T), P.totalQ, 1e-6);
});

test('adding conductive material never raises the peak temperature', () => {
  const stage = { w: 20, h: 20, sinks: [{ side: 'bottom', from: 8, to: 11 }] };
  const P = H.makeProblem(stage);
  const ref = H.reference(P);
  const mat = new Uint8Array(P.n);
  for (let y = 10; y < 20; y++) mat[y * 20 + 10] = 1;
  const r = H.evaluate(P, mat, new Float64Array(P.n), { tol: 1e-10 });
  assert(r.tmax < ref.tmax, `${r.tmax} < ${ref.tmax}`);
});

test('copper trunk is cooler than aluminium trunk', () => {
  const P = H.makeProblem({ w: 20, h: 20, sinks: [{ side: 'bottom', from: 8, to: 11 }] });
  const run = (id) => {
    const mat = new Uint8Array(P.n);
    for (let y = 8; y < 20; y++) { mat[y * 20 + 9] = id; mat[y * 20 + 10] = id; }
    return H.evaluate(P, mat, new Float64Array(P.n), { tol: 1e-10 }).tmax;
  };
  assert(run(2) < run(1));
});

test('connectivity: islands away from the sink are not connected', () => {
  const P = H.makeProblem({ w: 10, h: 10, sinks: [{ side: 'bottom', from: 4, to: 5 }] });
  const mat = new Uint8Array(P.n);
  mat[9 * 10 + 4] = 1; mat[8 * 10 + 4] = 1;   // touches the sink
  mat[2 * 10 + 2] = 1;                       // island
  const c = H.connectedToSink(P, mat);
  assert(c[9 * 10 + 4] && c[8 * 10 + 4] && !c[2 * 10 + 2]);
});

test('warm start does not need more iterations than a cold start', () => {
  const P = H.makeProblem({ w: 40, h: 40, sinks: [{ side: 'bottom', from: 18, to: 21 }] });
  const mat = new Uint8Array(P.n);
  for (let y = 10; y < 40; y++) mat[y * 40 + 20] = 1;
  const T = new Float64Array(P.n);
  const cold = H.evaluate(P, mat, T, { tol: 1e-7 });
  mat[20 * 40 + 21] = 1;
  const warm = H.evaluate(P, mat, T, { tol: 1e-7 });
  console.log('     cold iters', cold.iters, ' warm iters', warm.iters);
  assert(warm.iters < cold.iters);
});

process.exit(failed ? 1 : 0);
