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
    <header className="mb-6 sm:mb-8">
      <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight sm:text-3xl">{title}</h1>
      {children && <p className="mt-1.5 max-w-2xl text-[0.9375rem] leading-relaxed text-muted">{children}</p>}
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

/** "2026-10-01", "2026-10-31" -> "1–31 Oct 2026" */
export function formatPeriod(start: string, end: string): string {
  const date = (iso: string) => new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).formatRange(date(start), date(end));
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{children}</p>;
}

/** "housing" -> "Housing", "credit_card" -> "Credit card" */
export function humanise(value: string): string {
  const spaced = value.replaceAll('_', ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
