import { authenticateToken, listConnections, revokeConnection } from '@fin/core';
import { eq, schema } from '@fin/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUser, testCtx } from '../../../packages/core/test/helpers';
import { classifyRedirect } from '../src';
import { CIMD_CLIENT, MCP_URL, REDIRECT, startAuth } from './flow';

const ctx = testCtx();
let auth: Awaited<ReturnType<typeof startAuth>>;
let alice: string;
let bob: string;

beforeAll(async () => {
  auth = await startAuth(ctx.db);
  alice = await createUser(ctx);
  bob = await createUser(ctx);
});
afterAll(async () => {
  await auth.close();
  await ctx.close();
});

describe('discovery', () => {
  it('describes itself at the public address, with what MCP clients look for', async () => {
    const meta = (await (await fetch(`${auth.base}/.well-known/oauth-authorization-server`)).json()) as Record<string, any>;
    expect(meta).toMatchObject({
      issuer: 'http://localhost:3000',
      authorization_endpoint: 'http://localhost:3000/oauth/authorize',
      token_endpoint: 'http://localhost:3000/oauth/token',
      registration_endpoint: 'http://localhost:3000/oauth/register',
      revocation_endpoint: 'http://localhost:3000/oauth/revoke',
      code_challenge_methods_supported: ['S256'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
      response_types_supported: ['code'],
    });
    expect(meta.scopes_supported).toEqual(expect.arrayContaining(['finance:read', 'finance:write']));
    expect(meta.grant_types_supported.sort()).toEqual(['authorization_code', 'refresh_token']);
    expect(meta.token_endpoint_auth_methods_supported).toContain('none');
  });
});

describe('connecting an app', () => {
  it('issues tokens for the MCP server with only the permissions the user ticked', async () => {
    const browser = auth.browser();
    const { body: client } = await auth.register();
    const { location } = await auth.authorize(browser, client.client_id);
    expect(location).toMatch(/^\/connect\//);

    const details = await auth.consent.details(browser);
    expect(details.body).toMatchObject({
      clientName: 'Test Agent',
      redirect: { kind: 'loopback', host: '127.0.0.1:9999' },
      scopes: ['finance:read', 'finance:write'],
    });

    const connection = await auth.connect(alice, ['finance:read']);
    expect(connection.callback.searchParams.get('iss')).toBe('http://localhost:3000');
    expect(connection.callback.searchParams.get('state')).toBe('state-1');
    expect(connection.tokens).toMatchObject({ token_type: 'Bearer', scope: 'finance:read', expires_in: 900 });
    expect(connection.accessToken.split('.')).toHaveLength(1); // opaque, not a JWT

    const who = await authenticateToken(ctx, connection.accessToken, MCP_URL);
    expect(who).toMatchObject({ userId: alice, scopes: ['finance:read'] });
    expect(await authenticateToken(ctx, connection.accessToken, 'https://elsewhere.example/mcp')).toBeNull();

    const [listed] = (await listConnections(ctx, alice)).filter((c) => c.id === who!.connectionId);
    expect(listed).toMatchObject({ clientName: 'Test Agent', scopes: ['finance:read'], revokedAt: null });
  });

  it('stores tokens and codes only as hashes', async () => {
    const { accessToken, refreshToken } = await auth.connect(alice, ['finance:read']);
    const rows = JSON.stringify(await ctx.db.select().from(schema.oauthRecords));
    expect(rows).not.toContain(accessToken);
    expect(rows).not.toContain(refreshToken);
  });

  it('works for an app that identifies itself with a metadata URL', async () => {
    const { accessToken } = await auth.connect(alice, ['finance:read'], { clientId: CIMD_CLIENT });
    const who = await authenticateToken(ctx, accessToken, MCP_URL);
    expect(who).toMatchObject({ userId: alice, clientId: CIMD_CLIENT });
    const [listed] = (await listConnections(ctx, alice)).filter((c) => c.id === who!.connectionId);
    expect(listed!.clientName).toBe('Metadata Agent');
  });

  it('offers read access only to an app that asks for no scope', async () => {
    const browser = auth.browser();
    const { body: client } = await auth.register();
    await auth.authorize(browser, client.client_id, { scope: '' });
    expect((await auth.consent.details(browser)).body.scopes).toEqual(['finance:read']);
    // Ticking more than was asked for grants nothing extra.
    const finished = await auth.consent.finish(browser, { userId: alice, scopes: ['finance:read', 'finance:write'] });
    const back = await browser.get(finished.body.returnTo);
    expect(new URL(back.headers.get('location')!).searchParams.get('code')).toBeTruthy();
    const [latest] = await listConnections(ctx, alice);
    expect(latest!.scopes).toEqual(['finance:read']);
  });

  it('completes for an app that also asks for openid and offline_access', async () => {
    const browser = auth.browser();
    const { body: client } = await auth.register();
    const { location } = await auth.authorize(browser, client.client_id, { scope: 'openid offline_access finance:read' });
    expect(location).toMatch(/^\/connect\//);
    const finished = await auth.consent.finish(browser, { userId: alice, scopes: ['finance:read'] });
    if (!finished.body.returnTo) throw new Error(JSON.stringify(finished.body));
    const back = await browser.get(finished.body.returnTo);
    expect(back.headers.get('location'), await back.text()).toContain('code=');
  });

  it('a second user in the same browser gets their own connection, not the first user\'s', async () => {
    const browser = auth.browser();
    const first = await auth.connect(alice, ['finance:read'], { browser });
    const second = await auth.connect(bob, ['finance:read'], { browser, clientId: first.clientId });
    expect((await authenticateToken(ctx, second.accessToken, MCP_URL))!.userId).toBe(bob);
    expect((await authenticateToken(ctx, first.accessToken, MCP_URL))!.userId).toBe(alice);
  });
});

describe('refusals', () => {
  it('requires PKCE and a known resource', async () => {
    const { body: client } = await auth.register();
    const noPkce = await auth.authorize(auth.browser(), client.client_id, { code_challenge: '', code_challenge_method: '' });
    expect(noPkce.location).toContain('error=invalid_request');
    const wrongResource = await auth.authorize(auth.browser(), client.client_id, { resource: 'https://evil.example/' });
    expect(wrongResource.location).toContain('error=invalid_target');
  });

  it('does not redirect to an address the app did not register', async () => {
    const { body: client } = await auth.register();
    const response = await auth.authorize(auth.browser(), client.client_id, { redirect_uri: 'https://evil.example/cb' });
    expect(response.status).toBe(400);
    expect(response.location).toBe('');
  });

  it('rejects a wrong PKCE verifier and a code used twice', async () => {
    const browser = auth.browser();
    const { body: client } = await auth.register();
    const { verifier } = await auth.authorize(browser, client.client_id);
    const finished = await auth.consent.finish(browser, { userId: alice, scopes: ['finance:read'] });
    const code = new URL((await browser.get(finished.body.returnTo)).headers.get('location')!).searchParams.get('code')!;
    const exchange = (code_verifier: string) =>
      auth.token({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier, client_id: client.client_id });
    expect((await exchange('x'.repeat(43))).body.error).toBe('invalid_grant');
    const good = await exchange(verifier);
    expect(good.body.access_token).toBeTruthy();
    // A code works once. Presenting it again also withdraws what it produced.
    expect((await exchange(verifier)).body.error).toBe('invalid_grant');
    expect(await authenticateToken(ctx, good.body.access_token, MCP_URL)).toBeNull();
  });

  it('needs the cookies of the browser that started the flow, and the internal secret', async () => {
    const browser = auth.browser();
    const { body: client } = await auth.register();
    await auth.authorize(browser, client.client_id);
    const stranger = auth.browser();
    expect((await auth.consent.details(stranger)).status).toBe(400);
    expect((await auth.consent.finish(stranger, { userId: bob, scopes: ['finance:read'] })).status).toBe(400);
    const noSecret = await fetch(`${auth.base}/internal/interaction`, { headers: { cookie: browser.cookies() } });
    expect(noSecret.status).toBe(403);
  });

  it('tells the app when the user declines, and grants nothing when nothing is ticked', async () => {
    const browser = auth.browser();
    const { body: client } = await auth.register();
    await auth.authorize(browser, client.client_id);
    expect((await auth.consent.finish(browser, { userId: alice, scopes: [] })).body.error).toBe('nothing_granted');
    const denied = await auth.consent.finish(browser, { deny: true });
    const back = await browser.get(denied.body.returnTo);
    expect(back.headers.get('location')).toContain('error=access_denied');
  });

  it('refuses to send a code over plain http to another machine', async () => {
    const browser = auth.browser();
    const { body: client } = await auth.register({ redirect_uris: ['http://attacker.example/cb'] });
    if (client.client_id) {
      await auth.authorize(browser, client.client_id, { redirect_uri: 'http://attacker.example/cb' });
      expect((await auth.consent.details(browser)).body.redirect.kind).toBe('unsafe');
      expect((await auth.consent.finish(browser, { userId: alice, scopes: ['finance:read'] })).body.error).toBe('unsafe_redirect');
    }
  });

  it('classifies redirect addresses', () => {
    expect(classifyRedirect('https://claude.ai/api/mcp/auth_callback')).toEqual({ kind: 'https', host: 'claude.ai' });
    expect(classifyRedirect('http://localhost:6274/oauth/callback').kind).toBe('loopback');
    expect(classifyRedirect('http://192.168.1.5/cb').kind).toBe('unsafe');
    expect(classifyRedirect('cursor://anysphere.cursor-mcp/oauth/callback').kind).toBe('app');
    expect(classifyRedirect('not a url').kind).toBe('unsafe');
  });
});

describe('refresh and revocation', () => {
  it('rotates refresh tokens, and a replayed one revokes the connection', async () => {
    const first = await auth.connect(alice, ['finance:read']);
    const refresh = (refresh_token: string) => auth.token({ grant_type: 'refresh_token', refresh_token, client_id: first.clientId });
    const second = await refresh(first.refreshToken);
    expect(second.body.refresh_token).toBeTruthy();
    expect(second.body.refresh_token).not.toBe(first.refreshToken);
    expect(await authenticateToken(ctx, second.body.access_token, MCP_URL)).not.toBeNull();

    const connectionId = (await authenticateToken(ctx, second.body.access_token, MCP_URL))!.connectionId;
    expect((await refresh(first.refreshToken)).body.error).toBe('invalid_grant');
    expect(await authenticateToken(ctx, second.body.access_token, MCP_URL)).toBeNull();
    expect((await refresh(second.body.refresh_token)).body.error).toBe('invalid_grant');
    expect((await listConnections(ctx, alice)).find((c) => c.id === connectionId)!.revokedAt).not.toBeNull();
  });

  it('after the user revokes, neither token works again', async () => {
    const { accessToken, refreshToken, clientId } = await auth.connect(alice, ['finance:read', 'finance:write']);
    const { connectionId } = (await authenticateToken(ctx, accessToken, MCP_URL))!;
    await revokeConnection(ctx, alice, connectionId);
    expect(await authenticateToken(ctx, accessToken, MCP_URL)).toBeNull();
    expect((await auth.token({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId })).body.error).toBe('invalid_grant');
  });

  it('an app can hand its tokens back', async () => {
    const { accessToken, refreshToken, clientId } = await auth.connect(alice, ['finance:read']);
    const { connectionId } = (await authenticateToken(ctx, accessToken, MCP_URL))!;
    const response = await fetch(`${auth.base}/oauth/revoke`, { method: 'POST', body: auth.form({ token: refreshToken, client_id: clientId }) });
    expect(response.status).toBe(200);
    expect(await authenticateToken(ctx, accessToken, MCP_URL)).toBeNull();
    expect((await listConnections(ctx, alice)).find((c) => c.id === connectionId)!.revokedAt).not.toBeNull();
  });

  it('stops refreshing once the account is gone', async () => {
    const carol = await createUser(ctx);
    const { refreshToken, clientId } = await auth.connect(carol, ['finance:read']);
    await ctx.db.delete(schema.user).where(eq(schema.user.id, carol));
    const refreshed = await auth.token({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId });
    expect(refreshed.body.access_token).toBeUndefined();
  });
});

describe('rate limits', () => {
  it('limits how fast apps can register', async () => {
    await ctx.db.delete(schema.rateLimits);
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) statuses.push((await auth.register()).status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(20);
    expect(statuses.slice(20)).toEqual([429, 429]);
    await ctx.db.delete(schema.rateLimits);
  });
});
