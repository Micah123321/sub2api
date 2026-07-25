import { resolveMasterKey, encryptSecret, decryptSecret, maskSecret } from '../apps/server/src/common/crypto';
import { describe, expect, it } from 'vitest';

describe('crypto helpers', () => {
  it('encrypts secrets and masks display values', () => {
    const key = resolveMasterKey(Buffer.alloc(32, 7).toString('base64'));
    const cipher = encryptSecret('admin-api-key-value', key);
    expect(cipher.startsWith('v1:')).toBe(true);
    expect(decryptSecret(cipher, key)).toBe('admin-api-key-value');
    expect(maskSecret('admin-api-key-value')).toContain('alue');
    expect(maskSecret('admin-api-key-value')).not.toContain('admin-api-key-value');
  });
});
