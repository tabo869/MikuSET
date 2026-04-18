import { describe, it, expect } from 'vitest';
import { mapToWorld } from '../../utils/coordinateMapper';

describe('coordinateMapper', () => {
  it('should map center (0.5, 0.5) to (0, 0, Z)', () => {
    const result = mapToWorld(0.5, 0.5, 0);
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(0);
    expect(result.z).toBeCloseTo(0);
  });

  it('should mirror X and map top-left (0, 0) to max X and max Y', () => {
    // normX=0 -> mirror -> x max (4.8)
    // normY=0 -> invert -> y max (2.8)
    const result = mapToWorld(0.0, 0.0, 0);
    expect(result.x).toBeCloseTo(4.8);
    expect(result.y).toBeCloseTo(2.8);
  });

  it('should mirror X and map bottom-right (1, 1) to min X and min Y', () => {
    const result = mapToWorld(1.0, 1.0, 0);
    expect(result.x).toBeCloseTo(-4.8);
    expect(result.y).toBeCloseTo(-2.8);
  });

  it('should clamp values outside of 0-1 range', () => {
    const result = mapToWorld(2.0, -1.0, 10.0);
    expect(result.x).toBeCloseTo(-4.8); // clamped min
    expect(result.y).toBeCloseTo(2.8);  // clamped max
    expect(result.z).toBeCloseTo(2);    // clamped max
  });

  it('should correctly scale when bounds are provided', () => {
    const bounds = { minX: 0.2, maxX: 0.8, minY: 0.2, maxY: 0.8 };
    // Inside bounds (center)
    const resCenter = mapToWorld(0.5, 0.5, 0, bounds);
    expect(resCenter.x).toBeCloseTo(0);
    expect(resCenter.y).toBeCloseTo(0);

    // Corner of bounds -> mapped to extremes
    const resEdge = mapToWorld(0.2, 0.2, 0, bounds);
    expect(resEdge.x).toBeCloseTo(4.8);
    expect(resEdge.y).toBeCloseTo(2.8);
  });

  // MW-04: Abnormal Range
  it('[MW-04] should clamp extreme outer bounds safely', () => {
    const result = mapToWorld(-10.0, 10.0, 2.0);
    expect(result.x).toBeCloseTo(4.8);
    expect(result.x).toBeLessThanOrEqual(4.8);
    expect(result.x).toBeGreaterThanOrEqual(-4.8);
    
    expect(result.y).toBeLessThanOrEqual(2.8);
    expect(result.y).toBeGreaterThanOrEqual(-2.8);
    
    expect(result.z).toBeLessThanOrEqual(2);
    expect(result.z).toBeGreaterThanOrEqual(-2);
  });

  // MW-05: NaN
  it('[MW-05] should handle NaN inputs safely without crashing', () => {
    const result = mapToWorld(NaN, NaN, 0);
    expect(result.x).toBeNaN();
    expect(result.y).toBeNaN();
  });

  // MW-06: Zero Area bounds
  it('[MW-06] should prevent divide by zero for zero area bounds', () => {
    const badBounds = { minX: 0.5, maxX: 0.5, minY: 0.5, maxY: 0.5 };
    const res = mapToWorld(0.5, 0.5, 0, badBounds);
    expect(res.x).toBeCloseTo(0); // Falls back to default calculation
    expect(res.y).toBeCloseTo(0);
  });
});
