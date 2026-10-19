# sim_game — 物理の直感を作るシミュレーションゲーム

直感的にわかりにくい物理現象を題材に、**ハイスコアを狙って試行錯誤する**ことで
「こうすればこうなる」という感覚を養うブラウザゲーム集。
スパゲッティブリッジの授業を、シミュレーションとスコアで高速化・ゲーム化したもの。

## ゲーム

| フォルダ | 題材 | 遊び方 |
|---|---|---|
| [`bridge_lab/`](bridge_lab/) | 橋の強度(2Dトラス、座屈) | `bridge_lab/index.html` をブラウザで開く |
| [`heat_lab/`](heat_lab/) | 熱の通り道(2D定常熱伝導、枝分かれ構造) | `heat_lab/index.html` をブラウザで開く |
| [`magnet_lab/`](magnet_lab/) | 磁石と磁界(磁気回路、シールド、ハルバッハ) | `magnet_lab/index.html` をブラウザで開く |
| [`quantum_lab/`](quantum_lab/) | 量子回路パズル(重ね合わせ・位相・もつれ) | `quantum_lab/index.html` をブラウザで開く |
| [`entropy_lab/`](entropy_lab/) | エントロピー(粒子ビームの散乱・可逆性) | `entropy_lab/index.html` をブラウザで開く |
| [`engine_lab/`](engine_lab/) | 内燃機関の熱サイクル(オットー、ミラー、ターボ) | `engine_lab/index.html` をブラウザで開く |
| [`trebuchet_lab/`](trebuchet_lab/) | 投石機(ラグランジュ力学、スリングのウィップ、吊り下げ式の錘) | `trebuchet_lab/index.html` をブラウザで開く |
| [`crash_lab/`](crash_lab/) | クラッシャブル構造(衝突、座屈、エネルギー吸収) | `crash_lab/index.html` をブラウザで開く |

各ゲームは独立したフォルダで、ビルド不要・外部依存なしの静的ページです。
GitHub Pages で公開する場合、ルートの `index.html` がゲームの案内ページになります(`<サイトURL>/bridge_lab/` が橋ゲーム)。新しいゲームを足したら、`index.html` のカードも追加してください。

## 今後の題材

[`docs/themes.md`](docs/themes.md) を参照(熱伝導パス、PCBのインピーダンス整合テーパー、
ヒートシンク、翼形状 など。2D形状で最適化する題材を優先)。

## 構成

```
index.html     ゲームの案内ページ(GitHub Pagesのトップ)
bridge_lab/    ゲーム1: Bridge Lab(index.html, js/, tests/ ...)
heat_lab/      ゲーム2: Heat Lab
crash_lab/     ゲーム3: Crash Lab
magnet_lab/    ゲーム4: Magnet Lab
quantum_lab/   ゲーム5: Quantum Lab
entropy_lab/   ゲーム6: Entropy Lab
engine_lab/    ゲーム7: Engine Lab
trebuchet_lab/ ゲーム8: Trebuchet Lab
common/        共通スクリプト(ピンチズーム)
docs/          共通ドキュメント(題材案など)
<new_game>/    今後のゲームも同じ構成で追加
```
