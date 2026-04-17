# 詳細設計書: `src/components/HandTracker.tsx`

## `function HandTracker({ handsDataRef }: { handsDataRef: BothHandsDataRef })`
* **概要**: `MediaPipe Hand Landmarker` を初期化し、Webカメラ映像から手の座標を推論。推論結果の3D座標を `handsDataRef` にリアルタイムで書き込む非表示コンポーネント。
* **パラメータ**:
  * `handsDataRef` (BothHandsDataRef): 抽出した手の座標・フラグを格納し子階層と共有するための可変参照オブジェクト。
* **戻り値**: カメラプレビューを隠して表示するための `JSX.Element (<video>)`。

### 内部関数 (Internal Functions)

#### `initHandLandmarker()`
* **概要**: AIモデルファイル（WASM/Task）をフェッチしてメモリに準備し、推論インフラを構築する非同期処理。
* **パラメータ**: なし

#### `startCamera()`
* **概要**: 320x240 @30fpsでの最適化された内蔵カメラストリーム取得を開始し、非表示の `<video>` へ流し込む非同期処理。
* **パラメータ**: なし

#### `stopCamera()`
* **概要**: 進行中のカメラストリーム（トラック）を強制停止し破棄する処理。
* **パラメータ**: なし

#### `detectLoop()`
* **概要**: `requestAnimationFrame` にフックし、フレームごとに推論処理（`detectForVideo`）を実行するメインループ関数。カメラストリームのコマ更新時のみ実行。
* **パラメータ**: なし

#### `assignHand(raw: { tip: any; palm: any }, isLeft: boolean): boolean`
* **概要**: 生の推論座標をミラーリング補正・逆サイド検知を行い、ワールド空間に反映する(`detectLoop`内部のヘルパーサブルーチン)。
* **パラメータ**:
  * `raw`: 推論エンジンが抽出したランドマーク群の生データ。
  * `isLeft`: 対象の手がシステム視点で「左手」として認識されるかのフラグ。
* **戻り値**: 検出が有効（左右の混同等で棄却されなかったか）かを示す boolean 値。
