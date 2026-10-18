/*
 * Stages. free: parameters the player may change (with [min, max, step]); fixed: everything else.
 * objective: 'eta' = brake thermal efficiency, 'torque' = brake mean effective pressure.
 * floor / ref: objective value that scores 0 / 1000.  minBmep: minimum brake mean effective pressure (bar).
 */
(function (root) {
  'use strict';
  const STAGES = [
    { id: 1, name: '圧縮比', objective: 'eta', free: { r: [6, 16, 0.1] }, fixed: { spark: 20, ivc: 30, evo: 40, lambda: 1, throttle: 1, boost: 1, rpm: 2500, octane: 91 },
      floor: 0.296, ref: 0.364,
      brief: '圧縮比を上げるほど熱効率は上がる(オットーサイクル)。でもガソリンは圧縮されすぎると勝手に自己着火してノッキングする。ノッキングしない範囲で、できるだけ高い熱効率を狙おう(オクタン価91)。' },
    { id: 2, name: '点火時期', objective: 'torque', free: { spark: [0, 45, 1] }, fixed: { r: 10.5, ivc: 30, evo: 40, lambda: 1, throttle: 1, boost: 1, rpm: 2500, octane: 91 },
      floor: 9.7, ref: 10.9,
      brief: '点火が遅いと燃え終わる前にピストンが下がって力が逃げる。早すぎると上昇中のピストンに逆らって燃え、圧力のピークも高くなる。トルク(平均有効圧)が最大になる点火時期(MBT)を探そう。' },
    { id: 3, name: 'ミラーサイクル', objective: 'eta', free: { ivc: [0, 110, 1], evo: [0, 80, 1] }, fixed: { r: 13, spark: 20, lambda: 1, throttle: 1, boost: 1, rpm: 2500, octane: 91 }, minBmep: 9,
      floor: 0.30, ref: 0.374,
      brief: '幾何学的な圧縮比13は高すぎてノッキングする。吸気バルブを遅く閉じる(ミラーサイクル)と、実際の圧縮は浅く、膨張は深いままにできる。ノッキングを避けつつ、平均有効圧9 bar以上を保って、熱効率を最大にしよう。排気バルブを開けるタイミングも効く。' },
    { id: 4, name: '総合設計', objective: 'eta', free: { r: [7, 16, 0.1], spark: [0, 45, 1], ivc: [0, 110, 1], evo: [0, 80, 1], lambda: [0.8, 1.4, 0.01], boost: [1, 2, 0.01] }, fixed: { throttle: 1, rpm: 2500, octane: 91 }, minBmep: 16,
      floor: 0.25, ref: 0.357,
      brief: 'ターボ過給でパワーを出しつつ(平均有効圧16 bar以上)、熱効率を高く保とう。過給は圧力と温度を上げてノッキングしやすくなる。圧縮比・点火・バルブタイミング・空燃比・過給圧を総合的に決める。' },
  ];
  const api = { STAGES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EngineStages = api;
})(typeof window !== 'undefined' ? window : globalThis);
