import { useState, useEffect } from 'react';
import { useGameState } from '../hooks/useGameState';
import type { GameState } from '../hooks/useGameState';
import { useMusicPlayer } from '../hooks/useMusicPlayer';

/**
 * ScoreHUD — スコアとコンボ数を表示するヘッドアップディスプレイ
 *
 * 画面右上に配置し、ゲームプレイ中にリアルタイムで
 * スコア・コンボ数・ヒット数・ミス数を表示する。
 */
export default function ScoreHUD() {
  const { stateRef } = useGameState();
  const { state: musicState } = useMusicPlayer();
  const [display, setDisplay] = useState<GameState>({ ...stateRef.current });

  // 100msごとにUIを更新（パフォーマンスのためポーリング）
  useEffect(() => {
    const interval = setInterval(() => {
      setDisplay({ ...stateRef.current });
    }, 100);
    return () => clearInterval(interval);
  }, [stateRef]);

  return (
    <>
      {/* ========================================================
          トップ中央：コンボ表示（大きく演出）
         ======================================================== */}
      {display.combo > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 20,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          <div
            style={{
              fontSize: 'clamp(48px, 8vw, 96px)', // はるかに大きく
              fontWeight: 900,
              fontFamily: "'Inter', 'Segoe UI', sans-serif",
              color: display.combo >= 10 ? '#ffee88' : '#bbddff',
              textShadow: display.combo >= 10
                ? '0 0 20px rgba(255, 220, 50, 0.8), 0 0 40px rgba(255, 100, 0, 0.5)'
                : '0 0 15px rgba(100, 180, 255, 0.6), 0 0 30px rgba(0, 100, 255, 0.4)',
              lineHeight: 0.9,
              transition: 'color 0.2s ease, text-shadow 0.2s ease',
              fontStyle: 'italic',
            }}
          >
            {display.combo}
          </div>
          <div
            style={{
              fontSize: 'clamp(14px, 2vw, 24px)',
              fontWeight: 700,
              fontFamily: "'Inter', 'Segoe UI', sans-serif",
              color: 'rgba(255, 255, 255, 0.8)',
              letterSpacing: '0.2em',
              textShadow: '0 0 10px rgba(255, 255, 255, 0.4)',
              marginTop: 4,
            }}
          >
            COMBO
          </div>
        </div>
      )}

      {/* ========================================================
          トップ右：スコア、ヒット/ミス、入力モード
         ======================================================== */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          zIndex: 20,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 4,
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        {/* スコア */}
        <div
          style={{
            fontSize: 28,
            fontWeight: 700,
            fontFamily: "'Inter', 'Segoe UI', sans-serif",
            color: '#ffffff',
            textShadow: '0 0 15px rgba(100, 180, 255, 0.6)',
            letterSpacing: 2,
          }}
        >
          {display.score.toLocaleString()}
        </div>

        {/* ヒット/ミス カウンター */}
        <div
          style={{
            fontSize: 12,
            fontFamily: "'Inter', 'Segoe UI', sans-serif",
            color: 'rgba(255, 255, 255, 0.6)',
            display: 'flex',
            gap: 12,
            marginTop: 4,
            fontWeight: 600,
          }}
        >
          <span>HIT {display.hits}</span>
          <span>MISS {display.misses}</span>
        </div>

        {/* 入力モードインジケーター */}
        {(musicState.isVirtualInputMode || musicState.isAutoPlayMode) && (
          <div style={{
            marginTop: 8,
            fontSize: 11,
            fontWeight: 600,
            fontFamily: "'Inter', 'Segoe UI', sans-serif",
            color: 'rgba(255, 220, 100, 0.8)',
            letterSpacing: 1,
            background: 'rgba(50, 40, 0, 0.6)',
            padding: '4px 8px',
            borderRadius: 4,
            border: '1px solid rgba(255, 200, 50, 0.3)',
          }}>
            {musicState.isVirtualInputMode && '⌨️ TOUCH/KEY'}
            {musicState.isAutoPlayMode && ' 🤖 AUTO'}
          </div>
        )}
      </div>
    </>
  );
}
