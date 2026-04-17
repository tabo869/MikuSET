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

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

import { CONTEST_SONGS } from '../config/songs';

/**
 * TextAlive App API トークン
 * ※ TextAlive開発者サイトで発行されたトークン
 *    無効な場合はデモモードで動作する
 */
const APP_TOKEN = 'nHnMSqOuct1mMKqt';

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
}

/** MusicPlayer の操作メソッド */
export interface MusicPlayerActions {
  play: (forceStart?: boolean) => void;
  pause: () => void;
  stop: () => void;
  togglePlayPause: () => void;
  toggleTrackingTest: () => void;
  setCalibrationStep: (step: CalibrationStep) => void;
  setCalibrationData: (data: CalibrationData) => void;
  selectSong: (url: string) => void;
  toggleAutoPlay: () => void;
  toggleVirtualInputMode: () => void;
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
    isVirtualInputMode: false,
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

  // Player初期化（mediaElementをDOM直接操作で作成）
  useEffect(() => {
    const mediaEl = document.createElement('div');
    mediaEl.id = 'textalive-media';
    // contain: layout paint → 子要素の描画をこの要素の範囲にクリッピング
    // （contain: strict と違い size 制約がないためSongle SDKの初期化は通る）
    mediaEl.style.cssText = [
      'position: fixed',
      'bottom: 0',
      'right: 0',
      'width: 320px',
      'height: 240px',
      'overflow: hidden',
      'contain: layout paint',
      'opacity: 0.01',
      'pointer-events: none',
      'z-index: -1',
    ].join(';');
    document.body.appendChild(mediaEl);

    // --- Songle/TextAliveがbodyに追加する要素を監視・無効化 ---
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement && node.parentNode === document.body) {
            // #root と #textalive-media 以外のbody直下要素を強制非表示
            if (node.id !== 'root' && node.id !== 'textalive-media' &&
                node.tagName !== 'SCRIPT' && node.tagName !== 'LINK' && node.tagName !== 'STYLE') {
              console.log('[MusicManager] Songle要素を検出・非表示化:', node.tagName, node.id || node.className);
              node.style.cssText = 'position:fixed!important;left:-9999px!important;top:-9999px!important;width:1px!important;height:1px!important;opacity:0!important;pointer-events:none!important;z-index:-9999!important;overflow:hidden!important;';
            }
          }
        }
      }
    });
    observer.observe(document.body, { childList: true });

    // --- TextAlive Player 初期化 ---
    const player = new Player({
      app: { token: APP_TOKEN },
      mediaElement: mediaEl,
    });
    playerRef.current = player;

    player.addListener({
      onAppReady(app: IPlayerApp) {
        console.log('[MusicManager] App準備完了', { managed: app.managed });
        setState((prev) => ({
          ...prev,
          statusMessage: '楽曲データを読み込み中...',
        }));

        if (!app.managed) {
          player.createFromSongUrl(DEFAULT_SONG_URL);
        }
      },

      onVideoReady(video: IVideo) {
        console.log(
          '[MusicManager] 楽曲データ準備完了:',
          `${video.wordCount} 単語, ${video.charCount} 文字`
        );

        // 全Wordのリストを構築してグローバルに公開（NoteManagerが参照する）
        const words: { text: string; startTime: number; endTime: number }[] = [];
        let lastWordTime = 0;
        let word = video.firstWord;
        while (word) {
          words.push({
            text: word.text,
            startTime: word.startTime,
            endTime: word.endTime,
          });
          lastWordTime = Math.max(lastWordTime, word.endTime);
          word = word.next;
        }
        (window as unknown as Record<string, unknown>).__mikusetWords = words;
        (window as unknown as Record<string, unknown>).__mikusetLastWordTime = lastWordTime;
        (window as unknown as Record<string, unknown>).__mikusetVideoDuration = video.duration;

        // フレーズ情報の取得（PhraseDisplayで使用）
        const phrases: {
          id: string;
          startTime: number;
          endTime: number;
          words: { id: string; text: string; startTime: number; endTime: number }[];
        }[] = [];
        let phrase = video.firstPhrase;
        while (phrase) {
          const phraseWords: { id: string; text: string; startTime: number; endTime: number }[] = [];
          let w = phrase.firstWord;
          while (w) {
            phraseWords.push({
              id: `${phrase.startTime}-${w.startTime}-${w.text}`,
              text: w.text,
              startTime: w.startTime,
              endTime: w.endTime,
            });
            w = w.next;
          }
          phrases.push({
            id: `phrase-${phrase.startTime}`,
            startTime: phrase.startTime,
            endTime: phrase.endTime,
            words: phraseWords,
          });
          phrase = phrase.next;
        }
        (window as unknown as Record<string, unknown>).__mikusetPhrases = phrases;
        console.log(`[MusicManager] ${phrases.length} 個のフレーズデータを公開`);


        // サビ情報の取得
        const choruses: { startTime: number; endTime: number }[] = [];
        if (video.choruses) {
          video.choruses.forEach((c) => {
            choruses.push({ startTime: c.startTime, endTime: c.endTime });
          });
        }
        (window as unknown as Record<string, unknown>).__mikusetChoruses = choruses;

        // 最初のWordの開始時刻を保存（play()でのシーク先として利用）
        const firstWordTime = words.length > 0 ? words[0].startTime : 0;
        (window as unknown as Record<string, unknown>).__mikusetFirstWordTime = firstWordTime;
        console.log(
          `[MusicManager] ${words.length} 個のWordデータ、${choruses.length} 個のサビ区間を公開。` +
          `最初のWord: ${Math.round(firstWordTime / 1000)}秒 (${firstWordTime}ms)`
        );

        setState((prev) => ({
          ...prev,
          isVideoReady: true,
          statusMessage: 'タイマー準備中...',
        }));
      },

      onTimerReady(_timer: Timer) {
        console.log('[MusicManager] タイマー準備完了 — 再生可能');
        setState((prev) => ({
          ...prev,
          isReady: true,
          statusMessage: '再生可能',
        }));
      },

      /**
       * 毎フレーム更新
       * ★ setStateは絶対に呼ばない — positionRefのみ更新
       */
      onTimeUpdate(position: number) {
        positionRef.current = position;
        if (position > maxPositionRef.current) {
          maxPositionRef.current = position;
        }
      },

      onPlay() {
        setState((prev) => ({ ...prev, isPlaying: true }));
      },
      onPause() {
        setState((prev) => ({ ...prev, isPlaying: false }));
      },
      onStop() {
        setState((prev) => ({ ...prev, isPlaying: false }));
        positionRef.current = 0;
      },
    });

    return () => {
      observer.disconnect();
      player.dispose();
      playerRef.current = null;
      // mediaElementをDOMから除去
      if (mediaEl.parentNode) {
        mediaEl.parentNode.removeChild(mediaEl);
      }
      console.log('[MusicManager] Player破棄完了');
    };
  }, []);

  // 操作メソッド
  const play = useCallback((forceStart = false) => {
    const player = playerRef.current;
    if (!player) return;

    // __mikusetFirstWordTime が取得できている場合は最初のWordの直前からシーク再生する。
    // こうすることでイントロが長い楽曲でも開始直後からノーツが降ってくる。
    // NOTE_LEAD_MS: ノーツが先行して降ってくるためのリードタイム（余裕を持って3秒前から）
    const NOTE_LEAD_MS = 3000;
    const firstWordTime =
      (window as unknown as Record<string, unknown>).__mikusetFirstWordTime as number | undefined;

    const isFinished = player.video && positionRef.current >= player.video.endTime - 500;
    const shouldRestart = forceStart === true || positionRef.current === 0 || isFinished;

    if (shouldRestart) {
      if (firstWordTime !== undefined && firstWordTime > NOTE_LEAD_MS) {
        const seekTo = Math.max(0, firstWordTime - NOTE_LEAD_MS);
        console.log(`[MusicPlayer] 最初のWord(${Math.round(firstWordTime / 1000)}s)の${NOTE_LEAD_MS / 1000}秒前(${Math.round(seekTo / 1000)}s)からシーク再生`);
        player.requestMediaSeek(seekTo);
      } else {
        player.requestMediaSeek(0);
      }
    }
    
    player.requestPlay();

    maxPositionRef.current = 0; // 新規再生時に最大位置をリセット
    setState((prev) => ({ ...prev, isTrackingTest: false, calibrationStep: 'NONE' }));
  }, []);

  const pause = useCallback(() => {
    playerRef.current?.requestPause();
  }, []);

  const stop = useCallback(() => {
    playerRef.current?.requestStop();
  }, []);

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
    
    setState((prev) => ({
      ...prev,
      activeSongUrl: url,
      isReady: false,
      isVideoReady: false,
      statusMessage: '楽曲データを読み込み中...',
    }));
    
    positionRef.current = 0; // 曲の切り替え時に再生位置を明示的にリセット
    playerRef.current.createFromSongUrl(url);
  }, []);

  const toggleAutoPlay = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isAutoPlayMode: !prev.isAutoPlayMode,
    }));
  }, []);

  const toggleVirtualInputMode = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isVirtualInputMode: !prev.isVirtualInputMode,
    }));
  }, []);

  // actions は固定（useCallback済み）なので一度だけ生成
  const actions = useMemo<MusicPlayerActions>(
    () => ({ play, pause, stop, togglePlayPause, toggleTrackingTest, setCalibrationStep, setCalibrationData, selectSong, toggleAutoPlay, toggleVirtualInputMode }),
    [play, pause, stop, togglePlayPause, toggleTrackingTest, setCalibrationStep, setCalibrationData, selectSong, toggleAutoPlay, toggleVirtualInputMode]
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
