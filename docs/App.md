# 詳細設計書: `src/App.tsx`

## `function App()`
* **概要**: リアクトツリーの根幹。各種Provider (`GameStateProvider`, `MusicProvider`) で子階層をラップし、`Scene`, `MusicManager`, `ScoreHUD`などのコアUI全体を統括するルートコンポーネント。
* **パラメータ**: なし
* **戻り値**: ツリー全体の `JSX.Element`。
