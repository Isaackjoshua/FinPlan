import { Empty, Flash, humanise, PageHeader } from '@/components/ui';
import { run, str } from '@/lib/forms';
import { getCtx } from '@/lib/server';
import { requireProfile } from '@/lib/session';
import { ACTIVITY_OUTCOMES, listActivity, listConnections, listProfileRevisions, restoreProfileRevision, revokeConnection, type ActivityOutcome, type Connection } from '@fin/core';
import Link from 'next/link';

export const metadata = { title: 'AI apps' };

async function revoke(form: FormData) {
  'use server';
  const { userId } = await requireProfile();
  await run('/agents', () => revokeConnection(getCtx(), userId, str(form, 'id')), 'Disconnected. That app can no longer read or change anything.');
}

async function restore(form: FormData) {
  'use server';
  const { userId } = await requireProfile();
  await run('/agents', async () => {
    await restoreProfileRevision(getCtx(), userId, Number(str(form, 'revision')));
  }, 'Your profile and goals are back to how they were before that change.');
}

const PERMISSION = { 'finance:read': 'See your information', 'finance:write': 'Make changes' } as const;
const OUTCOME: Record<ActivityOutcome, string> = {
  ok: 'Done',
  denied: 'Refused: no permission',
  invalid: 'Rejected: invalid request',
  rate_limited: 'Refused: too many requests',
  error: 'Failed',
};
const when = (date: Date | null) => (date ? date.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'Never');

function ConnectionCard({ connection }: { connection: Connection }) {
  return (
    <li className="card flex flex-wrap items-start justify-between gap-3">
      <div className="text-sm">
        {/* The name is whatever the app calls itself; shown as plain text. */}
        <p className="font-semibold">{connection.clientName}</p>
        <p className="text-muted">{connection.scopes.map((scope) => PERMISSION[scope]).join(' · ')}</p>
        <p className="text-muted">Connected {when(connection.createdAt)} · Last used {when(connection.lastUsedAt)}</p>
      </div>
      <form action={revoke}>
        <input type="hidden" name="id" value={connection.id} />
        <button className="btn-quiet">Disconnect</button>
      </form>
    </li>
  );
}

export default async function AgentsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string; app?: string; outcome?: string }> }) {
  const { userId } = await requireProfile();
  const query = await searchParams;
  const ctx = getCtx();
  const connections = await listConnections(ctx, userId);
  const name = new Map(connections.map((c) => [c.id, c.clientName]));
  const filter = {
    connectionId: connections.some((c) => c.id === query.app) ? query.app : undefined,
    outcome: ACTIVITY_OUTCOMES.find((o) => o === query.outcome),
  };
  const [activity, revisions] = await Promise.all([listActivity(ctx, userId, { ...filter, limit: 100 }), listProfileRevisions(ctx, userId, 20)]);
  const live = connections.filter((c) => !c.revokedAt);
  const past = connections.filter((c) => c.revokedAt);
  const mcpUrl = process.env.MCP_URL ?? '';

  return (
    <>
      <PageHeader title="AI apps">
        Connect your own AI assistant so it can help you build and keep up your plan. You decide what it may do, you can see everything it does, and you can disconnect it at any time.
      </PageHeader>
      <Flash searchParams={searchParams} />

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold">Connect an app</h2>
        <div className="card space-y-3 text-sm">
          <p>Give your AI app this address. It will send you back here to sign in and choose what it may do.</p>
          <p><code className="num select-all rounded bg-paper px-2 py-1">{mcpUrl}</code></p>
          <ul className="list-disc space-y-1 pl-5 text-muted">
            <li><span className="font-medium text-ink">Claude:</span> in Settings, open Connectors, add a custom connector and paste the address.</li>
            <li><span className="font-medium text-ink">ChatGPT:</span> in Settings, open Apps and connectors, create a connector and paste the address as the MCP server URL.</li>
            <li><span className="font-medium text-ink">Other apps:</span> anything that supports remote MCP servers works. Add a server and paste the address.</li>
          </ul>
          <p className="text-muted">FinPlan supports financial education and planning. Connected apps get no tools for trading or for recommending specific investments, and they can never delete your data.</p>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold">Connected apps</h2>
        {live.length === 0 ? <Empty>No app is connected.</Empty> : <ul className="space-y-3">{live.map((c) => <ConnectionCard key={c.id} connection={c} />)}</ul>}
        {past.length > 0 && (
          <details className="mt-3 text-sm text-muted">
            <summary className="cursor-pointer">Disconnected ({past.length})</summary>
            <ul className="mt-2 space-y-1">
              {past.map((c) => <li key={c.id}>{c.clientName} · disconnected {when(c.revokedAt)}</li>)}
            </ul>
          </details>
        )}
      </section>

      <section className="mb-10">
        <h2 className="mb-1 text-lg font-semibold">Undo changes</h2>
        <p className="mb-3 max-w-2xl text-sm text-muted">
          Before an app changes your profile or goals, FinPlan keeps a copy of how they were. Restoring one undoes that change and any made after it. Plans saved by an app are undone on the <Link href="/plan" className="link">Plan page</Link>.
        </p>
        {revisions.length === 0 ? (
          <Empty>No app has changed your profile or goals.</Empty>
        ) : (
          <ul className="space-y-2">
            {revisions.map((r) => (
              <li key={r.revision} className="card flex flex-wrap items-center justify-between gap-3 text-sm">
                <span>
                  {when(r.at)} · {r.madeBy === 'agent' ? `changed by ${name.get(r.connectionId ?? '') ?? 'an app'}` : 'restored by you'}
                </span>
                <form action={restore}>
                  <input type="hidden" name="revision" value={r.revision} />
                  <button className="btn-quiet">Restore to before this</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-lg font-semibold">Activity</h2>
        <p className="mb-3 max-w-2xl text-sm text-muted">Every request an app makes, including ones that were refused. The log records what was done, never the amounts.</p>
        <form className="mb-3 flex flex-wrap items-end gap-3 text-sm">
          <label>
            <span className="label">App</span>
            <select name="app" defaultValue={filter.connectionId ?? ''} className="input">
              <option value="">All apps</option>
              {connections.map((c) => <option key={c.id} value={c.id}>{c.clientName}{c.revokedAt ? ' (disconnected)' : ''}</option>)}
            </select>
          </label>
          <label>
            <span className="label">Result</span>
            <select name="outcome" defaultValue={filter.outcome ?? ''} className="input">
              <option value="">All results</option>
              {ACTIVITY_OUTCOMES.map((o) => <option key={o} value={o}>{OUTCOME[o]}</option>)}
            </select>
          </label>
          <button className="btn-quiet">Filter</button>
        </form>
        {activity.length === 0 ? (
          <Empty>Nothing to show.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr><th className="py-2 pr-4">When</th><th className="py-2 pr-4">App</th><th className="py-2 pr-4">Request</th><th className="py-2 pr-4">Result</th><th className="py-2">Details</th></tr>
              </thead>
              <tbody>
                {activity.map((row) => (
                  <tr key={row.id} className="border-t border-line align-top">
                    <td className="num py-2 pr-4 whitespace-nowrap">{when(row.createdAt)}</td>
                    <td className="py-2 pr-4">{name.get(row.connectionId) ?? 'Unknown'}</td>
                    <td className="py-2 pr-4">{humanise(row.tool)}</td>
                    <td className={`py-2 pr-4 ${row.outcome === 'ok' ? '' : 'text-danger'}`}>{OUTCOME[row.outcome]}</td>
                    <td className="py-2 text-muted">
                      {row.entityType === 'plan_version' && row.entityId ? <Link href="/plan" className="link">Plan version {row.entityId}</Link> : row.entityType ? humanise(row.entityType) : ''}
                      {row.changedFields?.length ? ` (${row.changedFields.map((field) => field.replaceAll('_', ' ')).join(', ')})` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
