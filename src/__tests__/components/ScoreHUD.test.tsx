import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ScoreHUD from '../../components/ScoreHUD';

// Mock contexts
vi.mock('../../hooks/useGameState', () => ({
  useGameState: () => ({
    stateRef: {
      current: {
        score: 12345,
        combo: 50,
        maxCombo: 100,
        productionLevel: 4
      }
    },
    getSnapshot: () => ({
      score: 12345,
      combo: 50,
      maxCombo: 100,
      productionLevel: 4
    })
  })
}));

vi.mock('../../hooks/useMusicPlayer', () => ({
  useMusicPlayer: () => ({
    state: { isReady: true, isVideoReady: true }
  })
}));

describe('ScoreHUD Component', () => {
  it('should render score and combo', () => {
    render(<ScoreHUD />);
    expect(screen.getByText('12,345')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('COMBO')).toBeInTheDocument();
  });
});
