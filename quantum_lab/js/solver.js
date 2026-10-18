/*
 * solver.js — exact state-vector simulation of small quantum circuits (1-3 qubits).
 *
 * Qubit 0 is the top wire and the most significant bit of the basis index: |q0 q1 q2>.
 * A state is a Float64Array of interleaved (re, im) amplitudes. A gate is
 *   { c: column, type, q: target wire, k?: control wire (CNOT / CZ) or partner wire (SWAP) }.
 * Gates in the same column must act on different wires; columns are applied left to right.
 *
 * Works in the browser (window.Quantum) and in node (module.exports).
 */
(function (root) {
  'use strict';

  const R2 = Math.SQRT1_2;
  // 2x2 matrices, row-major, interleaved (re, im): [a, b; c, d]
  const U = {
    H: [R2, 0, R2, 0, R2, 0, -R2, 0],
    X: [0, 0, 1, 0, 1, 0, 0, 0],
    Y: [0, 0, 0, -1, 0, 1, 0, 0],
    Z: [1, 0, 0, 0, 0, 0, -1, 0],
    S: [1, 0, 0, 0, 0, 0, 0, 1],
    Sdg: [1, 0, 0, 0, 0, 0, 0, -1],
    T: [1, 0, 0, 0, 0, 0, R2, R2],
    Tdg: [1, 0, 0, 0, 0, 0, R2, -R2],
  };
  const GATES = {
    H: { label: 'H', cost: 1, qubits: 1, name: 'アダマール(重ね合わせ・基底の入れ替え)' },
    X: { label: 'X', cost: 1, qubits: 1, name: 'NOT(|0⟩⇄|1⟩)' },
    Y: { label: 'Y', cost: 1, qubits: 1, name: 'パウリY' },
    Z: { label: 'Z', cost: 1, qubits: 1, name: '位相反転(|1⟩に −1)' },
    S: { label: 'S', cost: 1, qubits: 1, name: '位相 +90°(|1⟩に i)' },
    Sdg: { label: 'S†', cost: 1, qubits: 1, name: '位相 −90°' },
    T: { label: 'T', cost: 2, qubits: 1, name: '位相 +45°(高コスト)' },
    Tdg: { label: 'T†', cost: 2, qubits: 1, name: '位相 −45°(高コスト)' },
    CNOT: { label: '●', cost: 2, qubits: 2, name: 'CNOT(制御ビットが1なら標的を反転)' },
    CZ: { label: 'CZ', cost: 2, qubits: 2, name: 'CZ(両方1なら位相反転)' },
    SWAP: { label: '×', cost: 3, qubits: 2, name: 'SWAP(2ビットの入れ替え)' },
  };

  const dimOf = (n) => 1 << n;
  const bitOf = (n, q) => n - 1 - q;
  const zeroState = (n) => { const s = new Float64Array(2 * dimOf(n)); s[0] = 1; return s; };

  function applySingle(s, n, q, m) {
    const b = bitOf(n, q), bit = 1 << b, dim = dimOf(n);
    for (let i = 0; i < dim; i++) {
      if (i & bit) continue;
      const j = i | bit;
      const ar = s[2 * i], ai = s[2 * i + 1], br = s[2 * j], bi = s[2 * j + 1];
      s[2 * i] = m[0] * ar - m[1] * ai + m[2] * br - m[3] * bi;
      s[2 * i + 1] = m[0] * ai + m[1] * ar + m[2] * bi + m[3] * br;
      s[2 * j] = m[4] * ar - m[5] * ai + m[6] * br - m[7] * bi;
      s[2 * j + 1] = m[4] * ai + m[5] * ar + m[6] * bi + m[7] * br;
    }
  }
  function applyCNOT(s, n, ctl, tgt) {
    const cb = 1 << bitOf(n, ctl), tb = 1 << bitOf(n, tgt), dim = dimOf(n);
    for (let i = 0; i < dim; i++) {
      if ((i & cb) && !(i & tb)) {
        const j = i | tb;
        let t = s[2 * i]; s[2 * i] = s[2 * j]; s[2 * j] = t;
        t = s[2 * i + 1]; s[2 * i + 1] = s[2 * j + 1]; s[2 * j + 1] = t;
      }
    }
  }
  function applyCZ(s, n, a, b) {
    const ab = 1 << bitOf(n, a), bb = 1 << bitOf(n, b), dim = dimOf(n);
    for (let i = 0; i < dim; i++) if ((i & ab) && (i & bb)) { s[2 * i] = -s[2 * i]; s[2 * i + 1] = -s[2 * i + 1]; }
  }
  function applySwap(s, n, a, b) {
    const ab = 1 << bitOf(n, a), bb = 1 << bitOf(n, b), dim = dimOf(n);
    for (let i = 0; i < dim; i++) {
      if ((i & ab) && !(i & bb)) {
        const j = (i & ~ab) | bb;
        let t = s[2 * i]; s[2 * i] = s[2 * j]; s[2 * j] = t;
        t = s[2 * i + 1]; s[2 * i + 1] = s[2 * j + 1]; s[2 * j + 1] = t;
      }
    }
  }
  function applyGate(s, n, g) {
    if (g.type === 'CNOT') applyCNOT(s, n, g.k, g.q);
    else if (g.type === 'CZ') applyCZ(s, n, g.k, g.q);
    else if (g.type === 'SWAP') applySwap(s, n, g.k, g.q);
    else applySingle(s, n, g.q, U[g.type]);
  }

  /** run the gates in columns 0..upto (inclusive; default all) on `init` (default |0..0>) */
  function run(n, gates, upto, init) {
    const s = init ? Float64Array.from(init) : zeroState(n);
    const sorted = gates.slice().sort((a, b) => a.c - b.c);
    const last = upto === undefined ? Infinity : upto;
    for (const g of sorted) if (g.c <= last) applyGate(s, n, g);
    return s;
  }

  /** full unitary as columns (images of the basis states) */
  function unitary(n, gates) {
    const dim = dimOf(n), cols = [];
    for (let k = 0; k < dim; k++) {
      const init = new Float64Array(2 * dim); init[2 * k] = 1;
      cols.push(run(n, gates, undefined, init));
    }
    return cols;
  }

  /** |<a|b>|^2 for normalised states (global phase irrelevant) */
  function stateFidelity(a, b) {
    let re = 0, im = 0;
    for (let i = 0; i < a.length; i += 2) { re += a[i] * b[i] + a[i + 1] * b[i + 1]; im += a[i] * b[i + 1] - a[i + 1] * b[i]; }
    return re * re + im * im;
  }
  /** |tr(Ut^dagger U)|^2 / 4^n */
  function unitaryFidelity(ut, u) {
    let re = 0, im = 0;
    for (let k = 0; k < ut.length; k++) {
      const a = ut[k], b = u[k];
      for (let i = 0; i < a.length; i += 2) { re += a[i] * b[i] + a[i + 1] * b[i + 1]; im += a[i] * b[i + 1] - a[i + 1] * b[i]; }
    }
    const d = ut.length;
    return (re * re + im * im) / (d * d);
  }

  /** Bloch vector of qubit q (length < 1 when entangled) */
  function bloch(s, n, q) {
    const bit = 1 << bitOf(n, q), dim = dimOf(n);
    let r00 = 0, r11 = 0, r01r = 0, r01i = 0;
    for (let i = 0; i < dim; i++) {
      if (i & bit) continue;
      const j = i | bit;
      // pair (i has q=0, j has q=1) with all other qubits traced over: sum over i with the same others
      const ar = s[2 * i], ai = s[2 * i + 1], br = s[2 * j], bi = s[2 * j + 1];
      r00 += ar * ar + ai * ai; r11 += br * br + bi * bi;
      r01r += ar * br + ai * bi; r01i += ai * br - ar * bi;   // a * conj(b)
    }
    // rho01 = sum a b*  ->  x = 2 Re rho01, y = -2 Im rho01 ... (convention below)
    return { x: 2 * r01r, y: -2 * r01i, z: r00 - r11 };
  }

  function probs(s) {
    const p = [];
    for (let i = 0; i < s.length; i += 2) p.push(s[i] * s[i] + s[i + 1] * s[i + 1]);
    return p;
  }

  function costOf(gates) { let c = 0; for (const g of gates) c += GATES[g.type].cost; return c; }

  const api = { U, GATES, zeroState, run, unitary, stateFidelity, unitaryFidelity, bloch, probs, costOf, applyGate, dimOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Quantum = api;
})(typeof window !== 'undefined' ? window : globalThis);
