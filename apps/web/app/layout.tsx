import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import { getServerConfig } from '@/lib/server-config.ts';
import './globals.css';

// Fonts are downloaded at build time and self-hosted; the browser never contacts Google.
const sans = Geist({ subsets: ['latin'], variable: '--font-geist-sans', display: 'swap' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });

// Configuration is read at request time; nothing environment-dependent is prerendered.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'Tradeplex', template: '%s · Tradeplex' },
  description: 'Tradeplex development build: copies your own futures trades across your own accounts. Simulator only.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f6f4' },
    { media: '(prefers-color-scheme: dark)', color: '#0e0d0c' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const result = getServerConfig();
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{result.ok ? children : <ConfigurationRefused problems={result.problems} />}</body>
    </html>
  );
}

function ConfigurationRefused({ problems }: { problems: string[] }) {
  return (
    <main className="standalone">
      <p className="standalone__code">Startup guard</p>
      <h1>Configuration refused</h1>
      <p>The web app will not run with this configuration. Fix these items and restart. Values are never shown here.</p>
      <ul className="standalone__list">
        {problems.map((p) => (
          <li key={p}>
            <code>{p}</code>
          </li>
        ))}
      </ul>
    </main>
  );
}
