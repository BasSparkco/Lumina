import type { Metadata } from 'next';
import { ThemeProvider, themeInitScript } from '@/context/ThemeContext';
import { QueryProvider } from '@/context/QueryProvider';
import { AuthProvider } from '@/context/AuthContext';
import { AppToaster } from '@/components/AppToaster';
import './globals.css';

export const metadata: Metadata = {
  title: 'Lumina Signage',
  description: 'Cloud digital signage platform',
  icons: { icon: '/favicon.ico' },
};

// This is intentionally the *only* place <html>/<body> are rendered. It has no
// [locale] param, so it never remounts on a language switch — unlike the old
// setup where <html>/<body> (and everything inside, incl. ThemeProvider,
// QueryProvider and AuthProvider) lived inside app/[locale]/layout.tsx and got
// torn down/rebuilt on every switch. For ThemeProvider that caused a flash back
// to the default (light) theme; for AuthProvider it briefly reset `loading`/`user`
// to their initial state, which made the sidebar (gated on `loading || !user` in
// (app)/layout.tsx) disappear every time the locale was switched.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="dark:bg-gray-950">
        <ThemeProvider>
          <AppToaster />
          <QueryProvider>
            <AuthProvider>{children}</AuthProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
