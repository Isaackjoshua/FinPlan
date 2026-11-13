import { proxyToAuth } from '@/lib/authServer';
import type { NextRequest } from 'next/server';

const handle = (request: NextRequest) => proxyToAuth(request, '/.well-known/oauth-authorization-server');

export { handle as GET, handle as OPTIONS };
