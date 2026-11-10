import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const KEY_BYTES = 32;
const IV_BYTES = 12;

export class DecryptionError extends Error {
  constructor() {
    // Deliberately vague: never say which check failed or echo any input.
    super('Could not decrypt data');
    this.name = 'DecryptionError';
  }
}

/** Reads the 32-byte master key from a base64 string (normally DATA_MASTER_KEY). */
export function parseMasterKey(base64: string | undefined): Buffer {
  if (!base64) throw new Error('DATA_MASTER_KEY is not set');
  const key = Buffer.from(base64, 'base64');
  if (key.length !== KEY_BYTES) throw new Error('DATA_MASTER_KEY must be 32 bytes, base64-encoded');
  return key;
}

export function newDataKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

/**
 * AES-256-GCM. `aad` names where the value lives (for example "goals:<user>:<id>");
 * it is not secret, but decryption fails unless the same string is supplied, so a
 * ciphertext cannot be moved to another row or another user.
 */
export function seal(key: Buffer, aad: string, plaintext: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return [VERSION, iv, body, cipher.getAuthTag()]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

export function open(key: Buffer, aad: string, sealed: string): Buffer {
  const [version, iv, body, tag] = sealed.split('.');
  if (version !== VERSION || !iv || body === undefined || !tag) throw new DecryptionError();
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]);
  } catch {
    throw new DecryptionError();
  }
}

export function sealJson(key: Buffer, aad: string, value: unknown): string {
  return seal(key, aad, Buffer.from(JSON.stringify(value), 'utf8'));
}

export function openJson<T>(key: Buffer, aad: string, sealed: string): T {
  return JSON.parse(open(key, aad, sealed).toString('utf8')) as T;
}

export function wrapDataKey(masterKey: Buffer, userId: string, dataKey: Buffer): string {
  return seal(masterKey, `user_keys:${userId}`, dataKey);
}

export function unwrapDataKey(masterKey: Buffer, userId: string, wrapped: string): Buffer {
  return open(masterKey, `user_keys:${userId}`, wrapped);
}
