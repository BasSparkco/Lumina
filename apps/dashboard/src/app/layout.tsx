import type { Metadata } from 'next';
import { ThemeProvider, themeInitScript } from '@/context/ThemeContext';
import './globals.css';

export const metadata: Metadata = {
  title: 'Lumina Signage',
  description: 'Cloud digital signage platform',
};

// This is intentionally the *only* place <html>/<body> are rendered. It has no
// [locale] param, so it never remounts on a language switch — unlike the old
// setup where <html>/<body> (and everything inside, incl. ThemeProvider) lived
// inside app/[locale]/layout.tsx and got torn down/rebuilt on every switch,
// causing a visible flash back to the default (light) theme.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="dark:bg-gray-950">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
