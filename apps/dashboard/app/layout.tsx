import type { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: 'Kasuwa Merchant Reconciliation Dashboard',
  description: 'Read-only merchant offline payment settlement reconciliation view',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>{`
          :root {
            --bg-primary: #f8fafc;
            --bg-card: #ffffff;
            --border-color: #e2e8f0;
            --text-primary: #0f172a;
            --text-secondary: #64748b;
            --accent-green: #10b981;
            --accent-amber: #f59e0b;
            --accent-red: #ef4444;
            --accent-blue: #2563eb;
          }
          @media (prefers-color-scheme: dark) {
            :root {
              --bg-primary: #0f172a;
              --bg-card: #1e293b;
              --border-color: #334155;
              --text-primary: #f8fafc;
              --text-secondary: #94a3b8;
              --accent-green: #34d399;
              --accent-amber: #fbbf24;
              --accent-red: #f87171;
              --accent-blue: #60a5fa;
            }
          }
          body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: var(--bg-primary);
            color: var(--text-primary);
          }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
