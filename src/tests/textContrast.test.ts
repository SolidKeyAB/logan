import { describe, it, expect } from 'vitest';
import { parseRgb, readableTextColor } from '../shared/textContrast';

describe('parseRgb', () => {
  it('parses #rrggbb', () => expect(parseRgb('#ff0000')).toEqual([255, 0, 0]));
  it('parses shorthand #rgb', () => expect(parseRgb('#0f0')).toEqual([0, 255, 0]));
  it('parses rgb() and rgba()', () => {
    expect(parseRgb('rgb(18, 52, 86)')).toEqual([18, 52, 86]);
    expect(parseRgb('rgba(1,2,3,0.5)')).toEqual([1, 2, 3]);
  });
  it('returns null for unparseable / empty', () => {
    expect(parseRgb('')).toBeNull();
    expect(parseRgb('tomato')).toBeNull();
  });
});

describe('readableTextColor', () => {
  it('dark text on light/bright backgrounds', () => {
    expect(readableTextColor('#ffffff')).toBe('#111111'); // white
    expect(readableTextColor('#ffff00')).toBe('#111111'); // yellow
    expect(readableTextColor('#00ff00')).toBe('#111111'); // green
  });
  it('light text on dark/saturated backgrounds', () => {
    expect(readableTextColor('#000000')).toBe('#f2f2f2'); // black
    expect(readableTextColor('#0000ff')).toBe('#f2f2f2'); // blue
    expect(readableTextColor('#7b1fa2')).toBe('#f2f2f2'); // deep purple
  });
  it('works from rgb() strings too', () => {
    expect(readableTextColor('rgb(255,255,255)')).toBe('#111111');
    expect(readableTextColor('rgb(0,0,0)')).toBe('#f2f2f2');
  });
  it('honors custom dark/light tokens', () => {
    expect(readableTextColor('#ffffff', '#000', '#fff')).toBe('#000');
    expect(readableTextColor('#000000', '#000', '#fff')).toBe('#fff');
  });
  it('falls back to dark on an unparseable background', () => {
    expect(readableTextColor('nope')).toBe('#111111');
  });
});
