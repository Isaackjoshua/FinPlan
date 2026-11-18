import { ServiceWorker } from '@/components/service-worker';
import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

// Downloaded at build time and served from FinPlan itself: visitors' browsers never contact Google.
const plex = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-plex', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'FinPlan', template: '%s · FinPlan' },
  description: 'Build and keep a personal financial plan with your own AI agent.',
  applicationName: 'FinPlan',
  // iPhones and iPads ignore most of the manifest and read these instead.
  appleWebApp: { capable: true, title: 'FinPlan', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  // Colours the phone's status bar and the installed app's title bar.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0f6b4f' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1311' },
  ],
  // Lets the installed app draw under the notch; the header and tab bar pad themselves by the safe area.
  viewportFit: 'cover',
};

// Runs before the first paint, so a saved "Light" or "Dark" choice never flashes the other theme.
// With no saved choice the stylesheet follows the device setting by itself.
const THEME_SCRIPT = `try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The script above may add data-theme before React loads; that difference is expected.
    <html lang="en" className={plex.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen font-sans antialiased">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
