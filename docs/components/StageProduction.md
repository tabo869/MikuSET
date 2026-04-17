# 詳細設計書: `src/components/StageProduction.tsx`

## `function StageProduction()`
* **概要**: ライティングや背景・群衆などの各種ステージ演出コンポーネント群を統合配置し、サビ状態やコンボ状態に応じた環境情報のハブとして機能する。
* **パラメータ**: なし
* **戻り値**: 演出層を束ねた `JSX.Element`（`<group>`ベース）。

### 内部関数 (Internal Functions)

#### `function calculateFinalLevel(baseLevel: number, now: number, choruses: { startTime: number; endTime: number }[] | undefined): number`
* **概要**: 基礎演出レベル（コンボに基づく値）に対し、サビ中などの条件に応じて一時的なブースト（強制レベル4等）を加味した最終的な描画レベルを算出する。
* **パラメータ**:
  * `baseLevel` (number): ベースレベル。
  * `now` (number): サビ判定のための現在進行時間（ms）。
  * `choruses`: TextAliveのサビ情報配列。
* **戻り値**: 確定した演出レベルの数値（0〜4程度）。

#### `function DynamicLights()`
* **概要**: 演出レベルに応じて、アンビエント・スポットライトの色や強さを動的に補間し変化させる。
* **パラメータ**: なし
* **戻り値**: ライト情報群を含んだ `JSX.Element`。

#### `function CyberBackground()`
* **概要**: ShaderMaterialを用いてサイバーグリッドを背景に描画し、演出レベルに応じた発光度合を加味する。
* **パラメータ**: なし
* **戻り値**: 背景メッシュの `JSX.Element`。

#### `function AudiencePenlights()`
* **概要**: インスタンスメッシュを使って群集を模した数千の観客用ペンライトを描画し、振りのアニメーションやカラー変化をGPUで最適にバッチ処理する。
* **パラメータ**: なし
* **戻り値**: InstancedMeshベースの群集オブジェクト `JSX.Element`。
