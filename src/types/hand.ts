/**
 * ハンドトラッキングの共有データ型定義（両手対応）
 */

/** 3D空間上の座標 */
export interface HandPosition {
  /** 人差し指の先端（Landmark 8）の3D座標 */
  fingertip: { x: number; y: number; z: number };
  /** キャリブレーション用の生の正規化座標(0.0~1.0) */
  rawFingertip: { x: number; y: number; z: number };
  /** 中指の付け根（Landmark 9 / 手のひら中心付近）の3D座標 */
  palmCenter: { x: number; y: number; z: number };
  /** 手が検出されているかどうか */
  detected: boolean;
}

/** 両手のトラッキングデータ */
export interface BothHandsData {
  /** 左手のデータ */
  left: HandPosition;
  /** 右手のデータ */
  right: HandPosition;
}

/** HandTrackerからBatonへ渡す共有データのRef型（両手） */
export interface BothHandsDataRef {
  current: BothHandsData;
}

/** 片手用の共有データRef型（Batonコンポーネント用） */
export interface HandDataRef {
  current: HandPosition;
}

/** HandPositionの初期値 */
export const DEFAULT_HAND_POSITION: HandPosition = {
  fingertip: { x: 0, y: 0, z: 0 },
  rawFingertip: { x: 0, y: 0, z: 0 },
  palmCenter: { x: 0, y: 0, z: 0 },
  detected: false,
};

/** 両手データの初期値 */
export const DEFAULT_BOTH_HANDS: BothHandsData = {
  left: { ...DEFAULT_HAND_POSITION },
  right: { ...DEFAULT_HAND_POSITION },
};

/** キャリブレーションの境界領域（カメラ画角内の0.0〜1.0） */
export interface CalibrationBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** 両手のキャリブレーションデータ */
export interface CalibrationData {
  left: CalibrationBounds | null;
  right: CalibrationBounds | null;
}

/** キャリブレーションデータの初期値（未設定） */
export const DEFAULT_CALIBRATION_DATA: CalibrationData = {
  left: null,
  right: null,
};

/**
 * キャリブレーション取得用の一時共有オブジェクト
 * Reactのレンダリングサイクル外で最新の生正規化座標を保持する
 */
export const LIVE_RAW_HANDS: {
  left: { x: number; y: number } | null;
  right: { x: number; y: number } | null;
} = {
  left: null,
  right: null,
};

