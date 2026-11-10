import 'server-only';
import { ConflictError, NotFoundError, parseAmount } from '@fin/core';
import { redirect } from 'next/navigation';
import { ZodError } from 'zod';

/** Sends the user back to a page with a message shown at the top. */
export function back(path: string, kind: 'error' | 'notice', message: string): never {
  redirect(`${path}?${kind}=${encodeURIComponent(message)}`);
}

export class FormError extends Error {}

export const str = (form: FormData, name: string) => String(form.get(name) ?? '').trim();

export function money(form: FormData, name: string, currency: string, label: string): number {
  const value = parseAmount(str(form, name), currency);
  if (value === null) throw new FormError(`${label}: enter an amount such as 1250.50`);
  return value;
}

/** Like `money`, but an empty field means "not provided". */
export function optionalMoney(form: FormData, name: string, currency: string, label: string): number | undefined {
  return str(form, name) === '' ? undefined : money(form, name, currency, label);
}

/** Reads a percentage such as "19.99" and returns basis points (1999). */
export function percent(form: FormData, name: string, label: string): number {
  const raw = str(form, name) || '0';
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(raw)) throw new FormError(`${label}: enter a percentage such as 19.99`);
  return Math.round(Number(raw) * 100);
}

/**
 * Runs a form action and turns expected failures into a message on `path`.
 * Messages are written here, never taken from the thrown error's contents,
 * except for our own FormError and validation issue text.
 */
export async function run(path: string, action: () => Promise<void>, done?: string): Promise<never> {
  try {
    await action();
  } catch (error) {
    if (error instanceof FormError) back(path, 'error', error.message);
    if (error instanceof ZodError) {
      const issue = error.issues[0];
      back(path, 'error', issue ? `${issue.path.join('.') || 'Input'}: ${issue.message}` : 'Please check the form');
    }
    if (error instanceof ConflictError) back(path, 'error', 'This changed since you loaded the page. Please try again.');
    if (error instanceof NotFoundError) back(path, 'error', 'That item no longer exists.');
    throw error;
  }
  if (done) back(path, 'notice', done);
  redirect(path);
}
