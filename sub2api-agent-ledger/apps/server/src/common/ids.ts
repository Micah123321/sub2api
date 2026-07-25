import { randomBytes, randomUUID } from 'node:crypto';

export function createId(prefix?: string): string {
  const id = randomUUID().replace(/-/g, '');
  return prefix ? `${prefix}_${id}` : id;
}

export function createRequestId(): string {
  return `req_${randomBytes(12).toString('hex')}`;
}

export function createOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
