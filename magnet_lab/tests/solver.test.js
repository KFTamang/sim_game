// node tests/solver.test.js
const assert = require('assert');
const M = require('../js/solver.js');
const { STAGES } = require('../js/stages.js');

let failed = 0;
function test(name, fn) { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n    ', e.message); } }
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);

test('uniform external field is reproduced exactly in empty space', () => {
  const P = M.makeProblem({ w: 30, h: 24, ext: [0.3, 0.1], zone: [10, 10, 15, 14] });
  const r = M.solve(P, new Uint8Array(P.n));
  near(r.B.bx[12 * 30 + 12], 0.3, 1e-6); near(r.B.by[12 * 30 + 12], 0.1, 1e-6);
});

test('a magnet drives flux along its magnetisation inside, and back around outside', () => {
  const P = M.makeProblem({ w: 40, h: 30, zone: [1, 1, 2, 2], fixed: [[15, 12, 24, 17, M.MAG_R]] });
  const r = M.solve(P, new Uint8Array(P.n));
  assert(r.B.bx[15 * 40 + 20] > 0.4, 'inside along +x');
  assert(r.B.bx[15 * 40 + 29] > 0, 'on the axis outside, same direction');
  assert(r.B.bx[8 * 40 + 20] < 0, 'return flux above the magnet points back');
  const P2 = M.makeProblem({ w: 40, h: 30, zone: [1, 1, 2, 2], fixed: [[15, 12, 24, 17, M.MAG_U]] });
  const r2 = M.solve(P2, new Uint8Array(P2.n));
  assert(r2.B.by[15 * 40 + 20] < -0.3, 'up magnet: B points up (negative screen y) inside');
});

test('magnetic circuit: a return path is needed; a short-circuiting yoke next to the magnet kills the gap field', () => {
  const st = STAGES[0], P = M.makeProblem(st);
  const rect = (m, x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!P.fixed[y * P.w + x]) m[y * P.w + x] = 1; };
  const run = (fn) => { const m = new Uint8Array(P.n); fn(m); return M.solve(P, m).bzone; };
  const open = run((m) => { rect(m, 17, 20, 27, 25); rect(m, 30, 20, 33, 25); });
  const loop = run((m) => { rect(m, 17, 20, 27, 25); rect(m, 30, 20, 33, 25); rect(m, 31, 26, 33, 31); rect(m, 10, 30, 33, 31); rect(m, 10, 29, 11, 29); });
  const shorted = run((m) => { rect(m, 17, 20, 27, 25); rect(m, 30, 20, 33, 25); rect(m, 31, 26, 33, 31); rect(m, 10, 30, 33, 31); rect(m, 10, 29, 11, 29); rect(m, 17, 26, 27, 29); });
  assert(loop > open * 3, `loop ${loop} vs open ${open}`);
  assert(shorted < loop * 0.7, `shorted ${shorted} vs loop ${loop}`);
});

test('iron saturates: B in iron stays physical (< 2.4 T) even with a strong magnet', () => {
  const P = M.makeProblem({ w: 40, h: 30, zone: [30, 13, 31, 16], fixed: [[3, 6, 8, 23, M.MAG_R]] });
  const mat = new Uint8Array(P.n);
  for (let x = 9; x <= 28; x++) { const half = Math.max(2, Math.round(9 - (x - 9) * 0.35)); for (let y = 14 - half; y < 14 + half; y++) mat[y * 40 + x] = 1; }
  const r = M.solve(P, mat);
  let mx = 0; for (let i = 0; i < P.n; i++) if (r.mat[i] === M.IRON) mx = Math.max(mx, r.B.bm[i]);
  assert(mx < 2.4, `max B in iron ${mx}`);
  assert(r.outer < 80, `nonlinear iteration converged in ${r.outer}`);
});

test('a closed iron shell shields; thicker is better; nesting beats one shell of equal iron', () => {
  const st = STAGES[1], P = M.makeProblem(st), ref = M.reference(P);
  const ring = (mat, rin, rout) => { for (let y = 0; y < P.h; y++) for (let x = 0; x < P.w; x++) { const r = Math.max(Math.abs(x - (P.w - 1) / 2), Math.abs(y - (P.h - 1) / 2)); if (r <= rout && r > rin) mat[y * P.w + x] = 1; } };
  const sh = (fn) => { const m = new Uint8Array(P.n); fn(m); return { f: ref / M.solve(P, m).bzone, c: M.costOf(P, m) }; };
  const one2 = sh((m) => ring(m, 6.5, 8.5)), one3 = sh((m) => ring(m, 5.5, 8.5));
  const nested = sh((m) => { ring(m, 7.5, 8.5); ring(m, 3.5, 4.5); });
  assert(one3.f > one2.f, 'thicker shields more');
  assert(nested.f > one2.f * 3 && nested.c < one2.c, `nested ${nested.f}@${nested.c} vs single ${one2.f}@${one2.c}`);
});

test('Halbach-style rotation puts the field on one side only', () => {
  const st = STAGES[3], P = M.makeProblem(st);
  const [bx0, , bx1] = st.build;
  const pat = [M.MAG_R, M.MAG_U, M.MAG_L, M.MAG_D];
  const m = new Uint8Array(P.n);
  for (let x = bx0; x <= bx1; x++) for (const y of [24, 25]) m[y * P.w + x] = pat[Math.floor((x - bx0) / 4) % 4];
  const r = M.solve(P, m);
  assert(r.bzone / r.bzone2 > 4, `ratio ${r.bzone / r.bzone2}`);
});

test('solver is fast enough to run live', () => {
  const P = M.makeProblem(STAGES[1]);
  const m = new Uint8Array(P.n);
  for (let y = 0; y < P.h; y++) for (let x = 0; x < P.w; x++) { const r = Math.max(Math.abs(x - (P.w - 1) / 2), Math.abs(y - (P.h - 1) / 2)); if ((r <= 8.5 && r > 7.5) || (r <= 4.5 && r > 3.5)) m[y * P.w + x] = 1; }
  const t0 = Date.now(); M.solve(P, m); const dt = Date.now() - t0;
  assert(dt < 400, `${dt} ms`);
});

process.exit(failed ? 1 : 0);
