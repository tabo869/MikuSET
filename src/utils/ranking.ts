/**
 * ranking.ts — ローカルランキング管理ユーティリティ
 *
 * localStorage を使用して楽曲・難易度別に TOP 5 スコアを保存・取得する。
 */

import type { DifficultyLevel } from '../config/difficulty';

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

/** ランキングの1エントリ */
export interface RankingEntry {
  /** プレイヤーイニシャル（3文字） */
  initial: string;
  /** スコア */
  score: number;
  /** 難易度 */
  difficulty: DifficultyLevel;
  /** 記録日時（ISO文字列） */
  date: string;
}

/** 難易度別ランキングデータ */
export type DifficultyRankings = Partial<Record<DifficultyLevel, RankingEntry[]>>;

/** localStorage に保存する楽曲別ランキングデータ */
export interface SongRanking {
  /** 楽曲識別子（URLなど） */
  songId: string;
  /** 難易度別エントリ一覧（各難易度最大5件） */
  byDifficulty: DifficultyRankings;
}

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

/** TOP Nの件数 */
const TOP_N = 5;

/** localStorage キーのプレフィックス */
const STORAGE_KEY_PREFIX = 'mikuset_ranking_';

// ---------------------------------------------------------------------------
// ユーティリティ関数
// ---------------------------------------------------------------------------

/**
 * songId から localStorage キーを生成する
 * URL に含まれる特殊文字をエスケープして安全なキーにする
 */
function makeStorageKey(songId: string): string {
  // btoa はバイナリ安全ではないため、encodeURIComponent でエスケープ
  return STORAGE_KEY_PREFIX + songId.replace(/[^a-zA-Z0-9]/g, '_');
}

/**
 * localStorage から楽曲のランキングデータを取得する
 * 存在しない場合は空のデータを返す
 */
export function getRanking(songId: string): SongRanking {
  try {
    const raw = localStorage.getItem(makeStorageKey(songId));
    if (!raw) return { songId, byDifficulty: {} };
    const parsed = JSON.parse(raw) as SongRanking;
    // byDifficulty が存在しない古い形式への後方互換
    if (!parsed.byDifficulty) return { songId, byDifficulty: {} };
    return parsed;
  } catch {
    return { songId, byDifficulty: {} };
  }
}

/**
 * 指定難易度のランキングエントリ一覧を取得する（降順ソート済み）
 */
export function getRankingByDifficulty(
  songId: string,
  difficulty: DifficultyLevel
): RankingEntry[] {
  const data = getRanking(songId);
  return data.byDifficulty[difficulty] ?? [];
}

/**
 * スコアが指定難易度の TOP N にランクインしているか判定する
 * @returns ランクイン位置（1-based）、ランク外なら null
 */
export function getRankPosition(
  songId: string,
  score: number,
  difficulty: DifficultyLevel
): number | null {
  const entries = getRankingByDifficulty(songId, difficulty);

  // TOP N 未満か、スコアが既存エントリより高い位置があるか調べる
  if (entries.length < TOP_N) {
    // まだ N 件に達していない → 必ずランクイン
    const pos = entries.findIndex((e) => score > e.score);
    return pos === -1 ? entries.length + 1 : pos + 1;
  }

  // N 件埋まっている → 最下位より高いか確認
  const lowestScore = entries[entries.length - 1].score;
  if (score <= lowestScore) return null;

  const pos = entries.findIndex((e) => score > e.score);
  return pos === -1 ? TOP_N : pos + 1;
}

/**
 * スコアが TOP N にランクインしているか真偽で返す
 */
export function isHighScore(
  songId: string,
  score: number,
  difficulty: DifficultyLevel
): boolean {
  return getRankPosition(songId, score, difficulty) !== null;
}

/**
 * ランキングにエントリを追加・保存する
 * 自動的に降順ソートして上位 TOP_N 件のみ保持する
 *
 * @returns 保存後のランキングデータ
 */
export function saveRanking(
  songId: string,
  entry: RankingEntry
): SongRanking {
  const data = getRanking(songId);
  const existing = data.byDifficulty[entry.difficulty] ?? [];

  // 新エントリを追加してスコア降順ソート → TOP N 件に絞る
  const updated = [...existing, entry]
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N);

  const newData: SongRanking = {
    songId,
    byDifficulty: {
      ...data.byDifficulty,
      [entry.difficulty]: updated,
    },
  };

  try {
    localStorage.setItem(makeStorageKey(songId), JSON.stringify(newData));
  } catch (e) {
    console.warn('[Ranking] localStorage への保存に失敗しました:', e);
  }

  return newData;
}

/**
 * 全難易度のランキングをまとめて取得する（トップ画面のボード表示用）
 */
export function getAllDifficultyRankings(
  songId: string
): DifficultyRankings {
  return getRanking(songId).byDifficulty;
}
