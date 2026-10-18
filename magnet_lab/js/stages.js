/*
 * Stages. kind: 'gain'   -> maximise the mean |B| in `zone` (value in tesla)
 *               'shield' -> minimise it (value = field without shield / field with shield, "x times weaker")
 * Magnet ids: 2 right, 3 left, 4 down, 5 up (screen axes). fixed: [x0,y0,x1,y1,material]
 * build: the only area the player may paint in. scoreRef: value-per-cost that scores 1000.
 */
(function (root) {
  'use strict';
  const STAGES = [
    { id: 1, name: '磁気ギャップ', kind: 'gain', w: 40, h: 30, tools: [1],
      fixed: [[4, 9, 8, 20, 2]], zone: [20, 12, 21, 17], build: [1, 1, 38, 28],
      target: 0.4, budget: 220, scoreRef: 0.0035,
      brief: '左の磁石の磁束を、中央の測定ゾーン(ギャップ)へ導いて磁束密度を上げよう。磁束は必ず磁石へ「戻る」ので、行きだけでなく帰りの道も要る。' },
    { id: 2, name: '磁気シールド', kind: 'shield', w: 48, h: 40, tools: [1], ext: [0.3, 0],
      zone: [22, 18, 25, 21], build: [1, 1, 46, 38], bScale: 0.4,
      target: 40, budget: 160, scoreRef: 2,
      brief: '外から一様な磁場(0.3 T)がかかっている。中央の測定ゾーンの磁場を弱めよう。鉄は磁束を吸い込んで迂回させる。ただし鉄は飽和する。厚い1枚と、薄い何枚か。どちらが得?' },
    { id: 3, name: '磁束の集中', kind: 'gain', w: 40, h: 30, tools: [1],
      fixed: [[3, 6, 8, 23, 2]], zone: [17, 13, 18, 16], build: [1, 1, 38, 28],
      target: 0.8, budget: 260, scoreRef: 0.005,
      brief: '磁石の面は大きいが、使いたいのは小さなギャップだけ。磁極を先細りにして磁束を絞ると、磁石自身の磁束密度に迫れる。ただし鉄は約1.6 Tで飽和する。' },
    { id: 4, name: '片側だけ磁場', kind: 'gain', w: 48, h: 36, tools: [1, 2, 5, 3, 4],
      zone: [14, 10, 33, 11], zone2: [14, 24, 33, 25], build: [10, 14, 37, 21],
      target: 0.06, budget: 240, minRatio: 3, scoreRef: 0.0004,
      brief: '磁石を自由に並べ、上の測定ゾーンにだけ強い磁場を作ろう(下側の漏れの2.5倍以上)。磁石の向きをどう並べれば磁束が片側に集まる?(ハルバッハ配列)' },
  ];
  // Extra air around every stage (the outer box is a flux-parallel wall, so more air = less
  // wall influence on the field near the magnets). Everything is shifted by PAD cells.
  const PAD = 8;
  for (const st of STAGES) {
    const sh = (r) => [r[0] + PAD, r[1] + PAD, r[2] + PAD, r[3] + PAD].concat(r.slice(4));
    st.w += 2 * PAD; st.h += 2 * PAD;
    if (st.fixed) st.fixed = st.fixed.map(sh);
    for (const k of ['zone', 'zone2', 'build']) if (st[k]) st[k] = sh(st[k]);
  }
  const api = { STAGES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MagStages = api;
})(typeof window !== 'undefined' ? window : globalThis);
