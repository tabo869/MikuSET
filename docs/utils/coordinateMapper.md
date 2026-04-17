# 詳細設計書: `src/utils/coordinateMapper.ts`

## `function mapToWorld(normX: number, normY: number, normZ: number, bounds: CalibrationBounds | null = null): { x: number; y: number; z: number }`
* **概要**: MediaPipeが返す2次元の正規化座標領域（0.0〜1.0）とユーザーのキャリブレーション領域に基づき、Three.js空間内の3Dワールド座標に変換・クランプ・ミラーリングする。
* **パラメータ**:
  * `normX` (number): MediaPipeの抽出したX正規化座標。
  * `normY` (number): MediaPipeの抽出したY正規化座標。
  * `normZ` (number): 深度（相対Z値）。
  * `bounds` (CalibrationBounds | null): キャリブレーションの境界枠情報。
* **戻り値**: 3Dワールド座標オブジェクト `{ x, y, z }`。
