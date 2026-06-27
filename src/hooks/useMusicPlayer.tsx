import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import { Player } from 'textalive-app-api';
import type { IPlayerApp, IVideo, Timer } from 'textalive-app-api';
import { KOTAETE_SONG_URL, KOTAETE_CHORUS_DATA } from '../config/chorus_override';

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

import { CONTEST_SONGS } from '../config/songs';

/**
 * TextAlive App API トークン
 * ※ TextAlive開発者サイトで発行されたトークン
 *    無効な場合はデモモードで動作する
 */
const APP_TOKEN = '9Q2d6XgVSDAA1NuA';

/**
 * デフォルト楽曲はコンテスト曲の1曲目
 */
const DEFAULT_SONG_URL = CONTEST_SONGS[0].url;

// ---------------------------------------------------------------------------
// Context 型定義
// ---------------------------------------------------------------------------

import type { CalibrationData } from '../types/hand';
import { DEFAULT_CALIBRATION_DATA } from '../types/hand';

export type CalibrationStep =
  | 'NONE'
  | 'RIGHT_TOP_RIGHT'
  | 'RIGHT_BOTTOM_LEFT'
  | 'LEFT_TOP_LEFT'
  | 'LEFT_BOTTOM_RIGHT';

/** MusicPlayer の状態 */
export interface MusicPlayerState {
  /** 再生中かどうか */
  isPlaying: boolean;
  /** Playerが準備完了しているか */
  isReady: boolean;
  /** 楽曲データの読み込みが完了しているか */
  isVideoReady: boolean;
  /** トラッキング確認モードがオンかどうか */
  isTrackingTest: boolean;
  /** キャリブレーションの進行ステップ */
  calibrationStep: CalibrationStep;
  /** 現在のキャリブレーション補正データ */
  calibrationData: CalibrationData;
  /** 選択中の楽曲URL */
  activeSongUrl: string;
  /** ステータスメッセージ */
  statusMessage: string;
  /** 全て自動でPerfect判定になるオートプレイ（デモ）モード */
  isAutoPlayMode: boolean;
  /** タッチパネルやキーボードでの仮想入力モード */
  isVirtualInputMode: boolean;
  /** 言語設定 ('en' | 'ja') */
  language: 'en' | 'ja';
  /** キーボード入力用のラベルを表示するかどうか */
  showInputLabels: boolean;
  /** モバイル環境かどうか */
  isMobile: boolean;
  /** カメラが利用可能かどうか */
  hasCamera: boolean;
  /** 流れる歌詞を表示しないかどうか */
  hideScrollingLyrics: boolean;
  /** マジカル・ゲスト（自動演奏＆表情セッション）モードかどうか */
  isMagicalGuestMode: boolean;
}



/** MusicPlayer の操作メソッド */
export interface MusicPlayerActions {
  play: (forceStart?: boolean) => void;
  pause: () => void;
  stop: () => void;
  seek: (ms: number) => void;
  setVolume: (vol: number) => void;
  togglePlayPause: () => void;
  toggleTrackingTest: () => void;
  setCalibrationStep: (step: CalibrationStep) => void;
  setCalibrationData: (data: CalibrationData) => void;
  selectSong: (url: string) => void;
  toggleAutoPlay: () => void;
  toggleVirtualInputMode: () => void;
  setLanguage: (lang: 'en' | 'ja') => void;
  toggleInputLabels: () => void;
  toggleHideScrollingLyrics: () => void;
  toggleMagicalGuestMode: () => void;
}


/** Context の値 */
export interface MusicPlayerContextValue {
  state: MusicPlayerState;
  actions: MusicPlayerActions;
  /** 現在の再生位置を高速に参照するためのRef（useFrame内で使用） */
  positionRef: React.RefObject<number>;
  /** 曲中の最大到達再生位置 */
  maxPositionRef: React.RefObject<number>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const MusicPlayerContext = createContext<MusicPlayerContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider コンポーネント
// ---------------------------------------------------------------------------

interface MusicProviderProps {
  children: ReactNode;
}

/**
 * MusicProvider — TextAlive Player のライフサイクルを管理する Context Provider
 *
 * ★ 重要な設計：
 * - mediaElementはReactのレンダリングツリー外でDOMに直接作成する
 *   → TextAlive/Songleが作るiframe等がReactのCanvasを覆う問題を根本的に回避
 * - onTimeUpdateではsetStateしない（positionRefのみ更新）
 */
export function MusicProvider({ children }: MusicProviderProps) {
  const playerRef = useRef<Player | null>(null);
  const positionRef = useRef<number>(0);
  const maxPositionRef = useRef<number>(0);

  // モバイル環境（スマホ/タブレット）の簡易判定
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  const [state, setState] = useState<MusicPlayerState>({
    isPlaying: false,
    isReady: false,
    isVideoReady: false,
    isTrackingTest: false,
    calibrationStep: 'NONE',
    calibrationData: DEFAULT_CALIBRATION_DATA,
    activeSongUrl: DEFAULT_SONG_URL,
    statusMessage: 'TextAlive Playerを初期化中...',
    isAutoPlayMode: false,
    isVirtualInputMode: isMobile,
    language: 'ja',
    showInputLabels: !isMobile,
    isMobile: isMobile,
    hasCamera: true,
    hideScrollingLyrics: false,
    isMagicalGuestMode: false,
  });



  // 初期化時にローカルストレージからキャリブレーションデータを復元
  useEffect(() => {
    const saved = localStorage.getItem('mikuset_calibration');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setState((prev) => ({ ...prev, calibrationData: parsed }));
      } catch (err) {
        console.warn('キャリブレーションデータの復元に失敗しました', err);
      }
    }
  }, []);

  // カメラの有無をチェックし、利用不可なら自動的にタッチモード等へ切り替える
  useEffect(() => {
    const checkCamera = async () => {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
          throw new Error('MediaDevices not supported');
        }
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter(device => device.kind === 'videoinput');

        if (videoInputs.length === 0) {
          console.log('[MusicManager] カメラが見つからないため、モバイル/タッチモード設定を適用します');
          setState(prev => ({
            ...prev,
            hasCamera: false,
            isVirtualInputMode: true,
            showInputLabels: true
          }));
        } else {
          console.log(`[MusicManager] ${videoInputs.length} 個のカメラを検出しました`);
          setState(prev => ({ ...prev, hasCamera: true }));
        }
      } catch (err) {
        console.warn('[MusicManager] カメラの検出に失敗しました', err);
        setState(prev => ({
          ...prev,
          hasCamera: false,
          isVirtualInputMode: true,
          showInputLabels: true
        }));
      }
    };
    checkCamera();
  }, []);


  // Player初期化（mediaElementをDOM直接操作で作成）
  useEffect(() => {
    const mediaEl = document.createElement('div');
    mediaEl.id = 'textalive-media';
    mediaEl.style.cssText = [
      'position: fixed', 'bottom: 0', 'right: 0', 'width: 320px', 'height: 240px',
      'overflow: hidden', 'contain: layout paint', 'opacity: 0.01', 'pointer-events: none', 'z-index: -1',
    ].join(';');
    document.body.appendChild(mediaEl);

    // Songle/TextAliveがbodyに追加する要素を監視・無効化
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement && node.parentNode === document.body) {
            if (node.id !== 'root' && node.id !== 'textalive-media' &&
              node.tagName !== 'SCRIPT' && node.tagName !== 'LINK' && node.tagName !== 'STYLE') {
              node.style.cssText = 'position:fixed!important;left:-9999px!important;top:-9999px!important;width:1px!important;height:1px!important;opacity:0!important;pointer-events:none!important;z-index:-9999!important;overflow:hidden!important;';
            }
          }
        }
      }
    });
    observer.observe(document.body, { childList: true });

    const player = new Player({
      app: { token: APP_TOKEN },
      mediaElement: mediaEl,
    });
    playerRef.current = player;
    (window as any).__mikusetPlayer = player;

    player.addListener({
      onAppReady(app: IPlayerApp) {
        console.log('[MusicManager] App準備完了');
        setState((prev) => ({ ...prev, statusMessage: '楽曲データを読み込み中...' }));
        if (!app.managed) {
          // デフォルト楽曲の読み込み時にも lyricId などの設定オプションを適用
          const song = CONTEST_SONGS.find((s) => s.url === DEFAULT_SONG_URL);
          const options = song && song.lyricId ? { video: { lyricId: song.lyricId } } : undefined;
          player.createFromSongUrl(DEFAULT_SONG_URL, options);
        }
      },

      onVideoReady(video: IVideo) {
        // デバッグログ: TextAlive から取得した楽曲のメタ情報と歌詞を詳細に出力
        console.log('[MusicManager] 楽曲データ準備完了:', `${video.wordCount} 単語`);
        console.log('[MusicManager] video URL:', (video as any).url);
        console.log('[MusicManager] video documentUrl:', (video as any).documentUrl);
        console.log('[MusicManager] video text:', (video as any).text);
        if (video.firstWord) {
          console.log('[MusicManager] 最初のワードのテキスト:', video.firstWord.text);
        }

        (window as any).__mikusetWords = [];
        (window as any).__mikusetChars = [];
        (window as any).__mikusetPhrases = [];
        positionRef.current = 0;
        maxPositionRef.current = 0;

        // --- 1. 文字データの抽出 (セーフティカウンタ付き) ---
        let allChars: { text: string; startTime: number; endTime: number; parentWord: any }[] = [];
        let wordPtr = video.firstWord;
        let wordSafety = 0;
        while (wordPtr && wordSafety < 2000) {
          wordSafety++;
          let charPtr = wordPtr.firstChar;
          let charSafety = 0;
          while (charPtr && charSafety < 200) {
            charSafety++;
            // コーラス周辺の異常データ（タイミングが10ms以下の壊れたデータ）を広範囲に除去
            const isBrokenInChorus = charPtr.startTime >= 50000 && charPtr.startTime <= 120000 && (charPtr.endTime - charPtr.startTime <= 10);

            if (!isBrokenInChorus && charPtr.text && charPtr.text.trim() !== '') {
              allChars.push({ text: charPtr.text, startTime: charPtr.startTime, endTime: charPtr.endTime, parentWord: wordPtr });
            }
            charPtr = charPtr.next;
          }
          wordPtr = wordPtr.next;
        }

        // --- 2. 精密コーラスデータの注入 ---
        if ((video as any).documentUrl && (video as any).documentUrl.includes('6W2N')) {
          let chorusCount = 0;
          KOTAETE_CHORUS_DATA.forEach((phrase) => {
            phrase.forEach((char: any) => {
              allChars.push({ text: char.text, startTime: char.startTime, endTime: char.endTime, parentWord: { duration: 1 } });
              chorusCount++;
            });
          });
          console.log(`[MusicManager] ${chorusCount} 文字の精密データを注入しました`);
        }

        // 重複を除去（10ms以内の同一文字）
        const seen = new Set<string>();
        allChars = allChars.filter(c => {
          const key = `${Math.round(c.startTime / 10) * 10}-${c.text}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        allChars.sort((a, b) => a.startTime - b.startTime);

        // --- 3. Char / Word データの構築 ---
        const finalChars = allChars.map(c => ({
          id: `char-${c.startTime}-${c.text}-${Math.random().toString(36).substr(2, 4)}`,
          text: c.text, startTime: c.startTime, endTime: c.endTime
        }));
        (window as any).__mikusetChars = finalChars;

        const words: any[] = [];
        let currentWordText = '';
        let currentWordStart = 0;
        let currentWordEnd = 0;
        let currentParent: any = null;
        let wordSourceTimes: number[] = [];

        const MAX_CHARS_PER_NOTE = 6; // 6文字で分割して密度を上げる

        allChars.forEach((c) => {
          const isBrokenWord = c.parentWord && c.parentWord.duration <= 10;
          const isTooLong = currentWordText.length >= MAX_CHARS_PER_NOTE;
          const isTimeGap = currentWordEnd > 0 && (c.startTime - currentWordEnd > 400);

          const shouldSplit = !currentParent ||
            (c.parentWord !== currentParent) ||
            isBrokenWord ||
            isTimeGap ||
            isTooLong;

          if (shouldSplit) {
            if (currentWordText) {
              words.push({
                id: `word-${currentWordStart}-${words.length}-${Math.random().toString(36).substr(2, 2)}`,
                text: currentWordText,
                startTime: currentWordStart,
                endTime: currentWordEnd,
                sourceStartTimes: wordSourceTimes
              });
            }
            currentWordText = c.text;
            currentWordStart = c.startTime;
            currentWordEnd = c.endTime;
            currentParent = c.parentWord;
            wordSourceTimes = [c.startTime];
          } else {
            currentWordText += c.text;
            currentWordEnd = Math.max(currentWordEnd, c.endTime);
            wordSourceTimes.push(c.startTime);
          }
        });

        if (currentWordText) {
          words.push({
            id: `word-${currentWordStart}-${words.length}-${Math.random().toString(36).substr(2, 2)}`,
            text: currentWordText,
            startTime: currentWordStart,
            endTime: currentWordEnd,
            sourceStartTimes: wordSourceTimes
          });
        }
        console.log(`[MusicManager] 最終Word数: ${words.length} (MaxChars: ${MAX_CHARS_PER_NOTE})`);

        // 記号や空文字を排除し、有効な歌詞文字（日本語・英数字）を含む最初の単語を厳格に抽出
        const validFirstWord = words.find(w => w.text && /[a-zA-Z0-9\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/.test(w.text));
        (window as any).__mikusetWords = words;
        (window as any).__mikusetFirstWordTime = validFirstWord ? validFirstWord.startTime : (words.length > 0 ? words[0].startTime : 0);
        (window as any).__mikusetLastWordTime = words.length > 0 ? words[words.length - 1].endTime : 0;
        (window as any).__mikusetVideoDuration = video.duration;


        // --- 4. フレーズ情報の構築 (PhraseDisplay用) ---
        const phrases: any[] = [];
        let phrasePtr = video.firstPhrase;
        let pSafety = 0;
        let lastWordEnd = 0;
        let maxGap = 0;

        // 生成されたWordの整合性チェックログ
        console.log(`[MusicManager] --- Word生成結果 (${words.length}件) ---`);
        words.forEach((w, i) => {
          if (i < 5 || (w.startTime > 50000 && w.startTime < 75000) || i > words.length - 5) {
            console.log(`[Word #${i}] ${w.startTime}ms: "${w.text}" (${w.endTime - w.startTime}ms)`);
          }
          if (lastWordEnd > 0 && w.startTime - lastWordEnd > 2000) {
            const gap = w.startTime - lastWordEnd;
            maxGap = Math.max(maxGap, gap);
            console.warn(`[MusicManager] ノーツに空白があります: ${lastWordEnd}ms -> ${w.startTime}ms (隙間: ${gap}ms)`);
          }
          lastWordEnd = w.endTime;
        });
        if (maxGap > 0) console.warn(`[MusicManager] 最大ノーツ隙間: ${maxGap}ms`);

        while (phrasePtr && pSafety < 500) {
          pSafety++;
          const pStart = phrasePtr.startTime;
          const pEnd = phrasePtr.endTime;
          const matchingWords = words.filter(w => w.startTime >= pStart && w.startTime < pEnd);
          const phraseWords = matchingWords.map((w) => ({ id: `pw-${w.id}`, text: w.text, startTime: w.startTime, endTime: w.endTime }));
          if (phraseWords.length > 0) {
            phrases.push({ id: `phrase-${pStart}-${phrases.length}`, startTime: phraseWords[0].startTime, endTime: phraseWords[phraseWords.length - 1].endTime, words: phraseWords });
          }
          phrasePtr = phrasePtr.next;
        }
        (window as any).__mikusetPhrases = phrases;
        (window as any).__mikusetChoruses = (video as any).choruses ? (video as any).choruses.map((c: any) => ({ startTime: c.startTime, endTime: c.endTime })) : [];

        setState((prev) => ({ ...prev, isVideoReady: true, statusMessage: 'タイマー準備中...' }));

        // フォールバック: 3秒待っても onTimerReady が呼ばれない場合は強制的に準備完了にする
        setTimeout(() => {
          setState((prev) => {
            if (prev.isVideoReady && !prev.isReady) {
              console.warn('[MusicPlayer] Timer ready timeout. Forcing isReady to true.');
              return { ...prev, isReady: true, statusMessage: '準備完了 (デモモード)' };
            }
            return prev;
          });
        }, 3000);

        // ★ 最初から再生するために位置を0にリセット
        positionRef.current = 0;
        maxPositionRef.current = 0;
      },

      onTimerReady() {
        setState((prev) => ({ ...prev, isReady: true, statusMessage: '再生可能' }));
      },
      onTimeUpdate(position: number) {
        positionRef.current = position;
        (window as any).__mikusetCurrentPosition = position;
        if (position > maxPositionRef.current) maxPositionRef.current = position;
      },
      onPlay() {
        setState((prev) => ({ ...prev, isPlaying: true }));
        // 最初の再生開始時（開始から1秒以内）に強制的に0秒へシークして前奏カットを防止
        if (positionRef.current < 1000) {
          playerRef.current?.requestMediaSeek(0);
        }
      },
      onPause() { setState((prev) => ({ ...prev, isPlaying: false })); },
      onStop() { setState((prev) => ({ ...prev, isPlaying: false })); positionRef.current = 0; },
    });

    return () => {
      observer.disconnect();
      player.dispose();
      playerRef.current = null;
      if (mediaEl.parentNode) mediaEl.parentNode.removeChild(mediaEl);
    };
  }, []);


  // 操作メソッド
  const play = useCallback((forceStart = false) => {
    const player = playerRef.current;
    if (!player) return;

    const isFinished = player.video && positionRef.current >= player.video.endTime - 500;
    const shouldRestart = forceStart === true || positionRef.current === 0 || isFinished;

    // --- 再生リクエスト ---
    if (shouldRestart) {
      player.requestMediaSeek(0);
      positionRef.current = 0;
      player.requestPlay();
    } else {
      player.requestPlay();
    }

    setState((prev) => ({ ...prev, isTrackingTest: false, calibrationStep: 'NONE' }));
  }, []);


  const pause = useCallback(() => {
    playerRef.current?.requestPause();
  }, []);

  const seek = useCallback((ms: number) => {
    playerRef.current?.requestMediaSeek(ms);
    positionRef.current = ms;
  }, []);

  const setVolume = useCallback((vol: number) => {
    const player = playerRef.current;
    if (player) {
      player.volume = vol;
    }
  }, []);

  const clearGlobalMusicData = useCallback(() => {
    const win = window as any;
    win.__mikusetWords = [];
    win.__mikusetChars = [];
    win.__mikusetPhrases = [];
    win.__mikusetChoruses = [];
    win.__mikusetFirstWordTime = 0;
    win.__mikusetLastWordTime = 0;
    win.__mikusetVideoDuration = 0;
    win.__mikusetCurrentPosition = 0;
    if (win.__mikusetHitWordIds) {
      win.__mikusetHitWordIds.clear();
    }
  }, []);

  const resetPlayProgress = useCallback(() => {
    const win = window as any;
    win.__mikusetCurrentPosition = 0;
    if (win.__mikusetHitWordIds) {
      win.__mikusetHitWordIds.clear();
    }
  }, []);

  const stop = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;

    resetPlayProgress();
    clearGlobalMusicData();

    // requestStop() は TextAlive の内部分析エンジンを完全停止させてしまい、
    // 再度 requestPlay() しても onTimeUpdate が発火しなくなる。
    // そのため requestPause + requestMediaSeek(0) で「一時停止＋先頭に戻す」方式にする。
    player.requestPause();
    
    // 同じ楽曲を再ロードして完全初期化
    const url = state.activeSongUrl;
    setState((prev) => ({
      ...prev,
      isPlaying: false,
      isTrackingTest: false,
      calibrationStep: 'NONE',
      isReady: false,
      isVideoReady: false,
      statusMessage: '楽曲データを再読み込み中...',
    }));

    positionRef.current = 0;
    maxPositionRef.current = 0;

    const song = CONTEST_SONGS.find((s) => s.url === url);
    const options = song && song.lyricId ? { video: { lyricId: song.lyricId } } : undefined;
    player.createFromSongUrl(url, options);
  }, [resetPlayProgress, clearGlobalMusicData, state.activeSongUrl]);

  const togglePlayPause = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    if (p.isPlaying) {
      p.requestPause();
    } else {
      p.requestPlay();
      setState((prev) => ({ ...prev, isTrackingTest: false, calibrationStep: 'NONE' }));
    }
  }, []);

  const toggleTrackingTest = useCallback(() => {
    setState((prev) => {
      // テストをOFFにする場合はキャリブレーションもキャンセルする
      const nextTest = !prev.isTrackingTest;
      return {
        ...prev,
        isTrackingTest: nextTest,
        calibrationStep: nextTest ? prev.calibrationStep : 'NONE'
      };
    });
  }, []);

  const setCalibrationStep = useCallback((step: CalibrationStep) => {
    setState((prev) => ({ ...prev, calibrationStep: step }));
  }, []);

  const setCalibrationData = useCallback((data: CalibrationData) => {
    setState((prev) => ({ ...prev, calibrationData: data }));
    localStorage.setItem('mikuset_calibration', JSON.stringify(data));
  }, []);

  const selectSong = useCallback((url: string) => {
    if (!playerRef.current) return;

    clearGlobalMusicData();

    setState((prev) => ({
      ...prev,
      activeSongUrl: url,
      isReady: false,
      isVideoReady: false,
      statusMessage: '楽曲データを読み込み中...',
    }));

    positionRef.current = 0; // 曲の切り替え時に再生位置を明示的にリセット
    const song = CONTEST_SONGS.find((s) => s.url === url);
    const options = song && song.lyricId ? { video: { lyricId: song.lyricId } } : undefined;
    playerRef.current.createFromSongUrl(url, options);
  }, [clearGlobalMusicData]);

  const toggleAutoPlay = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isAutoPlayMode: !prev.isAutoPlayMode,
    }));
  }, []);

  const toggleMagicalGuestMode = useCallback(() => {
    setState((prev) => {
      const nextMode = !prev.isMagicalGuestMode;
      return {
        ...prev,
        isMagicalGuestMode: nextMode,
        // マジカル・ゲストONなら、自動的にオートプレイをONにし、仮想キーボードモードをOFF（カメラON）にする
        isAutoPlayMode: nextMode ? true : prev.isAutoPlayMode,
        isVirtualInputMode: nextMode ? false : prev.isVirtualInputMode,
      };
    });
  }, []);

  const toggleVirtualInputMode = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isVirtualInputMode: !prev.isVirtualInputMode,
    }));
  }, []);

  const setLanguage = useCallback((lang: 'en' | 'ja') => {
    setState((prev) => ({ ...prev, language: lang }));
  }, []);

  const toggleInputLabels = useCallback(() => {
    setState((prev) => ({ ...prev, showInputLabels: !prev.showInputLabels }));
  }, []);

  const toggleHideScrollingLyrics = useCallback(() => {
    setState((prev) => ({ ...prev, hideScrollingLyrics: !prev.hideScrollingLyrics }));
  }, []);


  // actions は固定（useCallback済み）なので一度だけ生成
  const actions = useMemo<MusicPlayerActions>(
    () => ({ play, pause, stop, seek, setVolume, togglePlayPause, toggleTrackingTest, setCalibrationStep, setCalibrationData, selectSong, toggleAutoPlay, toggleMagicalGuestMode, toggleVirtualInputMode, setLanguage, toggleInputLabels, toggleHideScrollingLyrics }),
    [play, pause, stop, seek, setVolume, togglePlayPause, toggleTrackingTest, setCalibrationStep, setCalibrationData, selectSong, toggleAutoPlay, toggleMagicalGuestMode, toggleVirtualInputMode, setLanguage, toggleInputLabels, toggleHideScrollingLyrics]
  );

  // contextValue は state が変わった時のみ再生成
  const contextValue = useMemo<MusicPlayerContextValue>(
    () => ({ state, actions, positionRef, maxPositionRef }),
    [state, actions, positionRef, maxPositionRef]
  );

  return (
    <MusicPlayerContext.Provider value={contextValue}>
      {children}
    </MusicPlayerContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// カスタムフック
// ---------------------------------------------------------------------------

export function useMusicPlayer(): MusicPlayerContextValue {
  const context = useContext(MusicPlayerContext);
  if (!context) {
    throw new Error('useMusicPlayer は MusicProvider の中で使用してください');
  }
  return context;
}
