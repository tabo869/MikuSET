import { useRef, useState, useEffect } from 'react';
import { useMusicPlayer } from '../hooks/useMusicPlayer';
import { useGameState } from '../hooks/useGameState';
import { CONTEST_SONGS } from '../config/songs';
import { DIFFICULTIES, DIFFICULTY_LEVELS } from '../config/difficulty';
import type { DifficultyLevel } from '../config/difficulty';
import ResultScreen from './ResultScreen';
import { isHighScore, getRankPosition } from '../utils/ranking';

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
      
      if (!isUserStopped.current) {
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

  /** 再生開始ハンドラ（ブラウザ制限回避のため、クリック直後に同期的に再生命令を出す） */
  const handleStart = async () => {
    try {
      // 画面固定の成功率を高めるため、フルスクリーンを要求（Android等）
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen().catch(() => {});
      }

      // スマートフォンでの誤操作防止のため、可能であれば画面を横向きにロック
      if (typeof screen !== 'undefined' && (screen as any).orientation && (screen as any).orientation.lock) {
        await (screen as any).orientation.lock('landscape').catch(() => {
          // ロックに失敗（iOSや非フルスクリーン時）しても続行
        });
      }
    } catch (e) {
      // API非対応ブラウザ
    }

    // ★ 再生命令を最優先で実行（1msの遅延も許さない）
    actions.play(true);
    
    isUserStopped.current = false;
    gameActions.reset();
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
          <style>{`
            .mikuset-portrait-warning {
              position: fixed;
              inset: 0;
              z-index: 9999;
              background: rgba(0, 10, 30, 0.95);
              backdrop-filter: blur(10px);
              display: none;
              align-items: center;
              justify-content: center;
              color: #fff;
              text-align: center;
            }
            @media (orientation: portrait) {
              .mikuset-portrait-warning {
                display: flex;
              }
            }
            .warning-content .icon {
              font-size: 64px;
              margin-bottom: 20px;
              animation: rotateHint 2s infinite ease-in-out;
            }
            .warning-content .text-ja {
              font-size: 20px;
              font-weight: 900;
              letter-spacing: 2px;
              margin-bottom: 8px;
            }
            .warning-content .text-en {
              font-size: 14px;
              font-weight: 400;
              letter-spacing: 4px;
              opacity: 0.7;
            }
            @keyframes rotateHint {
              0% { transform: rotate(0deg); }
              25% { transform: rotate(90deg); }
              75% { transform: rotate(90deg); }
              100% { transform: rotate(0deg); }
            }
          `}</style>
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

        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 2500,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'flex-start',
            padding: '40px 20px',
            overflowY: 'auto',
            background: state.isTrackingTest ? 'rgba(0, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.4)',
            backdropFilter: state.isTrackingTest ? 'blur(10px)' : 'blur(4px)',
            pointerEvents: 'auto',
          }}
        >
          {state.isTrackingTest && (
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
                
                {/* モーションスコア・バー（可視化） */}
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
                  🔥 {t('判定感度（低いほど敏感）', 'SENSITIVITY (Lower is more sensitive)')}: <span style={{ color: '#ffffff', fontWeight: 700 }}>{gs.motionThreshold}</span>
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
          )}


          {/* 楽曲選択ドロップダウン */}
          <div style={{ marginBottom: 32, textAlign: 'center' }}>
            <label style={{ color: '#aaddff', fontSize: 14, letterSpacing: 2, display: 'block', marginBottom: 8 }}>
              {t('楽曲を選択', 'SELECT SONG')}
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
              {t('難易度', 'DIFFICULTY')}
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

          {/* ラグ調整 (オフセット) & クールダウン調整 */}
          <div style={{ marginBottom: 24, textAlign: 'center', display: 'flex', gap: 32, justifyContent: 'center', flexWrap: 'wrap' }}>
            {/* 判定オフセット */}
            <div>
              <label style={{ color: '#aaddff', fontSize: 13, letterSpacing: 1, display: 'block', marginBottom: 6 }}>
                ⏱ {t('判定調整', 'TIMING OFFSET')} (ms): <span style={{ color: '#ffffff', fontWeight: 700 }}>{localOffsetMs}</span>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
                <button
                  onClick={() => handleOffsetChange(localOffsetMs - 1)}
                  style={{
                    width: 30, height: 30, borderRadius: '50%', border: '1px solid rgba(0, 210, 255, 0.3)',
                    background: 'rgba(0, 210, 255, 0.1)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18
                  }}
                  onMouseOver={(e) => e.currentTarget.style.background = 'rgba(0, 210, 255, 0.3)'}
                  onMouseOut={(e) => e.currentTarget.style.background = 'rgba(0, 210, 255, 0.1)'}
                >－</button>
                <input
                  type="range"
                  min={-500}
                  max={500}
                  step={1}
                  value={localOffsetMs}
                  onChange={(e) => handleOffsetChange(Number(e.target.value))}
                  style={{ width: 130, cursor: 'pointer', accentColor: '#00d2ff' }}
                />
                <button
                  onClick={() => handleOffsetChange(localOffsetMs + 1)}
                  style={{
                    width: 30, height: 30, borderRadius: '50%', border: '1px solid rgba(0, 210, 255, 0.3)',
                    background: 'rgba(0, 210, 255, 0.1)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18
                  }}
                  onMouseOver={(e) => e.currentTarget.style.background = 'rgba(0, 210, 255, 0.3)'}
                  onMouseOut={(e) => e.currentTarget.style.background = 'rgba(0, 210, 255, 0.1)'}
                >＋</button>
              </div>

            </div>

            {/* スイングクールダウン (カメラ利用不可時は非表示) */}
            {state.hasCamera && (
              <div>
                <label style={{ color: '#ffccaa', fontSize: 13, letterSpacing: 1, display: 'block', marginBottom: 6 }}>
                  🥁 {t('連打間隔', 'SWING COOLDOWN')} (ms): <span style={{ color: '#ffffff', fontWeight: 700 }}>{gs.swingCooldownMs}</span>
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
                  <button
                    onClick={() => gameActions.setSwingCooldownMs(Math.max(50, gs.swingCooldownMs - 1))}
                    style={{
                      width: 30, height: 30, borderRadius: '50%', border: '1px solid rgba(255, 170, 100, 0.3)',
                      background: 'rgba(255, 170, 100, 0.1)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18
                    }}
                    onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255, 170, 100, 0.3)'}
                    onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255, 170, 100, 0.1)'}
                  >－</button>
                  <input
                    type="range"
                    min={50}
                    max={1000}
                    step={1}
                    value={gs.swingCooldownMs}
                    onChange={(e) => gameActions.setSwingCooldownMs(Number(e.target.value))}
                    style={{ width: 130, cursor: 'pointer', accentColor: '#ffaa66' }}
                  />
                  <button
                    onClick={() => gameActions.setSwingCooldownMs(Math.min(1000, gs.swingCooldownMs + 1))}
                    style={{
                      width: 30, height: 30, borderRadius: '50%', border: '1px solid rgba(255, 170, 100, 0.3)',
                      background: 'rgba(255, 170, 100, 0.1)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18
                    }}
                    onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255, 170, 100, 0.3)'}
                    onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255, 170, 100, 0.1)'}
                  >＋</button>
                </div>

              </div>
            )}

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
              {state.isReady ? t('スタート', 'START') : t('読み込み中...', 'LOADING...')}
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

          {/* カメラテストボタン (カメラ利用不可時は非表示) */}
          {state.hasCamera && (
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
                boxShadow: state.isTrackingTest ? '0 0 20px rgba(255, 100, 150, 0.5)' : 'none',
              }}
            >
              {state.isTrackingTest 
                ? t('🥁 スイングテストを終了', '🥁 EXIT SWING TEST') 
                : t('🥁 スイングテスト (感度・連打設定)', '🥁 SWING TEST (CALIBRATION)')}
            </button>

          )}

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
            {t('オートプレイ (演出確認用)', 'AUTO PLAY (DEMO)')}
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
            {t('タッチ・キーボード操作モード (カメラOFF)', 'TOUCH / KEYBOARD MODE (CAMERA OFF)')}
          </label>

          {/* 歌詞スクロール表示の無効化ボタン */}
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
              checked={state.hideScrollingLyrics}
              onChange={actions.toggleHideScrollingLyrics}
              style={{ width: 16, height: 16, cursor: 'pointer' }}
            />
            {t('歌詞の流れる表示を隠す', 'HIDE SCROLLING LYRICS')}
          </label>


          {/* 言語切り替え */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 16 }}>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              cursor: 'pointer',
              color: '#aaddff',
              fontSize: 13,
              fontWeight: 700,
              background: 'rgba(30, 80, 150, 0.4)',
              padding: '6px 12px',
              borderRadius: 16,
              border: '1px solid rgba(0, 210, 255, 0.3)'
            }}>
              <input 
                type="checkbox" 
                checked={isJa}
                onChange={(e) => actions.setLanguage(e.target.checked ? 'ja' : 'en')}
                style={{ width: 14, height: 14, cursor: 'pointer' }}
              />
              日本語 (JA)
            </label>

            {/* アルファベット表示切り替え */}
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              cursor: 'pointer',
              color: '#aaddff',
              fontSize: 13,
              fontWeight: 700,
              background: 'rgba(30, 80, 150, 0.4)',
              padding: '6px 12px',
              borderRadius: 16,
              border: '1px solid rgba(0, 210, 255, 0.3)'
            }}>
              <input 
                type="checkbox" 
                checked={state.showInputLabels}
                onChange={actions.toggleInputLabels}
                style={{ width: 14, height: 14, cursor: 'pointer' }}
              />
              {t('ガイド文字を表示', 'SHOW ALPHABETS')}
            </label>
          </div>


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


