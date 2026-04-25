import { useState, useEffect } from 'react';
import { useGameState } from '../hooks/useGameState';
import type { GameState } from '../hooks/useGameState';
import { useMusicPlayer } from '../hooks/useMusicPlayer';

/**
 * ScoreHUD — スコアとコンボ数を表示するヘッドアップディスプレイ
 */
export default function ScoreHUD() {
  const { stateRef } = useGameState();
  const { state: musicState } = useMusicPlayer();
  const [display, setDisplay] = useState<GameState>({ ...stateRef.current });

  const isJa = musicState.language === 'ja';

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
            top: 'clamp(12px, 4vh, 24px)',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 20,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            pointerEvents: 'none',
            userSelect: 'none',
            width: '100%',
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
            {isJa ? 'コンボ' : 'COMBO'}
          </div>
        </div>
      )}

      {/* ========================================================
          トップ右：スコア、ヒット/ミス、入力モード
         ======================================================== */}
      <div
        className="hud-score-container"
        style={{
          position: 'absolute',
          top: 'clamp(8px, 2vh, 16px)',
          right: 'clamp(16px, 4vw, 32px)', // Paddingを増やして見切れを防止
          zIndex: 20,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 'clamp(2px, 0.5vh, 4px)',
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        {/* スコア */}
        <div
          style={{
            fontSize: 'clamp(40px, 6vw, 72px)', // 大幅に拡大
            fontWeight: 900,
            fontStyle: 'italic',
            fontFamily: "'Inter', 'Segoe UI', sans-serif",
            color: '#ffffff',
            textShadow: '0 0 20px rgba(0, 210, 255, 0.8), 0 0 40px rgba(0, 150, 255, 0.5)',
            letterSpacing: 4,
            lineHeight: 1,
            transition: 'all 0.1s ease',
          }}
        >
          {display.score.toLocaleString()}
        </div>

        {/* ヒット/ミス カウンター */}
        <div style={{
          display: 'flex',
          gap: 'clamp(12px, 3vw, 24px)',
          marginTop: 'clamp(4px, 1vh, 8px)',
          fontFamily: 'monospace',
          fontSize: 'clamp(16px, 2.5vw, 32px)',
          fontWeight: 700,
          letterSpacing: '0.05em'
        }}>
          <div style={{ color: '#ffffff', textShadow: '0 0 10px rgba(100,200,255,0.6)' }}>
            <span style={{ fontSize: '0.7em', color: '#88aaff', marginRight: 4 }}>HIT</span>
            {display.hits}
          </div>
          <div style={{ color: '#ff4466', textShadow: '0 0 10px rgba(255,0,50,0.4)' }}>
            <span style={{ fontSize: '0.7em', color: '#ff88aa', marginRight: 4 }}>MISS</span>
            {display.misses}
          </div>
        </div>

        {/* ゲージ（体力） */}
        <div style={{
          marginTop: 8,
          width: 'clamp(120px, 20vw, 240px)',
          height: 8,
          background: 'rgba(0,0,0,0.5)',
          borderRadius: 4,
          overflow: 'hidden',
          border: '1px solid rgba(255,255,255,0.2)',
          boxShadow: '0 0 10px rgba(0,0,0,0.5)'
        }}>
          <div style={{
            width: `${display.health}%`,
            height: '100%',
            background: display.health < 30 ? '#ff3355' : display.health < 60 ? '#ffaa22' : '#22ffaa',
            boxShadow: `0 0 15px ${display.health < 30 ? '#ff0033' : '#00ffaa'}`,
            transition: 'width 0.3s ease, background 0.5s ease',
          }} />
        </div>

        {/* 入力モード表示 */}
        <div
          style={{
            marginTop: 'clamp(2px, 0.5vh, 6px)',
            fontSize: 'clamp(10px, 1.2vw, 14px)',
            fontWeight: 700,
            color: musicState.isVirtualInputMode ? '#66ccff' : '#ff88dd',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            background: 'rgba(0, 0, 0, 0.4)',
            padding: '2px 8px',
            borderRadius: 4,
          }}
        >
          {musicState.isVirtualInputMode 
            ? (isJa ? 'タッチ/キーボード入力' : 'TOUCH / KEYBOARD MODE') 
            : (isJa ? 'トラッキング入力' : 'TRACKING MODE')}
        </div>
      </div>
    </>
  );
}
