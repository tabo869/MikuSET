# 詳細設計書 (DD) - MikuSET

## 1. システムアーキテクチャ
* **フレームワーク**: React (Vite)
* **言語**: TypeScript
* **コンポーネント構成**: 関数コンポーネント指向、Hooksを用いた状態管理
* **スタイリング**: カスタムCSS (index.css) 及びインラインスタイル

## 2. 状態管理設計 (State Management)
全体の状態は React の Context API と Custom Hooks を用いて管理・提供する。

### 2.1. GameStateProvider (`useGameState.tsx`)
ゲームの進行状況、難易度設定、システム全般のフラグを管理する。
* **状態構造 (GameState)**:
  * `score` / `combo` / `maxCombo` / `hits` / `misses`: 成績データ。
  * `currentDifficulty` (DifficultyLevel): 現在の難易度 (Easy/Normal/Hard/Very Hard)。
  * `productionLevel` (number): 演出レベル (1〜4)。
  * `globalOffsetMs` (number): 全体的な判定遅延調整（ms）。
  * `isCleared` (boolean): 楽曲完走・クリア済みフラグ。
  * `isTrackingTest` (boolean): カメラプレビューおよび座標表示を伴うテストモード。
  * `calibrationData` (CalibrationData): ユーザー設定の四隅座標。
* **アクション**:
  * `onHit`: コンボ加算、スコア計算、および音響/視覚エフェクトのトリガー。
  * `onMiss`: コンボリセット、演出レベルの初期低下。

### 2.2. MusicProvider (`useMusicPlayer.tsx`)
`TextAlive App API` のライフサイクルと再生状態を管理する。
* **状態 (State)**:
  * `isPlaying`: 再生中フラグ。
  * `isVideoReady`: 楽曲/動画読み込み完了フラグ。
  * `isAutoPlayMode`: デモ用オートプレイモード（すべての判定を自動成功させる）。
* **高速参照用 Ref**:
  * `positionRef`: 再描画を介さずに、3Dレンダリングループ (rAF) から 60fps で参照できる楽曲の現在時間 (ms)。

## 3. コンポーネント設計 (Components)

### 3.1. App.tsx
ルートコンポーネント。`MusicProvider` と `GameStateProvider` で全体をラップし、子コンポーネント群（`Scene`, `MusicManager`, `ScoreHUD` 等）へ状態を注入する。

### 3.2. NoteManager & Note (`Note.tsx`)
* **役割**: `MusicProvider` の再生時間をもとに事前定義された歌詞データを参照し、適切なタイミング（`spawnTime`）で `Note` コンポーネントを描画する。
* **設計**:
  * NoteDataに基づいて、画面上における物理座標(`originX`, `originY`)から判定座標(`targetX`, `targetY`)へのアニメーションを計算。

### 3.3. Input 系 (`VirtualInputManager.tsx`, `HandTracker.tsx`)
* **役割**: マウス、ジェスチャー等の入力座標を常時モニタリング。
* **設計**:
  * 入力座標を `coordinateMapper.ts` で正規化（内部解像度へのマッピング）し、現在画面上にあるノートの `targetX` / `targetY` 座標との距離計算によりヒット判定を行う。成功時に `actions.onHit()` へ通知。

### 3.4. HUD & 演出 (`ScoreHUD.tsx`, `StageProduction.tsx`, `Scene.tsx`)
* **役割**: ユーザーへの視覚的フィードバック。
* **設計**:
  * `useGameState` (または `useProductionLevel`) をリッスン。
  * `ScoreHUD` はコンボ数やスコアに変化があった場合のみ再描画を行うよう最適化。
  * `StageProduction` は `productionLevel`（1〜4）の変化にフックして、背景のパーティクル量やライトの強度などの描画パラメータを動的に変更する。

## 4. データモデル設計

### 4.1. NoteData (`src/types/note.ts`)
```typescript
interface NoteData {
  id: string;
  hand: 'left' | 'right';
  text: string;
  startTime: number;
  endTime: number;
  spawnTime: number;
  targetX: number, targetY: number;
  speed: number;        // 難易度依存
  hitboxRadius: number; // 判定半径
  magnetPower: number;  // 吸着強度
  sourceStartTimes?: number[]; // マージされた元単語のID群
}
```

### 4.2. DifficultyConfig (`src/config/difficulty.ts`)
難易度ごとの動的パラメータセット（`speed`, `mergeCount`, `timingWindow` 等）。

## 5. 主要アルゴリズム

### 5.1. ノーツマージ・振り分けロジック (`NoteManager.tsx`)
1. 楽曲Wordリストを難易度依存の `mergeCount` に基づきチャンク化 (`mergeUnits`)。
2. インデックス mod 2 により「左手」「右手」へ交互にノーツを配分。
3. `CONDUCTOR_PATTERN` (3x3グリッドベースの指揮軌道テンプレート) に基づいて `targetX/Y` を割り当て。

### 5.2. 演出演出補正計算 (`StageProduction.tsx`)
`calculateFinalLevel(baseLevel, now, choruses)`:
- `baseLevel`: コンボ数に基づく 1〜4 のランク。
- `now` が `choruses`（サビ区間）内の場合、`baseLevel` に関わらず強制的に `Level 4` を返す。
- サビ終わりから一定期間はレベルを維持し、視覚的な熱量を保つ。
1. `MusicManager` が楽曲再生をトリガー。現在再生時間(`currentTime`)を更新。
2. `NoteManager` が `currentTime` を監視。`spawnTime` を迎えた `Note` を生成・描画。
3. `HandTracker` / `VirtualInputManager` が入力を監視。
4. プレイヤーのアクションが判定エリア(`target`座標)内で発生したかを計算。
5. ヒットの場合、`Note` は消滅・エフェクト発生。`useGameState().actions.onHit()` が呼ばれる。
6. State更新に伴い、`ScoreHUD`がスコア加算・コンボ更新を行い、`StageProduction` が必要に応じて演出を強化（Level UP）する。
