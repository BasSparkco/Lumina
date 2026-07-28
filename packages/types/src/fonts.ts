// Curated, self-hostable font library for text assets and theme text elements — every entry
// ships as an `@fontsource/<id>` package (installed in both apps/dashboard, for editing/preview,
// and apps/player, for on-screen rendering) so text renders correctly even on a kiosk display
// with no internet access. All are Google Fonts under the SIL Open Font License, which — unlike
// Microsoft's Core Fonts (install-only redistribution terms) — explicitly permits bundling.
//
// `id` doubles as the `@fontsource/<id>` package name and the value stored on
// Asset.textFontFamily / ThemeElementStyle.fontFamily — keep it stable; renaming one breaks
// every asset/theme already saved with it.
export type FontCategory = 'SANS' | 'SERIF' | 'DISPLAY' | 'HANDWRITTEN' | 'MONOSPACE' | 'ARABIC';

export interface FontDefinition {
  id: string;
  label: string;
  category: FontCategory;
  /** CSS `font-family` value, including a generic fallback. */
  stack: string;
}

export const FONT_LIBRARY: FontDefinition[] = [
  // Sans-serif
  { id: 'inter', label: 'Inter', category: 'SANS', stack: '"Inter", sans-serif' },
  { id: 'roboto', label: 'Roboto', category: 'SANS', stack: '"Roboto", sans-serif' },
  { id: 'open-sans', label: 'Open Sans', category: 'SANS', stack: '"Open Sans", sans-serif' },
  { id: 'lato', label: 'Lato', category: 'SANS', stack: '"Lato", sans-serif' },
  { id: 'montserrat', label: 'Montserrat', category: 'SANS', stack: '"Montserrat", sans-serif' },
  { id: 'poppins', label: 'Poppins', category: 'SANS', stack: '"Poppins", sans-serif' },
  { id: 'nunito', label: 'Nunito', category: 'SANS', stack: '"Nunito", sans-serif' },
  { id: 'work-sans', label: 'Work Sans', category: 'SANS', stack: '"Work Sans", sans-serif' },
  { id: 'raleway', label: 'Raleway', category: 'SANS', stack: '"Raleway", sans-serif' },
  { id: 'source-sans-3', label: 'Source Sans 3', category: 'SANS', stack: '"Source Sans 3", sans-serif' },
  { id: 'rubik', label: 'Rubik', category: 'SANS', stack: '"Rubik", sans-serif' },
  { id: 'dm-sans', label: 'DM Sans', category: 'SANS', stack: '"DM Sans", sans-serif' },
  { id: 'manrope', label: 'Manrope', category: 'SANS', stack: '"Manrope", sans-serif' },

  // Serif
  { id: 'playfair-display', label: 'Playfair Display', category: 'SERIF', stack: '"Playfair Display", serif' },
  { id: 'merriweather', label: 'Merriweather', category: 'SERIF', stack: '"Merriweather", serif' },
  { id: 'lora', label: 'Lora', category: 'SERIF', stack: '"Lora", serif' },
  { id: 'pt-serif', label: 'PT Serif', category: 'SERIF', stack: '"PT Serif", serif' },
  { id: 'crimson-text', label: 'Crimson Text', category: 'SERIF', stack: '"Crimson Text", serif' },
  { id: 'noto-serif', label: 'Noto Serif', category: 'SERIF', stack: '"Noto Serif", serif' },
  { id: 'bitter', label: 'Bitter', category: 'SERIF', stack: '"Bitter", serif' },
  { id: 'cormorant-garamond', label: 'Cormorant Garamond', category: 'SERIF', stack: '"Cormorant Garamond", serif' },

  // Display / decorative
  { id: 'bebas-neue', label: 'Bebas Neue', category: 'DISPLAY', stack: '"Bebas Neue", sans-serif' },
  { id: 'anton', label: 'Anton', category: 'DISPLAY', stack: '"Anton", sans-serif' },
  { id: 'oswald', label: 'Oswald', category: 'DISPLAY', stack: '"Oswald", sans-serif' },
  { id: 'archivo-black', label: 'Archivo Black', category: 'DISPLAY', stack: '"Archivo Black", sans-serif' },
  { id: 'righteous', label: 'Righteous', category: 'DISPLAY', stack: '"Righteous", cursive' },

  // Handwritten / script
  { id: 'pacifico', label: 'Pacifico', category: 'HANDWRITTEN', stack: '"Pacifico", cursive' },
  { id: 'dancing-script', label: 'Dancing Script', category: 'HANDWRITTEN', stack: '"Dancing Script", cursive' },
  { id: 'caveat', label: 'Caveat', category: 'HANDWRITTEN', stack: '"Caveat", cursive' },
  { id: 'great-vibes', label: 'Great Vibes', category: 'HANDWRITTEN', stack: '"Great Vibes", cursive' },
  { id: 'satisfy', label: 'Satisfy', category: 'HANDWRITTEN', stack: '"Satisfy", cursive' },

  // Monospace
  { id: 'jetbrains-mono', label: 'JetBrains Mono', category: 'MONOSPACE', stack: '"JetBrains Mono", monospace' },
  { id: 'roboto-mono', label: 'Roboto Mono', category: 'MONOSPACE', stack: '"Roboto Mono", monospace' },
  { id: 'space-mono', label: 'Space Mono', category: 'MONOSPACE', stack: '"Space Mono", monospace' },
  { id: 'ibm-plex-mono', label: 'IBM Plex Mono', category: 'MONOSPACE', stack: '"IBM Plex Mono", monospace' },
  { id: 'fira-code', label: 'Fira Code', category: 'MONOSPACE', stack: '"Fira Code", monospace' },

  // Arabic — the dashboard/player both support an `ar` locale, so these need first-class billing
  // rather than being an afterthought bolted onto the Latin list.
  { id: 'cairo', label: 'Cairo', category: 'ARABIC', stack: '"Cairo", sans-serif' },
  { id: 'tajawal', label: 'Tajawal', category: 'ARABIC', stack: '"Tajawal", sans-serif' },
  { id: 'almarai', label: 'Almarai', category: 'ARABIC', stack: '"Almarai", sans-serif' },
  { id: 'noto-sans-arabic', label: 'Noto Sans Arabic', category: 'ARABIC', stack: '"Noto Sans Arabic", sans-serif' },
  { id: 'noto-kufi-arabic', label: 'Noto Kufi Arabic', category: 'ARABIC', stack: '"Noto Kufi Arabic", sans-serif' },
  { id: 'amiri', label: 'Amiri', category: 'ARABIC', stack: '"Amiri", serif' },
  { id: 'reem-kufi', label: 'Reem Kufi', category: 'ARABIC', stack: '"Reem Kufi", sans-serif' },
];

export const FONT_IDS = FONT_LIBRARY.map(f => f.id) as [string, ...string[]];

const FONT_STACK_BY_ID = new Map(FONT_LIBRARY.map(f => [f.id, f.stack]));

export const DEFAULT_FONT_ID = 'inter';

/** Resolves a stored font id to its CSS `font-family` value, falling back to the default font
 * for ids that predate this registry or were never set. */
export function fontStack(id: string | null | undefined): string {
  if (!id) return FONT_STACK_BY_ID.get(DEFAULT_FONT_ID)!;
  return FONT_STACK_BY_ID.get(id) ?? FONT_STACK_BY_ID.get(DEFAULT_FONT_ID)!;
}
