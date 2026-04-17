# 詳細設計書: `src/components/Scene.tsx`

## `function Scene()`
* **概要**: `<Canvas>` を初期化し、カメラ・ライティング・`HandTracker`・各種演出・ゲームオブジェクト（ノーツやBaton）を統合・ビルドするメイングラフィックスコンポーネント。
* **パラメータ**: なし
* **戻り値**: フルスクリーンの Canvas `JSX.Element`。

### 内部関数 (Internal Functions)

#### `function createHandProxy(handsRef: BothHandsDataRef, side: 'left' | 'right'): HandDataRef`
* **概要**: 両手分のトラッキングデータ群から、指定側の片手分のみを透過的に切り出してプロキシ参照オブジェクトを生成する。
* **パラメータ**:
  * `handsRef` (BothHandsDataRef): 親となる両手分のオブジェクト。
  * `side` ('left' | 'right'): 切り出す手。
* **戻り値**: 片手情報だけを参照できる `HandDataRef` オブジェクト。

#### `function JudgeLine()`
* **概要**: ヒット判定が行われるZ=0の平面にネオンガイドのグリッドラインを引く静的コンポーネント。
* **パラメータ**: なし
* **戻り値**: ガイドライン用メッシュの `JSX.Element`。

#### `function PlayAreaFrame()`
* **概要**: 左右の手ごとの操作可能エリアを示す透過ボックスの枠線を描画する静的コンポーネント。
* **パラメータ**: なし
* **戻り値**: バウンディングボックスメッシュ群の `JSX.Element`。
