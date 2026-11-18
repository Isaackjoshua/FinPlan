'use client';

import { useEffect } from 'react';

/** Registers /sw.js once the page has loaded. Renders nothing. */
export function ServiceWorker() {
  useEffect(() => {
    // Only in production: in development a service worker can serve stale pages and confuse hot reload.
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    // updateViaCache 'none': always check the server for a new sw.js, never a cached copy.
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {
      // Not fatal: the site works the same without it, only the offline page is missing.
    });
  }, []);
  return null;
}
