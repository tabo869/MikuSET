/**
 * 難易度設定マスターデータ
 *
 * ノーツの密度（mergeCount）・速度・判定範囲・吸着力・軌道タイプを
 * 4段階の難易度ごとに定義する。
 */

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

/** 難易度レベル */
export type DifficultyLevel = 'Easy' | 'Normal' | 'Hard' | 'Very Hard';

/** 軌道タイプ */
export type TrajectoryType = 'straight' | 'curve' | 'spiral' | 'mixed';

/** 難易度ごとのパラメータ */
export interface DifficultyConfig {
  /** 表示ラベル */
  label: string;
  /** TextAlive のテキスト単位 ('word' | 'char') */
  textUnit: 'word' | 'char';
  /**
   * マージカウント — 何個の word/char を 1 つのノーツにまとめるか
   * 例: 2 → 2 つの word を結合して 1 ノーツ化（密度半減）
   */
  mergeCount: number;
  /** ノーツが出現してから判定位置に到達するまでの時間（ms） */
  speed: number;
  /** 当たり判定の X/Y 半径（大きいほど甘い） */
  hitboxRadius: number;
  /** 吸着（マグネット）速度の倍率 */
  magnetPower: number;
  /** ノーツの軌道タイプ */
  trajectoryType: TrajectoryType;
  /** タイミングウィンドウ（ms）— 判定時刻とのずれ許容幅 */
  timingWindow: number;
}

// ---------------------------------------------------------------------------
// マスターデータ
// ---------------------------------------------------------------------------

export const DIFFICULTIES: Record<DifficultyLevel, DifficultyConfig> = {
  Easy: {
    label: 'Easy — やさしい',
    textUnit: 'word',
    mergeCount: 3,
    speed: 2800,
    hitboxRadius: 6.0,
    magnetPower: 35,
    trajectoryType: 'straight',
    timingWindow: 600,
  },
  Normal: {
    label: 'Normal — ふつう',
    textUnit: 'word',
    mergeCount: 1,
    speed: 2000,
    hitboxRadius: 5.5,
    magnetPower: 30,
    trajectoryType: 'straight',
    timingWindow: 500,
  },
  Hard: {
    label: 'Hard — むずかしい',
    textUnit: 'char',
    mergeCount: 2,
    speed: 1800,
    hitboxRadius: 4.0,
    magnetPower: 25,
    trajectoryType: 'curve',
    timingWindow: 350,
  },
  'Very Hard': {
    label: 'Very Hard — 超上級',
    textUnit: 'char',
    mergeCount: 1,
    speed: 1500,
    hitboxRadius: 3.0,
    magnetPower: 20,
    trajectoryType: 'mixed',
    timingWindow: 250,
  },
};

/** 難易度の全レベル一覧（UI 表示順） */
export const DIFFICULTY_LEVELS: DifficultyLevel[] = ['Easy', 'Normal', 'Hard', 'Very Hard'];
