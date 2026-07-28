// Side-effect import: registers @font-face rules (regular weight, all subsets) for every font
// in the shared FONT_LIBRARY (packages/types/src/fonts.ts), so both the editor previews and the
// final render use real font files bundled at build time — no runtime fetch to Google's CDN,
// which matters for kiosk/TV players that may have no outbound internet access.
//
// Import this module exactly once, near the app root, before anything renders text.
import '@fontsource/inter/index.css';
import '@fontsource/roboto/index.css';
import '@fontsource/open-sans/index.css';
import '@fontsource/lato/index.css';
import '@fontsource/montserrat/index.css';
import '@fontsource/poppins/index.css';
import '@fontsource/nunito/index.css';
import '@fontsource/work-sans/index.css';
import '@fontsource/raleway/index.css';
import '@fontsource/source-sans-3/index.css';
import '@fontsource/rubik/index.css';
import '@fontsource/dm-sans/index.css';
import '@fontsource/manrope/index.css';
import '@fontsource/playfair-display/index.css';
import '@fontsource/merriweather/index.css';
import '@fontsource/lora/index.css';
import '@fontsource/pt-serif/index.css';
import '@fontsource/crimson-text/index.css';
import '@fontsource/noto-serif/index.css';
import '@fontsource/bitter/index.css';
import '@fontsource/cormorant-garamond/index.css';
import '@fontsource/bebas-neue/index.css';
import '@fontsource/anton/index.css';
import '@fontsource/oswald/index.css';
import '@fontsource/archivo-black/index.css';
import '@fontsource/righteous/index.css';
import '@fontsource/pacifico/index.css';
import '@fontsource/dancing-script/index.css';
import '@fontsource/caveat/index.css';
import '@fontsource/great-vibes/index.css';
import '@fontsource/satisfy/index.css';
import '@fontsource/jetbrains-mono/index.css';
import '@fontsource/roboto-mono/index.css';
import '@fontsource/space-mono/index.css';
import '@fontsource/ibm-plex-mono/index.css';
import '@fontsource/fira-code/index.css';
import '@fontsource/cairo/index.css';
import '@fontsource/tajawal/index.css';
import '@fontsource/almarai/index.css';
import '@fontsource/noto-sans-arabic/index.css';
import '@fontsource/noto-kufi-arabic/index.css';
import '@fontsource/amiri/index.css';
import '@fontsource/reem-kufi/index.css';
