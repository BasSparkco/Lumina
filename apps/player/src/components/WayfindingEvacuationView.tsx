import { useEffect, useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { WayfindingDirectory } from '../lib/api';
import { findNearestNode, computeRoute, buildDirectionSteps } from '../lib/routing';
import { loadWayfindingLang, t } from '../lib/wayfindingLang';
import { speakSteps } from '../lib/tts';

interface Point { x: number; y: number }

// Fire/evacuation mode (7.4) — reuses Screen.emergencyActive exactly like every other emergency
// override in this app, no parallel system. PlayerPage swaps this in for a WAYFINDING screen
// whenever emergencyActive is set with no explicit emergencyPlaylist chosen (an admin can still
// override a specific kiosk with a playlist the normal way). Routes to the nearest POI whose
// category is labeled "Exit" — the same system/custom preset every building already has from 7.1
// — explicitly avoiding ELEVATOR edges (never take a lift during a fire), the mirror image of
// 7.3's accessible-mode STAIRS exclusion. Auto-reads the directions aloud on entry since a
// evacuation banner people are meant to react to instantly, not read at a normal pace.
export default function WayfindingEvacuationView({ directory }: { directory: WayfindingDirectory }) {
  const lang = loadWayfindingLang();
  const floor = directory.floors.find(f => f.id === directory.kiosk.floorId) ?? directory.floors[0] ?? null;

  const nearestExit = useMemo(() => {
    const exits = directory.pois.filter(p => p.category.label.toLowerCase() === 'exit');
    if (!exits.length) return null;
    const sameFloor = exits.filter(p => p.floorId === directory.kiosk.floorId);
    const pool = sameFloor.length ? sameFloor : exits;
    let best = pool[0]!;
    let bestDist = Infinity;
    for (const p of pool) {
      const d = p.floorId === directory.kiosk.floorId ? Math.hypot(p.x - directory.kiosk.x, p.y - directory.kiosk.y) : 0;
      if (d < bestDist) { bestDist = d; best = p; }
    }
    return best;
  }, [directory]);

  const kioskNode = useMemo(
    () => findNearestNode(directory.routeNodes, directory.kiosk.floorId, directory.kiosk.x, directory.kiosk.y),
    [directory],
  );
  const exitNode = useMemo(
    () => (nearestExit ? findNearestNode(directory.routeNodes, nearestExit.floorId, nearestExit.x, nearestExit.y) : null),
    [directory, nearestExit],
  );
  const route = useMemo(() => {
    if (!kioskNode || !exitNode) return null;
    return computeRoute(directory.routeNodes, directory.routeEdges, kioskNode.id, exitNode.id, { avoidElevators: true });
  }, [directory, kioskNode, exitNode]);
  const steps = useMemo(
    () => (route && nearestExit ? buildDirectionSteps(route, directory.floors, nearestExit.name, lang) : []),
    [route, nearestExit, directory.floors, lang],
  );

  const floorRoutePoints = useMemo((): Point[] => {
    if (!route || !nearestExit || !floor) return [];
    const onThisFloor = route.nodes.filter(n => n.floorId === floor.id);
    if (!onThisFloor.length) return [];
    const points: Point[] = [];
    const isFirstLeg = route.nodes[0]?.id === onThisFloor[0]?.id;
    const isLastLeg = route.nodes[route.nodes.length - 1]?.id === onThisFloor[onThisFloor.length - 1]?.id;
    if (isFirstLeg && floor.id === directory.kiosk.floorId) points.push({ x: directory.kiosk.x, y: directory.kiosk.y });
    points.push(...onThisFloor.map(n => ({ x: n.x, y: n.y })));
    if (isLastLeg && floor.id === nearestExit.floorId) points.push({ x: nearestExit.x, y: nearestExit.y });
    return points;
  }, [route, nearestExit, floor, directory.kiosk]);

  // Auto-read once when evacuation mode starts (and again if the computed route itself changes,
  // e.g. a POI status update mid-drill) — an evacuation banner is meant to be reacted to
  // instantly, not opted into via a button the way the normal directions panel's readout is.
  useEffect(() => {
    if (steps.length) speakSteps(steps, lang);
  }, [steps, lang]);

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <AlertTriangle size={40} color="#fff" />
        <div>
          <div style={styles.title}>{t('evacuate', lang)}</div>
          <div style={styles.subtitle}>{t('evacuateSub', lang)}</div>
        </div>
      </header>

      <div style={styles.body}>
        <div style={styles.mapPane}>
          {floor?.floorPlanUrl ? (
            <div style={styles.mapWrap}>
              <img src={floor.floorPlanUrl} alt="" style={styles.mapImage} />
              {floorRoutePoints.length > 1 && (
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={styles.routeSvg}>
                  <polyline
                    points={floorRoutePoints.map(p => `${p.x},${p.y}`).join(' ')}
                    fill="none" stroke="#fff" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round"
                  />
                </svg>
              )}
              {floor.id === directory.kiosk.floorId && (
                <div style={{ ...styles.here, left: `${directory.kiosk.x}%`, top: `${directory.kiosk.y}%` }} />
              )}
              {nearestExit?.floorId === floor.id && (
                <div style={{ ...styles.exitDot, left: `${nearestExit.x}%`, top: `${nearestExit.y}%` }} />
              )}
            </div>
          ) : (
            <div style={styles.noMap}>{t('noFloorPlan', lang)}</div>
          )}
        </div>

        <ol style={styles.stepsList}>
          {(steps.length ? steps : [t('noExitFound', lang)]).map((step, i) => (
            <li key={i} style={styles.stepItem}>
              <span style={styles.stepNumber}>{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
    background: '#7f1d1d', color: '#fff', fontFamily: 'system-ui, sans-serif',
  },
  header: {
    flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: '1.5vw',
    padding: '3vh 3vw', background: '#991b1b', borderBottom: '4px solid #fca5a5',
  },
  title: { fontSize: '3vw', fontWeight: 900, letterSpacing: '0.03em' },
  subtitle: { fontSize: '1.6vw', fontWeight: 600, opacity: 0.9, marginTop: '0.5vh' },
  body: { flex: '1 1 auto', display: 'flex', gap: '2vw', padding: '3vh 3vw', minHeight: 0 },
  mapPane: { flex: '1 1 55%', position: 'relative', minHeight: 0 },
  mapWrap: { position: 'relative', width: '100%', height: '100%' },
  mapImage: { width: '100%', height: '100%', objectFit: 'contain', display: 'block' },
  routeSvg: { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' },
  here: {
    position: 'absolute', width: 28, height: 28, borderRadius: '50%', background: '#2563eb',
    border: '3px solid white', transform: 'translate(-50%, -50%)',
  },
  exitDot: {
    position: 'absolute', width: 28, height: 28, borderRadius: '50%', background: '#22c55e',
    border: '3px solid white', transform: 'translate(-50%, -50%)',
  },
  noMap: {
    width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '1.6vw', opacity: 0.7, border: '1px dashed rgba(255,255,255,0.3)', borderRadius: 12,
  },
  stepsList: {
    flex: '1 1 45%', listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column',
    gap: '2vh', overflowY: 'auto',
  },
  stepItem: { display: 'flex', alignItems: 'flex-start', gap: '1.2vw', fontSize: '2vw', fontWeight: 700, lineHeight: 1.4 },
  stepNumber: {
    flex: '0 0 auto', width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.2)',
    fontSize: '1.6vw', fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
};
