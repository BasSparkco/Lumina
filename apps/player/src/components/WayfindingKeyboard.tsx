import { ChevronDown, Delete } from 'lucide-react';
import type { WayfindingLang } from '../lib/wayfindingLang';

// docs/modules/ai_wayfinding_module_plan.md §9.2 — extracted from WayfindingDirectoryPanel's
// original inline QWERTY-only keyboard so both Directory search and the AI assistant share one
// on-screen keyboard implementation instead of maintaining two. Kiosks are touch-only hardware
// (no physical keyboard, and the platform's own virtual keyboard is frequently absent/unreliable
// in kiosk mode), so a docked keyboard is shown on demand rather than relied on implicitly.
//
// English uses a standard QWERTY layout; Arabic uses a standard Arabic keyboard layout so the
// bilingual assistant/directory search doesn't depend on an OS keyboard that may not exist.
const EN_KEY_ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];

const AR_KEY_ROWS = [
  ['ض', 'ص', 'ث', 'ق', 'ف', 'غ', 'ع', 'ه', 'خ', 'ح', 'ج'],
  ['ش', 'س', 'ي', 'ب', 'ل', 'ا', 'ت', 'ن', 'م', 'ك', 'ط'],
  ['ئ', 'ء', 'ؤ', 'ر', 'لا', 'ى', 'ة', 'و', 'ز', 'ظ'],
];

export default function WayfindingKeyboard({ lang, onKey, onSpace, onBackspace, onCollapse }: {
  lang: WayfindingLang;
  onKey: (char: string) => void;
  onSpace: () => void;
  onBackspace: () => void;
  onCollapse: () => void;
}) {
  const rows = lang === 'ar' ? AR_KEY_ROWS : EN_KEY_ROWS;
  return (
    <div style={styles.keyboard} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div style={styles.keyboardHeader}>
        <button style={styles.keyboardCollapse} onClick={onCollapse}>
          <ChevronDown size={20} color="#94a3b8" />
        </button>
      </div>
      {rows.map((row, i) => (
        <div key={i} style={styles.keyRow}>
          {row.map((ch) => (
            <button key={ch} style={styles.key} onClick={() => onKey(ch)}>
              {ch}
            </button>
          ))}
        </div>
      ))}
      <div style={styles.keyRow}>
        <button style={styles.keySpace} onClick={onSpace}>space</button>
        <button style={styles.keyBackspace} onClick={onBackspace}>
          <Delete size={20} color="#0f172a" />
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  keyboard: {
    flex: '0 0 auto', marginTop: '1.5vh', background: 'rgba(255,255,255,0.06)', borderRadius: '16px 16px 0 0',
    padding: '1vh 1vw 1.5vh', display: 'flex', flexDirection: 'column', gap: '0.8vh', boxSizing: 'border-box',
  },
  keyboardHeader: { display: 'flex', justifyContent: 'center' },
  keyboardCollapse: { background: 'none', border: 'none', cursor: 'pointer', padding: 4 },
  keyRow: { display: 'flex', gap: '0.5vw', justifyContent: 'center' },
  key: {
    flex: '1 1 0', maxWidth: '8vw', fontSize: '1.4vw', fontWeight: 600, textTransform: 'uppercase',
    background: '#f1f5f9', color: '#0f172a', border: 'none', borderRadius: 8, padding: '1.4vh 0', cursor: 'pointer',
  },
  keySpace: {
    flex: '4 1 0', fontSize: '1.2vw', fontWeight: 600, background: '#f1f5f9', color: '#0f172a',
    border: 'none', borderRadius: 8, padding: '1.4vh 0', cursor: 'pointer',
  },
  keyBackspace: {
    flex: '1 1 0', maxWidth: '10vw', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '1.4vh 0', cursor: 'pointer',
  },
};
