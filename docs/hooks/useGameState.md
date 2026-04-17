# 詳細設計書: `src/hooks/useGameState.tsx`

## `function GameStateProvider({ children }: { children: ReactNode })`
* **概要**: ゲーム全体のスコア、コンボ数、ヒット/ミス数、演出レベルなどを管理し、ツリー内の子コンポーネントへゲーム状態コンテキストを提供する。
* **パラメータ**:
  * `children` (ReactNode): Providerでラップされる要素。
* **戻り値**: Provider要素の `JSX.Element`。

## `function useGameState(): GameStateContextValue`
* **概要**: `GameStateContext` からゲームステート全体へアクセスするためのフック。
* **パラメータ**: なし
* **戻り値**: ゲームステート変数 (`stateRef`) と更新アクション (`onHit`, `onMiss`, `reset`) を含むオブジェクト。

## `function useProductionLevel(): number`
* **概要**: 現在のゲーム状態における「演出レベル」のみを抽出し、再描画の頻度を最小化するための軽量フック。
* **パラメータ**: なし
* **戻り値**: 現在の演出レベル（1〜4）。
