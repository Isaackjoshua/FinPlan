import 'server-only';
import { deriveSecret } from '@fin/core';
import type { NextRequest } from 'next/server';

/** Where the OAuth server listens. It is never exposed directly; requests reach it through this app. */
const base = () => process.env.AUTH_INTERNAL_URL ?? 'http://127.0.0.1:3002';

const FORWARDED_REQUEST = ['accept', 'authorization', 'content-type', 'cookie', 'origin', 'access-control-request-method', 'access-control-request-headers', 'x-forwarded-for', 'dpop'];
const FORWARDED_RESPONSE = ['content-type', 'location', 'cache-control', 'pragma', 'www-authenticate', 'retry-after', 'vary', 'access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers', 'access-control-expose-headers', 'access-control-max-age'];

/** Passes a public OAuth request through to the OAuth server and returns its answer unchanged. */
export async function proxyToAuth(request: NextRequest, path: string): Promise<Response> {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const upstream = await fetch(`${base()}${path}${request.nextUrl.search}`, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: 'manual',
    cache: 'no-store',
  });

  const out = new Headers();
  for (const name of FORWARDED_RESPONSE) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  for (const cookie of upstream.headers.getSetCookie()) out.append('set-cookie', cookie);
  return new Response(upstream.status === 204 || upstream.status === 304 ? null : upstream.body, { status: upstream.status, headers: out });
}

export interface ConsentRequest {
  uid: string;
  clientId: string;
  /** Whatever the app calls itself. Not verified. */
  clientName: string | null;
  redirect: { kind: 'https' | 'loopback' | 'app' | 'unsafe'; host: string };
  scopes: ('finance:read' | 'finance:write')[];
}

async function internal<T>(path: string, cookies: string, init: RequestInit = {}): Promise<T | null> {
  const secret = process.env.AUTH_INTERNAL_SECRET;
  if (!secret) throw new Error('AUTH_INTERNAL_SECRET is not set');
  const response = await fetch(`${base()}${path}`, {
    ...init,
    // The browser's cookies go along so the OAuth server can tie the approval to the browser that asked.
    headers: { cookie: cookies, 'x-internal-secret': deriveSecret(secret, 'internal-api'), 'content-type': 'application/json' },
    cache: 'no-store',
  });
  return response.ok ? ((await response.json()) as T) : null;
}

export const getConsentRequest = (cookies: string) => internal<ConsentRequest>('/internal/interaction', cookies);

export const finishConsent = (cookies: string, decision: { userId: string; scopes: string[] } | { deny: true }) =>
  internal<{ returnTo: string }>('/internal/interaction/finish', cookies, { method: 'POST', body: JSON.stringify(decision) });
