import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import VirtualInputManager from '../../components/VirtualInputManager';

describe('VirtualInputManager calcTrackingInset Matrix Test', () => {
  let originalInnerWidth: number;
  let originalInnerHeight: number;

  beforeEach(() => {
    originalInnerWidth = window.innerWidth;
    originalInnerHeight = window.innerHeight;
  });

  afterEach(() => {
    // Restore window dimensions
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: originalInnerWidth });
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: originalInnerHeight });
    vi.restoreAllMocks();
  });

  const testMatrix = [
    { id: 'CTI-01', w: 1920, h: 1080, expectedTopValid: true, expectedLeftValid: true },
    { id: 'CTI-02', w: 800,  h: 600,  expectedTopValid: true, expectedLeftValid: true },
    { id: 'CTI-03', w: 1080, h: 1920, expectedTopValid: true, expectedLeftValid: true }, // Extremely tall, Math.max(0, ...) should prevent negative
    { id: 'CTI-04', w: 0,    h: 0,    expectedTopValid: true, expectedLeftValid: true }, // Zero
    { id: 'CTI-05', w: -100, h: -100, expectedTopValid: true, expectedLeftValid: true }  // Negative
  ];

  it.each(testMatrix)('[$id] should safely compute inset for window %dx%d', ({ w, h, expectedTopValid, expectedLeftValid }) => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: w });
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: h });

    const mockRef = { current: { left: { detected: false, fingertip: {} }, right: { detected: false, fingertip: {} } } };
    
    // We expect it to not throw an error during calculation regardless of proportions
    let error: Error | null = null;
    let container: HTMLElement | null = null;
    try {
      const result = render(<VirtualInputManager isActive={true} handsDataRef={mockRef as any} />);
      container = result.container;
    } catch(e: any) {
      error = e;
    }

    if (error) {
      throw new Error(`[Bug] Component crashed on resolution ${w}x${h} with error: ${error.message}`);
    }

    // It renders an absolute positioned wrapper as its firstChild
    const wrapper = container?.firstChild as HTMLElement;
    expect(wrapper).toBeTruthy();
    
    const topStr = wrapper.style.top;
    const leftStr = wrapper.style.left;
    const topVal = parseFloat(topStr);
    const leftVal = parseFloat(leftStr);

    if (expectedTopValid) {
      if (isNaN(topVal) || topVal < 0 || topVal === Infinity) {
        throw new Error(`[Bug] Top percentage is invalid (${topStr}) for resolution ${w}x${h}`);
      }
    }
    
    if (expectedLeftValid) {
      if (isNaN(leftVal) || leftVal < 0 || leftVal === Infinity) {
         throw new Error(`[Bug] Left percentage is invalid (${leftStr}) for resolution ${w}x${h}`);
      }
    }
  });
});
