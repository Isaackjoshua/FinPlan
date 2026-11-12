import { hitRateLimit, isScope, recordConsent, SCOPES, type Scope } from '@fin/core';
import { eq, schema, type Db } from '@fin/db';
import { createHmac, generateKeyPairSync, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import Provider, { errors, type Configuration } from 'oidc-provider';
import { createAdapter } from './adapter';

export interface AuthServerOptions {
  db: Db;
  /** Public address of the web app. The OAuth endpoints live under it, at /oauth. */
  issuer: string;
  /** Public address of the MCP endpoint. Every token is issued for this and nothing else. */
  mcpUrl: string;
  /** Shared with the web app; guards the internal consent API. */
  internalSecret: string;
  /** Used to fetch client metadata documents. Overridden in tests. */
  fetch?: typeof fetch;
}

/** Where the app will send the user (and the authorisation code) after consent. */
export type RedirectKind = 'https' | 'loopback' | 'app' | 'unsafe';

export function classifyRedirect(uri: string): { kind: RedirectKind; host: string } {
  const url = URL.parse(uri);
  if (!url) return { kind: 'unsafe', host: '' };
  if (url.protocol === 'https:') return { kind: 'https', host: url.host };
  if (url.protocol === 'http:') {
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    // Plain http anywhere else would send the code across the network unencrypted.
    return { kind: loopback ? 'loopback' : 'unsafe', host: url.host };
  }
  // A private scheme such as "cursor://": an app installed on the user's own device.
  return { kind: 'app', host: `${url.protocol}//` };
}

const MINUTE = 60;
const DAY = 24 * 60 * MINUTE;

export function createAuthServer(options: AuthServerOptions) {
  const { db, mcpUrl } = options;
  const issuer = new URL(options.issuer);
  const secret = (label: string) => createHmac('sha256', options.internalSecret).update(label).digest('base64url');
  // Only ID tokens are signed, and none are issued for our scopes, so a key made at start-up is enough.
  const signingKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'jwk' });

  const configuration: Configuration = {
    adapter: createAdapter(db),
    clients: [],
    jwks: { keys: [signingKey as never] },
    cookies: { keys: [secret('oauth-cookies')] },
    scopes: [],
    responseTypes: ['code'],
    // Every app must prove it is the one that started the flow (PKCE), whatever kind of client it is.
    pkce: { required: () => true },
    clientDefaults: { grant_types: ['authorization_code', 'refresh_token'], token_endpoint_auth_method: 'none' },
    // A refresh token works once. Presenting a used one revokes the whole connection.
    rotateRefreshToken: true,
    issueRefreshToken: async (_ctx, client) => client.grantTypeAllowed('refresh_token'),
    // Tokens outlive the browser visit in which the user approved them.
    expiresWithSession: async () => false,
    // Never reuse an earlier approval silently: connecting always shows our consent page.
    loadExistingGrant: async (ctx) => {
      const grantId = ctx.oidc.result?.consent?.grantId;
      return grantId ? ctx.oidc.provider.Grant.find(grantId) : undefined;
    },
    interactions: { url: (_ctx, interaction) => `/connect/${interaction.uid}` },
    findAccount: async (_ctx, id) => {
      const [found] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.id, id));
      return found ? { accountId: id, claims: async () => ({ sub: id }) } : undefined;
    },
    ttl: {
      AccessToken: 15 * MINUTE,
      AuthorizationCode: MINUTE,
      RefreshToken: 30 * DAY,
      Grant: 365 * DAY,
      Interaction: 10 * MINUTE,
      // The library's own browser session is never relied on (see below).
      Session: MINUTE,
    },
    routes: {
      authorization: '/oauth/authorize',
      token: '/oauth/token',
      registration: '/oauth/register',
      revocation: '/oauth/revoke',
      jwks: '/oauth/jwks',
    },
    ...(options.fetch ? { fetch: options.fetch } : {}),
    features: {
      devInteractions: { enabled: false },
      userinfo: { enabled: false },
      rpInitiatedLogout: { enabled: false },
      revocation: { enabled: true },
      // Older MCP clients register themselves. Registering gives no access to anything by itself.
      registration: { enabled: true, initialAccessToken: false, issueRegistrationAccessToken: false },
      // Current MCP clients identify themselves with a URL that serves their metadata.
      clientIdMetadataDocument: { enabled: true, ack: 'draft-02' },
      resourceIndicators: {
        enabled: true,
        defaultResource: async () => mcpUrl,
        useGrantedResource: async () => true,
        getResourceServerInfo: async (_ctx, resource) => {
          if (resource !== mcpUrl) throw new errors.InvalidTarget();
          return { scope: SCOPES.join(' '), audience: mcpUrl, accessTokenFormat: 'opaque', accessTokenTTL: 15 * MINUTE };
        },
      },
    } as Configuration['features'],
  };

  const provider = new Provider(issuer.origin, configuration);
  provider.proxy = true;
  // Names only: request bodies and tokens never reach the log.
  provider.on('server_error', (_ctx, error) => console.error('oauth server_error:', error.name, error.message));

  provider.use(async (ctx, next) => {
    // This process is only reachable through the web app's proxy, so the public
    // address is whatever we were configured with, not what the proxy says.
    const clientIp = String(ctx.req.headers['x-forwarded-for'] ?? ctx.req.socket.remoteAddress ?? '').split(',')[0]!.trim();
    ctx.req.headers.host = issuer.host;
    ctx.req.headers['x-forwarded-host'] = issuer.host;
    ctx.req.headers['x-forwarded-proto'] = issuer.protocol.slice(0, -1);

    if (ctx.path.startsWith('/internal/')) {
      await internalApi(ctx.req, ctx.res, ctx.path);
      ctx.respond = false;
      return;
    }

    // FinPlan's own sign-in is the only login. Hiding the library's session cookie
    // means it can never stand in for one, for example after the user signs out.
    if (ctx.path.startsWith('/oauth/authorize') && ctx.req.headers.cookie) {
      ctx.req.headers.cookie = ctx.req.headers.cookie
        .split(/;\s*/)
        .filter((cookie) => !cookie.startsWith('_session'))
        .join('; ');
    }
    // An app that names no scope is asking for the least: read access.
    if (ctx.method === 'GET' && ctx.path === '/oauth/authorize' && !String(ctx.query.scope ?? '').split(' ').some(isScope)) {
      ctx.query = { ...ctx.query, scope: `${ctx.query.scope ?? ''} finance:read`.trim() };
    }
    if (ctx.path.startsWith('/.well-known/')) {
      await next();
      // The library lists only its built-in scopes; advertise the two that mean something here.
      if (ctx.body && typeof ctx.body === 'object') (ctx.body as Record<string, unknown>).scopes_supported = [...SCOPES];
      return;
    }

    const limit =
      ctx.method === 'POST' && ctx.path === '/oauth/register'
        ? { name: 'register', max: 20, window: 60 * MINUTE }
        : ctx.method === 'POST' && ctx.path === '/oauth/token'
          ? { name: 'token', max: 300, window: MINUTE }
          : null;
    if (limit) {
      const { allowed, retryAfterSeconds } = await hitRateLimit({ db }, `oauth:${limit.name}:${clientIp}`, limit.max, limit.window);
      if (!allowed) {
        ctx.status = 429;
        ctx.set('Retry-After', String(retryAfterSeconds));
        ctx.body = { error: 'slow_down', error_description: 'Too many requests; try again later' };
        return;
      }
    }
    return next();
  });

  // --- Internal API, called by the web app's consent page -----------------------
  // The web app forwards the browser's cookies, so the library can check that the
  // person approving is in the same browser that started the flow.

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  const authorised = (req: IncomingMessage) => {
    const given = Buffer.from(String(req.headers['x-internal-secret'] ?? ''));
    const expected = Buffer.from(secret('internal-api'));
    return given.length === expected.length && timingSafeEqual(given, expected);
  };

  async function describe(req: IncomingMessage, res: ServerResponse) {
    const details = await provider.interactionDetails(req, res);
    const client = await provider.Client.find(String(details.params.client_id));
    if (!client) throw new Error('unknown client');
    const redirectUri = String(details.params.redirect_uri ?? client.redirectUris?.[0] ?? '');
    const asked = String(details.params.scope ?? '').split(' ').filter(isScope);
    return {
      details,
      view: {
        uid: details.uid,
        clientId: client.clientId,
        clientName: client.clientName ?? null,
        redirect: classifyRedirect(redirectUri),
        scopes: asked as Scope[],
      },
    };
  }

  async function internalApi(req: IncomingMessage, res: ServerResponse, path: string) {
    if (!authorised(req)) return json(res, 403, { error: 'forbidden' });
    try {
      if (req.method === 'GET' && path === '/internal/interaction') {
        return json(res, 200, (await describe(req, res)).view);
      }
      if (req.method === 'POST' && path === '/internal/interaction/finish') {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw || '{}') as { userId?: string; scopes?: string[]; deny?: boolean };
        const { details, view } = await describe(req, res);

        if (body.deny) {
          const returnTo = await provider.interactionResult(req, res, { error: 'access_denied', error_description: 'The user declined' });
          return json(res, 200, { returnTo });
        }
        if (view.redirect.kind === 'unsafe') return json(res, 400, { error: 'unsafe_redirect' });
        // Only what the app asked for can be granted, and only what the user ticked.
        const granted = view.scopes.filter((scope) => body.scopes?.includes(scope));
        if (!body.userId || granted.length === 0) return json(res, 400, { error: 'nothing_granted' });

        const grant = new provider.Grant({ accountId: body.userId, clientId: view.clientId });
        grant.addResourceScope(mcpUrl, granted.join(' '));
        const declined = SCOPES.filter((scope) => !granted.includes(scope));
        if (declined.length > 0) grant.rejectResourceScope(mcpUrl, declined.join(' '));
        // Scopes such as "openid" or "offline_access" carry no access here; accept them so the flow can finish.
        const other = String(details.params.scope ?? '').split(' ').filter((scope) => scope && !isScope(scope));
        if (other.length > 0) grant.addOIDCScope(other.join(' '));
        const grantId = await grant.save();

        await recordConsent({ db }, { userId: body.userId, clientId: view.clientId, clientName: view.clientName ?? undefined, grantId, scopes: granted });
        const returnTo = await provider.interactionResult(
          req,
          res,
          { login: { accountId: body.userId, remember: false }, consent: { grantId } },
          { mergeWithLastSubmission: false },
        );
        return json(res, 200, { returnTo });
      }
      return json(res, 404, { error: 'not_found' });
    } catch (error) {
      // Most often: the interaction expired, or the cookies are not from the browser that started it.
      return json(res, 400, { error: 'interaction_invalid', reason: error instanceof Error ? error.name : 'unknown' });
    }
  }

  return { provider, handler: provider.callback(), internalSecret: secret('internal-api') };
}
