/**
 * ResultScreen.tsx — リザルト画面コンポーネント
 *
 * ゲーム終了後に表示するリザルト画面。
 * 成績詳細 → イニシャル入力（ランクイン時）→ ランキング表示 の3フェーズで構成。
 * isVirtualInputMode に応じてイニシャル入力UIを自動切替する。
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { GameState } from '../hooks/useGameState';
import type { DifficultyLevel } from '../config/difficulty';
import { DIFFICULTY_LEVELS } from '../config/difficulty';
import {
  isHighScore,
  getRankPosition,
  saveRanking,
  getRankingByDifficulty,
} from '../utils/ranking';
import type { RankingEntry } from '../utils/ranking';

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

interface ResultScreenProps {
  /** リザルト画面の表示フラグ */
  isVisible: boolean;
  /** ゲームオーバーかどうか */
  isGameOver: boolean;
  /** 現在の楽曲URL（ランキングのsongIdとして使用） */
  activeSongUrl: string;
  /** ゲーム状態のスナップショット */
  gameState: GameState;
  /** タッチ/バーチャル入力モードかどうか（UIの切り替え判定） */
  isVirtualInputMode: boolean;
  /** オートプレイモードかどうか */
  isAutoPlayMode: boolean;
  /** 「次へ」ボタン押下時のコールバック */
  onClose: () => void;
}

/** リザルト画面の表示フェーズ */
type ResultPhase = 'stats' | 'initial_input' | 'ranking';

// ---------------------------------------------------------------------------
// 補助コンポーネント
// ---------------------------------------------------------------------------

/** スピナー1文字分（タッチ向けA-Zセレクター） */
function CharSpinner({
  value,
  onChange,
  index,
}: {
  value: string;
  onChange: (char: string) => void;
  index: number;
}) {
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.!-? ';

  const handleUp = () => {
    const idx = CHARS.indexOf(value);
    onChange(CHARS[(idx - 1 + CHARS.length) % CHARS.length]);
  };
  const handleDown = () => {
    const idx = CHARS.indexOf(value);
    onChange(CHARS[(idx + 1) % CHARS.length]);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        animation: `slideUp 0.6s ease-out ${0.1 * index}s both`,
      }}
    >
      <button
        onClick={handleUp}
        style={spinnerBtnStyle}
        aria-label={`文字${index + 1}を上へ`}
      >
        ▲
      </button>
      <div
        style={{
          fontSize: 48,
          fontWeight: 900,
          color: '#00d2ff',
          width: 60,
          textAlign: 'center',
          textShadow: '0 0 20px rgba(0,210,255,0.8)',
          fontFamily: "'Inter', 'Segoe UI', monospace",
        }}
      >
        {value}
      </div>
      <button
        onClick={handleDown}
        style={spinnerBtnStyle}
        aria-label={`文字${index + 1}を下へ`}
      >
        ▼
      </button>
    </div>
  );
}

const spinnerBtnStyle: React.CSSProperties = {
  background: 'rgba(0, 210, 255, 0.15)',
  border: '1px solid rgba(0, 210, 255, 0.4)',
  borderRadius: 8,
  color: '#00d2ff',
  fontSize: 18,
  padding: '8px 16px',
  cursor: 'pointer',
  transition: 'all 0.15s ease',
};

/** 難易度バッジ */
function DiffBadge({ diff }: { diff: DifficultyLevel }) {
  const colors: Record<DifficultyLevel, string> = {
    Easy: '#44cc88',
    Normal: '#4499ff',
    Hard: '#ff9933',
    'Very Hard': '#ff4466',
  };
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        color: colors[diff],
        border: `1px solid ${colors[diff]}`,
        borderRadius: 4,
        padding: '1px 5px',
        letterSpacing: 0.5,
        opacity: 0.9,
      }}
    >
      {diff.toUpperCase()}
    </span>
  );
}

// ---------------------------------------------------------------------------
// メインコンポーネント
// ---------------------------------------------------------------------------

export default function ResultScreen({
  isVisible,
  isGameOver,
  activeSongUrl,
  gameState,
  isVirtualInputMode,
  isAutoPlayMode,
  onClose,
}: ResultScreenProps) {
  const [phase, setPhase] = useState<ResultPhase>('stats');
  const [initials, setInitials] = useState(['A', 'A', 'A']);
  const [keyboardInitials, setKeyboardInitials] = useState('');
  const [rankingEntries, setRankingEntries] = useState<RankingEntry[]>([]);
  const [selectedDiffTab, setSelectedDiffTab] = useState<DifficultyLevel>(
    gameState.currentDifficulty
  );
  const [savedRank, setSavedRank] = useState<number | null>(null);
  const keyboardInputRef = useRef<HTMLInputElement>(null);

  const { score, maxCombo, perfects, misses, currentDifficulty } = gameState;

  // リザルトが表示されるたびに初期化
  useEffect(() => {
    if (!isVisible) return;

    setPhase('stats');
    setInitials(['A', 'A', 'A']);
    setKeyboardInitials('');
    setSelectedDiffTab(currentDifficulty);
    setSavedRank(null);

    // 統計表示後、自動的にランクイン判定フェーズへ（1.2秒後）
    const timer = setTimeout(() => {
      // オートプレイ時はランキング対象外
      if (!isAutoPlayMode && isHighScore(activeSongUrl, score, currentDifficulty)) {
        setPhase('initial_input');
      } else {
        setRankingEntries(getRankingByDifficulty(activeSongUrl, currentDifficulty));
        setPhase('ranking');
      }
    }, 1800);

    return () => clearTimeout(timer);
  }, [isVisible, activeSongUrl, score, currentDifficulty]);

  // ランキングタブ切り替え
  useEffect(() => {
    setRankingEntries(getRankingByDifficulty(activeSongUrl, selectedDiffTab));
  }, [selectedDiffTab, activeSongUrl]);

  // キーボード入力フォーカス
  useEffect(() => {
    if (phase === 'initial_input' && !isVirtualInputMode) {
      setTimeout(() => keyboardInputRef.current?.focus(), 300);
    }
  }, [phase, isVirtualInputMode]);

  /** イニシャル送信 */
  const handleSubmit = useCallback(() => {
    const initial = isVirtualInputMode
      ? initials.join('')
      : keyboardInitials.toUpperCase().slice(0, 3).padEnd(3, '_');

    if (initial.replace(/_/g, '').length === 0) return;

    const entry: RankingEntry = {
      initial,
      score,
      difficulty: currentDifficulty,
      date: new Date().toISOString(),
    };

    saveRanking(activeSongUrl, entry);
    const rank = getRankPosition(activeSongUrl, score, currentDifficulty);
    setSavedRank(rank);
    setRankingEntries(getRankingByDifficulty(activeSongUrl, currentDifficulty));
    setSelectedDiffTab(currentDifficulty);
    setPhase('ranking');
  }, [initials, keyboardInitials, isVirtualInputMode, score, currentDifficulty, activeSongUrl]);

  if (!isVisible) return null;

  // ---------------------------------------------------------------------------
  // フェーズ別レンダリング
  // ---------------------------------------------------------------------------

  return (
    <div style={overlayStyle}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { transform: translateY(30px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.6; } }
        @keyframes rankIn { from { transform: translateX(-20px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        .result-btn:hover { transform: scale(1.05) !important; }
        .spinner-btn:hover { background: rgba(0,210,255,0.3) !important; }
        .diff-tab:hover { opacity: 1 !important; }
      `}</style>

      {/* ─── タイトル ─── */}
      <h2 style={titleStyle(isGameOver)}>
        {isGameOver ? 'GAME OVER' : 'STAGE CLEARED'}
      </h2>

      {/* ─── スコア ─── */}
      <div style={scoreStyle}>
        {score.toLocaleString()}
      </div>

      {/* ─── 成績詳細パネル ─── */}
      <div style={statsPanel}>
        <StatItem label="MAX COMBO" value={maxCombo} unit="" delay={0} />
        <StatItem label="PERFECT" value={perfects} unit="" delay={0.1} color="#ffdd33" />
        <StatItem label="MISS" value={misses} unit="" delay={0.2} color="#ff6677" />
      </div>

      {isAutoPlayMode && (
        <div style={{
          color: '#ffaa00',
          fontSize: 14,
          fontWeight: 900,
          letterSpacing: 4,
          marginBottom: 20,
          padding: '4px 16px',
          border: '2px solid #ffaa00',
          borderRadius: 4,
          animation: 'fadeIn 0.5s ease-out',
        }}>
          AUTO PLAY - NO RECORD
        </div>
      )}

      {/* ─── イニシャル入力フェーズ ─── */}
      {phase === 'initial_input' && (
        <div style={{ ...phaseBox, animation: 'fadeIn 0.4s ease-out' }}>
          <div style={{ color: '#ffdd33', fontSize: 14, fontWeight: 700, letterSpacing: 3, marginBottom: 8, animation: 'pulse 1.5s infinite' }}>
            ★ NEW RECORD ★
          </div>
          <div style={{ color: '#aaddff', fontSize: 13, marginBottom: 20, opacity: 0.8 }}>
            {getRankPosition(activeSongUrl, score, currentDifficulty)} 位にランクイン！
          </div>

          <div style={{ color: '#ffffff', fontSize: 12, marginBottom: 16, opacity: 0.6, letterSpacing: 2 }}>
            ENTER YOUR INITIALS
          </div>

          {isVirtualInputMode ? (
            /* ── スピナー方式（タッチ向け） ── */
            <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginBottom: 24 }}>
              {initials.map((ch, i) => (
                <CharSpinner
                  key={i}
                  index={i}
                  value={ch}
                  onChange={(c) => setInitials((prev) => prev.map((v, idx) => (idx === i ? c : v)))}
                />
              ))}
            </div>
          ) : (
            /* ── キーボード直接入力方式 ── */
            <div style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <input
        ref={keyboardInputRef}
        type="text"
        maxLength={3}
        value={keyboardInitials}
        onChange={(e) => setKeyboardInitials(e.target.value.toUpperCase().replace(/[^A-Z0-9.!\-? ]/g, ''))}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
        placeholder="ABC"
        style={{
          fontSize: 48,
          fontWeight: 900,
          textAlign: 'center',
          width: 180,
          background: 'rgba(0,210,255,0.1)',
          border: '2px solid rgba(0,210,255,0.5)',
          borderRadius: 12,
          color: '#00d2ff',
          outline: 'none',
          letterSpacing: 12,
          padding: '8px 16px',
          fontFamily: "'Inter', monospace",
          textShadow: '0 0 20px rgba(0,210,255,0.8)',
        }}
      />
      <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>
        英数字・記号(. ! ? -)の3文字を入力 → Enter で決定
      </div>
            </div>
          )}

          <button
            className="result-btn"
            onClick={handleSubmit}
            disabled={
              isVirtualInputMode
                ? false
                : keyboardInitials.length === 0
            }
            style={primaryBtnStyle}
          >
            SUBMIT
          </button>
        </div>
      )}

      {/* ─── ランキング表示フェーズ ─── */}
      {phase === 'ranking' && (
        <div style={{ ...phaseBox, animation: 'fadeIn 0.4s ease-out', width: '100%', maxWidth: 480 }}>
          {savedRank !== null && (
            <div style={{ color: '#ffdd33', fontSize: 13, fontWeight: 700, letterSpacing: 2, marginBottom: 12, animation: 'pulse 2s infinite' }}>
              #{savedRank} に登録されました！
            </div>
          )}

          <div style={{ fontSize: 13, color: '#aaddff', letterSpacing: 3, marginBottom: 12 }}>TOP 5 RANKING</div>

          {/* 難易度タブ */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
            {DIFFICULTY_LEVELS.map((diff) => (
              <button
                key={diff}
                className="diff-tab"
                onClick={() => setSelectedDiffTab(diff)}
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '4px 10px',
                  borderRadius: 20,
                  border: `1px solid ${selectedDiffTab === diff ? '#00d2ff' : 'rgba(255,255,255,0.2)'}`,
                  background: selectedDiffTab === diff ? 'rgba(0,210,255,0.2)' : 'transparent',
                  color: selectedDiffTab === diff ? '#00d2ff' : 'rgba(255,255,255,0.5)',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  opacity: selectedDiffTab === diff ? 1 : 0.6,
                  letterSpacing: 1,
                }}
              >
                {diff.toUpperCase()}
              </button>
            ))}
          </div>

          {/* ランキングリスト */}
          {rankingEntries.length === 0 ? (
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, padding: '20px 0' }}>
              まだ記録がありません
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
              {rankingEntries.map((entry, i) => (
                <div
                  key={`${entry.initial}-${entry.score}-${i}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 16px',
                    background: i === 0
                      ? 'linear-gradient(90deg, rgba(255,215,0,0.15), transparent)'
                      : 'rgba(255,255,255,0.04)',
                    borderRadius: 10,
                    border: i === 0 ? '1px solid rgba(255,215,0,0.3)' : '1px solid rgba(255,255,255,0.08)',
                    animation: `rankIn 0.4s ease-out ${i * 0.08}s both`,
                  }}
                >
                  <div style={{
                    width: 28,
                    fontSize: i === 0 ? 20 : 16,
                    fontWeight: 900,
                    color: ['#ffd700', '#c0c0c0', '#cd7f32'][i] ?? 'rgba(255,255,255,0.5)',
                    textShadow: i === 0 ? '0 0 10px rgba(255,215,0,0.6)' : 'none',
                  }}>
                    {i === 0 ? '👑' : `#${i + 1}`}
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: '#ffffff', fontFamily: 'monospace', flex: '0 0 auto' }}>
                    {entry.initial}
                  </div>
                  <div style={{ flex: 1, textAlign: 'right', fontSize: 18, fontWeight: 700, color: '#aaddff', fontVariantNumeric: 'tabular-nums' }}>
                    {entry.score.toLocaleString()}
                  </div>
                  <DiffBadge diff={entry.difficulty} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── 次へボタン（統計フェーズ以外で表示） ─── */}
      {phase !== 'initial_input' && (
        <button
          className="result-btn"
          onClick={onClose}
          style={{ ...primaryBtnStyle, marginTop: 24, animation: 'slideUp 1s ease-out 0.3s both' }}
        >
          NEXT (SELECT SONG)
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 補助コンポーネント（内部）
// ---------------------------------------------------------------------------

function StatItem({
  label,
  value,
  unit,
  delay,
  color = '#ffffff',
}: {
  label: string;
  value: number;
  unit: string;
  delay: number;
  color?: string;
}) {
  return (
    <div style={{ textAlign: 'center', animation: `slideUp 0.6s ease-out ${delay}s both` }}>
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', letterSpacing: 3, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 900, color, fontVariantNumeric: 'tabular-nums', fontFamily: 'monospace' }}>
        {value.toLocaleString()}{unit}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// スタイル定数
// ---------------------------------------------------------------------------

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0, bottom: 0, left: 0, right: 0,
  zIndex: 9999,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'flex-start',
  padding: 'clamp(20px, 4vh, 48px) 20px 80px',
  overflowY: 'auto',
  background: 'radial-gradient(ellipse at 50% 50%, rgba(0,10,30,0.6) 0%, rgba(0,0,0,0.85) 100%)',
  backdropFilter: 'blur(4px)',
  animation: 'fadeIn 0.5s ease-out',
};

const titleStyle = (isGameOver: boolean): React.CSSProperties => ({
  color: isGameOver ? '#ff4444' : '#aaddff',
  fontSize: 'clamp(22px, 4vw, 34px)',
  fontWeight: 900,
  letterSpacing: isGameOver ? 12 : 8,
  marginBottom: 12,
  animation: 'slideUp 0.6s ease-out',
  textShadow: isGameOver ? '0 0 20px rgba(255,0,0,0.8)' : '0 0 20px rgba(100,180,255,0.4)',
  fontFamily: "'Inter', 'Segoe UI', sans-serif",
});

const scoreStyle: React.CSSProperties = {
  fontSize: 'clamp(48px, 12vw, 96px)',
  fontWeight: 900,
  color: '#ffffff',
  textShadow: '0 0 40px rgba(0,210,255,0.6)',
  marginBottom: 'clamp(12px, 2vh, 24px)',
  animation: 'slideUp 0.8s ease-out',
  fontFamily: "'Inter', 'Segoe UI', sans-serif",
  fontStyle: 'italic',
  fontVariantNumeric: 'tabular-nums',
};

const statsPanel: React.CSSProperties = {
  display: 'flex',
  gap: 'clamp(16px, 4vw, 40px)',
  marginBottom: 'clamp(16px, 3vh, 32px)',
  flexWrap: 'wrap',
  justifyContent: 'center',
};

const phaseBox: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 20,
  padding: 'clamp(16px, 3vw, 28px)',
  marginBottom: 8,
  width: '100%',
  maxWidth: 420,
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '14px 40px',
  fontSize: 16,
  fontWeight: 700,
  letterSpacing: 2,
  color: '#ffffff',
  background: 'linear-gradient(135deg, #00d2ff 0%, #3a7bd5 100%)',
  border: 'none',
  borderRadius: 30,
  cursor: 'pointer',
  boxShadow: '0 8px 32px rgba(0,210,255,0.4)',
  transition: 'transform 0.2s ease',
};
