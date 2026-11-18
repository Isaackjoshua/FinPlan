import { ServiceWorker } from '@/components/service-worker';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

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
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
