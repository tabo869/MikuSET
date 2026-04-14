import type { CalibrationBounds } from '../types/hand';

/**
 * カメラ2D座標 → Three.js 3D座標 変換ユーティリティ
 *
 * MediaPipeのランドマークは正規化座標（0.0〜1.0）で返される。
 * これをThree.jsのワールド座標に変換する。
 * ※ X軸は左右反転（ミラーリング）して、鏡のように自然に操作できるようにする。
 */

/**
 * 3D空間のマッピング範囲
 *
 * カメラ設定: position=[0,0,8], fov=50
 *   → Z=0 平面での表示範囲: tan(25°)*8 ≈ ±3.73 (Y), ±6.63 (X, 16:9想定)
 *
 * ★ Y を ±2.8 に抑えることで、どの解像度・アスペクト比でも
 *   バトンが画面外に出ない安全マージンを確保する。
 * ★ X も ±4.8 に抑えて左右端での消失を防ぐ。
 */
const RANGE = {
  x: { min: -4.8, max: 4.8 },  // 左右方向（画面端より少し内側）
  y: { min: -2.8, max: 2.8 },  // 上下方向（画面端より少し内側）
  z: { min: -2,   max: 2   },  // 奥行き方向
} as const;

/**
 * 正規化された2D座標を3D空間座標に変換する
 *
 * @param normX - MediaPipeのX座標（0.0〜1.0、左が0）
 * @param normY - MediaPipeのY座標（0.0〜1.0、上が0）
 * @param normZ - MediaPipeのZ座標（深度、手首からの相対値）
 * @param bounds - ユーザーが設定したキャリブレーション領域（未設定ならnull）
 * @returns Three.jsワールド座標 { x, y, z }（RANGE 内にクランプ済み）
 */
export function mapToWorld(
  normX: number,
  normY: number,
  normZ: number,
  bounds: CalibrationBounds | null = null
): { x: number; y: number; z: number } {
  // キャリブレーション情報がある場合は、その矩形範囲を 0.0〜1.0 に再スケールする
  let effectiveNormX = normX;
  let effectiveNormY = normY;

  if (bounds) {
    const rangeX = bounds.maxX - bounds.minX;
    const rangeY = bounds.maxY - bounds.minY;
    // ゼロ除算ガード
    if (rangeX > 0.01) effectiveNormX = (normX - bounds.minX) / rangeX;
    if (rangeY > 0.01) effectiveNormY = (normY - bounds.minY) / rangeY;
  }

  // X軸：左右反転（ミラーリング）— (1 - effectiveNormX) で反転
  const rawX = RANGE.x.min + (1 - effectiveNormX) * (RANGE.x.max - RANGE.x.min);

  // Y軸：MediaPipeはY=0が上端、Three.jsはY+が上なので反転
  const rawY = RANGE.y.min + (1 - effectiveNormY) * (RANGE.y.max - RANGE.y.min);

  // Z軸：深度情報をマッピング（normZは負の値が手前）
  const rawZ = normZ * (RANGE.z.max - RANGE.z.min);

  // ★ クランプ：計算結果がRANGE外に出た場合（キャリブレーション境界付近など）も
  //   常に表示範囲内に収める
  const x = Math.max(RANGE.x.min, Math.min(RANGE.x.max, rawX));
  const y = Math.max(RANGE.y.min, Math.min(RANGE.y.max, rawY));
  const z = Math.max(RANGE.z.min, Math.min(RANGE.z.max, rawZ));

  return { x, y, z };
}

