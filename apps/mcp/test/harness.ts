import type { Ctx } from '@fin/core';
import { getRequestListener } from '@hono/node-server';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { startAuth } from '../../auth/test/flow';
import { createMcpApp, type Limits } from '../src';

/** Runs the MCP server and the OAuth server on spare ports, each knowing its real address. */
export async function startStack(ctx: Ctx, options: { limits?: Partial<Limits>; allowedOrigins?: string[] } = {}) {
  let handle: ((request: Request) => Response | Promise<Response>) | undefined;
  const server = createServer(getRequestListener((request) => handle!(request)));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const mcpUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  const auth = await startAuth(ctx.db, { mcpUrl, issuer: 'self' });
  const app = createMcpApp({ ctx, mcpUrl, appUrl: auth.issuer, allowedOrigins: options.allowedOrigins ?? ['allowed.example'], limits: options.limits });
  handle = app.fetch;

  /** An MCP client holding `token`. `seen` records every HTTP answer, for checking status codes and headers. */
  async function client(token: string, era: 'modern' | 'legacy' = 'modern') {
    const seen: { status: number; headers: Headers }[] = [];
    const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
      authProvider: { token: async () => token },
      fetch: async (input, init) => {
        const response = await fetch(input, init);
        seen.push({ status: response.status, headers: response.headers });
        return response;
      },
    });
    // 'modern' is protocol revision 2026-07-28 (no handshake); 'legacy' is what 2025-era apps still speak.
    const mcp = new Client(
      { name: 'test-agent', version: '1.0.0' },
      era === 'modern' ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {},
    );
    await mcp.connect(transport);
    /** Calls a tool and returns its structured result, or throws with the tool's error text. */
    async function call<T = any>(name: string, args: Record<string, unknown> = {}): Promise<T> {
      const result = await mcp.callTool({ name, arguments: args });
      if (result.isError) throw new Error((result.content as { text: string }[])[0]?.text ?? 'tool error');
      return result.structuredContent as T;
    }
    return { mcp, call, seen, last: () => seen.at(-1)!, close: () => mcp.close() };
  }

  /** Approves a new connection for `userId` and returns a ready client. */
  async function connect(userId: string, scopes: string[], era: 'modern' | 'legacy' = 'modern') {
    const connection = await auth.connect(userId, scopes);
    return { ...(await client(connection.accessToken, era)), ...connection };
  }

  return {
    mcpUrl,
    auth,
    app,
    client,
    connect,
    close: async () => {
      await app.close();
      await auth.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
