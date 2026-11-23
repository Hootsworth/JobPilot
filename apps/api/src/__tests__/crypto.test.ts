import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, maskApiKey } from '../services/crypto.js';

describe('BYOK AES-256-GCM encryption', () => {
  const validHexKey = randomBytes(32).toString('hex');

  it('encrypts and decrypts secrets with unique IVs', () => {
    const secret = 'sk-proj-super-secret-value-9876';
    const a = encryptSecret(secret, validHexKey);
    const b = encryptSecret(secret, validHexKey);

    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(secret);
    expect(a.keyHint).toBe('••••9876');
    expect(decryptSecret(a, validHexKey)).toBe(secret);
    expect(decryptSecret(b, validHexKey)).toBe(secret);
  });

  it('rejects tampered ciphertext or invalid key length', () => {
    const enc = encryptSecret('secret-key-1234', validHexKey);
    const tampered = {
      ...enc,
      ciphertext: Buffer.from('tampered').toString('base64')
    };

    expect(() => decryptSecret(tampered, validHexKey)).toThrow();
    expect(() => encryptSecret('abc', 'short-key')).toThrow();
    expect(maskApiKey('123')).toBe('••••');
  });
});
