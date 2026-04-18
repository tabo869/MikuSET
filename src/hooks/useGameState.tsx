import {
  createContext,
  useContext,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import type { DifficultyLevel } from '../config/difficulty';

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

/** ゲーム状態 */
export interface GameState {
  score: number;
  combo: number;
  maxCombo: number;
  hits: number;
  misses: number;
  productionLevel: number;
  /** 現在の難易度 */
  currentDifficulty: DifficultyLevel;
  /** ラグ調整オフセット（ms） */
  globalOffsetMs: number;
}

// ... (省略箇所なしで再記述)
export interface GameActions {
  onHit: () => void;
  onMiss: () => void;
  reset: () => void;
  /** 難易度を変更する */
  setDifficulty: (level: DifficultyLevel) => void;
  /** ラグオフセットを変更する（ms） */
  setGlobalOffsetMs: (ms: number) => void;
}

export interface GameStateContextValue {
  stateRef: React.RefObject<GameState>;
  actions: GameActions;
  getSnapshot: () => GameState;
}

const INITIAL_STATE: GameState = {
  score: 0,
  combo: 0,
  maxCombo: 0,
  hits: 0,
  misses: 0,
  productionLevel: 1,
  currentDifficulty: 'Normal',
  globalOffsetMs: 0,
};

const BASE_SCORE = 100;
const COMBO_BONUS = 10;

const GameStateContext = createContext<GameStateContextValue | null>(null);

interface GameStateProviderProps {
  children: ReactNode;
}

export function GameStateProvider({ children }: GameStateProviderProps) {
  const stateRef = useRef<GameState>({ ...INITIAL_STATE });
  const listenersRef = useRef<Set<() => void>>(new Set());

  const notifyListeners = useCallback(() => {
    listenersRef.current.forEach((fn) => fn());
  }, []);

  const onHit = useCallback(() => {
    const s = stateRef.current;
    s.combo += 1;
    s.hits += 1;
    s.score += BASE_SCORE + s.combo * COMBO_BONUS;
    if (s.combo > s.maxCombo) {
      s.maxCombo = s.combo;
    }
    
    // 演出レベルの計算
    // 初期/ミス時は1, コンボ開始時は2, 以降10ごとに上がる
    if (s.combo >= 20) s.productionLevel = 4;
    else if (s.combo >= 10) s.productionLevel = 3;
    else if (s.combo >= 1) s.productionLevel = 2;
    else s.productionLevel = 1;

    console.log(
      `[GameState] ✨ HIT! スコア: ${s.score} コンボ: ${s.combo} Level: ${s.productionLevel}`
    );
    notifyListeners();
  }, [notifyListeners]);

  const onMiss = useCallback(() => {
    const s = stateRef.current;
    s.combo = 0;
    s.productionLevel = 1;
    s.misses += 1;
    console.log(`[GameState] ✗ MISS コンボリセット Level: 1`);
    notifyListeners();
  }, [notifyListeners]);

  const reset = useCallback(() => {
    const prev = stateRef.current;
    stateRef.current = {
      ...INITIAL_STATE,
      currentDifficulty: prev.currentDifficulty,
      globalOffsetMs: prev.globalOffsetMs,
    };
    notifyListeners();
  }, [notifyListeners]);

  const setDifficulty = useCallback((level: DifficultyLevel) => {
    stateRef.current.currentDifficulty = level;
    notifyListeners();
  }, [notifyListeners]);

  const setGlobalOffsetMs = useCallback((ms: number) => {
    stateRef.current.globalOffsetMs = ms;
    notifyListeners();
  }, [notifyListeners]);

  const getSnapshot = useCallback(() => {
    return { ...stateRef.current };
  }, []);

  const contextValue: GameStateContextValue = {
    stateRef,
    actions: { onHit, onMiss, reset, setDifficulty, setGlobalOffsetMs },
    getSnapshot,
  };

  return (
    <GameStateContext.Provider value={contextValue}>
      {children}
    </GameStateContext.Provider>
  );
}

import { useSyncExternalStore } from 'react';

/**
 * ゲームステートのContextを取得するフック
 */
export function useGameState(): GameStateContextValue {
  const context = useContext(GameStateContext);
  if (!context) {
    throw new Error('useGameState は GameStateProvider の中で使用してください');
  }
  return context;
}

/**
 * 演出レベル(0~4)の変更だけを購読して再描画を発生させる軽量なフック
 */
export function useProductionLevel(): number {
  const context = useGameState();
  
  const subscribe = useCallback((callback: () => void) => {
    const fn = () => callback();
    // 実際に listenersRef にアクセスするには Context に公開する必要があります。
    // しかし今回の設計では getSnapshot とともに手軽な polling を使うか、
    // または listeners への購読口を無理やり開けるより、グローバルなイベントで処理します。
    // 今回は getSnapshot があるため簡便な polling とします。
    const interval = setInterval(fn, 100);
    return () => clearInterval(interval);
  }, []);

  const getSnapshot = useCallback(() => context.getSnapshot().productionLevel, [context]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
