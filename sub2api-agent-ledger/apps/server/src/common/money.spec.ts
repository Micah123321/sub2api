import { describe, expect, it } from 'vitest';
import {
  addMinor,
  assertNonNegativeBalance,
  computeDeltaForSet,
  formatMinorToMajor,
  MoneyError,
  parseMajorToMinor,
} from './money';

describe('money', () => {
  it('parses major units into minor integers and rejects invalid floats', () => {
    expect(parseMajorToMinor('12.34')).toBe(1234);
    expect(parseMajorToMinor(10)).toBe(1000);
    expect(parseMajorToMinor('-1.5')).toBe(-150);
    expect(() => parseMajorToMinor('12.345')).toThrow(MoneyError);
    expect(() => parseMajorToMinor('abc')).toThrow(MoneyError);
    expect(() => parseMajorToMinor(Number.NaN)).toThrow(MoneyError);
  });

  it('formats and adds with overflow checks', () => {
    expect(formatMinorToMajor(1234)).toBe('12.34 USD');
    expect(addMinor(100, 50)).toBe(150);
    expect(computeDeltaForSet(100, 250)).toBe(150);
    expect(() => assertNonNegativeBalance(-1)).toThrow(MoneyError);
  });
});
