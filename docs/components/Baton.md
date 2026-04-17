# 詳細設計書: `src/components/Baton.tsx`

## `function Baton({ handDataRef, trailColor = '#66aaff' }: { handDataRef: HandDataRef; trailColor?: string })`
* **概要**: プレイヤーの手の動きに追従して、3D空間上で発光しながら軌跡（Trail）を描く指揮棒を描画する。
* **パラメータ**:
  * `handDataRef` (HandDataRef): 追従させる対象となる片手分の座標生データ参照コンテナ。
  * `trailColor` (string): 軌跡カラー（オプション）。指定がない場合はブルー系のHEX色となる。
* **戻り値**: ボールと軌跡エフェクトの `JSX.Element`。
