import { useEffect, useState } from 'react';
import * as LucideIcons from 'lucide-react';
import { MapPin } from 'lucide-react';
import type { WayfindingDirectory, WayfindingPoi } from '../lib/api';
import { t, loadWayfindingLang, pickName, pickCategoryLabel } from '../lib/wayfindingLang';

const FLOOR_DWELL_MS = 12_000;

type LucideComponent = React.ComponentType<{ size?: number; color?: string }>;

// Shared with WayfindingKioskMap's touch POI pins/detail card (Phase 7.2) — same lucide-name
// lookup, one place to keep it in sync if the icon set changes.
export function CategoryIcon({ name, size, color }: { name: string; size?: number; color?: string }) {
  const Icon = ((LucideIcons as unknown as Record<string, LucideComponent>)[name]) ?? MapPin;
  return <Icon size={size} color={color} />;
}

function groupByCategory(pois: WayfindingPoi[]): { category: WayfindingPoi['category']; pois: WayfindingPoi[] }[] {
  const groups = new Map<string, { category: WayfindingPoi['category']; pois: WayfindingPoi[] }>();
  for (const poi of pois) {
    const existing = groups.get(poi.category.id);
    if (existing) existing.pois.push(poi);
    else groups.set(poi.category.id, { category: poi.category, pois: [poi] });
  }
  return [...groups.values()].sort((a, b) => a.category.label.localeCompare(b.category.label));
}

// Non-touch boards have no toggle to switch language interactively, so they just read whatever
// language a touch kiosk on the same device (or a previous session) last left in localStorage —
// consistent with `WayfindingKioskMap`'s persisted lang choice rather than a second, disconnected
// language state for the passive board specifically.
function useDisplayLang() {
  const [lang] = useState(loadWayfindingLang);
  return lang;
}

// The non-touch directory board (Phase 7.1) — no interaction, just cycles through the
// building's floors on a timer so a passer-by eventually sees everything without needing to
// touch the screen. Each page groups that floor's POIs by category, same grouping a touch
// kiosk's on-screen directory (Phase 7.2) will offer as a filter.
export default function WayfindingDirectoryBoard({ directory }: { directory: WayfindingDirectory }) {
  const [floorIndex, setFloorIndex] = useState(0);
  const floors = directory.floors;
  const lang = useDisplayLang();

  useEffect(() => {
    setFloorIndex(0);
    if (floors.length < 2) return;
    const id = setInterval(() => setFloorIndex(i => (i + 1) % floors.length), FLOOR_DWELL_MS);
    return () => clearInterval(id);
  }, [floors]);

  if (floors.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.emptyText}>{t('noDirectoryData', lang)}</div>
      </div>
    );
  }

  // floors.length === 0 already returned above, and floorIndex is always kept in [0, floors.length)
  // by the rotation effect, so this index is never out of range.
  const floor = floors[floorIndex]!;
  const poisOnFloor = directory.pois.filter(p => p.floorId === floor.id);
  const groups = groupByCategory(poisOnFloor);
  const isKioskFloor = floor.id === directory.kiosk.floorId;

  return (
    <div style={styles.container} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <header style={styles.header}>
        <div style={styles.buildingName}>{directory.building.name}</div>
        <div style={styles.floorHeading}>
          {floor.label}
          {isKioskFloor && <span style={styles.hereBadge}>{t('youAreHere', lang)}</span>}
        </div>
      </header>

      <main style={styles.grid}>
        {groups.length === 0 ? (
          <div style={styles.emptyText}>{t('noListingsFloor', lang)}</div>
        ) : (
          groups.map(group => (
            <section key={group.category.id} style={styles.categoryCard}>
              <div style={styles.categoryHeader}>
                <CategoryIcon name={group.category.icon} size={28} color={group.category.color} />
                <span style={{ ...styles.categoryLabel, color: group.category.color }}>{pickCategoryLabel(group.category, lang)}</span>
              </div>
              <ul style={styles.poiList}>
                {group.pois.map(poi => (
                  <li key={poi.id} style={styles.poiRow}>
                    <span style={poi.status === 'OPEN' ? undefined : styles.poiInactive}>{pickName(poi, lang)}</span>
                    {poi.status !== 'OPEN' && (
                      <span style={styles.statusTag}>{poi.status === 'CLOSED' ? t('closed', lang) : t('relocated', lang)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </main>

      {floors.length > 1 && (
        <footer style={styles.dots}>
          {floors.map((f, i) => (
            <span key={f.id} style={i === floorIndex ? styles.dotActive : styles.dot} />
          ))}
        </footer>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
    background: '#0f172a', color: '#f1f5f9', fontFamily: 'system-ui, sans-serif',
    padding: '3vh 3vw', boxSizing: 'border-box',
  },
  header: { flex: '0 0 auto', marginBottom: '2vh' },
  buildingName: { fontSize: '2.2vw', fontWeight: 600, opacity: 0.7, letterSpacing: '0.03em' },
  floorHeading: { fontSize: '4vw', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '1.5vw' },
  hereBadge: {
    fontSize: '1.4vw', fontWeight: 700, background: '#2563eb', color: '#fff',
    padding: '0.4vh 1vw', borderRadius: 999,
  },
  grid: {
    flex: '1 1 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: '2vw 2.5vw', overflow: 'hidden', alignContent: 'start',
  },
  categoryCard: { background: 'rgba(255,255,255,0.06)', borderRadius: 16, padding: '2vh 1.5vw' },
  categoryHeader: { display: 'flex', alignItems: 'center', gap: '0.8vw', marginBottom: '1.2vh' },
  categoryLabel: { fontSize: '1.8vw', fontWeight: 700 },
  poiList: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.8vh' },
  poiRow: { fontSize: '1.5vw', display: 'flex', alignItems: 'center', gap: '0.6vw' },
  poiInactive: { opacity: 0.5, textDecoration: 'line-through' },
  statusTag: {
    fontSize: '1vw', fontWeight: 700, textTransform: 'uppercase', color: '#fbbf24',
    border: '1px solid #fbbf24', borderRadius: 6, padding: '0.1vh 0.5vw',
  },
  emptyText: { fontSize: '2vw', opacity: 0.6, margin: 'auto' },
  dots: { flex: '0 0 auto', display: 'flex', justifyContent: 'center', gap: '0.6vw', paddingTop: '2vh' },
  dot: { width: '0.8vw', height: '0.8vw', borderRadius: '50%', background: 'rgba(255,255,255,0.25)' },
  dotActive: { width: '0.8vw', height: '0.8vw', borderRadius: '50%', background: '#2563eb' },
};
