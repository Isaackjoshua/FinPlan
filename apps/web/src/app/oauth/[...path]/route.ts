import { proxyToAuth } from '@/lib/authServer';
import type { NextRequest } from 'next/server';

// The public OAuth endpoints (authorize, token, register, revoke, jwks). Only paths
// under /oauth are passed on, so the OAuth server's internal API is unreachable from here.
async function handle(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxyToAuth(request, `/oauth/${path.map(encodeURIComponent).join('/')}`);
}

export { handle as GET, handle as POST, handle as OPTIONS };
