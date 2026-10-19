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

  // ---- Grover's search: find the marked item among N = 2^n with about (pi/4) sqrt(N) rounds
  const hAll = (c, n) => Array.from({ length: n }, (_, q) => g(c, 'H', q));
  const xAll = (c, n) => Array.from({ length: n }, (_, q) => g(c, 'X', q));
  const mark = (c, n) => (n === 2 ? [g(c, 'CZ', 1, 0)] : [{ c, type: 'CCZ', q: 0, k: 1, k2: 2 }]);
  const diffusion = (c, n) => [...hAll(c, n), ...xAll(c + 1, n), ...mark(c + 2, n), ...xAll(c + 3, n), ...hAll(c + 4, n)];   // 5 columns
  const grover2 = [...hAll(0, 2), ...mark(1, 2), ...diffusion(2, 2)];                                                         // find |11>
  const grover2b = [...hAll(0, 2), g(1, 'X', 0), g(2, 'CZ', 1, 0), g(3, 'X', 0), ...diffusion(4, 2)];                        // find |01>
  const grover3 = (rounds) => { let a = hAll(0, 3), c = 1; for (let r = 0; r < rounds; r++) { a = a.concat(mark(c, 3), diffusion(c + 1, 3)); c += 6; } return a; };
  STAGES.push(
    { id: 10, name: '全候補を重ねる', n: 2, cols: 3, kind: 'state', gates: ['H', 'X'],
      target: hAll(0, 2), par: hAll(0, 2),
      brief: '【グローバー探索 ①】4つの候補(|00⟩〜|11⟩)の中から答えを1つ見つけたい。まず、全部の候補を同じ重みで同時にもつ状態を作ろう。' },
    { id: 11, name: '答えに印をつける', n: 2, cols: 4, kind: 'state', gates: ['H', 'X', 'CZ'],
      target: [...hAll(0, 2), ...mark(1, 2)], par: [...hAll(0, 2), ...mark(1, 2)],
      brief: '【グローバー探索 ②】答えは |11⟩ だとする。答えの符号だけを反転させよう(オラクル)。確率は変わらず、棒の色(位相)だけが変わる。' },
    { id: 12, name: '別の答えに印', n: 2, cols: 5, kind: 'state', gates: ['H', 'X', 'CZ'],
      target: [...hAll(0, 2), g(1, 'X', 0), g(2, 'CZ', 1, 0), g(3, 'X', 0)], par: [...hAll(0, 2), g(1, 'X', 0), g(2, 'CZ', 1, 0), g(3, 'X', 0)],
      brief: '【グローバー探索 ③】答えが |01⟩ のときの印。CZ は |11⟩ にしか印をつけられない。X でビットを入れ替えて、印をつける場所を変えよう。' },
    { id: 13, name: '平均で折り返す', n: 2, cols: 6, kind: 'unitary', gates: ['H', 'X', 'CZ'],
      target: diffusion(0, 2), par: diffusion(0, 2),
      brief: '【グローバー探索 ④】拡散=「全部の振幅を、平均値のまわりで折り返す」操作。印のついた(平均より低くなった)振幅は、折り返すと平均を超えて高くなる。この操作を H・X・CZ で作ろう。' },
    { id: 14, name: 'グローバー探索(4から1)', n: 2, cols: 8, kind: 'state', gates: ['H', 'X', 'CZ'],
      target: grover2, par: grover2,
      brief: '【グローバー探索 ⑤】全部を重ねる → 印をつける → 平均で折り返す。たった1回で、|11⟩ の確率が 25% → 100% になる。4つから1つを探すのに、候補を1つずつ調べる必要がない。' },
    { id: 15, name: 'グローバー探索(答え:01)', n: 2, cols: 10, kind: 'state', gates: ['H', 'X', 'CZ'],
      target: grover2b, par: grover2b,
      brief: '【グローバー探索 ⑥】答えが |01⟩ のとき。オラクルだけを作り替えれば、拡散(平均で折り返す部分)は同じものを使える。' },
    { id: 16, name: 'グローバー探索(8から1)', n: 3, cols: 8, kind: 'state', gates: ['H', 'X', 'CCZ'],
      target: grover3(1), par: grover3(1),
      brief: '【グローバー探索 ⑦】3ビット = 8つの候補から |111⟩ を探す。CCZ(3ビットがすべて1なら符号反転)を使い、「印 → 折り返し」を1回。答えの確率は約78%に上がるが、まだ100%ではない。' },
    { id: 17, name: 'グローバー探索(2回)', n: 3, cols: 14, kind: 'state', gates: ['H', 'X', 'CCZ'],
      target: grover3(2), par: grover3(2),
      brief: '【グローバー探索 ⑧】「印 → 折り返し」をもう1回。答えの確率は約94.5%まで上がる。最適な回数は約 (π/4)√N 回。やりすぎると確率が下がるのも体験しよう(3回目は約33%)。' },
  );
  const api = { STAGES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QuantumStages = api;
})(typeof window !== 'undefined' ? window : globalThis);
