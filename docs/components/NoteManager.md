# 詳細設計書: `src/components/NoteManager.tsx`

## `function NoteManager({ handsDataRef }: { handsDataRef: BothHandsDataRef })`
* **概要**: 楽曲データの解析済み歌詞テキストリストから、タイミングに応じて `Note` コンポーネント群を画面に出現・消滅させるオーケストレーター。左右手への振り分けも担当。
* **パラメータ**:
  * `handsDataRef` (BothHandsDataRef): 実体化する `Note` に提供するための座標の入った参照オブジェクト。
* **戻り値**: 配置された `Note` および誘導エフェクトの `JSX.Element`。

### 内部関数 (Internal Functions)

#### `function createStarShape()`
* **概要**: タイミングガイド用の五芒星シェイプをジオメトリとして動的に生成する関数。
* **パラメータ**: なし
* **戻り値**: 星型のパスを含んだ Three.js `Shape` オブジェクト。

#### `function TimingStar({ hand, wordsRef, positionRef }: { hand: 'left' | 'right'; wordsRef: React.RefObject<{ text: string; startTime: number; endTime: number }[]>; positionRef: React.RefObject<number> })`
* **概要**: 座標進行パスに沿って、次にノーツが発生する位置へ移動する誘導エフェクトを描画する。
* **パラメータ**:
  * `hand` ('left' | 'right'): 左右どちら向けのタイミングガイドであるか。
  * `wordsRef`: 対象となる手が出現する予定の歌詞情報の配列参照。
  * `positionRef` (React.RefObject<number>): 曲の最新時刻への参照。
* **戻り値**: ラインおよび星型アイコンの `JSX.Element`。
