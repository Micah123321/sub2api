import { describe, expect, it } from 'vitest';
import {
  addMinor,
  assertNonNegativeBalance,
  computeDeltaForSet,
  formatMicroToMajor,
  formatMinorToMajor,
  MoneyError,
  parseMajorToMinor,
  parseRemoteAmountToMicro,
  parseRemoteBalanceToMinor,
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

  // 浮点乘法误差随数值增大而增大，19.99 * 100 = 1998.9999999999998。
  // 早期用固定的 Number.EPSILON 容差，会把这些常见金额误判成非法输入。
  it('accepts float amounts whose scaled value is not bit-exact', () => {
    expect(parseMajorToMinor(19.99)).toBe(1999);
    expect(parseMajorToMinor(0.29)).toBe(29);
    expect(parseMajorToMinor(1234.56)).toBe(123456);
    expect(parseMajorToMinor(8.87)).toBe(887);
    expect(parseMajorToMinor(-19.99)).toBe(-1999);
    // 超过两位小数仍必须拒绝，本地账本精度不能被放宽。
    expect(() => parseMajorToMinor(12.345)).toThrow(MoneyError);
  });

  // 容差必须是绝对值而非相对值：相对容差会随金额增大而放宽，
  // 大额时把 x.xx5 当成合法两位小数并静默截断（5000000.005 会多算 1 分）。
  it('still rejects three-decimal input at large magnitudes', () => {
    expect(() => parseMajorToMinor(2000000.001)).toThrow(MoneyError);
    expect(() => parseMajorToMinor(5000000.005)).toThrow(MoneyError);
    expect(() => parseMajorToMinor(1029797.001)).toThrow(MoneyError);
    // 同量级的合法两位小数仍须通过。
    expect(parseMajorToMinor(2000000.01)).toBe(200000001);
    expect(parseMajorToMinor(5000000.99)).toBe(500000099);
  });

  it('formats and adds with overflow checks', () => {
    expect(formatMinorToMajor(1234)).toBe('12.34 USD');
    expect(addMinor(100, 50)).toBe(150);
    expect(computeDeltaForSet(100, 250)).toBe(150);
    expect(() => assertNonNegativeBalance(-1)).toThrow(MoneyError);
  });
});

describe('remote money', () => {
  // 主服务余额是 DECIMAL(20,8)，用严格的两位小数解析器会直接抛错并中断整批同步。
  it('rounds high-precision remote balances instead of throwing', () => {
    expect(parseRemoteBalanceToMinor(12.34567891)).toBe(1235);
    expect(parseRemoteBalanceToMinor(19.99)).toBe(1999);
    expect(parseRemoteBalanceToMinor(0)).toBe(0);
    expect(parseRemoteBalanceToMinor(-3.005)).toBe(-300);
    expect(parseRemoteBalanceToMinor('42.5')).toBe(4250);
    expect(() => parseRemoteBalanceToMinor(Number.NaN)).toThrow(MoneyError);
    expect(() => parseRemoteBalanceToMinor(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
  });

  // 单条调用费用是 DECIMAL(20,10)，常在 1e-5 量级；按「分」存会全部变成 0。
  it('keeps sub-cent usage costs representable in micro units', () => {
    expect(parseRemoteAmountToMicro(0.0000123)).toBe(12);
    expect(parseRemoteAmountToMicro(0.00123)).toBe(1230);
    expect(parseRemoteAmountToMicro(1.5)).toBe(1_500_000);
    expect(parseRemoteAmountToMicro(0)).toBe(0);
    expect(() => parseRemoteAmountToMicro('nope')).toThrow(MoneyError);
  });

  it('formats micro amounts without collapsing small values to zero', () => {
    expect(formatMicroToMajor(12)).toBe('0.000012 USD');
    expect(formatMicroToMajor(1_500_000)).toBe('1.50 USD');
    expect(formatMicroToMajor(0)).toBe('0.00 USD');
  });
});
