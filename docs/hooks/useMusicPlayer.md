# 詳細設計書: `src/hooks/useMusicPlayer.tsx`

## `function MusicProvider({ children }: { children: ReactNode })`
* **概要**: `TextAlive App API` の Player インスタンスの初期化とライフサイクルを管理し、楽曲の現在時刻や楽曲読み込み状態をツリーに提供する。
* **パラメータ**:
  * `children` (ReactNode): Providerでラップされる要素。
* **戻り値**: Provider要素の `JSX.Element`。

## `function useMusicPlayer(): MusicPlayerContextValue`
* **概要**: 楽曲の再生状態ステート・アクション群、および毎フレーム更新される楽曲の最新時間を取得するフック。
* **パラメータ**: なし
* **戻り値**: アプリ制御用オブジェクト (`state`, `actions`, `positionRef`, `maxPositionRef`)。
