# 詳細設計書: `src/components/Note.tsx`

## `function Note({ note, positionRef, handsDataRef, onHit, onMiss, isAutoPlayMode = false }: NoteProps)`
* **概要**: 個別に降ってくる歌詞ノートの3Dメッシュを描画し、位置補完、当たり判定（3D物理距離に基づく交差判定）を行う。
* **パラメータ**:
  * `note` (NoteData): 描画対象となるノーツの初期座標・色・歌詞テキスト情報の塊。
  * `positionRef` (React.RefObject<number>): 楽曲の現在進行時刻（ms）。再描画なしで高速参照される。
  * `handsDataRef` (BothHandsDataRef): 当たり判定を照合するための両手のトラッキング情報。
  * `onHit` ((id: string, hand: 'left'|'right') => void): 判定条件を満たした場合のコールバック。
  * `onMiss` ((id: string, hand: 'left'|'right') => void): 見逃した場合のコールバック。
  * `isAutoPlayMode` (boolean): デモ表示等のため、タイミングが合えば自動ヒットさせるフラグ。
* **戻り値**: 歌詞テキストを含む 3Dオブジェクトの `JSX.Element`。

### 内部関数 (Internal Functions)

#### `function HitEffect({ position, color, onComplete }: { position: THREE.Vector3; color: string; onComplete: () => void })`
* **概要**: ノーツがヒットした際に描画されるパーティクル四散エフェクト。
* **パラメータ**:
  * `position` (THREE.Vector3): 爆発エフェクトを発生させる3D中心座標。
  * `color` (string): パーティクルの発光色。
  * `onComplete` (() => void): エフェクト終了時に親に通知するコールバック。
* **戻り値**: パーティクルメッシュの `JSX.Element`。

#### `function RingGuide({ targetX, targetY, color, progressRef, stateRef }: { targetX: number; targetY: number; color: string; progressRef: React.RefObject<number>; stateRef: React.MutableRefObject<'active' | 'magnet' | 'hit' | 'missed'> })`
* **概要**: 判定目標タイミングに向けて、後方から収縮してくるジャストタイミングガイドリングを描画する。
* **パラメータ**:
  * `targetX`, `targetY` (number): 目標のX/Y絶対座標。
  * `color` (string): リング基調色。
  * `progressRef` (React.RefObject<number>): 進行度（0〜1）の可変参照。
  * `stateRef`: ノートの現在の進行状態ステート。
* **戻り値**: トーラス状リングの `JSX.Element`。
