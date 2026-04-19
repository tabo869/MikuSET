# 詳細設計書: `src/components/PhraseDisplay.tsx`

## `function PhraseDisplay({ positionRef }: { positionRef: React.RefObject<number> })`
* **概要**: 現在の再生時間にシンクして、歌詞テキストを下から奥へ向かって3Dスターウォーズ風のスクロールで描画・更新するエフェクトレイヤー。
* **パラメータ**:
  * `positionRef` (React.RefObject<number>): スクロールのタイミング基準となる現在時刻の参照。
* **戻り値**: DOMでのCSS3D風テキストスクロール群の `JSX.Element`。
* **表示条件**: 楽曲が再生中 (`state.isPlaying`) かつ楽曲データが準備完了 (`state.isVideoReady`) の場合のみ表示を行う。これらを満たさない場合（トップ画面等）は、一切の歌詞要素を描画せず、非表示としなければならない。

### 2. 歌詞ティッカー（最前列）のスクロール仕様
画面下部に表示される現在歌唱中の歌詞（ティッカー）は、歌唱の進行に合わせて水平スクロールを行う。
- **基準位置 (Target Offset)**: 歌唱中のワードが画面のどの位置に来るようにスクロールさせるかの基準。通常は画面中央（50%）とする。
- **開始時のオフセット**: 歌唱開始直後、最初のワードが左端の減光エリア（フェードアウト領域）に重ならないよう、スクロールの下限値を調整する。
- **初期配置**: 歌唱開始時、最初のワードが画面の左から **約25%** の位置に配置されるように初期オフセットを設定し、そこからスムーズに中央（50%）へとスクロールが移行する設計とする。

### 内部関数 (Internal Functions)

#### `function isWordHit(startTime: number): boolean`
* **概要**: 指定された startTime の歌詞ワードが、既にゲーム内でヒット処理済（スコア化済）であるかを判定し、色変化等に利用する。
* **パラメータ**:
  * `startTime` (number): チェックする単語の発生開始時間（ms）。
* **戻り値**: ヒット済であれば `true`、それ以外は `false`。

#### `function generateChunks(words: WordData[], chunkSize: number): ChunkData[]`
* **概要**: 歌詞の Flat な配列を指定された長さに切り分けて Chunk（最前列で表示するフレーズブロック）に変換するユーティリティ。
* **パラメータ**:
  * `words` (WordData[]): 単語群の配列。
  * `chunkSize` (number): 1ブロックあたりに結合する最大単語数。
* **戻り値**: 固められた `ChunkData` の配列。
