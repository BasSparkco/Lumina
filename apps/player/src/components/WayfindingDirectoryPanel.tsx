import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { WayfindingDirectory, WayfindingPoi, WayfindingPoiCategory } from '../lib/api';
import { CategoryIcon } from './WayfindingDirectoryBoard';
import WayfindingKeyboard from './WayfindingKeyboard';
import { type WayfindingLang, t, pickName, pickCategoryLabel } from '../lib/wayfindingLang';
import { logKioskEvent } from '../lib/kioskAnalytics';

const SEARCH_LOG_DEBOUNCE_MS = 1200;

// Full building directory (Phase 7.2) — alphabetical list + category filter + search, opened
// from a button in WayfindingKioskMap's header. Searches across every floor (not just the one
// on screen), since a visitor looking a store up usually doesn't know which floor it's on —
// picking a result hands the floor + POI back to the map via `onSelect`, which switches floors
// if needed and opens the same detail card the map's own tap-a-pin flow uses.
//
// On-screen keyboard: kiosks are touch-only hardware, so there's no physical keyboard to type
// a search into — a docked QWERTY keyboard is shown on demand instead of relying on the browser's
// (frequently absent/unreliable on kiosk OSes) virtual keyboard.
export default function WayfindingDirectoryPanel({ directory, lang, onClose, onSelect }: {
  directory: WayfindingDirectory;
  lang: WayfindingLang;
  onClose: () => void;
  onSelect: (poi: WayfindingPoi) => void;
}) {
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  const categories = useMemo(() => {
    const byId = new Map<string, WayfindingPoiCategory>();
    for (const poi of directory.pois) if (!byId.has(poi.category.id)) byId.set(poi.category.id, poi.category);
    return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [directory.pois]);

  const results = useMemo(() => {
    const query = search.trim().toLowerCase();
    return directory.pois
      .filter(p => !categoryId || p.category.id === categoryId)
      .filter(p => !query || pickName(p, lang).toLowerCase().includes(query))
      .sort((a, b) => pickName(a, lang).localeCompare(pickName(b, lang)));
  }, [directory.pois, categoryId, search, lang]);

  // Kiosk analytics (7.4) — log a search once typing settles rather than per keystroke, so a
  // visitor typing "starbucks" doesn't produce nine near-duplicate events.
  useEffect(() => {
    const query = search.trim();
    if (!query) return;
    const id = setTimeout(() => logKioskEvent('SEARCH', { query }), SEARCH_LOG_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [search]);

  return (
    <div style={styles.overlay} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <header style={styles.header}>
        <div style={styles.title}>{t('directory', lang)}</div>
        <button style={styles.closeButton} onClick={onClose}>
          <X size={24} color="#f1f5f9" />
        </button>
      </header>

      <button style={styles.searchBar} onClick={() => setKeyboardOpen(true)}>
        <Search size={20} color="#94a3b8" />
        <span style={search ? styles.searchText : styles.searchPlaceholder}>
          {search || t('search', lang)}
        </span>
        {search && (
          <span
            role="button"
            style={styles.searchClear}
            onClick={(e) => { e.stopPropagation(); setSearch(''); }}
          >
            <X size={16} color="#94a3b8" />
          </span>
        )}
      </button>

      {categories.length > 0 && (
        <div style={styles.chipRow}>
          <button
            style={categoryId === null ? styles.chipActive : styles.chip}
            onClick={() => setCategoryId(null)}
          >
            {t('all', lang)}
          </button>
          {categories.map(cat => (
            <button
              key={cat.id}
              style={categoryId === cat.id ? { ...styles.chipActive, background: cat.color } : styles.chip}
              onClick={() => setCategoryId(id => id === cat.id ? null : cat.id)}
            >
              <CategoryIcon name={cat.icon} size={16} color={categoryId === cat.id ? '#fff' : cat.color} />
              {pickCategoryLabel(cat, lang)}
            </button>
          ))}
        </div>
      )}

      <ul style={styles.list}>
        {results.length === 0 ? (
          <div style={styles.emptyText}>{t('noMatches', lang)}</div>
        ) : (
          results.map(poi => (
            <li key={poi.id}>
              <button style={styles.row} onClick={() => onSelect(poi)}>
                <span style={{ ...styles.rowIcon, background: poi.category.color }}>
                  <CategoryIcon name={poi.category.icon} size={18} color="#fff" />
                </span>
                <span style={styles.rowText}>
                  <span style={poi.status === 'OPEN' ? styles.rowName : styles.rowNameInactive}>{pickName(poi, lang)}</span>
                  <span style={styles.rowFloor}>{poi.floorLabel}</span>
                </span>
                {poi.status !== 'OPEN' && (
                  <span style={styles.rowStatusTag}>{poi.status === 'CLOSED' ? t('closed', lang) : t('relocated', lang)}</span>
                )}
              </button>
            </li>
          ))
        )}
      </ul>

      {keyboardOpen && (
        <WayfindingKeyboard
          lang={lang}
          onKey={(ch) => setSearch((s) => s + ch)}
          onSpace={() => setSearch((s) => s + ' ')}
          onBackspace={() => setSearch((s) => s.slice(0, -1))}
          onCollapse={() => setKeyboardOpen(false)}
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'absolute', inset: 0, background: '#0f172a', color: '#f1f5f9',
    fontFamily: 'system-ui, sans-serif', display: 'flex', flexDirection: 'column',
    padding: '2vh 3vw', boxSizing: 'border-box',
  },
  header: { flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5vh' },
  title: { fontSize: '2.2vw', fontWeight: 800 },
  closeButton: {
    background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '50%', width: 44, height: 44,
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
  },
  searchBar: {
    flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: '0.8vw', background: 'rgba(255,255,255,0.08)',
    border: 'none', borderRadius: 14, padding: '1.4vh 1.4vw', cursor: 'pointer', marginBottom: '1.5vh', width: '100%',
    boxSizing: 'border-box', textAlign: 'start',
  },
  searchText: { fontSize: '1.4vw', color: '#f1f5f9', flex: 1 },
  searchPlaceholder: { fontSize: '1.4vw', color: '#64748b', flex: 1 },
  searchClear: { display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
  chipRow: { flex: '0 0 auto', display: 'flex', gap: '0.6vw', overflowX: 'auto', paddingBottom: '1.5vh' },
  chip: {
    display: 'flex', alignItems: 'center', gap: '0.5vw', fontSize: '1.1vw', fontWeight: 600, color: '#cbd5e1',
    background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 999, padding: '0.8vh 1.2vw',
    cursor: 'pointer', whiteSpace: 'nowrap', flex: '0 0 auto',
  },
  chipActive: {
    display: 'flex', alignItems: 'center', gap: '0.5vw', fontSize: '1.1vw', fontWeight: 700, color: '#fff',
    background: '#2563eb', border: 'none', borderRadius: 999, padding: '0.8vh 1.2vw',
    cursor: 'pointer', whiteSpace: 'nowrap', flex: '0 0 auto',
  },
  list: { flex: '1 1 auto', overflowY: 'auto', listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.6vh' },
  row: {
    width: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: '1vw',
    background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: 12, padding: '1.2vh 1.2vw',
    cursor: 'pointer', textAlign: 'start',
  },
  rowIcon: {
    width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto',
  },
  rowText: { flex: 1, display: 'flex', flexDirection: 'column', gap: '0.2vh', minWidth: 0 },
  rowName: { fontSize: '1.3vw', fontWeight: 700 },
  rowNameInactive: { fontSize: '1.3vw', fontWeight: 700, opacity: 0.5, textDecoration: 'line-through' },
  rowFloor: { fontSize: '1vw', opacity: 0.6 },
  rowStatusTag: {
    fontSize: '0.9vw', fontWeight: 700, textTransform: 'uppercase', color: '#fbbf24',
    border: '1px solid #fbbf24', borderRadius: 6, padding: '0.3vh 0.7vw', flex: '0 0 auto',
  },
  emptyText: { fontSize: '1.4vw', opacity: 0.6, margin: 'auto', paddingTop: '4vh' },
};
