import { getAuth } from '@/lib/auth';
import { toNextJsHandler } from 'better-auth/next-js';

const handler = () => toNextJsHandler(getAuth());

export const GET = (request: Request) => handler().GET(request);
export const POST = (request: Request) => handler().POST(request);
