/*
 * Stages. kind 'state': reach `target` from |0..0>.  kind 'unitary': implement `target` exactly
 * (every input), using only the gates in `gates`. `target` and `par` are gate lists
 * ({c,type,q,k}); `par` is a cheapest-known solution that only uses the allowed gates.
 */
(function (root) {
  'use strict';
  const g = (c, type, q, k) => (k === undefined ? { c, type, q } : { c, type, q, k });
  const STAGES = [
    { id: 1, name: '反転', n: 1, cols: 4, kind: 'state', gates: ['X', 'H', 'Z'],
      target: [g(0, 'X', 0)], par: [g(0, 'X', 0)],
      brief: '量子ビットは |0⟩(球の北極)と |1⟩(南極)の間の「向き」で表される。X ゲートは球をひっくり返す。まずは |0⟩ を |1⟩ に。' },
    { id: 2, name: '位相をひねる', n: 1, cols: 4, kind: 'state', gates: ['H', 'X', 'Z', 'S'],
      target: [g(0, 'H', 0), g(1, 'S', 0)], par: [g(0, 'H', 0), g(1, 'S', 0)],
      brief: '赤道上の点は「|0⟩と|1⟩の重ね合わせ」。経度が「位相」。H で赤道へ、S で赤道を90°回して、目標(|+i⟩)に合わせよう。' },
    { id: 3, name: '基底を取り替える', n: 1, cols: 5, kind: 'unitary', gates: ['H', 'X'],
      target: [g(0, 'Z', 0)], par: [g(0, 'H', 0), g(1, 'X', 0), g(2, 'H', 0)],
      brief: 'H と X だけで Z ゲートを作ろう(どの入力でも Z と同じ結果に)。H は「X軸とZ軸」を入れ替える鏡。H で挟むと X が Z に化ける。' },
    { id: 4, name: '45°の位相', n: 1, cols: 4, kind: 'state', gates: ['H', 'T', 'S', 'X', 'Z'],
      target: [g(0, 'H', 0), g(1, 'T', 0)], par: [g(0, 'H', 0), g(1, 'T', 0)],
      brief: 'T ゲートは位相を45°回す(誤り訂正のある量子計算では特に高コスト)。S を2回では90°。目標の経度は45°、どのゲートが近い?' },
    { id: 5, name: 'もつれ(ベル状態)', n: 2, cols: 5, kind: 'state', gates: ['H', 'X', 'Z', 'CNOT'],
      target: [g(0, 'H', 0), g(1, 'CNOT', 1, 0)], par: [g(0, 'H', 0), g(1, 'CNOT', 1, 0)],
      brief: '(|00⟩+|11⟩)/√2 を作ろう。2ビットは別々の向きを持てず、各ビットの矢印は球の内側(中心)に縮む。それが「もつれ」。' },
    { id: 6, name: '一重項', n: 2, cols: 6, kind: 'state', gates: ['H', 'X', 'Z', 'CNOT'],
      target: [g(0, 'H', 0), g(1, 'CNOT', 1, 0), g(2, 'X', 1), g(2, 'Z', 0)], par: [g(0, 'H', 0), g(1, 'CNOT', 1, 0), g(2, 'X', 1), g(2, 'Z', 0)],
      brief: '(|01⟩−|10⟩)/√2 を作ろう。ベル状態をつくってから、符号と中身を直す。' },
    { id: 7, name: 'CZ から CNOT', n: 2, cols: 5, kind: 'unitary', gates: ['H', 'CZ'],
      target: [g(0, 'CNOT', 1, 0)], par: [g(0, 'H', 1), g(1, 'CZ', 1, 0), g(2, 'H', 1)],
      brief: 'H と CZ だけで CNOT を作ろう。CZ は「両方1なら符号反転」。標的ビットの基底を H で替えると、符号反転が「反転」に化ける。' },
    { id: 8, name: 'SWAP を作る', n: 2, cols: 6, kind: 'unitary', gates: ['CNOT'],
      target: [g(0, 'SWAP', 1, 0)], par: [g(0, 'CNOT', 1, 0), g(1, 'CNOT', 0, 1), g(2, 'CNOT', 1, 0)],
      brief: 'CNOT だけで2ビットを入れ替えよう(SWAP ゲートは使えない)。制御と標的の向きを入れ替えながら使う。' },
    { id: 9, name: 'GHZ状態', n: 3, cols: 6, kind: 'state', gates: ['H', 'X', 'Z', 'CNOT'],
      target: [g(0, 'H', 0), g(1, 'CNOT', 1, 0), g(2, 'CNOT', 2, 1)], par: [g(0, 'H', 0), g(1, 'CNOT', 1, 0), g(2, 'CNOT', 2, 1)],
      brief: '(|000⟩+|111⟩)/√2。3つの量子ビットがまとめてもつれた状態を、できるだけ少ないゲートで。' },
  ];
  const api = { STAGES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QuantumStages = api;
})(typeof window !== 'undefined' ? window : globalThis);
