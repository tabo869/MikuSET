import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MusicProvider, useMusicPlayer } from '../../hooks/useMusicPlayer';

let lastPlayerInstance: any = null;

vi.mock('textalive-app-api', () => {
  return {
    Player: class PlayerMock {
      app: any;
      mediaElement: any;
      listeners: any = {};
      video: any = { endTime: 100000, firstWord: null, firstPhrase: null, choruses: [] };
      isPlaying: boolean = false;
      
      createFromSongUrl = vi.fn();
      requestMediaSeek = vi.fn();
      requestPlay = vi.fn();
      requestPause = vi.fn();
      requestStop = vi.fn();
      dispose = vi.fn();
      
      constructor(config: any) {
        this.app = config.app;
        this.mediaElement = config.mediaElement;
        lastPlayerInstance = this;
      }
      addListener(l: any) { this.listeners = { ...this.listeners, ...l }; }
      __simulateEvent(eventName: string, ...args: any[]) {
          if (this.listeners[eventName]) this.listeners[eventName](...args);
      }
    }
  };
});

import { Player } from 'textalive-app-api';

describe('useMusicPlayer Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <MusicProvider>{children}</MusicProvider>
  );

  it('should throw error if used outside provider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useMusicPlayer())).toThrowError('useMusicPlayer は MusicProvider の中で使用してください');
    consoleError.mockRestore();
  });

  it('should initialize and load textalive Player on mount', () => {
    const { result } = renderHook(() => useMusicPlayer(), { wrapper });
    
    // Default song should be loaded
    expect(result.current.state.activeSongUrl).toBe('https://piapro.jp/t/6W2N/20251215164617');
    expect(result.current.state.statusMessage).toBe('TextAlive Playerを初期化中...');
    
    // Player constructor should be called and instance saved
    expect(lastPlayerInstance).toBeTruthy();
  });

  it('should handle AppReady and VideoReady events', () => {
    const { result } = renderHook(() => useMusicPlayer(), { wrapper });
    
    const mockPlayerInstance = lastPlayerInstance;

    act(() => {
      mockPlayerInstance.__simulateEvent('onAppReady', { managed: false });
    });
    // Should start creating from default URL
    expect(mockPlayerInstance.createFromSongUrl).toHaveBeenCalledWith('https://piapro.jp/t/6W2N/20251215164617');

    act(() => {
      const mockVideo = { wordCount: 10, charCount: 20, firstWord: null, firstPhrase: null, choruses: [] };
      mockPlayerInstance.__simulateEvent('onVideoReady', mockVideo);
    });

    expect(result.current.state.isVideoReady).toBe(true);
    expect(result.current.state.statusMessage).toBe('タイマー準備中...');

    act(() => {
      mockPlayerInstance.__simulateEvent('onTimerReady', {});
    });

    expect(result.current.state.isReady).toBe(true);
    expect(result.current.state.statusMessage).toBe('再生可能');
  });

  it('should accurately handle play, pause, stop actions and timeUpdate without state renders', () => {
    const { result } = renderHook(() => useMusicPlayer(), { wrapper });
    const mockPlayerInstance = lastPlayerInstance;

    act(() => {
      result.current.actions.play(true);
    });
    expect(mockPlayerInstance.requestPlay).toHaveBeenCalled();
    // Simulate internal play event
    act(() => { mockPlayerInstance.__simulateEvent('onPlay'); });
    expect(result.current.state.isPlaying).toBe(true);

    // Time update sets ref, not state
    act(() => { mockPlayerInstance.__simulateEvent('onTimeUpdate', 5000); });
    expect(result.current.positionRef.current).toBe(5000);
    expect(result.current.maxPositionRef.current).toBe(5000);

    act(() => { result.current.actions.pause(); });
    expect(mockPlayerInstance.requestPause).toHaveBeenCalled();
    act(() => { mockPlayerInstance.__simulateEvent('onPause'); });
    expect(result.current.state.isPlaying).toBe(false);

    act(() => { result.current.actions.stop(); });
    expect(mockPlayerInstance.requestStop).toHaveBeenCalled();
    act(() => { mockPlayerInstance.__simulateEvent('onStop'); });
    expect(result.current.state.isPlaying).toBe(false);
    expect(result.current.positionRef.current).toBe(0); // Stop clears position
  });

  it('should toggle various modes correctly', () => {
    const { result } = renderHook(() => useMusicPlayer(), { wrapper });

    act(() => { result.current.actions.toggleAutoPlay(); });
    expect(result.current.state.isAutoPlayMode).toBe(true);

    act(() => { result.current.actions.toggleVirtualInputMode(); });
    expect(result.current.state.isVirtualInputMode).toBe(true);

    act(() => { result.current.actions.toggleTrackingTest(); });
    expect(result.current.state.isTrackingTest).toBe(true);

    act(() => { result.current.actions.setCalibrationStep('RIGHT_TOP_RIGHT'); });
    expect(result.current.state.calibrationStep).toBe('RIGHT_TOP_RIGHT');
    
    // Testing track testing toggle off resets calibration
    act(() => { result.current.actions.toggleTrackingTest(); });
    expect(result.current.state.isTrackingTest).toBe(false);
    expect(result.current.state.calibrationStep).toBe('NONE');
  });

  it('should save and load calibration data from localStorage', () => {
    const { result } = renderHook(() => useMusicPlayer(), { wrapper });
    
    const mockData: any = { right: { minX: 1, maxX: 2, minY: 1, maxY: 2 }, left: { minX: 1, maxX: 2, minY: 1, maxY: 2 } };
    act(() => { result.current.actions.setCalibrationData(mockData); });
    
    expect(result.current.state.calibrationData).toEqual(mockData);
    expect(localStorage.getItem('mikuset_calibration')).toBe(JSON.stringify(mockData));

    // Also tests if restoration works on initial mount (we set it directly here so next renderHook reads it)
    const { result: newResult } = renderHook(() => useMusicPlayer(), { wrapper });
    expect(newResult.current.state.calibrationData.right?.minX).toBe(1);
  });

  it('should change song url and reset state', () => {
    const { result } = renderHook(() => useMusicPlayer(), { wrapper });
    const mockPlayerInstance = lastPlayerInstance;

    act(() => { result.current.actions.selectSong('new_url'); });
    expect(result.current.state.activeSongUrl).toBe('new_url');
    expect(result.current.state.isReady).toBe(false);
    expect(mockPlayerInstance.createFromSongUrl).toHaveBeenCalledWith('new_url');
    expect(result.current.positionRef.current).toBe(0);
  });
});
