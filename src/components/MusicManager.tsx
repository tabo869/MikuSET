import { useRef, useState, useEffect } from 'react';
import { useMusicPlayer } from '../hooks/useMusicPlayer';
import { useGameState } from '../hooks/useGameState';
import { CONTEST_SONGS } from '../config/songs';
import { DIFFICULTIES, DIFFICULTY_LEVELS } from '../config/difficulty';
import type { DifficultyLevel } from '../config/difficulty';
import ResultScreen from './ResultScreen';
import { isHighScore, getRankPosition } from '../utils/ranking';
import FaceTracker from './FaceTracker';

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
  
  const isJa = state.language === 'ja';
  const t = (ja: string, en: string) => (isJa ? ja : en);

  const [displayTime, setDisplayTime] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** カウントダウン状態: null=非表示, 3/2/1=カウント中, 0='GO!' */
  const [countdown, setCountdown] = useState<number | null>(null);

  /** リザルト画面表示状態 */
  const [showResult, setShowResult] = useState<boolean>(false);

  /** フェイクプログレスバー用 (0-100) */
  const [fakeProgress, setFakeProgress] = useState(0);

  const isUserStopped = useRef(false);
  const playTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [selectedDifficulty, setSelectedDifficulty] = useState<DifficultyLevel>(gameStateRef.current.currentDifficulty);
  const [localOffsetMs, setLocalOffsetMs] = useState(gameStateRef.current.globalOffsetMs);
  
  // UI更新用のリアクティブなゲーム状態
  const [gs, setGs] = useState(gameStateRef.current);

  /** スイングテストのフィードバック状態 */
  const [testFeedback, setTestFeedback] = useState<{ hand: 'left' | 'right', time: number } | null>(null);

  /** リアルタイムのモーションスコア（可視化用） */
  const [motionScores, setMotionScores] = useState({ left: 0, right: 0 });

  /** ポータル要素のRef */
  const portalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.isTrackingTest && portalRef.current) {
      window.dispatchEvent(new CustomEvent('mikuset-portal-ready', { detail: { element: portalRef.current } }));
    }
  }, [state.isTrackingTest]);

  // 100msごとにゲーム状態を同期（体力低下演出やゲームオーバー用）


  useEffect(() => {
    const interval = setInterval(() => {
      setGs({ ...gameStateRef.current });
    }, 100);
    return () => clearInterval(interval);
  }, [gameStateRef]);

  // 楽曲が切り替わったらゲーム状態とリザルト画面表示をリセットする
  useEffect(() => {
    gameActions.reset();
    setShowResult(false);
  }, [state.activeSongUrl, gameActions]);

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
      const maxPos = maxPositionRef.current;
      
      // ★ガード: 前回のプレイの遅延イベントによる誤判定を防ぐため、10秒以上の再生実績がある場合のみクリア判定を行う
      if (!isUserStopped.current && maxPos > 10000) {
        if (lastWordTime !== undefined && maxPos > 0 && maxPos >= lastWordTime - 15000) {
          isCleared = true;
        } else if (duration !== undefined && maxPos > 0 && maxPos >= duration - 15000) {
          isCleared = true;
        }
      }
      
      if (isCleared) {
        const gs = gameStateRef.current;
        // オートプレイ時はランキング対象外（isHighScore = false）
        const highScore = !state.isAutoPlayMode && isHighScore(state.activeSongUrl, gs.score, gs.currentDifficulty);
        
        gameStateRef.current.productionLevel = 1;
        setShowResult(true);

        // 3D演出用のイベントを発火
        // オートプレイ時でもフルコンボ（MISS 0）なら演出を見られるようにする
        window.dispatchEvent(new CustomEvent('mikuset-result-cinematic', {
          detail: { 
            isHighScore: highScore,
            score: gs.score,
            isFullCombo: gs.misses === 0 && gs.hits > 0
          }
        }));
        // ★ リザルト表示時に残存しているHTML要素（判定文字など）を即座に掃除
        setTimeout(() => {
          document.querySelectorAll('.mikuset-note-html-orphaned-guard').forEach(el => {
            const wrapper = el.closest('div[style*="absolute"]') as HTMLElement;
            if (wrapper) wrapper.style.display = 'none';
          });
        }, 0);
      }
    }

  }, [state.isPlaying, maxPositionRef, showResult]);

  /** スイングテストのイベントリスナー */
  useEffect(() => {
    const handleTestSwing = (e: any) => {
      setTestFeedback({ hand: e.detail.hand, time: Date.now() });
    };
    const handleMotionScore = (e: any) => {
      setMotionScores(e.detail);
    };
    window.addEventListener('mikuset-test-swing', handleTestSwing);
    window.addEventListener('mikuset-motion-score', handleMotionScore);
    return () => {
      window.removeEventListener('mikuset-test-swing', handleTestSwing);
      window.removeEventListener('mikuset-motion-score', handleMotionScore);
    };
  }, []);


  /** カウントダウン処理 */

  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      // カウントダウン完了の瞬間（GO!）に、最初の歌詞の位置にシーク同期する
      const firstNoteTime = (window as any).__mikusetFirstWordTime || 0;
      if (firstNoteTime < 3000) {
        actions.seek(firstNoteTime);
      }

      // 'GO!' 表示後にカウントダウン表示を消す
      const timer = setTimeout(() => {
        setCountdown(null);
        gameActions.setIsCountdownActive(false);
      }, 700);
      return () => clearTimeout(timer);
    }
    // 1秒ごとにカウントダウンを進める
    const timer = setTimeout(() => setCountdown((c) => (c as number) - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown, gameActions, actions]);

  /** 再生開始ハンドラ */
  const handleStart = async () => {
    if (playTimerRef.current) {
      clearTimeout(playTimerRef.current);
      playTimerRef.current = null;
    }

    try {
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen().catch(() => {});
      }
      if (typeof screen !== 'undefined' && (screen as any).orientation && (screen as any).orientation.lock) {
        await (screen as any).orientation.lock('landscape').catch(() => {});
      }
    } catch (e) {}

    isUserStopped.current = false;
    gameActions.reset();
    maxPositionRef.current = 0;

    // カウントダウンを開始する (3 -> 2 -> 1 -> GO!)
    setCountdown(3);
    gameActions.setIsCountdownActive(true);

    // 最初のノーツ出現時間に基づいて、曲の本格的な再生開始ディレイを決定する
    const firstNoteTime = (window as any).__mikusetFirstWordTime || 0;
    const countdownTotalTime = 3000; // 3秒間
    const playDelay = Math.max(0, countdownTotalTime - firstNoteTime);

    // 仮想的なマイナス時間（カウントダウン進行用）を設定
    positionRef.current = -playDelay;

    if (playDelay > 0) {
      // 歌い出しが早い曲：まず同期再生でアンロックし、100ms遅らせて確実に一時停止させてロードを待つ
      actions.play(true);
      setTimeout(() => {
        // 中断されていない場合のみ一時停止を実行
        if (!isUserStopped.current) {
          actions.pause();
        }
      }, 100);

      // 指定されたディレイ後に曲を本格再生する（すでに有効化されているため、非同期setTimeoutからでも100%確実に再生できます）
      playTimerRef.current = setTimeout(() => {
        actions.play(false); // forceStart = false で途中から流す
        playTimerRef.current = null;
      }, playDelay);
    } else {
      // イントロが十分長い曲：即座に本格再生開始
      actions.play(true);
    }
  };

  /** 中断（ストップ）ハンドラ */
  const handleStop = () => {
    isUserStopped.current = true;
    setCountdown(null);
    gameActions.setIsCountdownActive(false);
    if (playTimerRef.current) {
      clearTimeout(playTimerRef.current);
      playTimerRef.current = null;
    }
    gameActions.reset();
    actions.stop();
  };

  return (
    <>
      {/* ── カウントダウンオーバーレイ ─────────────────────────── */}
      {countdown !== null && (
        <div style={{
          position: 'absolute',
          top: '180px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 3000,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-start',
          pointerEvents: 'none',
          userSelect: 'none',
        }}>
          <div style={{
            fontSize: countdown === 0 ? 80 : 100,
            fontWeight: 900,
            letterSpacing: 4,
            color: countdown === 0 ? '#00ffcc' : '#ffffff',
            textShadow: countdown === 0
              ? '0 0 30px #00ffcc, 0 0 60px #00ffaa'
              : '0 0 35px rgba(255,255,255,0.7), 0 0 70px rgba(0,210,255,0.5)',
            animation: 'countdownPop 0.3s ease-out',
            transition: 'all 0.2s ease',
            lineHeight: 1,
            fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          }}>
            {countdown === 0 ? 'GO!' : countdown}
          </div>
          <div style={{
            marginTop: 12,
            fontSize: 14,
            color: 'rgba(180, 210, 255, 0.8)',
            letterSpacing: 2,
            fontWeight: 300,
            textShadow: '0 0 10px rgba(0,210,255,0.3)',
            fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          }}>
            {t('読み込み中...', 'LOADING...')}
          </div>
        </div>
      )}

      {/* ── 危険（体力低下）演出オーバーレイ ──────────────────── */}
      {state.isPlaying && gs.health < 25 && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          pointerEvents: 'none',
          zIndex: 100,
          boxShadow: 'inset 0 0 100px rgba(255, 0, 0, 0.6)',
          animation: 'dangerPulse 1s ease-in-out infinite alternate',
        }}>
          <style>
            {`
              @keyframes dangerPulse {
                from { background: rgba(255, 0, 0, 0.05); }
                to { background: rgba(255, 0, 0, 0.15); }
              }
            `}
          </style>
        </div>
      )}

      {/* ── 画面回転警告（縦画面プレイ防止） ────────────────── */}
      {state.isPlaying && (
        <div className="mikuset-portrait-warning">
          <div className="warning-content">
            <div className="icon">🔄</div>
            <div className="text-ja">画面を横向きにしてください</div>
            <div className="text-en">PLEASE ROTATE TO LANDSCAPE</div>
          </div>
        </div>
      )}

      {/* ── リザルト画面 ───────────────────────────── */}
      <ResultScreen
        isVisible={showResult || gs.isGameOver}
        isGameOver={gs.isGameOver}
        activeSongUrl={state.activeSongUrl}
        gameState={gameStateRef.current}
        isVirtualInputMode={state.isVirtualInputMode}
        isAutoPlayMode={state.isAutoPlayMode}
        onClose={() => {
          setShowResult(false);
          gameActions.reset();
          maxPositionRef.current = 0;
          isUserStopped.current = true;
          actions.stop();
          window.dispatchEvent(new CustomEvent('mikuset-stop-cinematic'));
        }}
      />

      {/* ── スタート画面オーバーレイ（未再生・カウントダウンなし・リザルトなし時） ───── */}
      {!state.isPlaying && countdown === null && !showResult && !gs.isGameOver && (
        <div className={`mikuset-title-container ${state.isTrackingTest ? 'is-testing' : ''}`}>
          {state.isTrackingTest ? (
            <>
              <div style={{
                background: 'rgba(30, 80, 150, 0.6)',
                padding: '24px',
                borderRadius: '20px',
                border: '1px solid rgba(255,255,255,0.3)',
                marginBottom: '32px',
                textAlign: 'center',
                width: '100%',
                maxWidth: '500px',
                boxShadow: '0 0 40px rgba(0, 210, 255, 0.3)'
              }}>
                <h2 style={{ color: '#00d2ff', marginTop: 0, fontSize: 24, letterSpacing: 4 }}>SWING TEST</h2>
                <p style={{ color: '#fff', fontSize: 14, opacity: 0.8 }}>
                  {t('カメラに向かって太鼓を叩くように腕を突き出してください。', 'Thrust your arms forward like beating a drum.')}
                  <br />
                  {t('正しく検知されると音が鳴ります。', 'Sound plays when a swing is detected.')}
                </p>
                <div style={{ 
                  margin: '20px auto', 
                  width: '320px', 
                  height: '240px', 
                  background: 'transparent', // カメラを透かすために透明に
                  borderRadius: '8px', 
                  border: '2px solid #00d2ff',
                  position: 'relative',
                  overflow: 'hidden'
                }}>

                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    zIndex: 100,
                    pointerEvents: 'none',
                  }} 
                  ref={portalRef}
                  id="swing-test-camera-portal" />


                  {/* 左手の判定ガイド（★） - 左側に配置 */}
                  <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '20px',
                    transform: 'translateY(-50%)',
                    fontSize: 40,
                    color: '#66aaff',
                    opacity: 0.3,
                    zIndex: 2105,
                  }}>★</div>
                  
                  {/* 右手の判定ガイド（★） - 右側に配置 */}
                  <div style={{
                    position: 'absolute',
                    top: '50%',
                    right: '20px',
                    transform: 'translateY(-50%)',
                    fontSize: 40,
                    color: '#ff66aa',
                    opacity: 0.3,
                    zIndex: 2105,
                  }}>★</div>



                  {/* Visual Feedback Overlay (ヒット時) */}
                  {testFeedback && Date.now() - testFeedback.time < 500 && (
                    <>
                      {/* ★ マーク（左右） */}
                      <div style={{
                        position: 'absolute',
                        top: '50%',
                        [testFeedback.hand === 'right' ? 'right' : 'left']: '20px',

                        transform: 'translateY(-50%)',
                        fontSize: 60,
                        color: testFeedback.hand === 'right' ? '#ff66aa' : '#66aaff',

                        textShadow: '0 0 20px currentColor',
                        animation: 'mikuset-pop 0.3s ease-out forwards',
                        zIndex: 2110,
                      }}>
                        ★
                      </div>
                      {/* PERFECT 文字 */}
                      <div style={{
                        position: 'absolute',
                        bottom: '20%',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        fontSize: 32,
                        fontWeight: 900,
                        color: '#ffff00',
                        textShadow: '0 0 15px rgba(255,255,0,0.8)',
                        animation: 'mikuset-judge-pop 0.4s cubic-bezier(0, 1.5, 0.5, 1) forwards',
                        zIndex: 2120,
                      }}>
                        PERFECT
                      </div>

                    </>
                  )}
                  
                  {/* モーションスコア・バー（可視化） - 右：ピンク(右手), 左：青(左手) */}
                  <div style={{ position: 'absolute', bottom: 0, right: 0, width: '50%', height: '4px', background: '#ff66aa', transform: `scaleX(${Math.min(1, motionScores.left / gs.motionThreshold)})`, transformOrigin: 'right', zIndex: 2130 }} />
                  <div style={{ position: 'absolute', bottom: 0, left: 0, width: '50%', height: '4px', background: '#66aaff', transform: `scaleX(${Math.min(1, motionScores.right / gs.motionThreshold)})`, transformOrigin: 'left', zIndex: 2130 }} />


                  <style>{`

                    @keyframes mikuset-pop {
                      0% { transform: translateY(-50%) scale(0.5); opacity: 0; }
                      50% { transform: translateY(-50%) scale(1.3); opacity: 1; }
                      100% { transform: translateY(-50%) scale(1); opacity: 0; }
                    }
                    @keyframes mikuset-judge-pop {
                      0% { transform: translateX(-50%) scale(0.5); opacity: 0; }
                      20% { transform: translateX(-50%) scale(1.2); opacity: 1; }
                      100% { transform: translateX(-50%) scale(1); opacity: 0; }
                    }
                  `}</style>
                </div>

                <div style={{ marginTop: 16 }}>
                  <label style={{ color: '#00d2ff', fontSize: 13, letterSpacing: 1, display: 'block', marginBottom: 6 }}>
                    🔥 {t('判定感度（低いほど敏感）', 'SENSITIVITY')}: <span style={{ color: '#ffffff', fontWeight: 700 }}>{gs.motionThreshold}</span>
                  </label>
                  <input
                    type="range"
                    min={1000}
                    max={1000000}
                    step={1000}
                    value={gs.motionThreshold}
                    onChange={(e) => gameActions.setMotionThreshold(Number(e.target.value))}
                    style={{ width: '80%', cursor: 'pointer', accentColor: '#00d2ff' }}
                  />
                </div>

              </div>

              <button
                onClick={actions.toggleTrackingTest}
                style={{
                  padding: '12px 24px',
                  fontSize: 16,
                  fontWeight: 600,
                  color: '#ffffff',
                  background: 'rgba(255, 100, 150, 0.8)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: 24,
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  backdropFilter: 'blur(4px)',
                  boxShadow: '0 0 20px rgba(255, 100, 150, 0.5)',
                }}
              >
                🥁 {t('スイングテストを終了', 'EXIT SWING TEST')}
              </button>
            </>
          ) : (
            <div className="mikuset-title-panel">
              <div style={{ textAlign: 'center', marginBottom: 4, width: '100%' }}>
                <h1 style={{ 
                  margin: 0, 
                  fontSize: 26, 
                  fontWeight: 900, 
                  letterSpacing: 4, 
                  color: '#00d2ff',
                  textShadow: '0 0 15px rgba(0,210,255,0.6)'
                }}>S★LIVE</h1>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', letterSpacing: 2, marginTop: 4 }}>
                  VIRTUAL PERFORMANCE SYSTEM
                </div>
              </div>

              <div style={{ width: '100%', height: '1px', background: 'linear-gradient(to right, rgba(0, 210, 255, 0), rgba(0, 210, 255, 0.25), rgba(0, 210, 255, 0))' }} />

              {/* 楽曲選択 */}
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <label style={{ color: '#aaddff', fontSize: 12, letterSpacing: 2, display: 'block', marginBottom: 6, fontWeight: 700 }}>
                  {t('楽曲を選択', 'SELECT SONG')}
                </label>
                <select
                  value={state.activeSongUrl}
                  onChange={(e) => actions.selectSong(e.target.value)}
                  disabled={!state.isReady}
                  style={{
                    padding: '8px 12px',
                    fontSize: 14,
                    fontWeight: 600,
                    color: '#ffffff',
                    background: 'rgba(5, 20, 45, 0.6)',
                    border: '1px solid rgba(0,210,255,0.3)',
                    borderRadius: 10,
                    cursor: 'pointer',
                    outline: 'none',
                    width: '100%',
                    boxSizing: 'border-box',
                    textAlign: 'center',
                    boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.5)'
                  }}
                >
                  {CONTEST_SONGS.map((song) => (
                    <option key={song.url} value={song.url} style={{ background: '#071224', color: '#fff' }}>
                      {song.title}
                    </option>
                  ))}
                </select>
              </div>

              {/* 難易度選択 */}
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <label style={{ color: '#aaddff', fontSize: 12, letterSpacing: 2, display: 'block', marginBottom: 6, fontWeight: 700 }}>
                  {t('難易度', 'DIFFICULTY')}
                </label>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap', width: '100%' }}>
                  {DIFFICULTY_LEVELS.map((level) => {
                    const cfg = DIFFICULTIES[level];
                    const isActive = selectedDifficulty === level;
                    return (
                      <button
                        key={level}
                        onClick={() => handleDifficultyChange(level)}
                        style={{
                          flex: 1,
                          minWidth: '60px',
                          padding: '6px 8px',
                          fontSize: 11,
                          fontWeight: isActive ? 800 : 500,
                          color: isActive ? '#ffffff' : '#aabbcc',
                          background: isActive
                            ? 'linear-gradient(135deg, #00d2ff 0%, #3a7bd5 100%)'
                            : 'rgba(10, 25, 50, 0.5)',
                          border: isActive
                            ? '1px solid rgba(0, 210, 255, 0.8)'
                            : '1px solid rgba(255,255,255,0.1)',
                          borderRadius: 10,
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          boxShadow: isActive ? '0 0 10px rgba(0, 210, 255, 0.2)' : 'none',
                        }}
                      >
                        {cfg.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 調整スライダー類 */}
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* 判定オフセット */}
                <div style={{ width: '100%', background: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.05)', boxSizing: 'border-box' }}>
                  <label style={{ color: '#aaddff', fontSize: 11, letterSpacing: 1, display: 'block', marginBottom: 4, fontWeight: 700 }}>
                    ⏱ {t('判定調整', 'TIMING OFFSET')} (ms): <span style={{ color: '#00d2ff', fontWeight: 800 }}>{localOffsetMs}</span>
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                    <button
                      onClick={() => handleOffsetChange(localOffsetMs - 1)}
                      style={{
                        width: 24, height: 24, borderRadius: '50%', border: '1px solid rgba(0, 210, 255, 0.3)',
                        background: 'rgba(0, 210, 255, 0.1)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14
                      }}
                    >－</button>
                    <input
                      type="range"
                      min={-500}
                      max={500}
                      step={1}
                      value={localOffsetMs}
                      onChange={(e) => handleOffsetChange(Number(e.target.value))}
                      style={{ flex: 1, cursor: 'pointer', accentColor: '#00d2ff', height: '3px' }}
                    />
                    <button
                      onClick={() => handleOffsetChange(localOffsetMs + 1)}
                      style={{
                        width: 24, height: 24, borderRadius: '50%', border: '1px solid rgba(0, 210, 255, 0.3)',
                        background: 'rgba(0, 210, 255, 0.1)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14
                      }}
                    >＋</button>
                  </div>
                </div>

                {/* スイングクールダウン */}
                {state.hasCamera && (
                  <div style={{ width: '100%', background: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.05)', boxSizing: 'border-box' }}>
                    <label style={{ color: '#ffccaa', fontSize: 11, letterSpacing: 1, display: 'block', marginBottom: 4, fontWeight: 700 }}>
                      🥁 {t('連打間隔', 'SWING COOLDOWN')} (ms): <span style={{ color: '#ffaa66', fontWeight: 800 }}>{gs.swingCooldownMs}</span>
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                      <button
                        onClick={() => gameActions.setSwingCooldownMs(Math.max(50, gs.swingCooldownMs - 1))}
                        style={{
                          width: 24, height: 24, borderRadius: '50%', border: '1px solid rgba(255, 170, 100, 0.3)',
                          background: 'rgba(255, 170, 100, 0.1)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14
                        }}
                      >－</button>
                      <input
                        type="range"
                        min={50}
                        max={1000}
                        step={1}
                        value={gs.swingCooldownMs}
                        onChange={(e) => gameActions.setSwingCooldownMs(Number(e.target.value))}
                        style={{ flex: 1, cursor: 'pointer', accentColor: '#ffaa66', height: '3px' }}
                      />
                      <button
                        onClick={() => gameActions.setSwingCooldownMs(Math.min(1000, gs.swingCooldownMs + 1))}
                        style={{
                          width: 24, height: 24, borderRadius: '50%', border: '1px solid rgba(255, 170, 100, 0.3)',
                          background: 'rgba(255, 170, 100, 0.1)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14
                        }}
                      >＋</button>
                    </div>
                  </div>
                )}
              </div>

              {/* スタートボタン */}
              <div style={{ position: 'relative', width: '100%', textAlign: 'center', marginTop: 4 }}>
                <button
                  onClick={handleStart}
                  disabled={!state.isReady}
                  style={{
                    width: '100%',
                    padding: '12px 20px',
                    fontSize: 22,
                    fontWeight: 800,
                    letterSpacing: 4,
                    color: state.isReady ? '#ffffff' : '#888888',
                    background: state.isReady
                      ? 'linear-gradient(135deg, #00d2ff 0%, #3a7bd5 100%)'
                      : 'rgba(30, 40, 60, 0.8)',
                    border: 'none',
                    borderRadius: 20,
                    cursor: state.isReady ? 'pointer' : 'not-allowed',
                    boxShadow: state.isReady
                      ? '0 6px 20px rgba(0, 210, 255, 0.4), inset 0 1px 3px rgba(255, 255, 255, 0.4)'
                      : 'none',
                    transition: 'all 0.3s ease',
                    transform: state.isReady ? 'scale(1)' : 'scale(0.95)',
                  }}
                >
                  {state.isReady ? t('スタート', 'START') : t('読み込み中...', 'LOADING...')}
                </button>
                
                {!state.isReady && (
                  <div style={{
                    position: 'absolute',
                    bottom: -8,
                    left: 0,
                    right: 0,
                    height: 3,
                    background: 'rgba(255, 255, 255, 0.1)',
                    borderRadius: 1.5,
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      height: '100%',
                      width: `${fakeProgress}%`,
                      background: '#00d2ff',
                      transition: 'width 0.2s ease-out',
                      boxShadow: '0 0 6px #00d2ff'
                    }} />
                  </div>
                )}
              </div>

              <div style={{ width: '100%', height: '1px', background: 'linear-gradient(to right, rgba(255, 255, 255, 0), rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0))' }} />

              {/* オプション系ボタンリスト */}
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {state.hasCamera && (
                  <button
                    onClick={actions.toggleTrackingTest}
                    style={{
                      padding: '8px 12px',
                      fontSize: 12,
                      fontWeight: 600,
                      color: '#ccddff',
                      background: 'rgba(30, 80, 150, 0.25)',
                      border: '1px solid rgba(0, 210, 255, 0.2)',
                      borderRadius: 10,
                      cursor: 'pointer',
                      transition: 'all 0.3s ease',
                      width: '100%',
                    }}
                  >
                    🥁 {t('スイングテスト (感度設定)', 'SWING TEST (CALIBRATION)')}
                  </button>
                )}

                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: 'pointer',
                  color: '#ffffff',
                  fontSize: 11,
                  fontWeight: 600,
                  background: 'rgba(0, 0, 0, 0.25)',
                  padding: '6px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.06)',
                  width: '100%',
                  boxSizing: 'border-box'
                }}>
                  <input 
                    type="checkbox" 
                    checked={state.isAutoPlayMode}
                    onChange={actions.toggleAutoPlay}
                    style={{ width: 12, height: 12, cursor: 'pointer', accentColor: '#00d2ff' }}
                  />
                  {t('オートプレイ (演出確認用)', 'AUTO PLAY (DEMO)')}
                </label>

                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: 'pointer',
                  color: '#ffffff',
                  fontSize: 11,
                  fontWeight: 800,
                  background: state.isMagicalGuestMode 
                    ? 'linear-gradient(135deg, rgba(255, 51, 153, 0.2) 0%, rgba(0, 210, 255, 0.1) 100%)' 
                    : 'rgba(0, 0, 0, 0.25)',
                  padding: '6px 12px',
                  borderRadius: 10,
                  border: state.isMagicalGuestMode 
                    ? '1.2px solid rgba(255, 51, 153, 0.5)' 
                    : '1px solid rgba(255,255,255,0.06)',
                  transition: 'all 0.3s ease',
                  width: '100%',
                  boxSizing: 'border-box'
                }}>
                  <input 
                    type="checkbox" 
                    checked={state.isMagicalGuestMode}
                    onChange={actions.toggleMagicalGuestMode}
                    style={{ width: 12, height: 12, cursor: 'pointer', accentColor: '#ff3399' }}
                  />
                  {t('✨ マジカル・ゲスト (自動演奏)', '✨ MAGICAL GUEST')}
                </label>

                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: 'pointer',
                  color: '#ffffff',
                  fontSize: 11,
                  fontWeight: 600,
                  background: 'rgba(0, 0, 0, 0.25)',
                  padding: '6px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.06)',
                  width: '100%',
                  boxSizing: 'border-box'
                }}>
                  <input 
                    type="checkbox" 
                    checked={state.isVirtualInputMode}
                    onChange={actions.toggleVirtualInputMode}
                    style={{ width: 12, height: 12, cursor: 'pointer', accentColor: '#00d2ff' }}
                  />
                  {t('キーボード・タッチ操作 (カメラOFF)', 'KEYBOARD / TOUCH MODE')}
                </label>

                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: 'pointer',
                  color: '#ffffff',
                  fontSize: 11,
                  fontWeight: 600,
                  background: 'rgba(0, 0, 0, 0.25)',
                  padding: '6px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.06)',
                  width: '100%',
                  boxSizing: 'border-box'
                }}>
                  <input 
                    type="checkbox" 
                    checked={state.hideScrollingLyrics}
                    onChange={actions.toggleHideScrollingLyrics}
                    style={{ width: 12, height: 12, cursor: 'pointer', accentColor: '#00d2ff' }}
                  />
                  {t('歌詞の流れる表示を隠す', 'HIDE SCROLLING LYRICS')}
                </label>
              </div>

              {/* 言語・ガイド表示 */}
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <div style={{ display: 'flex', gap: 8, width: '100%', justifyContent: 'center' }}>
                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    cursor: 'pointer',
                    color: '#aaddff',
                    fontSize: 10,
                    fontWeight: 700,
                    background: 'rgba(30, 80, 150, 0.15)',
                    padding: '4px 8px',
                    borderRadius: 10,
                    border: '1px solid rgba(0, 210, 255, 0.15)'
                  }}>
                    <input 
                      type="checkbox" 
                      checked={isJa}
                      onChange={(e) => actions.setLanguage(e.target.checked ? 'ja' : 'en')}
                      style={{ width: 10, height: 10, cursor: 'pointer' }}
                    />
                    日本語 (JA)
                  </label>

                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    cursor: 'pointer',
                    color: '#aaddff',
                    fontSize: 10,
                    fontWeight: 700,
                    background: 'rgba(30, 80, 150, 0.15)',
                    padding: '4px 8px',
                    borderRadius: 10,
                    border: '1px solid rgba(0, 210, 255, 0.15)'
                  }}>
                    <input 
                      type="checkbox" 
                      checked={state.showInputLabels}
                      onChange={actions.toggleInputLabels}
                      style={{ width: 10, height: 10, cursor: 'pointer' }}
                    />
                    {t('ガイド表示', 'GUIDE')}
                  </label>
                </div>

                <div style={{ color: '#00d2ff', fontSize: 11, letterSpacing: 0.5, textAlign: 'center', opacity: 0.8, marginTop: 2 }}>
                  {state.statusMessage}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 画面下部のコントロール（再生時のみ） */}
      {state.isPlaying && (
        <div
          style={{
            position: 'absolute',
            bottom: 'max(55px, 10vh)',
            left: 'max(30px, 5vw)',


            zIndex: 20,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',         // 左寄せに変更
            gap: 12,
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              background: 'rgba(0, 0, 0, 0.4)',
              backdropFilter: 'blur(10px)',
              borderRadius: 20,
              padding: '12px 16px',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              pointerEvents: 'auto',
            }}
          >
            {/* 時間表示 */}
            <div
              style={{
                color: 'rgba(255, 255, 255, 0.95)',
                fontSize: 13,
                fontWeight: 700,
                fontFamily: 'monospace',
                letterSpacing: 2,
              }}
            >
              {formatTime(displayTime)}
            </div>

            {/* STOPボタン */}
            <button
              onClick={handleStop}
              style={{
                width: 52,
                height: 32,
                borderRadius: 16,
                border: 'none',
                background: 'rgba(255, 60, 100, 0.9)',
                color: '#ffffff',
                fontSize: 11,
                fontWeight: 900,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(255, 60, 100, 0.4)',
                transition: 'all 0.2s ease',
              }}
              title="演奏を中断する"
            >
              {t('中断', 'STOP')}
            </button>
          </div>
        </div>
      )}

      {/* マジカル・ゲスト用の表情トラッカーカメラプレビュー */}
      <FaceTracker isVisible={state.isMagicalGuestMode} />
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
 * ミリ秒を mm:ss 形式にフォーマットする
 */
function formatTime(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}


