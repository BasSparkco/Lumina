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
        {/* Curated theme-editor font list (see FONT_OPTIONS in the themes page) — loaded here
            so the editor preview, card thumbnails, and the played-out screen all render the
            same chosen font instead of a system fallback. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Roboto:wght@400;500;700;900&family=Open+Sans:wght@400;600;700;800&family=Lato:wght@400;700;900&family=Montserrat:wght@400;500;600;700;800;900&family=Poppins:wght@400;500;600;700;800;900&family=Nunito:wght@400;600;700;800;900&family=Playfair+Display:wght@400;600;700;800;900&family=Merriweather:wght@400;700;900&family=Oswald:wght@400;500;600;700&family=Raleway:wght@400;500;600;700;800;900&family=Noto+Sans+Arabic:wght@400;500;600;700;800;900&display=swap"
        />
      </head>
      <body className="dark:bg-gray-950">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
