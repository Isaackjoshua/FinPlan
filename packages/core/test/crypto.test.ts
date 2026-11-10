import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DecryptionError, newDataKey, open, openJson, parseMasterKey, seal, sealJson, unwrapDataKey, wrapDataKey } from '../src';

describe('field encryption', () => {
  const key = newDataKey();

  it('round-trips JSON', () => {
    const value = { label: 'Rent', amountMinor: 120000 };
    expect(openJson(key, 'items:u1:i1', sealJson(key, 'items:u1:i1', value))).toEqual(value);
  });

  it('produces different ciphertext each time and never contains the plaintext', () => {
    const a = seal(key, 'x', Buffer.from('SENTINEL-98765'));
    const b = seal(key, 'x', Buffer.from('SENTINEL-98765'));
    expect(a).not.toEqual(b);
    expect(a).not.toContain('SENTINEL');
    expect(Buffer.from(a.split('.')[2]!, 'base64url').toString()).not.toContain('SENTINEL');
  });

  it('refuses a ciphertext presented for a different row', () => {
    const sealed = sealJson(key, 'goals:alice:1', { title: 'House' });
    expect(() => openJson(key, 'goals:bob:1', sealed)).toThrow(DecryptionError);
  });

  it('refuses a different key', () => {
    expect(() => open(newDataKey(), 'x', seal(key, 'x', Buffer.from('hi')))).toThrow(DecryptionError);
  });

  it('refuses tampered or malformed input', () => {
    const parts = seal(key, 'x', Buffer.from('hello world')).split('.');
    const body = Buffer.from(parts[2]!, 'base64url');
    body[0] = body[0]! ^ 1;
    parts[2] = body.toString('base64url');
    expect(() => open(key, 'x', parts.join('.'))).toThrow(DecryptionError);
    expect(() => open(key, 'x', 'not-a-ciphertext')).toThrow(DecryptionError);
    expect(() => open(key, 'x', 'v0.a.b.c')).toThrow(DecryptionError);
  });

  it('wraps data keys per user', () => {
    const master = randomBytes(32);
    const wrapped = wrapDataKey(master, 'alice', key);
    expect(unwrapDataKey(master, 'alice', wrapped)).toEqual(key);
    expect(() => unwrapDataKey(master, 'bob', wrapped)).toThrow(DecryptionError);
  });

  it('validates the master key', () => {
    expect(() => parseMasterKey(undefined)).toThrow();
    expect(() => parseMasterKey(Buffer.from('short').toString('base64'))).toThrow();
    expect(parseMasterKey(randomBytes(32).toString('base64'))).toHaveLength(32);
  });
});
