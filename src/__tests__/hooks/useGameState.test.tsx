import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameStateProvider, useGameState, useProductionLevel } from '../../hooks/useGameState';

describe('useGameState Hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <GameStateProvider>{children}</GameStateProvider>
  );

  it('should throw error if used outside provider', () => {
    // Suppress console.error for this specific test
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useGameState())).toThrowError('useGameState は GameStateProvider の中で使用してください');
    consoleError.mockRestore();
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useGameState(), { wrapper });
    
    const snapshot = result.current.getSnapshot();
    expect(snapshot).toEqual({
      score: 0,
      combo: 0,
      maxCombo: 0,
      hits: 0,
      misses: 0,
      productionLevel: 1,
    });
  });

  it('should correctly process onHit and update productionLevel', () => {
    const { result } = renderHook(() => useGameState(), { wrapper });

    act(() => {
      result.current.actions.onHit(); // combo 1 => level 2
    });

    let state = result.current.getSnapshot();
    expect(state.combo).toBe(1);
    expect(state.hits).toBe(1);
    expect(state.score).toBe(110); // BASE_SCORE(100) + COMBO(1)*10
    expect(state.maxCombo).toBe(1);
    expect(state.productionLevel).toBe(2);

    // Hit up to combo 10
    act(() => {
      for(let i=0; i<9; i++) result.current.actions.onHit();
    });
    
    state = result.current.getSnapshot();
    expect(state.combo).toBe(10);
    expect(state.productionLevel).toBe(3);

    // Hit up to combo 20
    act(() => {
      for(let i=0; i<10; i++) result.current.actions.onHit();
    });

    state = result.current.getSnapshot();
    expect(state.combo).toBe(20);
    expect(state.productionLevel).toBe(4);
  });

  it('should correctly process onMiss and reset combo / level', () => {
    const { result } = renderHook(() => useGameState(), { wrapper });

    act(() => {
      result.current.actions.onHit(); // combo 1
      result.current.actions.onHit(); // combo 2
    });

    let state = result.current.getSnapshot();
    expect(state.combo).toBe(2);
    expect(state.maxCombo).toBe(2);

    act(() => {
      result.current.actions.onMiss(); // reset combo
    });

    state = result.current.getSnapshot();
    expect(state.combo).toBe(0);
    expect(state.maxCombo).toBe(2); // max combo remains
    expect(state.misses).toBe(1);
    expect(state.productionLevel).toBe(1);
  });

  it('should reset all state correctly', () => {
    const { result } = renderHook(() => useGameState(), { wrapper });

    act(() => {
      result.current.actions.onHit();
      result.current.actions.onMiss();
      result.current.actions.reset();
    });

    const state = result.current.getSnapshot();
    expect(state.score).toBe(0);
    expect(state.combo).toBe(0);
    expect(state.maxCombo).toBe(0);
    expect(state.hits).toBe(0);
    expect(state.misses).toBe(0);
  });

  it('useProductionLevel should subscribe and return level updates', () => {
    const { result } = renderHook(() => {
      const gs = useGameState();
      const level = useProductionLevel();
      return { gs, level };
    }, { wrapper });

    expect(result.current.level).toBe(1);

    act(() => {
      result.current.gs.actions.onHit(); // Level upgrades to 2
      // Advance timers for polling in useProductionLevel
      vi.advanceTimersByTime(150);
    });

    expect(result.current.level).toBe(2);
  });
});
