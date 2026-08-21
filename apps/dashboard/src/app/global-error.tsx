'use client';

import { useEffect } from 'react';

// Only fires if something above the [locale] segment throws — the root layout itself, or one of
// ThemeProvider/QueryProvider/AuthProvider before [locale]/error.tsx exists to catch it. Next
// requires this file to render its own <html>/<body> since it fully replaces the root layout, so
// it can't lean on globals.css/Tailwind classes or app context the way [locale]/error.tsx does —
// everything here is inline and dependency-free on purpose, since this is the last line of defense.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[dashboard] unhandled root error:', error);
  }, [error]);

  return (
    <html>
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#f9fafb' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '16px' }}>
          <div style={{ maxWidth: 360, width: '100%', textAlign: 'center' }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#dc2626', margin: '0 0 8px' }}>Something went wrong</p>
            <h1 style={{ fontSize: 18, fontWeight: 600, color: '#111827', margin: '0 0 8px' }}>Lumina failed to load</h1>
            <p style={{ fontSize: 14, color: '#6b7280', margin: '0 0 24px' }}>
              Please try again. If this keeps happening, contact your administrator.
            </p>
            <button
              onClick={() => reset()}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                background: '#4f46e5',
                color: '#fff',
                fontSize: 14,
                fontWeight: 500,
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
