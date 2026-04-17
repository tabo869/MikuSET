# 詳細設計書 (DD) - MikuSET

## 1. システムアーキテクチャ
* **フレームワーク**: React (Vite)
* **言語**: TypeScript
* **コンポーネント構成**: 関数コンポーネント指向、Hooksを用いた状態管理
* **スタイリング**: カスタムCSS (index.css) 及びインラインスタイル

## 2. 状態管理設計 (State Management)
全体の状態は React の Context API と Custom Hooks を用いて管理・提供する。

### 2.1. GameStateProvider (`useGameState.tsx`)
ゲームの進行状況（スコア、コンボ等）を管理し、プロバイダー内で状態を保持する。
* **状態構造 (GameState)**:
  * `score` (number): 現在のスコア
  * `combo` (number): 現在の連続コンボ数
  * `maxCombo` (number): プレイ中の最大コンボ数
  * `hits` (number): ヒット総数
  * `misses` (number): ミス総数
  * `productionLevel` (number): 演出レベル (1〜4)
* **アクション**:
  * `onHit`: ヒット時の計算処理。コンボインクリメント、スコア計算（`Base(100) + Combo*10`）、演出レベルの更新を担う。
  * `onMiss`: ミス時の処理。コンボおよび演出レベル（1にリセット）の初期化。
  * `reset`: 全ステートの初期化。

### 2.2. MusicProvider (`useMusicPlayer.tsx`)
楽曲の再生状態、再生時間、現在進行中の楽曲情報を管理する。各コンポーネントからこのロジックにアクセスし、ノートの出現タイミング等を同期する。

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

### 4.1. NoteData (`types/note.ts`)
```typescript
interface NoteData {
  id: string;              // 一意のID
  hand: 'left' | 'right';  // 対象となる手
  text: string;            // 表示する歌詞
  startTime: number;       // 発声開始時刻 (ms)
  endTime: number;         // 発声終了時刻 (ms)
  spawnTime: number;       // 出現時刻 (startTimeの数秒前)
  targetX: number;
  targetY: number;
  // ... その他表示・色情報
}
```

### 4.2. SongInfo (`config/songs.ts`)
```typescript
export interface SongInfo {
  title: string;   // 曲名
  artist: string;  // アーティスト名
  url: string;     // 音源URL
}
```

## 5. モジュール間連携のフロー
1. `MusicManager` が楽曲再生をトリガー。現在再生時間(`currentTime`)を更新。
2. `NoteManager` が `currentTime` を監視。`spawnTime` を迎えた `Note` を生成・描画。
3. `HandTracker` / `VirtualInputManager` が入力を監視。
4. プレイヤーのアクションが判定エリア(`target`座標)内で発生したかを計算。
5. ヒットの場合、`Note` は消滅・エフェクト発生。`useGameState().actions.onHit()` が呼ばれる。
6. State更新に伴い、`ScoreHUD`がスコア加算・コンボ更新を行い、`StageProduction` が必要に応じて演出を強化（Level UP）する。
