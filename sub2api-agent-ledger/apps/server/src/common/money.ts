export type CurrencyCode = 'USD';

export const DEFAULT_CURRENCY: CurrencyCode = 'USD';
export const MINOR_UNITS_PER_MAJOR = 100;

export class MoneyError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_AMOUNT'
      | 'NEGATIVE_BALANCE'
      | 'OVERFLOW'
      | 'CURRENCY_MISMATCH',
    message: string,
  ) {
    super(message);
    this.name = 'MoneyError';
  }
}

export function assertIntegerMinor(amountMinor: unknown, field = 'amountMinor'): number {
  if (typeof amountMinor !== 'number' || !Number.isInteger(amountMinor)) {
    throw new MoneyError('INVALID_AMOUNT', `${field} 必须是整数最小单位`);
  }
  if (!Number.isSafeInteger(amountMinor)) {
    throw new MoneyError('OVERFLOW', `${field} 超出安全整数范围`);
  }
  return amountMinor;
}

export function parseMajorToMinor(input: unknown): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      throw new MoneyError('INVALID_AMOUNT', '金额必须是有限数字');
    }
    if (!Number.isInteger(input * MINOR_UNITS_PER_MAJOR) && !isExactTwoDecimals(input)) {
      throw new MoneyError(
        'INVALID_AMOUNT',
        '金额最多保留两位小数，禁止使用无法精确换算的浮点值',
      );
    }
    return Math.round(input * MINOR_UNITS_PER_MAJOR);
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!/^-?\d+(\.\d{1,2})?$/.test(trimmed)) {
      throw new MoneyError('INVALID_AMOUNT', '金额格式无效，示例: 12.34');
    }
    const negative = trimmed.startsWith('-');
    const [wholePart, fractionPart = ''] = (negative ? trimmed.slice(1) : trimmed).split('.');
    const minor =
      Number.parseInt(wholePart, 10) * MINOR_UNITS_PER_MAJOR +
      Number.parseInt(fractionPart.padEnd(2, '0') || '0', 10);
    return negative ? -minor : minor;
  }

  throw new MoneyError('INVALID_AMOUNT', '金额类型无效');
}

export function formatMinorToMajor(amountMinor: number, currency: CurrencyCode = DEFAULT_CURRENCY): string {
  const value = assertIntegerMinor(amountMinor);
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const major = Math.floor(abs / MINOR_UNITS_PER_MAJOR);
  const minor = String(abs % MINOR_UNITS_PER_MAJOR).padStart(2, '0');
  return `${sign}${major}.${minor} ${currency}`;
}

export function addMinor(a: number, b: number): number {
  const left = assertIntegerMinor(a, 'left');
  const right = assertIntegerMinor(b, 'right');
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) {
    throw new MoneyError('OVERFLOW', '金额加法溢出');
  }
  return sum;
}

export function subtractMinor(a: number, b: number): number {
  return addMinor(a, -assertIntegerMinor(b, 'right'));
}

export function assertNonNegativeBalance(balanceMinor: number): number {
  const value = assertIntegerMinor(balanceMinor, 'balanceMinor');
  if (value < 0) {
    throw new MoneyError('NEGATIVE_BALANCE', '余额不能为负');
  }
  return value;
}

export function computeDeltaForSet(currentMinor: number, targetMinor: number): number {
  return subtractMinor(assertIntegerMinor(targetMinor, 'targetMinor'), currentMinor);
}

function isExactTwoDecimals(value: number): boolean {
  const scaled = value * MINOR_UNITS_PER_MAJOR;
  return Math.abs(scaled - Math.round(scaled)) < Number.EPSILON * 100;
}
