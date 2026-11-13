import { getCtx } from '@/lib/server';
import { getSessionUser } from '@/lib/session';
import { exportUserData } from '@fin/core';

/** Downloads everything held about the signed-in user as one JSON file. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return new Response('Sign in first.', { status: 401 });
  const data = await exportUserData(getCtx(), user.id);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'content-type': 'application/json',
      'content-disposition': `attachment; filename="finplan-export-${data.exportedAt.slice(0, 10)}.json"`,
      'cache-control': 'no-store',
    },
  });
}
