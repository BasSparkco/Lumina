import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Locate, Search, Navigation, Accessibility, QrCode, Languages, Type, Volume2, VolumeX, Sparkles } from 'lucide-react';
import type { PlayerState, WayfindingPoi } from '../lib/api';
import { CategoryIcon } from './WayfindingDirectoryBoard';
import WayfindingDirectoryPanel from './WayfindingDirectoryPanel';
import WayfindingAiAssistant from './WayfindingAiAssistant';
import QrCodeWidget from './QrCodeWidget';
import ZonePlayer from './ZonePlayer';
import ThemeRenderer from './ThemeRenderer';
import { findNearestNode, computeRoute, buildDirectionSteps } from '../lib/routing';
import {
  type WayfindingLang, t, loadWayfindingLang, saveWayfindingLang, pickName, pickDescription, pickCategoryLabel,
} from '../lib/wayfindingLang';
import { ttsSupported, speakSteps, stopSpeaking } from '../lib/tts';
import { logKioskEvent } from '../lib/kioskAnalytics';

const A11Y_STORAGE_KEY = 'lumina-wayfinding-a11y';
function loadAccessibleMode(): boolean {
  return typeof window !== 'undefined' && window.localStorage.getItem(A11Y_STORAGE_KEY) === '1';
}
function saveAccessibleMode(on: boolean) {
  if (typeof window !== 'undefined') window.localStorage.setItem(A11Y_STORAGE_KEY, on ? '1' : '0');
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const TAP_MOVE_THRESHOLD_PX = 10;
const TAP_MAX_DURATION_MS = 400;
const DOUBLE_TAP_WINDOW_MS = 300;
const PIN_PX = 40;
const HERE_PX = 26;
const STAGE_PADDING = 0.92; // fraction of the viewport the floor plan is allowed to fill at scale=1
// Idle/attract-loop (Phase 7.2) — standard kiosk UX: after this long with no touch, fall back to
// promo content instead of just sitting on the map. Not configurable per-kiosk (yet) — one
// reasonable default beats a setting nobody will find.
const IDLE_ATTRACT_MS = 90_000;

interface Point { x: number; y: number }
interface Transform { scale: number; tx: number; ty: number }
const IDENTITY: Transform = { scale: 1, tx: 0, ty: 0 };

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function midpoint(a: Point, b: Point) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// Touch-capable interactive kiosk view (Phase 7.2) — pinch/drag pan+zoom on the floor plan,
// tap a pin for a detail card. Also works with a plain mouse (dev/testing, or a non-touch panel
// someone still points at this view) since it's built on pointer events, not touch events.
//
// Geometry: `stageWrap` is pinned exactly to the viewport (inset: 0) and carries the pan/zoom
// CSS transform with transformOrigin '0 0' — that keeps its own untransformed origin coincident
// with the viewport's, so pointer-to-content math never has to account for flex-centering
// offsets. The `stage` box inside it is sized in JS to the image's aspect ratio (contain-fit,
// like PoiMapEditor's canvas), so POI percentage coordinates line up with the rendered image
// exactly the same way they do in the dashboard's placement editor.
export default function WayfindingKioskMap({ state, onAssetChange }: { state: PlayerState; onAssetChange: (id: string) => void }) {
  const directory = state.wayfinding!;
  const [floorId, setFloorId] = useState(directory.kiosk.floorId);
  const [transform, setTransform] = useState<Transform>(IDENTITY);
  const [selectedPoi, setSelectedPoiRaw] = useState<WayfindingPoi | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [aspect, setAspect] = useState(4 / 3);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [attractActive, setAttractActive] = useState(false);
  const [routeOpen, setRouteOpen] = useState(false);
  const [accessibleRoute, setAccessibleRoute] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  // Multi-language directory switching (7.4) — persisted per-kiosk so a mall that sets a device
  // to Arabic keeps it that way across restarts, same rationale as the accessibility toggle below.
  const [lang, setLangRaw] = useState<WayfindingLang>(loadWayfindingLang);
  const setLang = useCallback((l: WayfindingLang) => { setLangRaw(l); saveWayfindingLang(l); }, []);
  // Larger-touch-target accessibility mode (7.4) — scales up the interactive chrome (buttons,
  // pins, step text); the floor plan/pins already share the percentage-canvas coordinate space
  // so scaling touch targets doesn't affect placement accuracy, only their rendered/hit size.
  const [accessible, setAccessibleRaw] = useState<boolean>(loadAccessibleMode);
  const setAccessible = useCallback((on: boolean) => { setAccessibleRaw(on); saveAccessibleMode(on); }, []);
  const [speaking, setSpeaking] = useState(false);
  const A = accessible ? 1.35 : 1;

  // A fresh POI selection always starts back at the plain detail card, not mid-route/QR state
  // left over from whichever POI was picked before it.
  const setSelectedPoi = useCallback((poi: WayfindingPoi | null) => {
    setSelectedPoiRaw(poi);
    setRouteOpen(false);
    setQrOpen(false);
    stopSpeaking();
    setSpeaking(false);
    if (poi) logKioskEvent('POI_VIEW', { poiId: poi.id, poiName: poi.name });
  }, []);

  // Kiosk analytics (7.4) — one session-start event per mount; a kiosk isn't expected to remount
  // mid-visit, so this is effectively "a visitor arrived at this kiosk."
  useEffect(() => { logKioskEvent('SESSION_START'); }, []);

  const hasAttractContent = !!directory.attractPlaylist || !!directory.attractTheme;
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (!hasAttractContent) return;
    idleTimerRef.current = setTimeout(() => setAttractActive(true), IDLE_ATTRACT_MS);
  }, [hasAttractContent]);

  useEffect(() => {
    resetIdleTimer();
    return () => { if (idleTimerRef.current) clearTimeout(idleTimerRef.current); };
  }, [resetIdleTimer]);

  // Any touch anywhere in the kiosk UI (map, directory panel, keyboard, detail card) both wakes
  // it back up from attract mode and pushes the next idle deadline out — capture phase so it
  // fires regardless of which child actually handles the tap.
  const wakeFromAttract = useCallback(() => {
    setAttractActive(false);
    resetIdleTimer();
  }, [resetIdleTimer]);

  const containerRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef<Map<number, Point>>(new Map());
  const gestureRef = useRef<{ startX: number; startY: number; startTime: number; moved: boolean; pinching: boolean }>({
    startX: 0, startY: 0, startTime: 0, moved: false, pinching: false,
  });
  const pinchRef = useRef<{ dist: number; mid: Point } | null>(null);
  const lastTapRef = useRef<{ x: number; y: number; time: number } | null>(null);
  // Set right before a directory-panel pick changes `floorId`, so the reset effect below (which
  // exists for the floor-*tab* case, where landing on a blank unzoomed view is correct) skips
  // clobbering the selection a directory pick is about to make on the new floor.
  const skipNextFloorResetRef = useRef(false);

  const floor = directory.floors.find(f => f.id === floorId) ?? directory.floors[0] ?? null;
  const poisOnFloor = directory.pois.filter(p => p.floorId === floor?.id);
  const isKioskFloor = floor?.id === directory.kiosk.floorId;

  // Route finding (Phase 7.3) — POIs aren't graph nodes, so routing snaps to whichever node sits
  // nearest the kiosk's own pin and nearest the selected POI's pin, then searches between those.
  const kioskNode = useMemo(
    () => findNearestNode(directory.routeNodes, directory.kiosk.floorId, directory.kiosk.x, directory.kiosk.y),
    [directory],
  );
  const destinationNode = useMemo(
    () => (selectedPoi ? findNearestNode(directory.routeNodes, selectedPoi.floorId, selectedPoi.x, selectedPoi.y) : null),
    [directory, selectedPoi],
  );
  const route = useMemo(() => {
    if (!kioskNode || !destinationNode) return null;
    return computeRoute(directory.routeNodes, directory.routeEdges, kioskNode.id, destinationNode.id, { accessible: accessibleRoute });
  }, [directory, kioskNode, destinationNode, accessibleRoute]);
  const directionSteps = useMemo(
    () => (route && selectedPoi ? buildDirectionSteps(route, directory.floors, pickName(selectedPoi, lang), lang) : []),
    [route, selectedPoi, directory.floors, lang],
  );

  // The portion of the computed path that falls on the floor currently on screen, so switching
  // floor tabs re-draws just that floor's segment — plus the kiosk's exact pin (not the nearest
  // node) as the true start, and the POI's exact pin as the true end, so the drawn line touches
  // the actual "you are here" marker and pin rather than stopping short at the nearest graph node.
  const floorRoutePoints = useMemo((): Point[] => {
    if (!route || !selectedPoi || !floor) return [];
    const onThisFloor = route.nodes.filter(n => n.floorId === floor.id);
    if (!onThisFloor.length) return [];
    const points: Point[] = [];
    const isFirstLeg = route.nodes[0]?.id === onThisFloor[0]?.id;
    const isLastLeg = route.nodes[route.nodes.length - 1]?.id === onThisFloor[onThisFloor.length - 1]?.id;
    if (isFirstLeg && floor.id === directory.kiosk.floorId) points.push({ x: directory.kiosk.x, y: directory.kiosk.y });
    points.push(...onThisFloor.map(n => ({ x: n.x, y: n.y })));
    if (isLastLeg && floor.id === selectedPoi.floorId) points.push({ x: selectedPoi.x, y: selectedPoi.y });
    return points;
  }, [route, selectedPoi, floor, directory.kiosk]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setViewportSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // While a route is open, switching floor tabs is how a visitor follows a cross-floor route
  // along — it must not drop the destination/route state the way an ordinary floor browse does.
  // Read via a ref (not a dependency) so toggling routeOpen itself doesn't also fire this effect
  // and reset the pan/zoom transform.
  const routeOpenRef = useRef(false);
  useEffect(() => { routeOpenRef.current = routeOpen; }, [routeOpen]);

  useEffect(() => {
    if (skipNextFloorResetRef.current) {
      skipNextFloorResetRef.current = false;
      return;
    }
    setTransform(IDENTITY);
    setAspect(4 / 3);
    if (!routeOpenRef.current) setSelectedPoi(null);
  }, [floorId, setSelectedPoi]);

  const selectFromDirectory = useCallback((poi: WayfindingPoi) => {
    setDirectoryOpen(false);
    if (poi.floorId !== floorId) {
      skipNextFloorResetRef.current = true;
      setTransform(IDENTITY);
      setAspect(4 / 3);
      setFloorId(poi.floorId);
    }
    setSelectedPoi(poi);
  }, [floorId, setSelectedPoi]);

  const clampTransform = useCallback((t: Transform): Transform => {
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.scale));
    const overpan = 80; // px of slack past the edge, so the map doesn't feel glued shut
    const maxTx = ((scale - 1) * viewportSize.width) / 2 + overpan;
    const maxTy = ((scale - 1) * viewportSize.height) / 2 + overpan;
    return {
      scale,
      tx: scale <= MIN_SCALE ? 0 : Math.min(maxTx, Math.max(-maxTx, t.tx)),
      ty: scale <= MIN_SCALE ? 0 : Math.min(maxTy, Math.max(-maxTy, t.ty)),
    };
  }, [viewportSize]);

  // Rescale around a fixed viewport-local point (pinch midpoint, double-tap point) — the
  // standard "translate then scale" anchor formula, valid because stageWrap's untransformed
  // origin is pinned to the viewport's (see geometry note above).
  const rescaleAround = useCallback((local: Point, targetScale: number, base: Transform): Transform => {
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, targetScale));
    const ratio = scale / base.scale;
    return {
      scale,
      tx: local.x - (local.x - base.tx) * ratio,
      ty: local.y - (local.y - base.ty) * ratio,
    };
  }, []);

  const resetView = useCallback(() => setTransform(IDENTITY), []);

  const hitTestPoi = useCallback((clientX: number, clientY: number) => {
    const el = document.elementFromPoint(clientX, clientY);
    const pinEl = el instanceof Element ? el.closest('[data-poi-id]') : null;
    const poiId = pinEl?.getAttribute('data-poi-id');
    if (!poiId) return null;
    return poisOnFloor.find(p => p.id === poiId) ?? null;
  }, [poisOnFloor]);

  const handlePointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 1) {
      gestureRef.current = { startX: e.clientX, startY: e.clientY, startTime: Date.now(), moved: false, pinching: false };
      pinchRef.current = null;
    } else if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      pinchRef.current = { dist: distance(a!, b!), mid: midpoint(a!, b!) };
      gestureRef.current.pinching = true;
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const prev = pointersRef.current.get(e.pointerId);
    if (!prev) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      const dist = distance(a!, b!);
      const mid = midpoint(a!, b!);
      const prevPinch = pinchRef.current;
      if (prevPinch) {
        setTransform(t => {
          const rescaled = rescaleAround({ x: mid.x - rect.left, y: mid.y - rect.top }, t.scale * (dist / prevPinch.dist), t);
          // Pinch also pans if the midpoint itself drifts (fingers moving together), on top of
          // the zoom-anchor translation already baked into `rescaled`.
          return clampTransform({
            ...rescaled,
            tx: rescaled.tx + (mid.x - prevPinch.mid.x),
            ty: rescaled.ty + (mid.y - prevPinch.mid.y),
          });
        });
      }
      pinchRef.current = { dist, mid };
      gestureRef.current.moved = true;
      return;
    }

    if (pointersRef.current.size === 1 && !gestureRef.current.pinching) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      if (Math.abs(e.clientX - gestureRef.current.startX) > TAP_MOVE_THRESHOLD_PX ||
          Math.abs(e.clientY - gestureRef.current.startY) > TAP_MOVE_THRESHOLD_PX) {
        gestureRef.current.moved = true;
      }
      setTransform(t => clampTransform({ ...t, tx: t.tx + dx, ty: t.ty + dy }));
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId);

    if (pointersRef.current.size === 1) {
      // Coming down from a pinch to a single remaining finger — resume that finger as a fresh
      // pan start rather than jumping using its stale pinch-time position.
      const [remaining] = [...pointersRef.current.entries()];
      pointersRef.current.set(remaining![0], remaining![1]);
      gestureRef.current = { startX: remaining![1].x, startY: remaining![1].y, startTime: Date.now(), moved: true, pinching: false };
      pinchRef.current = null;
      return;
    }
    if (pointersRef.current.size > 0) return;

    pinchRef.current = null;
    const g = gestureRef.current;
    const wasTap = !g.moved && !g.pinching && Date.now() - g.startTime < TAP_MAX_DURATION_MS;
    if (!wasTap) return;

    const poi = hitTestPoi(e.clientX, e.clientY);
    if (poi) {
      setSelectedPoi(poi);
      lastTapRef.current = null;
      return;
    }

    // Background tap: dismiss any open detail card; otherwise treat a quick double-tap as a
    // zoom toggle, the mouse/touch-friendly alternative to pinch for zooming in.
    if (selectedPoi) {
      setSelectedPoi(null);
      lastTapRef.current = null;
      return;
    }
    const last = lastTapRef.current;
    const point = { x: e.clientX, y: e.clientY };
    if (last && Date.now() - last.time < DOUBLE_TAP_WINDOW_MS && distance(last, point) < TAP_MOVE_THRESHOLD_PX * 2) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const local = { x: point.x - rect.left, y: point.y - rect.top };
        setTransform(t => clampTransform(rescaleAround(local, t.scale > MIN_SCALE + 0.01 ? MIN_SCALE : 2.2, t)));
      }
      lastTapRef.current = null;
    } else {
      lastTapRef.current = { ...point, time: Date.now() };
    }
  };

  if (!floor) {
    return (
      <div style={styles.container}>
        <div style={styles.emptyText}>{t('noDirectoryData', lang)}</div>
      </div>
    );
  }

  // Contain-fit the floor plan's aspect ratio inside the viewport, same math as
  // object-fit: contain, done in JS so the pin/marker percentage layer can share the box.
  const fitWidth = viewportSize.width * STAGE_PADDING;
  const fitHeight = viewportSize.height * STAGE_PADDING;
  const stageSize = viewportSize.width > 0 && viewportSize.height > 0
    ? (fitWidth / fitHeight > aspect
        ? { width: fitHeight * aspect, height: fitHeight }
        : { width: fitWidth, height: fitWidth / aspect })
    : { width: 0, height: 0 };

  return (
    <div style={styles.container} dir={lang === 'ar' ? 'rtl' : 'ltr'} onPointerDownCapture={wakeFromAttract}>
      <style>{keyframes}</style>
      <header style={styles.header}>
        <div style={styles.headerTop}>
          <div style={styles.buildingName}>{directory.building.name}</div>
          <div style={styles.headerActions}>
            <button
              style={{ ...styles.iconToggle, ...(accessible ? styles.iconToggleActive : null) }}
              onClick={() => setAccessible(!accessible)}
              title={t('accessibilityMode', lang)}
            >
              <Type size={18} />
            </button>
            <button style={styles.iconToggle} onClick={() => setLang(lang === 'en' ? 'ar' : 'en')} title="EN / AR">
              <Languages size={18} />
              <span style={styles.langLabel}>{lang.toUpperCase()}</span>
            </button>
            {directory.aiAssistant && (
              <button
                style={{ ...styles.aiButton, fontSize: `${1.1 * A}vw`, padding: `${0.9 * A}vh ${1.4 * A}vw` }}
                onClick={() => setAiOpen(true)}
              >
                <Sparkles size={18 * A} />
                {lang === 'ar' ? 'اسأل المساعد' : 'Ask the Assistant'}
              </button>
            )}
            <button style={{ ...styles.directoryButton, fontSize: `${1.1 * A}vw`, padding: `${0.9 * A}vh ${1.4 * A}vw` }} onClick={() => setDirectoryOpen(true)}>
              <Search size={18 * A} color="#0f172a" />
              {t('directory', lang)}
            </button>
          </div>
        </div>
        {directory.floors.length > 1 && (
          <div style={styles.tabs}>
            {directory.floors.map(f => (
              <button
                key={f.id}
                onClick={() => setFloorId(f.id)}
                style={{
                  ...(f.id === floorId ? styles.tabActive : styles.tab),
                  fontSize: `${1.2 * A}vw`, padding: `${0.8 * A}vh ${1.4 * A}vw`,
                }}
              >
                {f.label}
                {f.id === directory.kiosk.floorId && <span style={styles.tabDot} />}
              </button>
            ))}
          </div>
        )}
      </header>

      <div
        ref={containerRef}
        style={styles.viewport}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div
          style={{
            ...styles.stageWrap,
            transform: `translate(${transform.tx}px, ${transform.ty}px) scale(${transform.scale})`,
          }}
        >
          {stageSize.width > 0 && (
            <div style={{ ...styles.stage, width: stageSize.width, height: stageSize.height }}>
              {floor.floorPlanUrl ? (
                <img
                  src={floor.floorPlanUrl}
                  alt=""
                  draggable={false}
                  style={styles.stageImage}
                  onLoad={(e) => {
                    const { naturalWidth, naturalHeight } = e.currentTarget;
                    if (naturalWidth && naturalHeight) setAspect(naturalWidth / naturalHeight);
                  }}
                />
              ) : (
                <div style={styles.noFloorPlan}>{t('noFloorPlan', lang)}</div>
              )}

              {routeOpen && floorRoutePoints.length > 1 && (
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={styles.routeSvg}>
                  <polyline
                    points={floorRoutePoints.map(p => `${p.x},${p.y}`).join(' ')}
                    fill="none" stroke="#22c55e" strokeWidth={0.8} strokeLinecap="round" strokeLinejoin="round"
                  />
                </svg>
              )}

              {poisOnFloor.map(poi => (
                <button
                  key={poi.id}
                  data-poi-id={poi.id}
                  style={{
                    ...styles.pin,
                    left: `${poi.x}%`,
                    top: `${poi.y}%`,
                    opacity: poi.status === 'OPEN' ? 1 : 0.55,
                  }}
                >
                  <span style={{ ...styles.pinDot, width: PIN_PX * A, height: PIN_PX * A, background: poi.category.color }}>
                    <CategoryIcon name={poi.category.icon} size={18 * A} color="#fff" />
                  </span>
                </button>
              ))}

              {isKioskFloor && (
                <div style={{ ...styles.here, left: `${directory.kiosk.x}%`, top: `${directory.kiosk.y}%` }}>
                  <span style={{
                    ...styles.hereRing, width: HERE_PX * 2 * A, height: HERE_PX * 2 * A,
                    marginLeft: -HERE_PX * A, marginTop: -HERE_PX * A,
                  }}
                  />
                  <span style={{
                    ...styles.hereDot, width: HERE_PX * A, height: HERE_PX * A,
                    marginLeft: (-HERE_PX * A) / 2, marginTop: (-HERE_PX * A) / 2,
                  }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {transform.scale > MIN_SCALE + 0.01 && (
        <button style={styles.resetButton} onClick={resetView}>
          <Locate size={20} color="#0f172a" />
        </button>
      )}

      {selectedPoi && !routeOpen && (
        <>
          <div style={styles.backdrop} onClick={() => setSelectedPoi(null)} />
          <div style={styles.card}>
            <button style={styles.cardClose} onClick={() => setSelectedPoi(null)}>
              <X size={22} color="#f1f5f9" />
            </button>
            <div style={styles.cardHeader}>
              <span style={{ ...styles.cardIcon, background: selectedPoi.category.color }}>
                <CategoryIcon name={selectedPoi.category.icon} size={26} color="#fff" />
              </span>
              <div>
                <div style={styles.cardName}>{pickName(selectedPoi, lang)}</div>
                <div style={{ ...styles.cardCategory, color: selectedPoi.category.color }}>
                  {pickCategoryLabel(selectedPoi.category, lang)} · {selectedPoi.floorLabel}
                </div>
              </div>
              {selectedPoi.status !== 'OPEN' && (
                <span style={styles.cardStatusTag}>
                  {selectedPoi.status === 'CLOSED' ? t('closed', lang) : t('relocated', lang)}
                </span>
              )}
            </div>
            {pickDescription(selectedPoi, lang) && <p style={styles.cardDescription}>{pickDescription(selectedPoi, lang)}</p>}
            {route && (
              <button style={styles.directionsButton} onClick={() => setRouteOpen(true)}>
                <Navigation size={18} /> {t('directions', lang)}
              </button>
            )}
          </div>
        </>
      )}

      {selectedPoi && routeOpen && route && (
        <>
          <div style={styles.backdrop} onClick={() => setSelectedPoi(null)} />
          <div style={styles.card}>
            <button style={styles.cardClose} onClick={() => setSelectedPoi(null)}>
              <X size={22} color="#f1f5f9" />
            </button>
            <div style={styles.cardHeader}>
              <span style={{ ...styles.cardIcon, background: selectedPoi.category.color }}>
                <Navigation size={26} color="#fff" />
              </span>
              <div>
                <div style={styles.cardName}>{t('directionsTo', lang)} {pickName(selectedPoi, lang)}</div>
                <div style={{ ...styles.cardCategory, color: selectedPoi.category.color }}>
                  {directionSteps.length} {directionSteps.length === 1 ? t('step', lang) : t('steps', lang)}
                </div>
              </div>
              {ttsSupported() && (
                <button
                  style={{ ...styles.ttsToggle, ...(speaking ? styles.accessibleToggleActive : null) }}
                  onClick={() => {
                    if (speaking) { stopSpeaking(); setSpeaking(false); }
                    else { setSpeaking(true); speakSteps(directionSteps, lang, () => setSpeaking(false)); }
                  }}
                  title={speaking ? t('stopReading', lang) : t('readAloud', lang)}
                >
                  {speaking ? <VolumeX size={20} /> : <Volume2 size={20} />}
                </button>
              )}
              <button
                style={{ ...styles.accessibleToggle, ...(accessibleRoute ? styles.accessibleToggleActive : null) }}
                onClick={() => setAccessibleRoute(v => !v)}
                title={t('wheelchairAccessible', lang)}
              >
                <Accessibility size={20} />
              </button>
            </div>
            <ol style={styles.stepsList}>
              {directionSteps.map((step, i) => (
                <li key={i} style={{ ...styles.stepItem, fontSize: `${1.3 * A}vw` }}>
                  <span style={styles.stepNumber}>{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            <button style={styles.directionsButton} onClick={() => setQrOpen(true)}>
              <QrCode size={18} /> {t('continueOnPhone', lang)}
            </button>
          </div>
        </>
      )}

      {qrOpen && route && selectedPoi && (
        <>
          <div style={styles.backdrop} onClick={() => setQrOpen(false)} />
          <div style={styles.qrCard}>
            <button style={styles.cardClose} onClick={() => setQrOpen(false)}>
              <X size={22} color="#f1f5f9" />
            </button>
            <div style={styles.qrTitle}>{t('scanToTake', lang)}</div>
            <div style={styles.qrBox}>
              <QrCodeWidget
                value={`${t('directionsTo', lang)} ${selectedPoi.name} (${directory.building.name}):\n${directionSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`}
                color="#0f172a"
                background="#ffffff"
              />
            </div>
          </div>
        </>
      )}

      {directoryOpen && (
        <WayfindingDirectoryPanel
          directory={directory}
          lang={lang}
          onClose={() => setDirectoryOpen(false)}
          onSelect={selectFromDirectory}
        />
      )}

      {aiOpen && directory.aiAssistant && (
        <WayfindingAiAssistant
          directory={directory}
          lang={lang}
          attractActive={attractActive}
          kioskNode={kioskNode}
          onClose={() => setAiOpen(false)}
          onSelect={selectFromDirectory}
          onUseDirectory={() => { setAiOpen(false); setDirectoryOpen(true); }}
        />
      )}

      {attractActive && (directory.attractPlaylist ?? directory.attractTheme) && (
        <div style={styles.attractOverlay}>
          {directory.attractTheme ? (
            <ThemeRenderer theme={directory.attractTheme} state={state} onAssetChange={onAssetChange} />
          ) : (
            <ZonePlayer playlist={directory.attractPlaylist!} volume={state.volume} onAssetChange={onAssetChange} />
          )}
          <div style={styles.attractHint}>{t('tapToBrowse', lang)}</div>
        </div>
      )}
    </div>
  );
}

const keyframes = `
@keyframes lumina-here-pulse {
  0% { transform: scale(0.6); opacity: 0.9; }
  100% { transform: scale(1.6); opacity: 0; }
}
`;

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
    background: '#0f172a', color: '#f1f5f9', fontFamily: 'system-ui, sans-serif',
    position: 'relative', overflow: 'hidden',
  },
  // Explicit z-index (not just DOM order) so the floor tabs stay clickable above the detail-card/
  // route-panel backdrop — a visitor following a cross-floor route needs to switch tabs while
  // the route panel is open, which the backdrop would otherwise block.
  header: { flex: '0 0 auto', padding: '2vh 3vw 1vh', boxSizing: 'border-box', position: 'relative', zIndex: 2 },
  headerTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1vw', marginBottom: '1vh' },
  buildingName: { fontSize: '1.6vw', fontWeight: 600, opacity: 0.7, letterSpacing: '0.03em' },
  headerActions: { display: 'flex', alignItems: 'center', gap: '0.6vw', flex: '0 0 auto' },
  iconToggle: {
    display: 'flex', alignItems: 'center', gap: '0.3vw', color: '#f1f5f9',
    background: 'rgba(255,255,255,0.1)', border: '2px solid rgba(255,255,255,0.15)', borderRadius: 999,
    padding: '0.7vh 0.9vw', cursor: 'pointer', fontSize: '1vw', fontWeight: 700,
  },
  iconToggleActive: { background: '#2563eb', borderColor: '#2563eb' },
  langLabel: { fontSize: '1vw', fontWeight: 700 },
  directoryButton: {
    display: 'flex', alignItems: 'center', gap: '0.5vw', fontSize: '1.1vw', fontWeight: 700,
    color: '#0f172a', background: '#f1f5f9', border: 'none', borderRadius: 999,
    padding: '0.9vh 1.4vw', cursor: 'pointer', flex: '0 0 auto',
  },
  aiButton: {
    display: 'flex', alignItems: 'center', gap: '0.5vw', fontSize: '1.1vw', fontWeight: 700,
    color: '#fff', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', border: 'none', borderRadius: 999,
    padding: '0.9vh 1.4vw', cursor: 'pointer', flex: '0 0 auto',
  },
  tabs: { display: 'flex', gap: '0.6vw', flexWrap: 'wrap' },
  tab: {
    fontSize: '1.2vw', fontWeight: 600, color: '#cbd5e1', background: 'rgba(255,255,255,0.08)',
    border: 'none', borderRadius: 999, padding: '0.8vh 1.4vw', cursor: 'pointer', position: 'relative',
  },
  tabActive: {
    fontSize: '1.2vw', fontWeight: 700, color: '#fff', background: '#2563eb',
    border: 'none', borderRadius: 999, padding: '0.8vh 1.4vw', cursor: 'pointer', position: 'relative',
  },
  tabDot: { display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#22c55e', marginInlineStart: 6 },
  viewport: { flex: '1 1 auto', position: 'relative', overflow: 'hidden', touchAction: 'none' },
  stageWrap: {
    position: 'absolute', inset: 0, transformOrigin: '0 0',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  stage: { position: 'relative' },
  stageImage: { width: '100%', height: '100%', objectFit: 'contain', userSelect: 'none', display: 'block' },
  noFloorPlan: {
    width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '1.4vw', opacity: 0.5, border: '1px dashed rgba(255,255,255,0.2)', borderRadius: 12, boxSizing: 'border-box',
  },
  pin: {
    position: 'absolute', transform: 'translate(-50%, -100%)', background: 'none', border: 'none',
    cursor: 'pointer', padding: 4, touchAction: 'none',
  },
  pinDot: {
    width: PIN_PX, height: PIN_PX, borderRadius: '50% 50% 50% 0', transform: 'rotate(45deg)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: '2px solid white', boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
  },
  here: { position: 'absolute', transform: 'translate(-50%, -50%)', pointerEvents: 'none' },
  hereRing: {
    position: 'absolute', top: '50%', left: '50%', width: HERE_PX * 2, height: HERE_PX * 2,
    marginLeft: -HERE_PX, marginTop: -HERE_PX, borderRadius: '50%',
    background: 'rgba(37, 99, 235, 0.45)', animation: 'lumina-here-pulse 2s ease-out infinite',
  },
  hereDot: {
    position: 'absolute', top: '50%', left: '50%', width: HERE_PX, height: HERE_PX,
    marginLeft: -HERE_PX / 2, marginTop: -HERE_PX / 2, borderRadius: '50%',
    background: '#2563eb', border: '3px solid white', boxShadow: '0 0 0 1px rgba(0,0,0,0.3)',
  },
  resetButton: {
    position: 'absolute', bottom: '3vh', insetInlineEnd: '3vw', width: 48, height: 48,
    borderRadius: '50%', background: '#f1f5f9', border: 'none', display: 'flex',
    alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 2px 10px rgba(0,0,0,0.4)',
  },
  backdrop: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' },
  card: {
    position: 'absolute', left: 0, right: 0, bottom: 0, background: '#1e293b',
    borderRadius: '20px 20px 0 0', padding: '3vh 3vw', boxSizing: 'border-box',
    boxShadow: '0 -4px 24px rgba(0,0,0,0.5)',
  },
  cardClose: {
    position: 'absolute', top: '2vh', insetInlineEnd: '3vw', background: 'rgba(255,255,255,0.1)',
    border: 'none', borderRadius: '50%', width: 40, height: 40, display: 'flex',
    alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
  },
  cardHeader: { display: 'flex', alignItems: 'center', gap: '1.2vw' },
  cardIcon: {
    width: 52, height: 52, borderRadius: 16, display: 'flex', alignItems: 'center',
    justifyContent: 'center', flex: '0 0 auto',
  },
  cardName: { fontSize: '2vw', fontWeight: 800 },
  cardCategory: { fontSize: '1.2vw', fontWeight: 600, marginTop: '0.4vh' },
  cardStatusTag: {
    marginInlineStart: 'auto', fontSize: '1vw', fontWeight: 700, textTransform: 'uppercase',
    color: '#fbbf24', border: '1px solid #fbbf24', borderRadius: 6, padding: '0.4vh 0.8vw', flex: '0 0 auto',
  },
  cardDescription: { fontSize: '1.3vw', lineHeight: 1.5, opacity: 0.85, marginTop: '2vh', marginBottom: 0 },
  emptyText: { fontSize: '2vw', opacity: 0.6, margin: 'auto' },
  attractOverlay: { position: 'absolute', inset: 0, background: '#000' },
  attractHint: {
    position: 'absolute', bottom: '4vh', left: '50%', transform: 'translateX(-50%)',
    fontSize: '1.3vw', fontWeight: 600, color: '#fff', background: 'rgba(0,0,0,0.55)',
    padding: '1vh 2vw', borderRadius: 999, whiteSpace: 'nowrap',
  },
  routeSvg: { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' },
  directionsButton: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6vw', width: '100%',
    marginTop: '2vh', fontSize: '1.3vw', fontWeight: 700, color: '#0f172a', background: '#22c55e',
    border: 'none', borderRadius: 999, padding: '1.4vh 0', cursor: 'pointer',
  },
  accessibleToggle: {
    position: 'absolute', top: '2vh', insetInlineEnd: 'calc(3vw + 52px)',
    width: 40, height: 40, borderRadius: '50%',
    border: '2px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)', color: '#f1f5f9',
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
  },
  accessibleToggleActive: { background: '#2563eb', borderColor: '#2563eb', color: '#fff' },
  ttsToggle: {
    position: 'absolute', top: '2vh', insetInlineEnd: 'calc(3vw + 104px)',
    width: 40, height: 40, borderRadius: '50%',
    border: '2px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)', color: '#f1f5f9',
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
  },
  stepsList: { listStyle: 'none', margin: '2vh 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: '1.2vh' },
  stepItem: { display: 'flex', alignItems: 'flex-start', gap: '1vw', fontSize: '1.3vw', lineHeight: 1.4 },
  stepNumber: {
    flex: '0 0 auto', width: 26, height: 26, borderRadius: '50%', background: 'rgba(34,197,94,0.2)',
    color: '#22c55e', fontWeight: 800, fontSize: '1.05vw', display: 'flex', alignItems: 'center',
    justifyContent: 'center',
  },
  qrCard: {
    position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
    background: '#1e293b', borderRadius: 20, padding: '4vh 4vw', boxSizing: 'border-box',
    boxShadow: '0 4px 32px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column',
    alignItems: 'center', gap: '2vh', maxWidth: '70vw',
  },
  qrTitle: { fontSize: '1.5vw', fontWeight: 700, textAlign: 'center' },
  qrBox: { width: '22vw', height: '22vw', background: '#fff', borderRadius: 12, padding: '1vw', boxSizing: 'border-box' },
};
