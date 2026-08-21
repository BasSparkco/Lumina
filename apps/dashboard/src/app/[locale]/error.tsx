'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { RotateCw, Home } from 'lucide-react';

// Catches any render error thrown by a page or component under this locale segment (e.g. the
// theme/layout editors) so it no longer takes down the whole route to Next's default unstyled
// error screen with no recovery action. Deliberately has no dependency on AuthContext/ThemeContext
// state or next-intl messages — those providers wrap this boundary, but if *they're* what threw,
// this component still needs to render standalone without assuming they're in a good state.
export default function LocaleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[dashboard] unhandled render error:', error);
  }, [error]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-950 px-4">
      <div className="max-w-sm w-full text-center">
        <p className="text-sm font-medium text-red-600 dark:text-red-400 mb-2">Something went wrong</p>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">This page hit an unexpected error</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Your other tabs and data are unaffected. Try again, or head back to the dashboard.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => reset()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
          >
            <RotateCw className="w-4 h-4" /> Try again
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 text-sm font-medium hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <Home className="w-4 h-4" /> Dashboard home
          </Link>
        </div>
      </div>
    </div>
  );
}
