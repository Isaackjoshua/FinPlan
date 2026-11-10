import type { ReactNode } from 'react';

type Search = Promise<{ error?: string; notice?: string }>;

/** Shows the message a form action left in the URL. */
export async function Flash({ searchParams }: { searchParams: Search }) {
  const { error, notice } = await searchParams;
  if (error) {
    return (
      <p role="alert" className="mb-4 rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
        {error}
      </p>
    );
  }
  if (notice) {
    return (
      <p role="status" className="mb-4 rounded-lg border border-brand/30 bg-brand/5 px-4 py-3 text-sm text-brand-dark">
        {notice}
      </p>
    );
  }
  return null;
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {children && <p className="mt-1 max-w-2xl text-sm text-muted">{children}</p>}
    </header>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  const colour = tone === 'bad' ? 'text-danger' : tone === 'good' ? 'text-brand-dark' : 'text-ink';
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`num mt-1 text-xl font-semibold ${colour}`}>{value}</p>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{children}</p>;
}

/** "housing" -> "Housing", "credit_card" -> "Credit card" */
export function humanise(value: string): string {
  const spaced = value.replaceAll('_', ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
