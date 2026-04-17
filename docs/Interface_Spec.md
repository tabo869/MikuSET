# モジュール別 インターフェース仕様書

本ドキュメントでは、MikuSETを構成する主要なモジュール・コンポーネント間の連携で用いられるインターフェース（PropsやContext、共有データ型）の仕様を定義します。

---

## 1. 状態管理モジュール (Context / Hooks)

### 1.1. `useGameState` (Game State Context)
アプリケーション全体のゲームスコアや演出状態を管理し、各コンポーネントへ提供します。

**インターフェース: `GameStateContextValue`**
```typescript
interface GameStateContextValue {
  /** 常に最新のステートを保持するMutableRef (描画をトリガーせずに値参照用) */
  stateRef: React.RefObject<GameState>;
  /** ステート変更用のメソッド群 */
  actions: GameActions;
  /** 再描画用のスナップショット取得 (useSyncExternalStoreなどに利用) */
  getSnapshot: () => GameState;
}

interface GameState {
  score: number;           // 現在のスコア
  combo: number;           // 現在の連続ヒット数
  maxCombo: number;        // 最大連続ヒット数
  hits: number;            // 累積ヒット数
  misses: number;          // 累積ミス数
  productionLevel: number; // 演出レベル (1〜4)
}

interface GameActions {
  onHit: () => void;       // ヒット判定時の更新処理
  onMiss: () => void;      // ミス判定時の更新処理 (コンボリセット等)
  reset: () => void;       // トータルのスコア・コンボのリセット
}
```

### 1.2. `useMusicPlayer` (Music Player Context)
TextAlive App API のPlayerインスタンスや、楽曲の再生状態を管理します。

**インターフェース: `MusicPlayerContextValue`**
```typescript
interface MusicPlayerContextValue {
  /** 再生状態（React側でUIを更新するためのState） */
  state: MusicPlayerState;
  /** Player操作に関わるアクション群 */
  actions: MusicPlayerActions;
  /** 毎フレーム更新される現在の再生時間(ms) を追従するRef（※再描画を伴わない高速参照用） */
  positionRef: React.RefObject<number>;
  /** 曲中の最大到達再生位置(ms) */
  maxPositionRef: React.RefObject<number>;
}

interface MusicPlayerState {
  isPlaying: boolean;          // 再生中フラグ
  isReady: boolean;            // TextAliveからの再生準備完了フラグ
  isVideoReady: boolean;       // 楽曲データ（歌詞・コード等）準備完了フラグ
  isTrackingTest: boolean;     // カメラテストモードの有効化
  calibrationStep: string;     // ハンドトラッキングのキャリブレーション状態
  calibrationData: object;     // キャリブレーション補正データ
  activeSongUrl: string;       // 現在選択中の楽曲(Piapro URL)
  isAutoPlayMode: boolean;     // オートプレイ（デモ）モードの有効化
  isVirtualInputMode: boolean; // バーチャル入力（キーボード/画面タップ）の有効化
}

// ※ アクションとしては play, pause, stop, togglePlayPause, toggleVirtualInputMode 等が含まれる
```

---

## 2. コアプレイモジュール (UI Components)

### 2.1. `Note.tsx` (歌詞ノート単位)
飛んでくる歌詞のかたまり（ノーツ）1つ1つを描画し、判定タイミングにおける当たり判定をローカルで計算します。

**インターフェース: `NoteProps`**
```typescript
interface NoteProps {
  /** 対象ノートのパラメータ（対象の手、目標座標、発声時刻など） */
  note: NoteData;
  /** 楽曲の現在時間(ms)への高速参照。useFrame内で位置補完計算に利用。 */
  positionRef: React.RefObject<number>;
  /** 左右のハンドトラッキング/仮想入力のリアルタイム座標への高速参照。 */
  handsDataRef: BothHandsDataRef;
  /** ヒット成功時に親レイヤー(NoteManager等)へ通知するコールバック */
  onHit: (id: string, hand: 'left' | 'right') => void;
  /** タイミングを逃した場合の親レイヤーへのコールバック */
  onMiss: (id: string, hand: 'left' | 'right') => void;
  /** オートプレイモードかどうか。trueの場合は座標計算をスキップしてジャスト判定になる。 */
  isAutoPlayMode?: boolean;
}
```

### 2.2. `VirtualInputManager.tsx` (仮想入力)
カメラを使わずに、画面タップやキーボード（W/E/R 等）からの入力を「擬似的な3D指先座標」に変換して `handsDataRef` に注入します。

**インターフェース: `VirtualInputManagerProps`**
```typescript
interface VirtualInputManagerProps {
  /** 入力結果を書き込む先のオブジェクト（Noteコンポーネントがこれを参照して当たり判定を行う） */
  handsDataRef: BothHandsDataRef;
  /** 入力受付モードがアクティブかどうか。 */
  isActive: boolean; 
}
```

---

## 3. 共有データモデル (Data Types)

これらのデータ構造は、Reactのライフサイクル外（ `useFrame` の毎フレームなど）でパフォーマンスを落とさずに値をやり取りするためのRef用オブジェクトとして扱われます。

### 3.1. トラッキング情報: `BothHandsDataRef` / `HandPosition`
```typescript
interface BothHandsDataRef {
  current: {
    left: HandPosition;
    right: HandPosition;
  }
}

interface HandPosition {
  /** 指先（または仮想入力）の3D空間内座標(ヒット判定用) */
  fingertip: { x: number; y: number; z: number };
  /** キャリブレーション用の正規化生座標(0.0 - 1.0) */
  rawFingertip: { x: number; y: number; z: number };
  /** 中指・手のひら中心の3D座標 */
  palmCenter: { x: number; y: number; z: number };
  /** 現在この手がデバイス/仮想的に検出・入力されているか */
  detected: boolean;
}
```

### 3.2. 歌詞イベント情報: `NoteData`
```typescript
interface NoteData {
  id: string;              // Word単位やフレーズ単位でのユニークID
  hand: 'left' | 'right';  // このノートを叩くべき手（赤/青など）
  text: string;            // 表示する歌詞テキスト
  startTime: number;       // TextAliveでの発声開始タイミング(ms)
  endTime: number;         // TextAliveでの発声終了タイミング(ms)
  spawnTime: number;       // 画面奥に出現するタイミング（startTimeから逆算して決定）
  targetX: number;         // 手前側のヒット判定位置（X座標）
  targetY: number;         // 手前側のヒット判定位置（Y座標）
  originX: number;         // 奥の出現位置（X座標）
  originY: number;         // 奥の出現位置（Y座標）
  ringColor: string;       // 左右手に合わせた判別色（HEXColor）
}
```

---

## 備考
本システムはThree.js (`@react-three/fiber`) を用いた60FPS描画と、Reactの仮想DOMアップデートを効率的に分離する設計を取っています。
特に `positionRef` や `handsDataRef` などは、React の `useState` を**使わずに**可変オブジェクト（Mutable Ref）として受け渡すことで、再レンダリング処理による描画遅延を防止しています。
