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

// ---------------------------------------------------------------------------
// 远程金额（主服务）
// ---------------------------------------------------------------------------
// 主服务余额是 DECIMAL(20,8)、用量费用是 DECIMAL(20,10)，均以 JSON 浮点数下发，
// 精度天然超过两位小数。上面 parseMajorToMinor 的严格校验服务于插件本地账本写入
// （必须精确到分），不能用来解析远程数值：一条 8 位小数的余额会让整批同步事务抛错。
// 因此远程数值走下面这条独立通道，只做舍入、不做两位小数校验。

/** 用量金额的最小单位：百万分之一美元。DECIMAL(20,10) 的单条调用费用常在 1e-5 量级，
 *  若沿用「分」会被全部舍入成 0，代理商看到的用量金额将恒为 0。 */
export const MICRO_UNITS_PER_MAJOR = 1_000_000;

function toFiniteNumber(input: unknown, field: string): number {
  const value = typeof input === 'string' ? Number(input) : input;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new MoneyError('INVALID_AMOUNT', `${field} 必须是有限数字`);
  }
  return value;
}

/** 解析主服务余额为「分」，超出两位小数的部分四舍五入。 */
export function parseRemoteBalanceToMinor(input: unknown): number {
  const minor = Math.round(toFiniteNumber(input, '远程余额') * MINOR_UNITS_PER_MAJOR);
  if (!Number.isSafeInteger(minor)) {
    throw new MoneyError('OVERFLOW', '远程余额超出安全整数范围');
  }
  return minor;
}

/** 解析主服务用量费用为「微美元」，保留 6 位小数精度。 */
export function parseRemoteAmountToMicro(input: unknown): number {
  const micro = Math.round(toFiniteNumber(input, '远程用量金额') * MICRO_UNITS_PER_MAJOR);
  if (!Number.isSafeInteger(micro)) {
    throw new MoneyError('OVERFLOW', '远程用量金额超出安全整数范围');
  }
  return micro;
}

/** 格式化微美元用量金额。小额保留 6 位小数，否则按 2 位展示。 */
export function formatMicroToMajor(
  amountMicro: number,
  currency: CurrencyCode = DEFAULT_CURRENCY,
): string {
  const value = assertIntegerMinor(amountMicro, 'amountMicro');
  const major = value / MICRO_UNITS_PER_MAJOR;
  const digits = major !== 0 && Math.abs(major) < 0.01 ? 6 : 2;
  return `${major.toFixed(digits)} ${currency}`;
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
  const rounded = Math.round(scaled);
  // 相对容差：19.99 * 100 = 1998.9999999999998，绝对误差随数值增大而增大，
  // 固定的 Number.EPSILON 容差会把合法的两位小数金额误判为非法。
  return Math.abs(scaled - rounded) <= 1e-9 * Math.max(1, Math.abs(scaled));
}
