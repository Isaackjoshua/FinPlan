import { parseMasterKey } from '@fin/core';
import { createDb } from '@fin/db';
import { serve } from '@hono/node-server';
import { createMcpApp } from './server';

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const app = createMcpApp({
  ctx: { db: createDb(need('DATABASE_URL')), masterKey: parseMasterKey(process.env.DATA_MASTER_KEY) },
  mcpUrl: need('MCP_URL'),
  appUrl: need('BETTER_AUTH_URL'),
  allowedOrigins: (process.env.MCP_ALLOWED_ORIGINS ?? 'localhost,127.0.0.1').split(',').map((host) => host.trim()).filter(Boolean),
});

const port = Number(process.env.MCP_PORT ?? 3001);
serve({ fetch: app.fetch, port, hostname: process.env.MCP_HOST ?? '127.0.0.1' }, () => console.log(`mcp listening on ${port}`));
