'use client';

import { useEffect, useState } from 'react';

type Choice = 'system' | 'light' | 'dark';
const CHOICES: { value: Choice; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/**
 * Applies a choice to this browser. Saved in the browser rather than the account:
 * a phone and a laptop can sensibly differ, and the page script in app/layout.tsx
 * must read it before anything loads from the server.
 */
function choose(choice: Choice) {
  const root = document.documentElement;
  // "System" removes the override, so the stylesheet's prefers-color-scheme rule decides again.
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
  try {
    if (choice === 'system') localStorage.removeItem('theme');
    else localStorage.setItem('theme', choice);
  } catch {
    // Storage blocked (some private modes): the page still changes, it just isn't remembered.
  }
}

export function ThemePicker() {
  const [current, setCurrent] = useState<Choice>('system');
  // Read after loading: the server cannot see what this browser saved.
  useEffect(() => {
    const saved = document.documentElement.dataset.theme;
    if (saved === 'light' || saved === 'dark') setCurrent(saved);
  }, []);

  return (
    <fieldset>
      <legend className="sr-only">Appearance</legend>
      <div className="inline-grid grid-cols-3 rounded-xl border border-line bg-paper p-1">
        {CHOICES.map(({ value, label }) => (
          <label
            key={value}
            className={`flex min-h-10 cursor-pointer items-center justify-center rounded-lg px-4 text-sm font-medium transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand ${current === value ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
          >
            <input
              type="radio"
              name="theme"
              value={value}
              checked={current === value}
              onChange={() => {
                choose(value);
                setCurrent(value);
              }}
              className="sr-only"
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
