/*
 * stages.js — stage definitions.
 *   span         gap width [m] (cliff edges at x = 0 and x = span)
 *   anchorDepth  how far down the cliff faces you may anchor [m]
 *   yMax / yMin  build volume above / below the road [m]
 *   load         'udl' (uniform traffic jam) | 'point' (one heavy truck mid-span)
 *   required     live load the bridge must carry [kN]
 *   budget       cost limit
 */
(function (root) {
  'use strict';

  const STAGES = [
    {
      id: 1, name: '小川', span: 10, anchorDepth: 2, yMax: 6, yMin: -5,
      load: 'udl', required: 100, budget: 700,
      brief: '最初の橋。まず目標荷重に耐える橋を作り、次に材料を減らして効率を上げよう。',
    },
    {
      id: 2, name: '谷', span: 16, anchorDepth: 3, yMax: 8, yMin: -7,
      load: 'udl', required: 150, budget: 1800,
      brief: '長くなるほど、自重と座屈が効いてくる。',
    },
    {
      id: 3, name: '重量トラック', span: 16, anchorDepth: 3, yMax: 8, yMin: -7,
      load: 'point', required: 100, budget: 1800,
      brief: '荷重が中央に1点集中。分布荷重とは違う形が最適になる。',
    },
    {
      id: 4, name: '大渓谷', span: 24, anchorDepth: 5, yMax: 10, yMin: -9,
      load: 'udl', required: 150, budget: 3500,
      brief: '崖が深い。アーチやケーブル的な形も狙える。',
    },
  ];

  const api = { STAGES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Stages = api;
})(typeof window !== 'undefined' ? window : globalThis);
