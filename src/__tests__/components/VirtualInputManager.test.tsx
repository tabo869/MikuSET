import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import VirtualInputManager from '../../components/VirtualInputManager';

describe('VirtualInputManager Component', () => {
  it('should not render anything when isActive is false', () => {
    const mockRef = { current: { left: { detected: false, fingertip: {} }, right: { detected: false, fingertip: {} } } };
    const { container } = render(<VirtualInputManager isActive={false} handsDataRef={mockRef as any} />);
    expect(container.firstChild).toBeNull();
  });

  it('should render grids when isActive is true', () => {
    const mockRef = { current: { left: { detected: false, fingertip: {} }, right: { detected: false, fingertip: {} } } };
    render(<VirtualInputManager isActive={true} handsDataRef={mockRef as any} />);
    // Check for specific keys
    expect(screen.getByText('W')).toBeInTheDocument();
    expect(screen.getByText('U')).toBeInTheDocument();
  });

  it('should handle keydown and keyup events to simulate hand tracking inputs', () => {
    const mockRef = { current: { left: { detected: false, fingertip: { x:0, y:0, z:0 } }, right: { detected: false, fingertip: { x:0, y:0, z:0 } } } };
    render(<VirtualInputManager isActive={true} handsDataRef={mockRef as any} />);
    
    // Press 'W' for Left Hand
    fireEvent.keyDown(window, { key: 'W' });
    expect(mockRef.current.left.detected).toBe(true);
    expect(mockRef.current.left.fingertip.x).toBe(-3.5); // value for W

    // Release 'W'
    fireEvent.keyUp(window, { key: 'W' });
    expect(mockRef.current.left.detected).toBe(false);
  });
});
