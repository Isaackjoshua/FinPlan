import type { MetadataRoute } from 'next';

/**
 * The web app manifest: what a phone or computer needs to install FinPlan as an
 * app. Served at /manifest.webmanifest and linked from every page by Next.js.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // A stable identity, so changing start_url later does not create a second app.
    id: '/',
    name: 'FinPlan',
    short_name: 'FinPlan',
    description: 'Build and keep a personal financial plan with your own AI agent.',
    // Signed-out users are sent on to the sign-in page from here.
    start_url: '/dashboard',
    scope: '/',
    // Its own window, without the browser's address bar and tabs.
    display: 'standalone',
    // Shown behind the icon while the app starts: the page and brand colours from globals.css.
    background_color: '#f6f8f6',
    theme_color: '#0f6b4f',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Full-bleed version for Android, which cuts icons to its own shape (circle, squircle...).
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
