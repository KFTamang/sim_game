/*
 * stages.js — stage definitions.
 *   w, h        grid size [cells]
 *   heat(x,y)   heat generation per cell (default 1 everywhere)
 *   obstacles   insulating holes [x0,y0,x1,y1] (cannot be painted)
 *   sinks       cold edges (T = 0): { side, from, to }
 *   budget      material cost you may spend (aluminium cell = 1, copper cell = 3)
 *   target      required cooling factor  (peak temperature with no material / your peak temperature)
 *   score       (factor - 1) / cost * 10000 once target and budget are met
 */
(function (root) {
  'use strict';

  const STAGES = [
    {
      id: 1, name: 'チップ冷却', w: 40, h: 40,
      sinks: [{ side: 'bottom', from: 18, to: 21 }],
      budget: 240, target: 8,
      brief: '基板全体が発熱している。放熱できるのは下辺中央の小さな窓だけ。高伝導材で熱の通り道を作ろう。',
    },
    {
      id: 2, name: '角の放熱点', w: 40, h: 40,
      sinks: [{ side: 'bottom', from: 37, to: 39 }],
      budget: 280, target: 10,
      brief: '放熱点が隅に寄った。熱を運ぶ距離が長くなる。まっすぐ引くのが最善とは限らない。',
    },
    {
      id: 3, name: 'ホットスポット', w: 40, h: 40,
      heat: (x, y) => (x >= 5 && x <= 12 && y >= 5 && y <= 12 ? 25 : 0),
      sinks: [{ side: 'right', from: 28, to: 33 }],
      budget: 180, target: 6,
      brief: '発熱しているのは左上の小さな領域だけ。対角の遠い窓まで、どう熱を逃がす?',
    },
    {
      id: 4, name: '穴あきボード', w: 44, h: 44,
      obstacles: [[12, 0, 14, 29], [26, 14, 28, 43], [36, 0, 38, 20]],
      sinks: [{ side: 'bottom', from: 19, to: 23 }],
      budget: 400, target: 5,
      brief: '断熱の穴(暗い領域)が熱を遮る。穴を避けて通り道を作ろう。',
    },
  ];

  const api = { STAGES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HeatStages = api;
})(typeof window !== 'undefined' ? window : globalThis);
