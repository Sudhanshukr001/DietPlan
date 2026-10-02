import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Aaj Ka Khana — your daily food and routine companion',
  description:
    'A free, offline-first app that plans today’s affordable meals, shows exactly what to do next, and keeps you on track without diet culture.',
  applicationName: 'Aaj Ka Khana',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Aaj Ka Khana' },
  formatDetection: { telephone: false },
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#f2efe9',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-bg text-ink">

        {children}
      </body>
    </html>
  );
}