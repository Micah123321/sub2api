import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;

export function resolveMasterKey(raw: string | undefined): Buffer {
  if (!raw || raw.trim().length === 0) {
    throw new Error('PLUGIN_MASTER_KEY 缺失：服务拒绝启动');
  }

  const trimmed = raw.trim();
  try {
    const fromBase64 = Buffer.from(trimmed, 'base64');
    if (fromBase64.length === 32) {
      return fromBase64;
    }
  } catch {
    // fall through
  }

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  // ha-min: 派生密钥仅用于开发便利，生产应提供 32 字节 base64/hex 主密钥
  return scryptSync(trimmed, 'sub2api-agent-ledger', 32);
}

export function encryptSecret(plaintext: string, masterKey: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, masterKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptSecret(ciphertext: string, masterKey: Buffer): string {
  const [version, ivB64, tagB64, dataB64] = ciphertext.split(':');
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('密文格式无效');
  }
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const data = Buffer.from(dataB64, 'base64url');
  const decipher = createDecipheriv(ALGO, masterKey, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}

export function maskSecret(value: string, visible = 4): string {
  if (!value) {
    return '';
  }
  if (value.length <= visible) {
    return '*'.repeat(value.length);
  }
  return `${'*'.repeat(Math.max(4, value.length - visible))}${value.slice(-visible)}`;
}

export function hashCardCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export function displayCardMask(code: string): string {
  if (code.length <= 8) {
    return `${code.slice(0, 2)}****${code.slice(-2)}`;
  }
  return `${code.slice(0, 4)}****${code.slice(-4)}`;
}
