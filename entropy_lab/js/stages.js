/*
 * Stages. source: [x0,y0,x1,y1] cells where the beam starts, angle: beam direction (rad),
 * walls: fixed mirror rectangles, build: where the player may paint, tools: material ids
 * allowed (1 mirror, 2 rough), tRef: time that scores 1000, tLimit: must be faster than this.
 */
(function (root) {
  'use strict';
  const STAGES = [
    { id: 1, name: '鏡だけの箱', w: 48, h: 32, source: [2, 14, 3, 17], angle: 0,
      walls: [], build: [8, 2, 45, 29], tools: [1], budget: 40, tRef: 30, tLimit: 300,
      brief: '左から、ほぼ平行な粒子のビームを打ち込む(とても秩序だった低エントロピーの状態)。鏡の壁を置いて、粒子が箱いっぱいに均等に散らばるまでの時間を短くしよう。' },
    { id: 2, name: 'ざらざらの壁', w: 48, h: 32, source: [2, 14, 3, 17], angle: 0,
      walls: [], build: [8, 2, 45, 29], tools: [2], budget: 30, tRef: 35, tLimit: 300,
      brief: '拡散反射する壁(ざらざらの壁)は、当たった粒子が来た向きを忘れる。置ける量はわずか。どこに置くのが効率的?' },
    { id: 3, name: '二つの部屋', w: 48, h: 32, source: [2, 14, 3, 17], angle: 0,
      walls: [[23, 0, 24, 14], [23, 17, 24, 31]], build: [3, 2, 45, 29], tools: [1, 2], budget: 80, tRef: 30, tLimit: 120,
      brief: '仕切りの小さな穴の向こうの部屋にも粒子を行き渡らせたい。両方の部屋が均等になった(=エントロピーが最大になった)時点がゴール。' },
  ];
  const api = { STAGES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EntropyStages = api;
})(typeof window !== 'undefined' ? window : globalThis);
