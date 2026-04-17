# 詳細設計書: `src/components/VirtualInputManager.tsx`

## `function VirtualInputManager({ handsDataRef, isActive }: { handsDataRef: BothHandsDataRef; isActive: boolean })`
* **概要**: カメラを使用せずに、画面内のタッチグリッド・キーボードを利用して擬似的なハンドトラッキング座標データをリアルタイム生成し注入するコンポーネント。
* **パラメータ**:
  * `handsDataRef` (BothHandsDataRef): 擬似入力による手の座標結果を書き込む先の共通参照オブジェクト。
  * `isActive` (boolean): モードのON/OFFフラグ。
* **戻り値**: タッチ用グリッドの透明オーバーレイ要素の `JSX.Element`。

### 内部関数 (Internal Functions)

#### `function setFingertip(fp: { x: number; y: number; z: number }, x: number, y: number, z: number)`
* **概要**: 対象指先オブジェクトのXYZ座標を強制的に上書き設定する内部状態ヘルパー。
* **パラメータ**:
  * `fp`: 座標を書き直す対象のオブジェクト。
  * `x`, `y`, `z`: 新しい設定座標。
* **戻り値**: なし。

#### `function calcTrackingInset(winW: number, winH: number)`
* **概要**: ブラウザのウィンドウ解像度とカメラFOVから、スクリーンのCSSインセット率（％）を計算する。これによりどの画面比率でも操作枠が安全エリアにマッピングされる。
* **パラメータ**:
  * `winW` (number): 画面幅。
  * `winH` (number): 画面高さ。
* **戻り値**: `{ topPct: number, leftPct: number }` という上下左右からのインセット割合オブジェクト。
