import { like, schema, type Db } from '@fin/db';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createAuthServer } from '../src';

export const MCP_URL = 'http://localhost:3999/mcp';
export const REDIRECT = 'http://127.0.0.1:9999/callback';
export const CIMD_CLIENT = 'https://agent.example/oauth/client.json';

/** Runs the OAuth server on a spare port and plays the parts of the AI app, the browser and the web app. */
export async function startAuth(db: Db, options: { mcpUrl?: string; issuer?: 'self' } = {}) {
  // Earlier runs must not count against this one's limits.
  await db.delete(schema.rateLimits).where(like(schema.rateLimits.key, 'oauth:%'));
  // Listen first, so that the server can be told its own address when a test needs that.
  let handle: ReturnType<typeof createAuthServer>['handler'] | undefined;
  const server: Server = createServer((req, res) => void handle!(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const issuer = options.issuer === 'self' ? base : 'http://localhost:3000';
  const mcpUrl = options.mcpUrl ?? MCP_URL;
  const auth = createAuthServer({
    db,
    issuer,
    mcpUrl,
    internalSecret: 'test-internal-secret',
    // Stands in for the internet: serves one client metadata document.
    fetch: async (url, init) =>
      String(url) === CIMD_CLIENT
        ? Response.json({
            client_id: CIMD_CLIENT,
            client_name: 'Metadata Agent',
            redirect_uris: [REDIRECT],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
          })
        : fetch(url, init),
  });
  handle = auth.handler;
  const internal = { 'x-internal-secret': auth.internalSecret };
  const form = (fields: Record<string, string>) => new URLSearchParams(fields);

  /** A browser: remembers cookies between requests and never follows redirects by itself. */
  function browser() {
    const jar = new Map<string, string>();
    const cookies = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    return {
      cookies,
      async get(path: string) {
        // Links point at the public address; in tests that address is this server.
        const target = new URL(path.startsWith(issuer) ? path.slice(issuer.length) : path, base);
        const response = await fetch(target, { redirect: 'manual', headers: { cookie: cookies() } });
        for (const cookie of response.headers.getSetCookie()) {
          const pair = cookie.split(';')[0]!;
          const at = pair.indexOf('=');
          if (pair.slice(at + 1)) jar.set(pair.slice(0, at), pair.slice(at + 1));
          else jar.delete(pair.slice(0, at));
        }
        return response;
      },
    };
  }

  async function register(metadata: Record<string, unknown> = {}) {
    const response = await fetch(`${base}/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'Test Agent', redirect_uris: [REDIRECT], ...metadata }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  }

  /** The AI app sends the user's browser to the authorisation page. */
  async function authorize(b: ReturnType<typeof browser>, clientId: string, extra: Record<string, string> = {}) {
    const verifier = randomBytes(32).toString('base64url');
    const params = form({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: REDIRECT,
      scope: 'finance:read finance:write',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      resource: mcpUrl,
      state: 'state-1',
      ...extra,
    });
    for (const [key, value] of [...params]) if (value === '') params.delete(key);
    const response = await b.get(`/oauth/authorize?${params}`);
    return { verifier, location: response.headers.get('location') ?? '', status: response.status };
  }

  /** What the web app's consent page does, with the browser's cookies forwarded. */
  const consent = {
    async details(b: ReturnType<typeof browser>) {
      const response = await fetch(`${base}/internal/interaction`, { headers: { ...internal, cookie: b.cookies() } });
      return { status: response.status, body: (await response.json()) as Record<string, any> };
    },
    async finish(b: ReturnType<typeof browser>, body: { userId?: string; scopes?: string[]; deny?: boolean }) {
      const response = await fetch(`${base}/internal/interaction/finish`, {
        method: 'POST',
        headers: { ...internal, cookie: b.cookies() },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: (await response.json()) as Record<string, any> };
    },
  };

  async function token(fields: Record<string, string>) {
    const response = await fetch(`${base}/oauth/token`, { method: 'POST', body: form(fields) });
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  }

  let defaultClient: string | undefined;

  /** The whole flow: authorise, approve as `userId` with `scopes`, swap the code for tokens. */
  async function connect(userId: string, scopes: string[], options: { clientId?: string; browser?: ReturnType<typeof browser> } = {}) {
    const b = options.browser ?? browser();
    // One registered app serves every connection that does not ask for its own.
    const clientId = options.clientId ?? (defaultClient ??= (await register()).body.client_id as string);
    const { verifier, location } = await authorize(b, clientId);
    if (!location.startsWith('/connect/')) throw new Error(`authorize did not reach consent: ${location}`);
    const finished = await consent.finish(b, { userId, scopes });
    if (!finished.body.returnTo) throw new Error(`consent failed: ${JSON.stringify(finished.body)}`);
    const back = await b.get(finished.body.returnTo);
    const callback = new URL(back.headers.get('location')!);
    const tokens = await token({
      grant_type: 'authorization_code',
      code: callback.searchParams.get('code')!,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
      client_id: clientId,
      resource: mcpUrl,
    });
    return { clientId, callback, tokens: tokens.body, accessToken: tokens.body.access_token as string, refreshToken: tokens.body.refresh_token as string };
  }

  return {
    base,
    issuer,
    browser,
    register,
    authorize,
    consent,
    token,
    connect,
    form,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
