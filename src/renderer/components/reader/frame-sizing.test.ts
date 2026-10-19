import { describe, expect, it } from 'vitest';
import { INITIAL_SIZING, MAX_FRAME_HEIGHT, MIN_FRAME_HEIGHT, nextSizing, type FrameSizing } from './frame-sizing';

const feed = (measurements: number[], start: FrameSizing = INITIAL_SIZING) => measurements.reduce(nextSizing, start);

describe('nextSizing', () => {
  it('follows the content height and never drops below the minimum', () => {
    expect(feed([800.4]).height).toBe(801);
    expect(feed([10]).height).toBe(MIN_FRAME_HEIGHT);
  });

  it('keeps following ordinary growth, such as images arriving one by one', () => {
    const sized = feed([600, 900, 1250, 1300]);
    expect(sized.height).toBe(1300);
    expect(sized.locked).toBe(false);
  });

  it('ignores sub-pixel jitter', () => {
    const start = feed([700]);
    expect(nextSizing(start, 701)).toBe(start);
  });

  it('stops following a letter whose height feeds on the frame height', () => {
    // body{min-height:100vh;padding:20px}: every resize adds the same 40px again
    const sized = feed([600, 640, 680, 720, 760, 800]);
    expect(sized.locked).toBe(true);
    expect(sized.height).toBeLessThanOrEqual(720);
    expect(nextSizing(sized, 5000)).toBe(sized);
  });

  it('caps the height and stops there', () => {
    const sized = feed([MAX_FRAME_HEIGHT * 3]);
    expect(sized.height).toBe(MAX_FRAME_HEIGHT);
    expect(sized.locked).toBe(true);
  });

  it('never mutates the state it is given', () => {
    const start = Object.freeze({ ...INITIAL_SIZING });
    expect(() => feed([500, 900], start)).not.toThrow();
  });
});
