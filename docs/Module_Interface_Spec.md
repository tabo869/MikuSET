# モジュール詳細設計書（ソースファイル・全関数インターフェース仕様）

本ドキュメントでは、MikuSETプロジェクトにおける各種ソースコード（`src/` 配下）に含まれる**すべての関数（コンポーネント、Hooks、内部計算・ユーティリティ機能等）**について、そのシグネチャ、概要、および各パラメータの仕様を定義します。

---

## 1. ユーティリティ (Utils)

### `src/utils/coordinateMapper.ts`

#### `function mapToWorld(normX: number, normY: number, normZ: number, bounds: CalibrationBounds | null = null): { x: number; y: number; z: number }`
* **概要**: MediaPipeが返す2次元の正規化座標領域（0.0〜1.0）とユーザーのキャリブレーション領域（bounds）に基づき、Three.js空間内の3Dワールド座標に変換・クランプ・ミラーリングする。
* **パラメータ**:
  * `normX` (number): MediaPipeが推論したX座標。
  * `normY` (number): MediaPipeが推論したY座標。
  * `normZ` (number): 深度（手首からの相対Z値）。
  * `bounds` (CalibrationBounds | null): キャリブレーションで設定した可動範囲の境界情報。未指定時は全体をベースにする。
* **戻り値**: 3Dワールド座標オブジェクト `{ x, y, z }`。

---

## 2. 状態管理・カスタムHooks (Hooks)

### `src/hooks/useGameState.tsx`

#### `function GameStateProvider({ children }: { children: ReactNode })`
* **概要**: ゲーム全体のスコア、コンボ数、ヒット/ミス数、演出レベルなどを管理し、ツリー内の子コンポーネントへゲーム状態コンテキストを提供する。
* **パラメータ**:
  * `children` (ReactNode): Providerでラップされる子コンポーネント群。

#### `function useGameState(): GameStateContextValue`
* **概要**: `GameStateContext` からゲームステート全体へアクセスするためのフック。
* **パラメータ**: なし
* **戻り値**: ゲームステート変数 (`stateRef`) と更新アクション (`actions`: `onHit`, `onMiss`, `reset`) を含むオブジェクト。

#### `function useProductionLevel(): number`
* **概要**: 現在のゲームの状態における「演出レベル（productionLevel: 1〜4）」のみを描画タイミングに合わせて取り出し、監視するための軽量Hooks。
* **パラメータ**: なし
* **戻り値**: 現在の演出レベル。

### `src/hooks/useMusicPlayer.tsx`

#### `function MusicProvider({ children }: { children: ReactNode })`
* **概要**: `TextAlive App API` の Player インスタンスの初期化とライフサイクルを管理し、楽曲の現在時刻や楽曲読み込み状態をツリーに提供する。
* **パラメータ**:
  * `children` (ReactNode): Providerでラップされる子コンポーネント群。

#### `function useMusicPlayer(): MusicPlayerContextValue`
* **概要**: 楽曲の再生状態ステート・アクション群、および毎フレーム更新される楽曲の最新時間（`positionRef`）を取得するフック。
* **パラメータ**: なし
* **戻り値**: アプリ制御用オブジェクト (`state`, `actions`, `positionRef`, `maxPositionRef`)。

---

## 3. UIコンポーネント・3D描画 (Components)

### `src/components/HandTracker.tsx`

#### `function HandTracker({ handsDataRef }: { handsDataRef: BothHandsDataRef })`
* **概要**: `MediaPipe Hand Landmarker` を初期化し、Webカメラ映像から手の座標を推論。推論結果の3D座標を `handsDataRef` にリアルタイムで書き込むコンポーネント（表示レイヤーはビデオ隠し要素のみ）。
* **パラメータ**:
  * `handsDataRef` (BothHandsDataRef): 抽出した手の座標・検出フラグを格納するグローバルな可変参照オブジェクト。

*(補足: 内部定義のサブルーチン)*
* `initHandLandmarker()`: AIモデルファイル（WASM/Task）をフェッチしてメモリに準備する。
* `startCamera()`: 320x240 @30fpsでの最適化された内蔵カメラ映像の取得を開始する。
* `stopCamera()`: カメラからのMediaストリームを破棄する。
* `detectLoop()`: `requestAnimationFrame` にフックし、フレームごとに推論処理を実行するループ関数。
* `assignHand(raw: { tip: any; palm: any }, isLeft: boolean): boolean`: 生の推論座標をミラーリング補正・逆サイド検知を行いワールド空間に反映する(`detectLoop`内部のヘルパー関数)。

### `src/components/Baton.tsx`

#### `function Baton({ handDataRef, trailColor = '#66aaff' }: { handDataRef: HandDataRef; trailColor?: string })`
* **概要**: プレイヤーの手の動きに追従して、3D空間上で光りながら軌跡（Trail）を描く指揮棒を描画する。
* **パラメータ**:
  * `handDataRef` (HandDataRef): 追従対象となる1手分の生データ参照。
  * `trailColor` (string): 軌跡カラー（オプション）。指定がない場合はブルー系のHEX色となる。

### `src/components/VirtualInputManager.tsx`

#### `function setFingertip(fp: { x: number; y: number; z: number }, x: number, y: number, z: number)`
* **概要**: 指定された指先オブジェクト（Three.jsベクトル互換のプレーンオブジェクト）のXYZ座標を強制的に上書き設定する内部ヘルパー。
* **パラメータ**:
  * `fp`: 座標を書き直す対象のオブジェクト。
  * `x`, `y`, `z`: 新しいXYZの絶対座標。

#### `function calcTrackingInset(winW: number, winH: number)`
* **概要**: ブラウザのウィンドウサイズ（アスペクト比）と固定のカメラFOVから、操作領域の3Dトラッキングエリアに正確に重なるスクリーンのCSSインセット率（％）を計算する。
* **パラメータ**:
  * `winW` (number): ウィンドウの幅
  * `winH` (number): ウィンドウの高さ

#### `function VirtualInputManager({ handsDataRef, isActive }: { handsDataRef: BothHandsDataRef; isActive: boolean })`
* **概要**: カメラを使用せずに、画面内の左右3x3タッチグリッド・キーボードを利用して擬似的なハンドトラッキング座標データを生成し注入するコンポーネント。
* **パラメータ**:
  * `handsDataRef` (BothHandsDataRef): 擬似入力による手の座標結果を書き込む先の共通参照オブジェクト。
  * `isActive` (boolean): このコンポーネント（モード）がアクティブであるかどうかのフラグ。

### `src/components/Note.tsx`

#### `function HitEffect({ position, color, onComplete }: { position: THREE.Vector3; color: string; onComplete: () => void })`
* **概要**: ノーツがヒットした際に描画されるパーティクル四散エフェクト。
* **パラメータ**:
  * `position` (THREE.Vector3): 爆発エフェクトを発生させる3D中心座標。
  * `color` (string): パーティクルの発光色。
  * `onComplete` (() => void): エフェクト終了時に親要素からNote自体を消去させるためのコールバック関数。

#### `function RingGuide({ targetX, targetY, color, progressRef, stateRef }: { targetX: number; targetY: number; color: string; progressRef: React.RefObject<number>; stateRef: React.MutableRefObject<'active' | 'magnet' | 'hit' | 'missed'> })`
* **概要**: 判定目標タイミングに向けて、後方から収縮してくるジャストタイミングガイドリングを描画する。
* **パラメータ**:
  * `targetX` (number) / `targetY` (number): ヒットを待機するX/Y絶対座標。
  * `color` (string): リングの色。
  * `progressRef` (React.RefObject<number>): 0（出現直後）〜 1（判定タイミング）を示す進行度パラメータ。
  * `stateRef` (...): ノートの現在ステート（判定済かアクティブか）。

#### `function Note({ note, positionRef, handsDataRef, onHit, onMiss, isAutoPlayMode = false }: { note: NoteData; positionRef: React.RefObject<number>; handsDataRef: BothHandsDataRef; onHit: (id: string, hand: 'left'|'right') => void; onMiss: (id: string, hand: 'left'|'right') => void; isAutoPlayMode?: boolean })`
* **概要**: 個別に降ってくる歌詞ノートの3Dメッシュを描画し、位置補完、当たり判定（3D距離計算による）を行う。
* **パラメータ**:
  * `note` (NoteData): 描画対象となるノーツの初期座標・色・歌詞テキスト情報の塊。
  * `positionRef` (React.RefObject<number>): 楽曲の現在進行時刻（ms）。再描画なしで高速参照される。
  * `handsDataRef` (BothHandsDataRef): 当たり判定を照合するための両手のトラッキング情報。
  * `onHit` / `onMiss`: 判定条件を満たした・または見逃した場合のエラーハンドリング用コールバック通信関数。
  * `isAutoPlayMode` (boolean): デモ表示等のため、タイミングが合えば座標計算を無視して自動ヒットさせるフラグ。

### `src/components/NoteManager.tsx`

#### `function createStarShape()`
* **概要**: タイミングガイド用の五芒星シェイプをジオメトリとして動的に生成する関数。
* **パラメータ**: なし
* **戻り値**: Three.jsの `Shape` ジオメトリオブジェクト。

#### `function TimingStar({ hand, wordsRef, positionRef }: { hand: 'left' | 'right'; wordsRef: React.RefObject<{ text: string; startTime: number; endTime: number }[]>; positionRef: React.RefObject<number> })`
* **概要**: 現在位置から次にノーツが発生する位置へかけての誘導パスおよび現在処理中の誘導星エフェクトを描画する。
* **パラメータ**:
  * `hand` ('left' | 'right'): 左右どちらのタイミングガイドであるか。
  * `wordsRef` (...): 対象となる手の歌詞情報（出現タイミング等）の配列への参照。
  * `positionRef` (React.RefObject<number>): 曲の最新時刻への参照。

#### `function NoteManager({ handsDataRef }: { handsDataRef: BothHandsDataRef })`
* **概要**: 楽曲データの解析済み歌詞テキストリスト（Word群）から、タイミングに応じて `Note` コンポーネントを画面に出現・消滅させるオーケストレーター。左右への振り分けロジックを保持する。
* **パラメータ**:
  * `handsDataRef` (BothHandsDataRef): 実体化する `Note` に提供するための座標の入った参照オブジェクト。

### `src/components/PhraseDisplay.tsx`

#### `function isWordHit(startTime: number): boolean`
* **概要**: 指定されたstartTime（発声開始時刻）の歌詞ワードが、既にゲーム内でヒット処理済（スコア化済）であるかを判定する。
* **パラメータ**:
  * `startTime` (number): チェックする単語の発生開始時間（ms）。

#### `function generateChunks(words: WordData[], chunkSize: number): ChunkData[]`
* **概要**: FlatなWordの配列を、指定された長さに切り分けて Chunk（最前列で表示するフレーズブロック）に変換するユーティリティ関数。
* **パラメータ**:
  * `words` (WordData[]): 単語群の配列。
  * `chunkSize` (number): 1ブロックあたりに結合する最大単語数。

#### `function PhraseDisplay({ positionRef }: { positionRef: React.RefObject<number> })`
* **概要**: 現在の再生時間にシンクして、歌詞テキストを下から奥へ向かって3D風のスクロール（スターウォーズ方式）で描画・更新するエフェクトレイヤー。
* **パラメータ**:
  * `positionRef` (React.RefObject<number>): スクロールの基準タイミングとなる楽曲現在時間の参照。

### `src/components/Scene.tsx`

#### `function createHandProxy(handsRef: BothHandsDataRef, side: 'left' | 'right'): HandDataRef`
* **概要**: 両手分のトラッキングデータ群から、指定側の片手分のみを透過的に切り出してBaton等に渡すための Proxy 参照オブジェクトを生成する。
* **パラメータ**:
  * `handsRef` (BothHandsDataRef): 両手分のデータを持つ親オブジェクト。
  * `side` ('left' | 'right'): 切り出す手の方向。
* **戻り値**: プロパティのgetter/setterを持つ `HandDataRef` オブジェクト。

#### `function JudgeLine()`
* **概要**: ヒット判定が行われるZ=0の平面（XYのライン）にネオンガイドラインを引く静的コンポーネント。
* **パラメータ**: なし

#### `function PlayAreaFrame()`
* **概要**: 左右の手ごとの操作可能エリアを示す透過ボックスの枠線を描画する静的コンポーネント。
* **パラメータ**: なし

#### `function Scene()`
* **概要**: `<Canvas>` を初期化し、カメラ・ライティング・`HandTracker`・各種演出・そしてゲームオブジェクト本体（ノーツやBaton）を階層化して統合ビルドするメイングラフィックスコンポーネント。
* **パラメータ**: なし

### `src/components/ScoreHUD.tsx`

#### `function ScoreHUD()`
* **概要**: 現在のスコア・コンボ・ヒット数・ミス数・操作ステータスをリアルタイムで画面右上にUIとして描画するコンポーネント。
* **パラメータ**: なし

### `src/components/StageProduction.tsx`

#### `function calculateFinalLevel(baseLevel: number, now: number, choruses: { startTime: number; endTime: number }[] | undefined): number`
* **概要**: プレイヤーのコンボ等で計算された基礎演出レベル（baseLevel）に対し、サビ中などの条件に応じて一時的なブーストを加味した最終描画演出レベルを算出する。
* **パラメータ**:
  * `baseLevel` (number): コンボ数にベース依存したステージレベル。
  * `now` (number): 曲の現在進行時間（ms）。
  * `choruses` (...): TextAliveから取得したサビ情報区間の配列。
* **戻り値**: 最終補正された演出レベル値（ex: サビ中であれば強制4になる等）。

#### `function DynamicLights()`
* **概要**: 演出レベルに応じて、アンビエントライトやスポットライトの色、フラッシュの激しさといったライティング強度を動的に補間し変化させる。
* **パラメータ**: なし

#### `function CyberBackground()`
* **概要**: Three.jsのShaderMaterialを用いて、奥行き感のある流れるサイバーグリッドを背景に描画し、演出レベルに応じた発光度合を加味する。
* **パラメータ**: なし

#### `function AudiencePenlights()`
* **概要**: インスタンスメッシュを使って群集を模した数千のペンライトを描画し、演出レベルごとの揺らしアニメーションやカラー変化（サビでの赤・青などのミックス）をGPU側で最適に処理する。
* **パラメータ**: なし

#### `function StageProduction()`
* **概要**: `DynamicLights`、`CyberBackground`、`AudiencePenlights` の各種ステージ演出基盤をとりまとめ、サビ・コンボ状態に応じたカメラシェイク処理等のハブとして機能する。
* **パラメータ**: なし

### `src/components/MusicManager.tsx`

#### `function formatTime(ms: number): string`
* **概要**: ミリ秒（ms）から `MM:SS` （分：秒）の表示用文字列フォーマットに変換するヘルパー。
* **パラメータ**:
  * `ms` (number): 経過ミリ秒数。
* **戻り値**: `01:23` などの文字列フォーマット。

#### `function ResultScore()`
* **概要**: 楽曲の完走後、リザルト画面オーバーレイ内に最終の得点・最大コンボなどの成績を整形して表示するUI専用。
* **パラメータ**: なし

#### `function CalibrationWizard()`
* **概要**: カメラモード使用前またはテスト中に起動し、画面の四隅に対してトラッキング位置を登録するためのステップバイステップUIおよび設定保存を行う。
* **パラメータ**: なし

#### `function MusicManager()`
* **概要**: ゲーム本体に関わる2DフロントエンドUI全般を統制するレイヤー。タイトル・楽曲選択、PLAY STARTボタンからのダウンカウントシーケンス、PLAY中の停止UI、そして楽曲終了後のリザルト展開までを担当。
* **パラメータ**: なし

---

## 4. エントリポイント (Root Layers)

### `src/App.tsx`
#### `function App()`
* **概要**: リアクトツリーの根幹。各種Provider (`GameStateProvider`, `MusicProvider`) で子階層ラップし、`Scene`, `MusicManager`, `ScoreHUD`などのコアUIを統括する。
* **パラメータ**: なし

### `src/main.tsx`
#### *ReactDOM.createRoot*
* **概要**: ブラウザの `index.html` にマウントを行い、`App` コンポーネントをStrictMode下でブートストラップする。
* **パラメータ**: `HTMLDivElement` などのDOM要素ノードに対してレンダリングを差し込む。
