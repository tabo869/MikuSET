/**
 * ノート（歌詞オブジェクト）関連の型定義
 */

/** アクティブなノートのデータ */
export interface NoteData {
  /** 一意のID */
  id: string;
  /** 対象となる手 (左手か右手か) */
  hand: 'left' | 'right';
  /** 表示する歌詞テキスト */
  text: string;
  /** 発声開始時刻（ms） */
  startTime: number;
  /** 発声終了時刻（ms） */
  endTime: number;
  /** 出現時刻（ms）— startTimeの約2秒前 */
  spawnTime: number;
  /** ヒット済みかどうか */
  hit: boolean;
  /** ミス（通り過ぎた）かどうか */
  missed: boolean;
  /** リングガイドの目標X位置（判定位置） */
  targetX: number;
  /** リングガイドの目標Y位置（判定位置） */
  targetY: number;
  /** ノートの初期X位置（出現位置の水平オフセット） */
  originX: number;
  /** ノートの初期Y位置（出現位置の垂直オフセット） */
  originY: number;
  /** リングの蛍光色（HEX） */
  ringColor: string;

  // ---- 難易度パラメータ（省略時はデフォルト定数を使用） ----
  /** ノーツの到達時間（ms） */
  speed?: number;
  /** 当たり判定の X/Y 半径 */
  hitboxRadius?: number;
  /** 吸着速度の倍率 */
  magnetPower?: number;
  /** タイミングウィンドウ（ms） */
  timingWindow?: number;

  // ---- マージ元追跡（歌詞ハイライト用） ----
  /** マージされた元ユニットのstartTime一覧 */
  sourceStartTimes?: number[];
}
