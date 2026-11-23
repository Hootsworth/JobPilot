import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyHint: string;
}

export function parseEncryptionKey(hexKey: string): Buffer {
  const clean = hexKey.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error(
      'APP_ENCRYPTION_KEY must be a 64-character hex string (32 bytes for AES-256-GCM).'
    );
  }
  return Buffer.from(clean, 'hex');
}

export function maskApiKey(secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.length <= 4) return '••••';
  return `••••${trimmed.slice(-4)}`;
}

export function encryptSecret(plaintext: string, hexKey: string): EncryptedSecret {
  const trimmed = plaintext.trim();
  if (!trimmed) {
    throw new Error('Cannot encrypt an empty secret.');
  }
  const key = parseEncryptionKey(hexKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(trimmed, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    keyHint: maskApiKey(trimmed)
  };
}

export function decryptSecret(
  payload: { ciphertext: string; iv: string; authTag: string },
  hexKey: string
): string {
  const key = parseEncryptionKey(hexKey);
  const iv = Buffer.from(payload.iv, 'base64');
  const authTag = Buffer.from(payload.authTag, 'base64');
  const ciphertext = Buffer.from(payload.ciphertext, 'base64');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}
