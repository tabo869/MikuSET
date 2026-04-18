import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import MusicManager from '../../components/MusicManager';
import { useGameState } from '../../hooks/useGameState';
import { useMusicPlayer } from '../../hooks/useMusicPlayer';

vi.mock('../../hooks/useGameState');
vi.mock('../../hooks/useMusicPlayer');

describe('MusicManager formatTime Matrix Test', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (useGameState as any).mockReturnValue({
      actions: { reset: vi.fn() },
      stateRef: { current: { score: 0, combo: 0, maxCombo: 0, misses: 0, hits: 0 } }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  const testMatrix = [
    { id: 'FT-01', ms: 0, expected: '0:00' },
    { id: 'FT-02', ms: 59999, expected: '0:59' },
    { id: 'FT-03', ms: 60000, expected: '1:00' },
    { id: 'FT-04', ms: 600000, expected: '10:00' },
    { id: 'FT-05', ms: -500, expected: '0:00' },
    { id: 'FT-06', ms: NaN, expected: 'NaN:NaN' }, // We will observe what it actually outputs. Math.max(0, NaN) is NaN.
    { id: 'FT-07', ms: Infinity, expected: 'Infinity:NaN' }
  ];

  it.each(testMatrix)('[$id] should render correct format for $ms ms', async ({ ms, expected }) => {
    // Setup mock player state to simulate playing to trigger time display render
    const mockPositionRef = { current: ms };
    
    (useMusicPlayer as any).mockReturnValue({
      state: { isPlaying: true, isReady: true, isVideoReady: true },
      actions: { play: vi.fn(), stop: vi.fn() },
      positionRef: mockPositionRef,
      maxPositionRef: { current: ms }
    });

    render(<MusicManager />);
    
    // Fast forward to trigger the setInterval inside useEffect
    act(() => {
      vi.advanceTimersByTime(500);
    });

    // The display time in the DOM shouldn't crash it. Let's find the time div.
    // It is rendered with class or style but we know it's a string like 0:00
    // Because NaN output might be "NaN:NaN", we just search the dom tree text
    // We expect the 'expected' string to either be in the document, OR
    // if the function outputs something else safely, we capture it.
    
    // We try to find the text. If it fails, maybe the expected output is actually different.
    // Let's do a try/catch to log the actual DOM text if it fails, which helps in bug reporting.
    try {
      expect(screen.getByText(expected)).toBeInTheDocument();
    } catch(e) {
      // For NaN/Infinity it might output something weird. We grab the element that contains STOP and check its siblings.
      const stopBtn = screen.getByText('STOP');
      const timeDiv = stopBtn.nextElementSibling;
      const actual = timeDiv?.textContent;
      throw new Error(`[Bug found in ${ms} ms] Expected ${expected} but was ${actual}`);
    }
  });
});
