/* Stages. walls: rows (in cells, from the top) covered by the barrier. */
(function (root) {
  'use strict';
  const STAGES = [
    { id: 1, name: '正面衝突', w: 16, h: 10, v0: 14, M: 1000, gLimit: 40, budget: 260,
      brief: '時速50kmで壁に正面衝突。左端が壁、右端が乗員室。限られた潰れ代(80cm)と材料で、乗員室にかかる最大の減速度(G)をできるだけ小さく。' },
    { id: 2, name: '高速・短い潰れ代', w: 13, h: 10, v0: 16, M: 1000, gLimit: 45, budget: 300,
      brief: '時速58km、潰れ代は65cmしかない。短い距離で止めるには、力を「出し惜しみせず一定に」出し続ける必要がある。' },
    { id: 3, name: 'オフセット衝突', w: 16, h: 10, v0: 14, M: 1000, gLimit: 45, budget: 300, walls: [[5, 10]],
      brief: '壁は下半分だけ。壁に当たらない上半分の材料は、ただの重り。荷重の通り道を考えよう。' },
    { id: 4, name: 'ポール衝突', w: 16, h: 10, v0: 14, M: 1000, gLimit: 45, budget: 260, walls: [[4, 6]],
      brief: '電柱に激突。壁は中央の幅10cmだけ。構造のほとんどはポールを素通りしてしまう。力をどうやって中央に集める?' },
  ];
  const api = { STAGES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CrashStages = api;
})(typeof window !== 'undefined' ? window : globalThis);
