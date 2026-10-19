/*
 * Stages. free: parameters the player may change [min, max, step]; fixed: everything else (passed to the solver).
 * objective 'range': maximise the landing distance (m).  'target': land as close as possible to `target` (m).
 * floor / ref: value that scores 0 / 1000 (range stages).  start: initial slider values.
 */
(function (root) {
  'use strict';
  const BASE = { H: 9, L: 14, M: 400, m: 12 };
  const STAGES = [
    { id: 1, name: 'てこの比', objective: 'range',
      free: { a: [1.5, 6.5, 0.1], rel: [-70, 40, 1] }, fixed: Object.assign({}, BASE, { s: 6, c: 0 }),
      start: { a: 2.5, rel: 0 }, floor: 20, ref: 175,
      brief: '腕の全長は14 mで固定。支点を動かして、カウンターウェイト側(短い腕)の長さを決めよう。短い腕が長いほど錘は大きく落ちるが、錘が重い腕を振り回す分の運動エネルギーは無駄になる。さらに長すぎると錘が地面にぶつかる。放出角(スリングが外れる角度)も一緒に合わせよう。' },
    { id: 2, name: 'スリングの長さ', objective: 'range',
      free: { s: [3, 13, 0.1], rel: [-100, 40, 1] }, fixed: Object.assign({}, BASE, { a: 4, c: 0 }),
      start: { s: 5, rel: 0 }, floor: 80, ref: 320,
      brief: '腕の先に付けた紐(スリング)で弾を振り回すと、先端の速さを超える速度が出せる。長いほど速く振れるが、長すぎると弾が地面を引きずったり、放出のタイミングが合わなくなる。長さと放出角を探そう。' },
    { id: 3, name: '吊り下げ式の錘', objective: 'range',
      free: { c: [0, 5.4, 0.1], rel: [-100, 40, 1] }, fixed: Object.assign({}, BASE, { a: 4, s: 9 }),
      start: { c: 0, rel: -28 }, floor: 250, ref: 345,
      brief: 'カウンターウェイトを腕に固定せず、ヒンジで吊り下げる(c = 吊り棒の長さ)。錘が真下に落ちるので、位置エネルギーを無駄なく弾へ渡せる。ただし、短すぎる吊り棒は逆に損。棒が長すぎると錘が地面に当たる。' },
    { id: 4, name: '狙い撃ち', objective: 'target', target: 220,
      free: { M: [100, 800, 5], rel: [-100, 40, 1] }, fixed: Object.assign({}, BASE, { a: 4, s: 9, c: 3 }),
      start: { M: 400, rel: -30 },
      brief: '敵の城壁は 220 m 先。機械の形は決まっている。錘の重さと放出角で、ぴったり着弾させよう(誤差 0.5 m 以内で満点)。錘を重くすると、飛距離はどう変わる?' },
    { id: 5, name: '総合設計(全部組み合わせ)', objective: 'range',
      free: { a: [2, 6.5, 0.1], s: [3, 13, 0.1], c: [0, 5.4, 0.1], rel: [-100, 40, 1] }, fixed: Object.assign({}, BASE, {}),
      start: { a: 3, s: 7, c: 2, rel: -10 }, floor: 120, ref: 400,
      brief: 'ここまでの全部を組み合わせて、最大飛距離を狙おう。腕の比・スリング・吊り棒・放出角は互いに影響し合う。ひとつ変えたら、ほかも調整し直す必要がある。(ヒント: 最適な設計は、どの単独ステージの最高記録よりも遠くへ飛ぶ)' },
  ];
  const api = { STAGES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TrebStages = api;
})(typeof window !== 'undefined' ? window : globalThis);
