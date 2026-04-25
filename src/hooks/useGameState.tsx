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
  hits: number;
  perfects: number;
  misses: number;
  score: number;
  combo: number;
  maxCombo: number;
  health: number;
  isGameOver: boolean;
  productionLevel: number;
  /** 現在の難易度 */
  currentDifficulty: DifficultyLevel;
  /** ラグ調整オフセット（ms） */
  globalOffsetMs: number;
}

export interface GameActions {
  registerHit: (isPerfect: boolean) => void;
  registerMiss: () => void;
  registerPenalty: () => void;
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
  hits: 0,
  perfects: 0,
  misses: 0,
  score: 0,
  combo: 0,
  maxCombo: 0,
  health: 100,
  isGameOver: false,
  productionLevel: 1,
  currentDifficulty: 'Normal',
  globalOffsetMs: 0,
};

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

  const registerHit = useCallback((isPerfect: boolean) => {
    const s = stateRef.current;
    if (s.isGameOver) return;

    const newCombo = s.combo + 1;
    const baseScore = isPerfect ? 1000 : 500;
    const comboBonus = Math.floor(newCombo / 10) * 100;
    const addedScore = baseScore + comboBonus;
    const newHealth = Math.min(100, s.health + (isPerfect ? 5 : 2));

    stateRef.current = {
      ...s,
      hits: s.hits + 1,
      perfects: isPerfect ? s.perfects + 1 : s.perfects,
      combo: newCombo,
      maxCombo: Math.max(s.maxCombo, newCombo),
      score: s.score + addedScore,
      health: newHealth,
    };
    
    // 演出レベルの計算
    if (newCombo >= 80) stateRef.current.productionLevel = 8;
    else if (newCombo >= 60) stateRef.current.productionLevel = 7;
    else if (newCombo >= 40) stateRef.current.productionLevel = 6;
    else if (newCombo >= 30) stateRef.current.productionLevel = 5;
    else if (newCombo >= 20) stateRef.current.productionLevel = 4;
    else if (newCombo >= 10) stateRef.current.productionLevel = 3;
    else if (newCombo >= 1) stateRef.current.productionLevel = 2;
    else stateRef.current.productionLevel = 1;

    notifyListeners();
  }, [notifyListeners]);

  const registerMiss = useCallback(() => {
    const s = stateRef.current;
    if (s.isGameOver) return;

    const newHealth = Math.max(0, s.health - 15);
    const isGameOver = newHealth <= 0;

    stateRef.current = {
      ...s,
      misses: s.misses + 1,
      combo: 0,
      productionLevel: 1,
      health: newHealth,
      isGameOver,
    };
    notifyListeners();
  }, [notifyListeners]);

  const registerPenalty = useCallback(() => {
    const s = stateRef.current;
    if (s.isGameOver) return;

    const newHealth = Math.max(0, s.health - 5);
    const isGameOver = newHealth <= 0;

    stateRef.current = {
      ...s,
      health: newHealth,
      isGameOver,
    };
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
    actions: { registerHit, registerMiss, registerPenalty, reset, setDifficulty, setGlobalOffsetMs },
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
