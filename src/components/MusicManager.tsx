import { useRef, useState, useEffect } from 'react';
import { useMusicPlayer } from '../hooks/useMusicPlayer';
import { useGameState } from '../hooks/useGameState';
import { CONTEST_SONGS } from '../config/songs';
import { DIFFICULTIES, DIFFICULTY_LEVELS } from '../config/difficulty';
import type { DifficultyLevel } from '../config/difficulty';

/**
 * MusicManager — 音楽再生制御UIコンポーネント
 *
 * - 再生前/一時停止中：画面中央に大きな「START (再開)」ボタンを表示
 * - 再生中：画面下部に「STOP (中断)」ボタンを表示
 * - 曲の終了時：自動的に停止状態になり、再び中央にスタートボタンが現れる
 */
export default function MusicManager() {
  const { state, actions, positionRef, maxPositionRef } = useMusicPlayer();
  const { stateRef: gameStateRef, actions: gameActions } = useGameState();
  const [displayTime, setDisplayTime] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** カウントダウン状態: null=非表示, 3/2/1=カウント中, 0='GO!' */
  const [countdown, setCountdown] = useState<number | null>(null);

  /** リザルト画面表示状態 */
  const [showResult, setShowResult] = useState<boolean>(false);

  /** フェイクプログレスバー用 (0-100) */
  const [fakeProgress, setFakeProgress] = useState(0);

  const isUserStopped = useRef(false);

  // UI描画用のローカルstate（RefベースのgameStateと同期）
  const [selectedDifficulty, setSelectedDifficulty] = useState<DifficultyLevel>(gameStateRef.current.currentDifficulty);
  const [localOffsetMs, setLocalOffsetMs] = useState(gameStateRef.current.globalOffsetMs);

  /** 難易度変更ハンドラ — ローカルstate + Refの両方を更新 */
  const handleDifficultyChange = (level: DifficultyLevel) => {
    setSelectedDifficulty(level);
    gameActions.setDifficulty(level);
  };

  /** ラグオフセット変更ハンドラ — ローカルstate + Refの両方を更新 */
  const handleOffsetChange = (ms: number) => {
    const clamped = Math.max(-500, Math.min(500, ms));
    setLocalOffsetMs(clamped);
    gameActions.setGlobalOffsetMs(clamped);
  };

  // Loading時のフェイクプログレスアニメーション
  useEffect(() => {
    if (!state.isReady) {
      setFakeProgress(0);
      const timer = setInterval(() => {
        setFakeProgress((prev) => {
          // 90%までは徐々に進み、そこからはゆっくりになる
          const increment = prev < 80 ? Math.random() * 8 + 2 : Math.random() * 2 + 0.5;
          return Math.min(95, prev + increment);
        });
      }, 200);
      return () => clearInterval(timer);
    } else {
      // 読み込み完了したら100%にしてからリセット
      setFakeProgress(100);
      const timer = setTimeout(() => {
        if (state.isReady) setFakeProgress(0);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [state.isReady]);

  // 再生中のみ500msごとに時刻表示を更新
  useEffect(() => {
    if (state.isPlaying) {
      intervalRef.current = setInterval(() => {
        setDisplayTime(positionRef.current);
      }, 500);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [state.isPlaying, positionRef]);

  // Player側が停止（isPlaying: false）になったタイミングで、曲の最後まで来ているか判定する
  useEffect(() => {
    // リザルト表示中は再判定しない
    if (showResult) return;
    if (!state.isPlaying) {
      const lastWordTime = (window as unknown as Record<string, unknown>).__mikusetLastWordTime as number | undefined;
      const duration = (window as unknown as Record<string, unknown>).__mikusetVideoDuration as number | undefined;
      
      let isCleared = false;
      
      // 終了判定: TextAliveからのonTimeUpdateイベント欠落時や早めのonPause発行に備え、大幅なマージン（15000ms）を許容する
      const maxPos = maxPositionRef.current;
      
      if (!isUserStopped.current) {
        if (lastWordTime !== undefined && maxPos > 0 && maxPos >= lastWordTime - 15000) {
          isCleared = true;
        } else if (duration !== undefined && maxPos > 0 && maxPos >= duration - 15000) {
          isCleared = true;
        }
      }
      
      if (isCleared) {
        // ★ 演出レベルだけを即座にリセット（スコア・コンボはリザルト表示に必要なため保持）
        // Ref直書きにより、次のuseFrameで各演出コンポーネントが自律的にエフェクトを非表示にする
        gameStateRef.current.productionLevel = 1;
        setShowResult(true);
      }
    }
  }, [state.isPlaying, maxPositionRef, showResult]);

  /** カウントダウン処理 */
  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      // 'GO!' 表示後に再生開始
      const timer = setTimeout(() => {
        setCountdown(null);
        // 今回の修正で START ボタンからは必ず最初からの扱いになる（STOPを経由するため）
        gameActions.reset();
        actions.play(true); // forceStart
      }, 700);
      return () => clearTimeout(timer);
    }
    // 1秒ごとにカウントダウン
    const timer = setTimeout(() => setCountdown((c) => (c as number) - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown, actions, gameActions]);

  /** 再生開始ハンドラ（即時再生ではなくカウントダウンを起動） */
  const handleStart = () => {
    isUserStopped.current = false;
    setCountdown(3); // 3→2→1→GO→再生
  };

  /** 中断（ストップ）ハンドラ */
  const handleStop = () => {
    isUserStopped.current = true;
    gameActions.reset(); // ★追加: 途中リタイア時もコンボや演出レベル(productionLevel)を確実にリセット
    actions.stop(); // 曲の再生を停止し、位置を0に戻す
  };

  return (
    <>
      {/* ── カウントダウンオーバーレイ ─────────────────────────── */}
      {countdown !== null && (
        <div style={{
          position: 'absolute',
          inset: 0,
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0, 0, 10, 0.75)',
          backdropFilter: 'blur(6px)',
          pointerEvents: 'none',
        }}>
          <div style={{
            fontSize: countdown === 0 ? 96 : 120,
            fontWeight: 900,
            letterSpacing: 8,
            color: countdown === 0 ? '#00ffcc' : '#ffffff',
            textShadow: countdown === 0
              ? '0 0 40px #00ffcc, 0 0 80px #00ffaa'
              : '0 0 40px rgba(255,255,255,0.8)',
            animation: 'countdownPop 0.3s ease-out',
            transition: 'all 0.2s ease',
            lineHeight: 1,
          }}>
            {countdown === 0 ? 'GO!' : countdown}
          </div>
          <div style={{
            marginTop: 32,
            fontSize: 18,
            color: 'rgba(180, 210, 255, 0.8)',
            letterSpacing: 4,
            fontWeight: 300,
          }}>
            NOW LOADING...
          </div>
        </div>
      )}

      {/* ── リザルト画面オーバーレイ ───────────────────────────── */}
      {showResult && (
        <div style={{
          position: 'fixed',
          top: 0, bottom: 0, left: 0, right: 0,
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#000000',
          animation: 'fadeIn 0.5s ease-out',
        }}>
          {/* リザルト画面専用のインラインアニメーション */}
          <style>
            {`
              @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
              @keyframes slideUp { from { transform: translateY(50px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
            `}
          </style>

          <h2 style={{
            color: '#aaddff',
            fontSize: 24,
            letterSpacing: 8,
            marginBottom: 16,
            animation: 'slideUp 0.6s ease-out',
          }}>
            STAGE CLEARED
          </h2>
          
          <div style={{
            fontSize: 96,
            fontWeight: 900,
            color: '#ffffff',
            textShadow: '0 0 40px rgba(0, 210, 255, 0.6)',
            marginBottom: 40,
            animation: 'slideUp 0.8s ease-out',
            fontFamily: "'Inter', 'Segoe UI', sans-serif",
            fontStyle: 'italic',
          }}>
            {/* スコア表示のために GameState を取得 */}
            <ResultScore />
          </div>

          <div style={{ animation: 'slideUp 1s ease-out', display: 'flex', gap: 24 }}>
            <button
              onClick={() => {
                setShowResult(false);
                gameActions.reset();
                // ★ 次の曲で誤った終了判定を防ぐためリセット
                maxPositionRef.current = 0;
                isUserStopped.current = true; // STARTで false に戻る
                actions.stop(); // 確実に再生を停止し、NoteManagerのマウントを解除する
              }}
              style={{
                padding: '16px 40px',
                fontSize: 20,
                fontWeight: 700,
                letterSpacing: 2,
                color: '#ffffff',
                background: 'linear-gradient(135deg, #00d2ff 0%, #3a7bd5 100%)',
                border: 'none',
                borderRadius: 30,
                cursor: 'pointer',
                boxShadow: '0 8px 32px rgba(0, 210, 255, 0.4)',
                transition: 'all 0.2s ease',
              }}
              onMouseOver={(e) => (e.currentTarget.style.transform = 'scale(1.05)')}
              onMouseOut={(e) => (e.currentTarget.style.transform = 'scale(1)')}
            >
              NEXT (SELECT SONG)
            </button>
          </div>
        </div>
      )}

      {/* ── スタート画面オーバーレイ（未再生・カウントダウンなし・リザルトなし時） ───── */}
      {!state.isPlaying && countdown === null && !showResult && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 30,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: state.isTrackingTest ? 'rgba(0, 0, 0, 0.1)' : 'rgba(0, 0, 0, 0.4)',
            backdropFilter: state.isTrackingTest ? 'none' : 'blur(4px)',
            pointerEvents: 'auto',
          }}
        >
          {/* 楽曲選択ドロップダウン */}
          <div style={{ marginBottom: 32, textAlign: 'center' }}>
            <label style={{ color: '#aaddff', fontSize: 14, letterSpacing: 2, display: 'block', marginBottom: 8 }}>
              SELECT SONG
            </label>
            <select
              value={state.activeSongUrl}
              onChange={(e) => actions.selectSong(e.target.value)}
              disabled={!state.isReady}
              style={{
                padding: '8px 16px',
                fontSize: 16,
                fontWeight: 600,
                color: '#ffffff',
                background: 'rgba(30, 80, 150, 0.6)',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 8,
                cursor: 'pointer',
                outline: 'none',
                WebkitAppearance: 'none',
                minWidth: '300px',
              }}
            >
              {CONTEST_SONGS.map((song) => (
                <option key={song.url} value={song.url}>
                  {song.title} / {song.artist}
                </option>
              ))}
            </select>
          </div>

          {/* 難易度選択 */}
          <div style={{ marginBottom: 16, textAlign: 'center' }}>
            <label style={{ color: '#aaddff', fontSize: 14, letterSpacing: 2, display: 'block', marginBottom: 8 }}>
              DIFFICULTY
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              {DIFFICULTY_LEVELS.map((level) => {
                const cfg = DIFFICULTIES[level];
                const isActive = selectedDifficulty === level;
                return (
                  <button
                    key={level}
                    onClick={() => handleDifficultyChange(level)}
                    style={{
                      padding: '6px 16px',
                      fontSize: 13,
                      fontWeight: isActive ? 800 : 500,
                      color: isActive ? '#ffffff' : '#aabbcc',
                      background: isActive
                        ? 'linear-gradient(135deg, #00d2ff 0%, #3a7bd5 100%)'
                        : 'rgba(30, 50, 80, 0.6)',
                      border: isActive
                        ? '2px solid rgba(0, 210, 255, 0.8)'
                        : '1px solid rgba(255,255,255,0.15)',
                      borderRadius: 20,
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      boxShadow: isActive ? '0 4px 16px rgba(0, 210, 255, 0.3)' : 'none',
                    }}
                  >
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ラグ調整 (オフセット) */}
          <div style={{ marginBottom: 24, textAlign: 'center' }}>
            <label style={{ color: '#aaddff', fontSize: 13, letterSpacing: 1, display: 'block', marginBottom: 6 }}>
              ⏱ タイミング調整 (ms): <span style={{ color: '#ffffff', fontWeight: 700 }}>{localOffsetMs}</span>
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center' }}>
              <button
                onClick={() => handleOffsetChange(localOffsetMs - 1)}
                style={{
                  width: 36, height: 36, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.2)',
                  background: 'rgba(30, 50, 80, 0.6)', color: '#ffffff', fontSize: 18, cursor: 'pointer',
                }}
              >−</button>
              <input
                type="range"
                min={-500}
                max={500}
                step={1}
                value={localOffsetMs}
                onChange={(e) => handleOffsetChange(Number(e.target.value))}
                style={{ width: 200, cursor: 'pointer', accentColor: '#00d2ff' }}
              />
              <button
                onClick={() => handleOffsetChange(localOffsetMs + 1)}
                style={{
                  width: 36, height: 36, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.2)',
                  background: 'rgba(30, 50, 80, 0.6)', color: '#ffffff', fontSize: 18, cursor: 'pointer',
                }}
              >+</button>
            </div>
            <div style={{ marginTop: 4, fontSize: 11, color: '#6688aa' }}>
              正の値 → 判定を遅らせる ／ 負の値 → 判定を早める
            </div>
          </div>

          {/* 中央のSTARTボタンとローディングUI */}
          <div style={{ position: 'relative', width: 300, textAlign: 'center' }}>
            <button
              onClick={handleStart}
              disabled={!state.isReady}
              style={{
                width: '100%',
                padding: '16px 24px',
                fontSize: 28,
                fontWeight: 800,
                letterSpacing: 4,
                color: state.isReady ? '#ffffff' : '#888888',
                background: state.isReady
                  ? 'linear-gradient(135deg, #00d2ff 0%, #3a7bd5 100%)'
                  : 'rgba(50, 50, 50, 0.8)',
                border: 'none',
                borderRadius: 36,
                cursor: state.isReady ? 'pointer' : 'not-allowed',
                boxShadow: state.isReady
                  ? '0 8px 32px rgba(0, 210, 255, 0.4), inset 0 2px 4px rgba(255, 255, 255, 0.4)'
                  : 'none',
                transition: 'all 0.3s ease',
                transform: state.isReady ? 'scale(1)' : 'scale(0.95)',
              }}
            >
              {state.isReady ? 'START' : 'LOADING...'}
            </button>
            
            {/* ローディング時のみプログレスバーを表示 */}
            {!state.isReady && (
              <div style={{
                position: 'absolute',
                bottom: -20,
                left: 0,
                right: 0,
                height: 6,
                background: 'rgba(255, 255, 255, 0.1)',
                borderRadius: 3,
                overflow: 'hidden'
              }}>
                <div style={{
                  height: '100%',
                  width: `${fakeProgress}%`,
                  background: '#00d2ff',
                  transition: 'width 0.2s ease-out',
                  boxShadow: '0 0 10px #00d2ff'
                }} />
              </div>
            )}
          </div>

          {/* カメラテストボタン */}
          <button
            onClick={actions.toggleTrackingTest}
            style={{
              padding: '12px 24px',
              fontSize: 16,
              fontWeight: 600,
              color: state.isTrackingTest ? '#ffffff' : '#ccddff',
              background: state.isTrackingTest
                ? 'rgba(255, 100, 150, 0.8)'
                : 'rgba(30, 80, 150, 0.6)',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 24,
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              backdropFilter: 'blur(4px)',
            }}
          >
            {state.isTrackingTest ? '📷 カメラテストを終了' : '📷 トラッキングテスト (カメラON)'}
          </button>

          {/* オートプレイボタン */}
          <label style={{
            marginTop: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer',
            color: '#ffffff',
            fontSize: 14,
            fontWeight: 600,
            background: 'rgba(0, 0, 0, 0.5)',
            padding: '8px 16px',
            borderRadius: 16,
            border: '1px solid rgba(255,255,255,0.2)'
          }}>
            <input 
              type="checkbox" 
              checked={state.isAutoPlayMode}
              onChange={actions.toggleAutoPlay}
              style={{ width: 16, height: 16, cursor: 'pointer' }}
            />
            オートプレイ (演出確認用)
          </label>

          {/* 仮想入力（キーボード・タッチ）ボタン */}
          <label style={{
            marginTop: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer',
            color: '#ffffff',
            fontSize: 14,
            fontWeight: 600,
            background: 'rgba(0, 0, 0, 0.5)',
            padding: '8px 16px',
            borderRadius: 16,
            border: '1px solid rgba(255,255,255,0.2)'
          }}>
            <input 
              type="checkbox" 
              checked={state.isVirtualInputMode}
              onChange={actions.toggleVirtualInputMode}
              style={{ width: 16, height: 16, cursor: 'pointer' }}
            />
            タッチ・キーボード操作モード (カメラOFF)
          </label>


          {state.isTrackingTest && <CalibrationWizard />}

          <div style={{ marginTop: 24, color: '#aaddff', fontSize: 14, letterSpacing: 1 }}>
            {state.statusMessage}
          </div>
        </div>
      )}

      {/* 画面下部のコントロール（再生時のみ） */}
      {state.isPlaying && (
        <div
          style={{
            position: 'absolute',
            bottom: 300, // Webカメラ映像（右下）と被らない位置まで上げる
            right: 32,
            zIndex: 20,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 12,
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 20,
              background: 'rgba(0, 0, 0, 0.5)',
              backdropFilter: 'blur(8px)',
              borderRadius: 24,
              padding: '8px 24px',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              pointerEvents: 'auto', // ボタン部分はクリック可能に
            }}
          >
            {/* STOPボタン */}
            <button
              onClick={handleStop}
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                border: 'none',
                background: 'rgba(255, 60, 100, 0.8)',
                color: '#ffffff',
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 16px rgba(255, 60, 100, 0.4)',
                transition: 'all 0.2s ease',
              }}
              title="演奏を中断する"
            >
              STOP
            </button>

            {/* 時間表示 */}
            <div
              style={{
                color: 'rgba(255, 255, 255, 0.9)',
                fontSize: 16,
                fontWeight: 600,
                fontFamily: 'monospace',
                letterSpacing: 2,
              }}
            >
              {formatTime(displayTime)}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

import { LIVE_RAW_HANDS, type CalibrationData } from '../types/hand';

/** キャリブレーションの各ステップに対応する画面上のマーカー位置と色 */
const CALIBRATION_MARKERS: Record<string, {
  top?: string; bottom?: string; left?: string; right?: string;
  color: string; label: string;
}> = {
  RIGHT_TOP_RIGHT:    { top: '10%',  right: '10%',  color: '#ff6688', label: '①右上' },
  RIGHT_BOTTOM_LEFT:  { bottom: '15%', right: '30%', color: '#ff9944', label: '②右中央下' },
  LEFT_TOP_LEFT:      { top: '10%',  left: '10%',   color: '#44aaff', label: '③左上' },
  LEFT_BOTTOM_RIGHT:  { bottom: '15%', left: '30%',  color: '#44ffcc', label: '④左中央下' },
};

const MARKER_KEYFRAMES = `
@keyframes markerPulse {
  0%   { transform: translate(-50%, -50%) scale(1);   opacity: 0.9; }
  50%  { transform: translate(-50%, -50%) scale(1.25); opacity: 1;   }
  100% { transform: translate(-50%, -50%) scale(1);   opacity: 0.9; }
}
@keyframes markerRingPulse {
  0%   { transform: translate(-50%, -50%) scale(1);   opacity: 0.6; }
  50%  { transform: translate(-50%, -50%) scale(1.6); opacity: 0;   }
  100% { transform: translate(-50%, -50%) scale(1);   opacity: 0.6; }
}
`;

/**
 * キャリブレーションウィザード UIコンポーネント
 */
function CalibrationWizard() {
  const { state, actions } = useMusicPlayer();
  const [points, setPoints] = useState<Record<string, { x: number; y: number }>>({});

  useEffect(() => {
    if (state.calibrationStep === 'NONE') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();

        const isRightStep = state.calibrationStep.startsWith('RIGHT');
        const rawPos = isRightStep ? LIVE_RAW_HANDS.right : LIVE_RAW_HANDS.left;

        if (!rawPos) {
          alert('指定された手がカメラに映っていません！');
          return;
        }

        const newPoints = { ...points, [state.calibrationStep]: { ...rawPos } };
        setPoints(newPoints);

        switch (state.calibrationStep) {
          case 'RIGHT_TOP_RIGHT':
            actions.setCalibrationStep('RIGHT_BOTTOM_LEFT');
            break;
          case 'RIGHT_BOTTOM_LEFT':
            actions.setCalibrationStep('LEFT_TOP_LEFT');
            break;
          case 'LEFT_TOP_LEFT':
            actions.setCalibrationStep('LEFT_BOTTOM_RIGHT');
            break;
          case 'LEFT_BOTTOM_RIGHT': {
            const r1 = newPoints['RIGHT_TOP_RIGHT'];
            const r2 = newPoints['RIGHT_BOTTOM_LEFT'];
            const l1 = newPoints['LEFT_TOP_LEFT'];
            const l2 = newPoints['LEFT_BOTTOM_RIGHT'];

            const newData: CalibrationData = {
              right: {
                minX: Math.min(r1.x, r2.x),
                maxX: Math.max(r1.x, r2.x),
                minY: Math.min(r1.y, r2.y),
                maxY: Math.max(r1.y, r2.y),
              },
              left: {
                minX: Math.min(l1.x, l2.x),
                maxX: Math.max(l1.x, l2.x),
                minY: Math.min(l1.y, l2.y),
                maxY: Math.max(l1.y, l2.y),
              },
            };

            actions.setCalibrationData(newData);
            actions.setCalibrationStep('NONE');
            alert('キャリブレーションが完了しました！\n補正された追従範囲をテストしてください。');
            setPoints({});
            break;
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.calibrationStep, points, actions]);

  if (state.calibrationStep === 'NONE') {
    return (
      <div style={{ marginTop: 16 }}>
        <button
          onClick={() => {
            if (confirm('現在の補正データを破棄して、新しく位置を再設定しますか？')) {
              setPoints({});
              actions.setCalibrationData({ left: null, right: null });
              actions.setCalibrationStep('RIGHT_TOP_RIGHT');
            }
          }}
          style={{
            padding: '8px 16px',
            fontSize: 14,
            background: 'transparent',
            color: '#aaddff',
            border: '1px solid #4466aa',
            borderRadius: 16,
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          🔧 可動範囲キャリブレーションを開始
        </button>
      </div>
    );
  }

  const currentMarker = CALIBRATION_MARKERS[state.calibrationStep];

  let instruction = '';
  switch (state.calibrationStep) {
    case 'RIGHT_TOP_RIGHT':
      instruction = '【ステップ 1/4】\n右手を 画面右上の「①」マーカーへ合わせ、\nそのまま【スペースキー】を押して確定してください。';
      break;
    case 'RIGHT_BOTTOM_LEFT':
      instruction = '【ステップ 2/4】\n右手を 画面右中央下の「②」マーカーへ合わせ\n（胸の前あたり）、【スペースキー】で確定してください。';
      break;
    case 'LEFT_TOP_LEFT':
      instruction = '【ステップ 3/4】\n左手を 画面左上の「③」マーカーへ合わせ、\nそのまま【スペースキー】を押して確定してください。';
      break;
    case 'LEFT_BOTTOM_RIGHT':
      instruction = '【ステップ 4/4】\n左手を 画面左中央下の「④」マーカーへ合わせ\n（胸の前あたり）、【スペースキー】で確定してください。';
      break;
  }

  return (
    <>
      {/* アニメーション用スタイル */}
      <style>{MARKER_KEYFRAMES}</style>

      {/* 画面上に固定されるターゲットマーカー群 */}
      {/* 完了済みのマーカーはグレーで残表示、アクティブなマーカーは点滅 */}
      {Object.entries(CALIBRATION_MARKERS).map(([step, marker]) => {
        const isDone = step in points;
        const isActive = step === state.calibrationStep;
        const color = isDone ? 'rgba(180,180,180,0.4)' : marker.color;

        return (
          <div
            key={step}
            style={{
              position: 'fixed',
              top: marker.top,
              bottom: marker.bottom,
              left: marker.left,
              right: marker.right,
              width: 72,
              height: 72,
              zIndex: 50,
              pointerEvents: 'none',
            }}
          >
            {/* アウターリング（パルスアニメ） */}
            {isActive && (
              <div style={{
                position: 'absolute',
                top: '50%', left: '50%',
                width: 72, height: 72,
                borderRadius: '50%',
                background: 'transparent',
                border: `3px solid ${color}`,
                animation: 'markerRingPulse 1.2s ease-in-out infinite',
              }} />
            )}
            {/* インナー円 */}
            <div style={{
              position: 'absolute',
              top: '50%', left: '50%',
              width: isActive ? 48 : 32,
              height: isActive ? 48 : 32,
              borderRadius: '50%',
              background: isDone ? 'rgba(150,150,150,0.2)' : `${color}33`,
              border: `3px solid ${color}`,
              transform: 'translate(-50%, -50%)',
              animation: isActive ? 'markerPulse 1.2s ease-in-out infinite' : 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'width 0.3s, height 0.3s',
            }}>
              {/* 中心の十字 */}
              <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                <div style={{ position: 'absolute', top: '50%', left: 4, right: 4, height: 2, background: color, transform: 'translateY(-50%)', opacity: isDone ? 0.4 : 0.9 }} />
                <div style={{ position: 'absolute', left: '50%', top: 4, bottom: 4, width: 2, background: color, transform: 'translateX(-50%)', opacity: isDone ? 0.4 : 0.9 }} />
              </div>
            </div>
            {/* ラベル */}
            <div style={{
              position: 'absolute',
              top: '100%',
              left: '50%',
              transform: 'translateX(-50%)',
              marginTop: 6,
              fontSize: 13,
              fontWeight: 700,
              color: isDone ? 'rgba(180,180,180,0.5)' : color,
              whiteSpace: 'nowrap',
              textShadow: `0 0 8px ${color}`,
            }}>
              {isDone ? '✓ ' : ''}{marker.label}
            </div>
          </div>
        );
      })}

      {/* 中央下部の指示パネル */}
      <div style={{
        marginTop: 24,
        padding: '16px 32px',
        background: 'rgba(20, 40, 80, 0.88)',
        border: `2px solid ${currentMarker?.color ?? '#6688ff'}`,
        borderRadius: 16,
        textAlign: 'center',
        maxWidth: 560,
        boxShadow: `0 8px 32px rgba(0,0,0,0.6), 0 0 20px ${currentMarker?.color ?? '#6688ff'}44`,
      }}>
        <h3 style={{ margin: '0 0 12px 0', color: '#ffffff', fontSize: 19 }}>
          🎯 キャリブレーション実行中
        </h3>
        <p style={{ color: '#aaddff', whiteSpace: 'pre-wrap', lineHeight: '1.7', fontSize: 15, margin: 0 }}>
          {instruction}
        </p>
        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'center', gap: 8 }}>
          {Object.keys(CALIBRATION_MARKERS).map((step, i) => (
            <div key={step} style={{
              width: 12, height: 12, borderRadius: '50%',
              background: step in points
                ? '#66ffaa'
                : step === state.calibrationStep
                  ? CALIBRATION_MARKERS[step].color
                  : 'rgba(255,255,255,0.2)',
              border: '1px solid rgba(255,255,255,0.3)',
              transition: 'background 0.3s',
            }} title={`ステップ ${i + 1}`} />
          ))}
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: '#6688aa' }}>
          【スペースキー】で座標を記録します
        </div>
      </div>
    </>
  );
}

/**
 * ミリ秒を mm:ss 形式にフォーマットする
 */
function formatTime(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** リザルト画面でスコアを表示するための内部コンポーネント */
function ResultScore() {
  const { stateRef } = useGameState();
  const s = stateRef.current;
  return (
    <div style={{ textAlign: 'center' }}>
      <div>{s.score.toLocaleString()}</div>
      <div style={{
        fontSize: 24, fontWeight: 600, color: '#ffdd55', textShadow: 'none',
        display: 'flex', gap: 40, justifyContent: 'center', marginTop: 16,
        letterSpacing: 2, fontFamily: 'monospace'
      }}>
        <div>MAX COMBO: {s.maxCombo}</div>
        <div>HITS: {s.hits}</div>
        <div style={{ color: '#ff6688' }}>MISS: {s.misses}</div>
      </div>
    </div>
  );
}
