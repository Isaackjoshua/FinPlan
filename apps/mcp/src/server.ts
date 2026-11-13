import { authenticateToken, hitRateLimit, idempotent, logActivity, SCOPES, type ActivityOutcome, type Ctx } from '@fin/core';
import {
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  McpServer,
  OAuthError,
  OAuthErrorCode,
  originValidationResponse,
  requireBearerAuth,
  type AuthInfo,
} from '@modelcontextprotocol/server';
import { Hono } from 'hono';
import { INSTRUCTIONS } from './instructions';
import { TOOL_BY_NAME, TOOLS, type ToolAuth, type ToolDef, type Touched } from './tools';
import { explain, portable } from './wire';

export interface Limits {
  /** Requests of any kind, per connection. */
  callsPerMinute: number;
  /** Calls to tools that change something, per connection. */
  writesPerHour: number;
  /** New plan versions, per connection. */
  planVersionsPerDay: number;
}
export const DEFAULT_LIMITS: Limits = { callsPerMinute: 60, writesPerHour: 20, planVersionsPerDay: 10 };

export interface McpAppOptions {
  ctx: Ctx;
  /** Public address of this endpoint, e.g. https://mcp.example.com/mcp. Tokens must have been issued for exactly this. */
  mcpUrl: string;
  /** Public address of the web app, which is also the OAuth server's identity. */
  appUrl: string;
  /** Hostnames of web pages allowed to call this server from a browser. Programs that are not browsers send no Origin and are unaffected. */
  allowedOrigins: string[];
  limits?: Partial<Limits>;
}

/** What this request has already written to the activity log, so nothing is logged twice or missed. */
interface RequestState extends ToolAuth {
  logged: Set<string>;
}

const MAX_BODY_BYTES = 256 * 1024;
const CORS_HEADERS = 'authorization, content-type, accept, mcp-protocol-version, mcp-method, mcp-name, mcp-session-id, last-event-id';

const rpcError = (status: number, message: string, headers: Record<string, string> = {}) =>
  Response.json({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }, { status, headers });

export function createMcpApp(options: McpAppOptions) {
  const { ctx } = options;
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const resource = new URL(options.mcpUrl);
  const metadataUrl = getOAuthProtectedResourceMetadataUrl(resource);
  const deps = { ctx, appUrl: options.appUrl.replace(/\/$/, '') };

  async function record(state: RequestState, def: ToolDef | undefined, tool: string, outcome: ActivityOutcome, started: number, touched?: Touched) {
    state.logged.add(tool);
    try {
      await logActivity(ctx, {
        userId: state.userId,
        connectionId: state.connectionId,
        tool,
        requiredScope: def?.scope ?? null,
        outcome,
        durationMs: performance.now() - started,
        ...touched,
      });
    } catch (error) {
      // A logging failure must not turn a completed call into a failed one.
      console.error('activity log failed:', error instanceof Error ? error.name : 'unknown');
    }
  }

  /** A fresh server per request, already bound to the caller. Nothing is shared between users. */
  function buildServer(state: RequestState): McpServer {
    const server = new McpServer({ name: 'finplan', title: 'FinPlan', version: '1.0.0' }, { instructions: INSTRUCTIONS });
    for (const def of TOOLS) {
      const scope = def.scope;
      server.registerTool(
        def.name,
        {
          title: def.title,
          description: def.description,
          inputSchema: portable(def.input),
          outputSchema: portable(def.output),
          annotations:
            def.kind === 'write'
              ? { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
              : { readOnlyHint: true, openWorldHint: false },
          ...(scope && {
            // Checked on every call, before the handler runs. A missing permission is an
            // HTTP 403 naming what is needed, so the app can ask the user for it.
            scopeChallenge: async () => {
              if (state.scopes.includes(scope)) return undefined;
              await record(state, def, def.name, 'denied', performance.now());
              return {
                scopes: [...new Set([...state.scopes, scope])] as [string, ...string[]],
                errorDescription: `This tool needs the ${scope} permission, which the user has not granted to this connection`,
              };
            },
          }),
        },
        async (args: unknown) => {
          const started = performance.now();
          try {
            const run = () => def.run(args, state, deps);
            const { idempotency_key: key, ...rest } = args as { idempotency_key?: string };
            const out =
              def.kind === 'write'
                ? await idempotent(ctx, { userId: state.userId, connectionId: state.connectionId, key, tool: def.name, args: rest }, run)
                : await run();
            await record(state, def, def.name, 'ok', started, out.touched);
            const result = out.result as Record<string, unknown>;
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result };
          } catch (error) {
            const expected = explain(error);
            await record(state, def, def.name, expected ? 'invalid' : 'error', started);
            // Only the kind of error is logged. Its message could quote user data.
            if (!expected) console.error(`tool ${def.name} failed:`, error instanceof Error ? error.name : 'unknown');
            const text = expected ?? 'Something went wrong on the server and the request was not completed. Nothing was changed.';
            return { isError: true, content: [{ type: 'text' as const, text }] };
          }
        },
      );
    }
    return server;
  }

  const handler = createMcpHandler(
    (request) => {
      const state = request.authInfo?.extra?.state as RequestState | undefined;
      if (!state) throw new Error('unauthenticated request reached the MCP handler');
      return buildServer(state);
    },
    { responseMode: 'json', onerror: (error) => console.error('mcp:', error.name) },
  );

  const gate = requireBearerAuth({
    expectedResource: resource,
    resourceMetadataUrl: metadataUrl,
    verifier: {
      // Looked up in the database on every request, so revoking a connection takes effect at once.
      async verifyAccessToken(token): Promise<AuthInfo> {
        const auth = await authenticateToken(ctx, token, options.mcpUrl);
        if (!auth) throw new OAuthError(OAuthErrorCode.InvalidToken, 'The access token is invalid, expired or revoked');
        const state: RequestState = { userId: auth.userId, connectionId: auth.connectionId, scopes: auth.scopes, logged: new Set() };
        return { token, clientId: auth.clientId, scopes: auth.scopes, expiresAt: auth.expiresAt, resource, extra: { state } };
      },
    },
  });

  function cors(request: Request, response: Response): Response {
    const origin = request.headers.get('origin');
    if (!origin) return response;
    const out = new Response(response.body, response);
    out.headers.set('access-control-allow-origin', origin);
    out.headers.append('vary', 'Origin');
    out.headers.set('access-control-expose-headers', 'www-authenticate, retry-after');
    return out;
  }

  async function serve(request: Request): Promise<Response> {
    // 1. A web page may only call us if its site is on the list.
    const badOrigin = originValidationResponse(request, options.allowedOrigins);
    if (badOrigin) return badOrigin;
    if (request.method === 'OPTIONS') {
      return cors(request, new Response(null, { status: 204, headers: { 'access-control-allow-methods': 'POST', 'access-control-allow-headers': CORS_HEADERS, 'access-control-max-age': '600' } }));
    }
    // Stateless: there are no sessions to open (GET) or close (DELETE).
    if (request.method !== 'POST') return cors(request, rpcError(405, 'Method not allowed. Use POST.', { allow: 'POST' }));

    // 2. Who is calling? No valid token for this server means 401 and a pointer to how to get one.
    const auth = await gate(request);
    if (auth instanceof Response) {
      const challenge = auth.headers.get('www-authenticate');
      // Tell a new client the least it needs to ask for.
      if (auth.status === 401 && challenge && !challenge.includes('scope=')) auth.headers.set('www-authenticate', `${challenge}, scope="finance:read"`);
      return cors(request, auth);
    }
    const state = auth.extra!.state as RequestState;

    // 3. Read the request once, to learn which tools it calls.
    const text = await request.clone().text();
    if (text.length > MAX_BODY_BYTES) return cors(request, rpcError(413, 'Request too large.'));
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(text);
    } catch {
      parsedBody = undefined; // The protocol handler answers malformed JSON itself.
    }
    const messages = (Array.isArray(parsedBody) ? parsedBody : [parsedBody]) as { method?: unknown; params?: { name?: unknown } }[];
    const called = messages
      .filter((message) => message?.method === 'tools/call')
      // Names we do not recognise are attacker-chosen text; they are not written to the log.
      .map((message) => (typeof message.params?.name === 'string' && TOOL_BY_NAME.has(message.params.name) ? message.params.name : '(unknown tool)'));

    // 4. Rate limits. Every request counts; writes and plan saves have tighter limits of their own.
    const started = performance.now();
    const checks = [() => hitRateLimit(ctx, `mcp:calls:${state.connectionId}`, limits.callsPerMinute, 60)];
    for (const name of called) {
      if (TOOL_BY_NAME.get(name)?.kind === 'write') checks.push(() => hitRateLimit(ctx, `mcp:writes:${state.connectionId}`, limits.writesPerHour, 3600));
      if (name === 'save_plan_version') checks.push(() => hitRateLimit(ctx, `mcp:plans:${state.connectionId}`, limits.planVersionsPerDay, 86_400));
    }
    for (const check of checks) {
      const { allowed, retryAfterSeconds } = await check();
      if (!allowed) {
        for (const name of called.length > 0 ? called : ['(request)']) await record(state, TOOL_BY_NAME.get(name), name, 'rate_limited', started);
        return cors(request, rpcError(429, `Rate limit reached. Try again in ${retryAfterSeconds} seconds.`, { 'retry-after': String(retryAfterSeconds) }));
      }
    }

    // 5. Hand over to the protocol handler, which checks scopes and input before running a tool.
    const response = await handler.fetch(request, parsedBody === undefined ? { authInfo: auth } : { authInfo: auth, parsedBody });

    // 6. Anything it turned away before a tool ran (bad arguments, unknown tool) still goes in the log.
    for (const name of called) {
      if (!state.logged.has(name)) await record(state, TOOL_BY_NAME.get(name), name, 'invalid', started);
    }
    return cors(request, response);
  }

  const app = new Hono();
  const metadata = {
    resource: options.mcpUrl,
    authorization_servers: [new URL(options.appUrl).origin],
    scopes_supported: [...SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'FinPlan',
  };
  const describe = () => Response.json(metadata, { headers: { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=300' } });
  // Where a client learns which OAuth server protects this endpoint (RFC 9728).
  app.get(new URL(metadataUrl).pathname, describe);
  app.get('/.well-known/oauth-protected-resource', describe);
  app.get('/healthz', (c) => c.text('ok'));
  app.all(resource.pathname, (c) => serve(c.req.raw));

  return { fetch: (request: Request) => app.fetch(request), close: () => handler.close(), metadataUrl };
}
