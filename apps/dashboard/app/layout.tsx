import type { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: 'Kasuwa | Merchant Settlement & Dispute Reconciliation',
  description: 'Offline-first payment settlement reconciliation and on-chain shortfall dispute monitoring for merchants',
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
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
        <style>{`
          :root {
            --bg-primary: #070a13;
            --bg-secondary: #0d1222;
            --bg-card: #111827;
            --bg-card-hover: #172238;
            --border-color: #1f293d;
            --border-highlight: #334155;
            --text-primary: #f8fafc;
            --text-secondary: #94a3b8;
            --text-muted: #64748b;
            --accent-gold: #f59e0b;
            --accent-gold-dark: #d97706;
            --accent-green: #10b981;
            --accent-red: #f43f5e;
            --accent-purple: #a855f7;
            --accent-blue: #38bdf8;
            --shadow-subtle: 0 10px 30px -10px rgba(0, 0, 0, 0.5);
          }
          * {
            box-sizing: border-box;
          }
          body {
            margin: 0;
            padding: 0;
            font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background-color: var(--bg-primary);
            color: var(--text-primary);
            min-height: 100vh;
            -webkit-font-smoothing: antialiased;
          }
          code, pre, .font-mono {
            font-family: 'JetBrains Mono', monospace;
          }
          button, input, select {
            font-family: inherit;
          }
          @keyframes pulse-dot {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(0.85); }
          }
          .pulse-anim {
            animation: pulse-dot 2s infinite ease-in-out;
          }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
