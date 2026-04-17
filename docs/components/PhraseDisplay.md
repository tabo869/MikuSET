# 詳細設計書: `src/components/PhraseDisplay.tsx`

## `function PhraseDisplay({ positionRef }: { positionRef: React.RefObject<number> })`
* **概要**: 現在の再生時間にシンクして、歌詞テキストを下から奥へ向かって3Dスターウォーズ風のスクロールで描画・更新するエフェクトレイヤー。
* **パラメータ**:
  * `positionRef` (React.RefObject<number>): スクロールのタイミング基準となる現在時刻の参照。
* **戻り値**: DOMでのCSS3D風テキストスクロール群の `JSX.Element`。

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
