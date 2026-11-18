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
  themeColor: '#0f6b4f',
  // Lets the installed app draw under the notch; the header and tab bar pad themselves by the safe area.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={plex.variable}>
      <body className="min-h-screen font-sans antialiased">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
