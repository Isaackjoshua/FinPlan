import { createDb } from '@fin/db';
import { createServer } from 'node:http';
import { removeExpired } from './adapter';
import { createAuthServer } from './server';

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const db = createDb(need('DATABASE_URL'));
const { handler } = createAuthServer({
  db,
  issuer: need('BETTER_AUTH_URL'),
  mcpUrl: need('MCP_URL'),
  internalSecret: need('AUTH_INTERNAL_SECRET'),
});

const port = Number(process.env.AUTH_PORT ?? 3002);
// Not reachable from the internet: the web app proxies the public OAuth routes to this port.
createServer(handler).listen(port, process.env.AUTH_HOST ?? '127.0.0.1', () => console.log(`auth listening on ${port}`));

const sweep = () => removeExpired(db).catch((error) => console.error('cleanup failed:', error.name));
setInterval(sweep, 10 * 60 * 1000).unref();
void sweep();
