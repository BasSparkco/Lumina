import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import html2canvas from 'html2canvas';
import type { PlayerAssetManifestItem } from '@lumina/types';
import { api, ApiError, type Playlist, type PlayerState, type HeartbeatTelemetry } from '../lib/api';
import { clearLocalPlayerData } from '../lib/local-player-data';
import { initializeMediaStorage, mediaStorageKey, type MediaStorage } from '../lib/media-storage';
import {
  createBrowserPresentationActivationCoordinator,
  type BrowserPresentationActivationCoordinator,
  type PreparedPlayerPresentation,
  type PresentationStatus,
} from '../lib/presentation';
import { connectSocket, disconnectSocket, getSocket } from '../lib/socket';
import { resolveSchedule, resolvePower, msUntilNextTransition } from '../lib/scheduler';
import { isModuleLeaseValid } from '../lib/moduleLease';
import { usePlayerStore } from '../store/playerStore';
import { useDeviceSettingsStore } from '../store/deviceSettingsStore';
import { isAudioUnlocked, onAudioUnlock } from '../lib/audioUnlock';
import { tryInstallPwa } from '../lib/pwaInstall';
import {
  reportNetworkFailure,
  reportNetworkSuccess,
  shouldAttemptNetwork,
  startConnectivityMonitoring,
  stopConnectivityMonitoring,
  synchronizeAfterReconnect,
} from '../lib/connectivity';
import ZonePlayer, { type ZonePlayerHandle } from '../components/ZonePlayer';
import WayfindingDirectoryBoard from '../components/WayfindingDirectoryBoard';
import WayfindingKioskMap from '../components/WayfindingKioskMap';
import WayfindingEvacuationView from '../components/WayfindingEvacuationView';
import RoomBookingView from '../components/RoomBookingView';
import Splash from '../components/Splash';
import PlayerControlPanel from '../components/PlayerControlPanel';

const HEARTBEAT_INTERVAL = 30_000;
const STATE_REFRESH_INTERVAL = 60_000;
const MANIFEST_REQUEST_TIMEOUT = 15_000;
// Phase 10/11 (update_payer.md) — local media otherwise accumulates forever: nothing evicts a
// binary once the playlist that referenced it moves on. Unreferenced media stays for a week
// (covers "revert to the previous playlist" without a redownload) and eviction also kicks in
// early if the origin's storage quota gets tight, so a slow week never turns into a full disk.
const CLEANUP_INTERVAL = 30 * 60_000;
const CLEANUP_MAX_UNUSED_MS = 7 * 24 * 60 * 60_000;
const CLEANUP_QUOTA_TARGET = 0.8;

// Mirrors apps/api/src/modules/ws/screen.gateway.ts's PlayerCommand.
type PlayerCommand =
  | { type: 'publish' | 'reload' | 'clear-cache' | 'capture-screenshot' | 'deleted' }
  | { type: 'unpair'; pairingCode: string }
  | { type: 'pause' | 'resume' }
  | { type: 'seek'; toSeconds: number }
  | { type: 'setSpeed'; rate: number };

// Item 5 (awaiting-content badge) — the backend only flips this from the player's own
// heartbeat, so it needs an honest answer for whatever's *actually* about to render, not just
// "is a playlist assigned." Deliberately ignores poweredOn/stopped: a screen paused or outside
// its power window isn't missing content, so neither should flip the badge on.
function computeHasContent(state: PlayerState, activePlaylist: Playlist | null): boolean {
  if (state.emergencyActive && state.emergencyPlaylist) return state.emergencyPlaylist.items.length > 0;
  if (state.emergencyActive && state.wayfinding) return true; // evacuation view always renders something
  if (!state.emergencyActive && state.roomBooking && isModuleLeaseValid(state.moduleLeases, 'ROOM_BOOKING')) return true;
  if (state.wayfinding && isModuleLeaseValid(state.moduleLeases, 'WAYFINDING')) return state.wayfinding.pois.length > 0;
  return !!activePlaylist && activePlaylist.items.length > 0;
}

// Best-effort — a failed capture (e.g. a tainted canvas from a CORS-blocked asset) shouldn't
// crash playback; the dashboard just keeps showing whatever screenshot it already had.
async function captureAndUploadScreenshot() {
  try {
    const canvas = await html2canvas(document.body, {
      backgroundColor: '#000000',
      useCORS: true,
      logging: false,
      width: window.innerWidth,
      height: window.innerHeight,
    });
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
    if (blob) await api.uploadScreenshot(blob);
  } catch {
    /* ignore — see comment above */
  }
}

// Evaluated once per render of a wayfinding screen, not cached — a kiosk isn't expected to
// switch between touch and non-touch hardware mid-session, but re-checking is free either way.
function isTouchCapable() {
  return typeof window !== 'undefined' && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window);
}

// Decode the complete local wayfinding image set up front. Phase 6 rewrites these to leased OPFS
// object URLs, so this warms local images and never starts an independent network transfer.
function prefetchWayfindingImages(wayfinding: PlayerState['wayfinding']) {
  if (!wayfinding) return;
  const urls = [
    ...wayfinding.floors.map(f => f.floorPlanUrl),
    ...wayfinding.pois.map(p => p.iconUrl),
  ].filter((url): url is string => !!url);
  for (const url of urls) {
    const img = new Image();
    img.src = url;
  }
}

export default function PlayerPage() {
  const { token, screenId, unpair, forget } = usePlayerStore();
  const autoStart = useDeviceSettingsStore(s => s.autoStart);
  const muted = useDeviceSettingsStore(s => s.muted);
  const navigate = useNavigate();
  const [presentation, setPresentation] = useState<PreparedPlayerPresentation | null>(null);
  const state = presentation?.state ?? null;
  const [activePlaylist, setActivePlaylist] = useState<Playlist | null>(null);
  const [poweredOn, setPoweredOn] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [syncMessage, setSyncMessage] = useState('Synchronizing content…');
  // Auto-start off (device setting) — gates rendering behind a "Tap to start" screen until the
  // first interaction. Initialized from `autoStart` once and never re-read: flipping the setting
  // mid-session shouldn't un-start a session that's already playing, only change what happens on
  // the *next* boot.
  const [started, setStarted] = useState(() => autoStart);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scheduleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentAssetRef = useRef<string | null>(null);
  // Custom Player (Phase 9/10) — only meaningful while streamingType is 'ASSET' (see
  // ZonePlayer's `controllable` prop below); a ref rather than state since commands arrive
  // imperatively over the socket and shouldn't trigger a re-render.
  const zonePlayerRef = useRef<ZonePlayerHandle>(null);
  // Read by the heartbeat interval below, which is set up once on mount and would otherwise
  // only ever see the `activePlaylist`/`state` values from that first render.
  const hasContentRef = useRef(false);
  const activationRef = useRef<BrowserPresentationActivationCoordinator | null>(null);
  const storageRef = useRef<MediaStorage | null>(null);
  // The currently-published presentation's local binaries — cleanup must never evict these out
  // from under a video that's actively playing from them.
  const retainedStorageKeysRef = useRef<ReadonlySet<string>>(new Set());
  const cleanupRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Phase 12 (update_payer.md) telemetry — the most recently fetched manifest's asset list (to
  // report assetsTotal/Ready/Downloading/Failed against) and the last time a sync check actually
  // succeeded (ACTIVE or unchanged), independent of whether that tick published new content.
  const lastManifestAssetsRef = useRef<PlayerAssetManifestItem[]>([]);
  const lastSuccessfulSyncAtRef = useRef<string | null>(null);

  // React runs the previous effect cleanup only after the replacement presentation commits to
  // the DOM. That is the safe point to release its object-URL leases.
  useEffect(() => () => presentation?.release(), [presentation]);

  // Installed-PWA status is one of Chrome's strongest signals for auto-granting persistent OPFS
  // storage (see media-storage's DEGRADED diagnostic) — riding the same first-gesture hook
  // audioUnlock.ts already tracks means this costs nothing extra and fires the moment an
  // installer taps the screen during setup. Does nothing on a genuinely unattended, no-touch
  // kiosk (Chrome requires a gesture to prompt at all) — that case needs an OS/launch-level fix
  // instead, see pwaInstall.ts's comment.
  useEffect(() => onAudioUnlock(() => { void tryInstallPwa(); }), []);

  // A revoked credential — the screen row is gone (404), or it still exists but is no longer
  // paired (401: unpaired/re-paired-elsewhere while this player was offline/backgrounded and
  // missed the live `unpair`/`deleted` socket push below). Either way this is definitive, not a
  // network hiccup: there's no pairingCode to resume into since that only ever arrives over the
  // socket, so the only way back is a full re-pair — drop credentials and cached content and go
  // request a new pairing code, instead of looping stale content (or a dead token) forever.
  const handleRevoked = useCallback(async () => {
    await clearLocalPlayerData();
    forget();
    void navigate('/');
  }, [forget, navigate]);

  // Custom Player (Phase 9/10) — forwards ZonePlayer's ~1x/second position samples to the
  // dashboard over the socket. A stable callback (not inline) so ZonePlayer's progress-reporting
  // effect isn't torn down and restarted on every PlayerPage render.
  const handlePlaybackProgress = useCallback((progress: { currentTime: number; duration: number; paused: boolean; rate: number }) => {
    getSocket()?.emit('playback-progress', progress);
  }, []);

  // Schedule resolution: pick the right playlist from schedule rules
  const resolvePlaylist = useCallback((s: PlayerState): Playlist | null => {
    if (s.emergencyActive && s.emergencyPlaylist) return s.emergencyPlaylist;
    // Asset-streaming mode: the backend already wraps the single asset as a one-item playlist
    // (see hydrateAssetAsPlaylist), so the existing single-playlist render path below handles
    // it unchanged — no separate render branch needed.
    if (s.streamingType === 'ASSET') return s.asset;
    if (s.wayfinding) return null; // wayfinding mode — directory board renders itself
    const matchedId = resolveSchedule(s.scheduleRules, new Date());
    if (matchedId) {
      const rule = s.scheduleRules.find(r => r.playlistId === matchedId);
      if (rule?.playlist) return rule.playlist;
    }
    return s.defaultPlaylist;
  }, []);

  // Applies both the resolved playlist and the resolved power-on state for a given state snapshot.
  const applyState = useCallback((s: PlayerState) => {
    const playlist = resolvePlaylist(s);
    setActivePlaylist(playlist);
    setPoweredOn(resolvePower(s.powerScheduleRules, new Date()));
    hasContentRef.current = computeHasContent(s, playlist);
    prefetchWayfindingImages(s.wayfinding);
  }, [resolvePlaylist]);

  // Phase 10/11 (update_payer.md) — evict local media the active presentation no longer
  // references. Never touches retainedStorageKeysRef's contents regardless of age/size, so a
  // slow or failed cleanup can't ever pull the rug out from under what's on screen right now.
  const runCleanup = useCallback(async () => {
    const storage = storageRef.current;
    if (!storage) return;
    try {
      const usage = await storage.getUsage();
      const maxMediaBytes = usage.quotaBytes ? Math.floor(usage.quotaBytes * CLEANUP_QUOTA_TARGET) : undefined;
      const result = await storage.cleanup({
        retainStorageKeys: retainedStorageKeysRef.current,
        maxMediaBytes,
        maxUnusedMs: CLEANUP_MAX_UNUSED_MS,
      });
      if (result.removedStorageKeys.length > 0) {
        console.info('[media-cleanup]', JSON.stringify({
          removed: result.removedStorageKeys.length,
          removedBytes: result.removedBytes,
          remainingBytes: result.remainingBytes,
        }));
      }
    } catch (err) {
      console.warn('[media-cleanup] failed', err instanceof Error ? err.message : err);
    }
  }, []);

  // Phase 12 — READY only when the active revision is committed and every required local asset
  // is verified (coordinator status ACTIVE); DEGRADED (not FAILED) if a sync check just failed
  // but there's still valid local content playing from an earlier successful sync.
  const computeSyncState = useCallback((
    status: PresentationStatus | undefined,
    hasLocalContent: boolean,
  ): NonNullable<HeartbeatTelemetry['syncState']> => {
    if (!status) return 'UNKNOWN';
    if (status === 'ACTIVE') return 'READY';
    if (status === 'DOWNLOADING' || status === 'READY' || status === 'SUPERSEDED') return 'SYNCING';
    return hasLocalContent ? 'DEGRADED' : 'FAILED';
  }, []);

  // Phase 12 — assetsReady/Failed are matched against the last-fetched manifest's expected
  // storage keys (not a raw local-store count), so a stale local file from a since-changed
  // playlist doesn't get counted as this screen's current content. assetsDownloading is derived
  // (total - ready - failed) rather than read from the download manager directly, since nothing
  // in this component observes its live in-flight count today.
  const gatherTelemetry = useCallback(async (): Promise<HeartbeatTelemetry> => {
    const storage = storageRef.current;
    if (!storage) return {};
    const [usage, storedAssets, failures] = await Promise.all([
      storage.getUsage(),
      storage.list(),
      storage.listVerificationFailures(),
    ]);
    const expectedKeys = lastManifestAssetsRef.current.map(a => mediaStorageKey(storage.namespace, a));
    const readyKeys = new Set(storedAssets.map(a => a.storageKey));
    const failedKeys = new Set(failures.map(f => f.storageKey));
    const assetsReady = expectedKeys.filter(k => readyKeys.has(k)).length;
    const assetsFailed = expectedKeys.filter(k => failedKeys.has(k)).length;
    return {
      syncState: computeSyncState(activationRef.current?.getStatus(), retainedStorageKeysRef.current.size > 0),
      assetsTotal: expectedKeys.length,
      assetsReady,
      assetsFailed,
      assetsDownloading: Math.max(0, expectedKeys.length - assetsReady - assetsFailed),
      cacheBytes: usage.mediaBytes,
      ...(usage.availableBytes !== null ? { freeStorageBytes: usage.availableBytes } : {}),
      storagePersistent: usage.persisted,
      ...(lastSuccessfulSyncAtRef.current ? { lastSuccessfulSyncAt: lastSuccessfulSyncAtRef.current } : {}),
    };
  }, [computeSyncState]);

  // Re-evaluate schedule + power window every minute
  const scheduleNextCheck = useCallback((s: PlayerState) => {
    if (scheduleTimerRef.current) clearTimeout(scheduleTimerRef.current);
    const delay = msUntilNextTransition(s.scheduleRules, new Date());
    scheduleTimerRef.current = setTimeout(() => {
      applyState(s);
      scheduleNextCheck(s);
    }, delay);
  }, [applyState]);

  useEffect(() => {
    if (!token || !screenId) { void navigate('/'); return; }
    let cancelled = false;
    let manifestController: AbortController | null = null;
    let reconnectPromise: Promise<void> | null = null;
    startConnectivityMonitoring();

    const publishPresentation = (next: PreparedPlayerPresentation) => {
      if (cancelled) { next.release(); return; }
      currentAssetRef.current = null;
      retainedStorageKeysRef.current = new Set(next.assetStorageKeys);
      setPresentation(next);
      applyState(next.state);
      scheduleNextCheck(next.state);
      setSyncMessage('Content synchronized');
      void runCleanup();
    };

    const sendHeartbeat = async (): Promise<void> => {
      if (!shouldAttemptNetwork()) return;
      try {
        const telemetry = await gatherTelemetry();
        await api.heartbeat(currentAssetRef.current, hasContentRef.current, telemetry);
        reportNetworkSuccess();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          await handleRevoked();
          return;
        }
        reportNetworkFailure();
      }
    };

    const refreshPresentation = async (coordinator: BrowserPresentationActivationCoordinator) => {
      if (!shouldAttemptNetwork()) {
        setSyncMessage('Offline — playing locally stored content');
        return;
      }

      manifestController?.abort('superseded');
      const controller = new AbortController();
      manifestController = controller;
      const timeout = setTimeout(() => controller.abort('timeout'), MANIFEST_REQUEST_TIMEOUT);
      try {
        setSyncMessage('Synchronizing content…');
        const manifest = await api.getManifest(controller.signal);
        clearTimeout(timeout);
        if (manifestController === controller) manifestController = null;
        reportNetworkSuccess();
        lastManifestAssetsRef.current = manifest.assets;
        const result = await coordinator.activate(manifest);
        if (cancelled) {
          result.presentation?.release();
          return;
        }
        if (result.status === 'ACTIVE' && result.presentation) publishPresentation(result.presentation);
        else if (result.status === 'ACTIVE') setSyncMessage('Content synchronized');
        else if (result.status === 'FAILED') setSyncMessage('Synchronization failed; retrying later');
        if (result.status === 'ACTIVE') lastSuccessfulSyncAtRef.current = new Date().toISOString();
      } catch (err) {
        if (cancelled || controller.signal.reason === 'superseded') return;
        if (err instanceof ApiError && (err.status === 404 || err.status === 401)) {
          await handleRevoked();
          return;
        }
        // A transient manifest/API failure never replaces the active local presentation.
        reportNetworkFailure(
          controller.signal.reason === 'timeout'
            ? 'Server check timed out; continuing the local presentation.'
            : undefined,
        );
        setSyncMessage('Offline — playing locally stored content');
      } finally {
        clearTimeout(timeout);
        if (manifestController === controller) manifestController = null;
      }
    };

    const reconnectAndSynchronize = (): Promise<void> => {
      if (reconnectPromise) return reconnectPromise;
      reconnectPromise = synchronizeAfterReconnect(
        sendHeartbeat,
        async () => {
          if (activationRef.current) await refreshPresentation(activationRef.current);
        },
      ).finally(() => { reconnectPromise = null; });
      return reconnectPromise;
    };

    void (async () => {
      const storage = await initializeMediaStorage(screenId);
      if (cancelled) return;
      if (!storage) {
        setSyncMessage('Persistent media storage is unavailable');
        setLoaded(true);
        return;
      }
      storageRef.current = storage;
      const coordinator = createBrowserPresentationActivationCoordinator(storage);
      activationRef.current = coordinator;
      const restored = await coordinator.restore();
      if (restored.status === 'ACTIVE' && restored.presentation) publishPresentation(restored.presentation);
      if (cancelled) {
        restored.presentation?.release();
        coordinator.dispose();
        if (activationRef.current === coordinator) activationRef.current = null;
        return;
      }
      setLoaded(true);
      await refreshPresentation(coordinator);
    })();

    heartbeatRef.current = setInterval(() => { void sendHeartbeat(); }, HEARTBEAT_INTERVAL);

    refreshRef.current = setInterval(() => {
      if (activationRef.current) void refreshPresentation(activationRef.current);
    }, STATE_REFRESH_INTERVAL);

    cleanupRef.current = setInterval(() => { void runCleanup(); }, CLEANUP_INTERVAL);

    const sock = connectSocket(token, shouldAttemptNetwork());
    sock.on('command', async (cmd: PlayerCommand) => {
      if (cmd.type === 'publish') {
        if (activationRef.current) await refreshPresentation(activationRef.current);
      } else if (cmd.type === 'reload') {
        window.location.reload();
      } else if (cmd.type === 'clear-cache') {
        // Previously this only cleared the app's own IndexedDB (playlist/state/config data) —
        // it never touched the service worker's Cache Storage or the registration itself, so a
        // device stuck on an old deployed bundle (stale cached JS/CSS/HTML) had no way to force
        // a truly fresh fetch; a plain Reload can leave it running the same old code indefinitely
        // if the service worker hasn't independently decided to check for an update. This is the
        // actual "hard reset": app data, every Cache Storage entry the service worker owns, and
        // the registration itself, so the next load re-registers from scratch against whatever
        // is currently deployed.
        await clearLocalPlayerData();
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map(key => caches.delete(key)));
        }
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map(registration => registration.unregister()));
        }
        window.location.reload();
      } else if (cmd.type === 'capture-screenshot') {
        void captureAndUploadScreenshot();
      } else if (cmd.type === 'unpair') {
        await clearLocalPlayerData();
        unpair(cmd.pairingCode);
        void navigate('/');
      } else if (cmd.type === 'deleted') {
        await clearLocalPlayerData();
        forget();
        void navigate('/');
      } else if (cmd.type === 'pause') {
        zonePlayerRef.current?.pause();
      } else if (cmd.type === 'resume') {
        zonePlayerRef.current?.resume();
      } else if (cmd.type === 'seek') {
        zonePlayerRef.current?.seek(cmd.toSeconds);
      } else if (cmd.type === 'setSpeed') {
        zonePlayerRef.current?.setSpeed(cmd.rate);
      }
    });

    // A screen that was briefly offline (wifi hiccup, tab suspended) otherwise doesn't see
    // whatever changed until the next STATE_REFRESH_INTERVAL tick (up to 60s) — `reconnect`
    // (unlike `connect`, which also fires on the very first connection) only fires after a
    // real drop, so this doesn't duplicate the initial manifest request above.
    sock.io.on('reconnect', () => { void reconnectAndSynchronize(); });

    const handleBrowserOffline = () => {
      manifestController?.abort('offline');
      sock.disconnect();
      setSyncMessage('Offline — playing locally stored content');
    };
    const handleBrowserOnline = () => {
      sock.connect();
      void reconnectAndSynchronize();
    };
    window.addEventListener('offline', handleBrowserOffline);
    window.addEventListener('online', handleBrowserOnline);

    return () => {
      cancelled = true;
      manifestController?.abort('unmount');
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (refreshRef.current) clearInterval(refreshRef.current);
      if (cleanupRef.current) clearInterval(cleanupRef.current);
      if (scheduleTimerRef.current) clearTimeout(scheduleTimerRef.current);
      activationRef.current?.dispose();
      activationRef.current = null;
      window.removeEventListener('offline', handleBrowserOffline);
      window.removeEventListener('online', handleBrowserOnline);
      disconnectSocket();
      stopConnectivityMonitoring();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, screenId]);

  if (!loaded) return <FullscreenContainer><Splash text="Loading…" /></FullscreenContainer>;

  // Auto-start off (device setting, see PlayerControlPanel) — wait for a tap before rendering
  // any real content. Doubles as the audio-unlock gesture (see lib/audioUnlock.ts).
  if (!started) {
    return (
      <FullscreenContainer>
        <button onClick={() => setStarted(true)} style={startButtonStyle}>
          Tap to start
        </button>
      </FullscreenContainer>
    );
  }

  if (!state) return <FullscreenContainer><Splash text={syncMessage} /></FullscreenContainer>;

  // Outside its power-on window — highest priority of all, above even an explicit stop or
  // emergency override, since it represents the physical display being off. A real off screen
  // shows nothing, so this is a bare black container with no status text (unlike Splash). Device
  // controls are hidden too, matching a real screen that's actually off.
  if (!poweredOn) return <FullscreenContainer hideControls />;

  // Paused from the dashboard — takes priority over everything else, including an
  // active emergency override, since it's an explicit "blank this screen now" action.
  if (state.stopped) return <FullscreenContainer orientation={state.orientation} aspectRatio={state.aspectRatio}><Splash text="Playback paused" /></FullscreenContainer>;

  // Emergency override — fullscreen single zone
  if (state.emergencyActive && state.emergencyPlaylist) {
    return (
      <FullscreenContainer orientation={state.orientation} aspectRatio={state.aspectRatio} showClock={state.showClock} timezone={state.timezone}>
        <ZonePlayer playlist={state.emergencyPlaylist} state={state} volume={state.volume} forceMuted={muted} onAssetChange={id => { currentAssetRef.current = id; }} />
      </FullscreenContainer>
    );
  }

  // Fire/evacuation mode (7.4) — same Screen.emergencyActive flag as above, but a wayfinding
  // kiosk with no explicit emergency playlist chosen gets a purpose-built evacuation-route view
  // instead of just sitting on its normal directory/map (BuildingsService.setEvacuation is what
  // flips this flag for every kiosk in a building at once).
  if (state.emergencyActive && state.wayfinding) {
    return (
      <FullscreenContainer orientation={state.orientation} aspectRatio={state.aspectRatio}>
        <WayfindingEvacuationView directory={state.wayfinding} />
      </FullscreenContainer>
    );
  }

  // Room Booking (room_booking_module_plan.md §10.1) — unlike Wayfinding, this module has no
  // evacuation-bypass concept at all: an active emergency suppresses it unconditionally, which is
  // why this check comes after both emergency-active blocks above rather than relying on them to
  // have already returned (a Room-Booking-only screen with no wayfinding data and no chosen
  // emergency playlist would otherwise fall through to here while still mid-emergency). The API
  // still computes and returns `roomBooking`/the ROOM_BOOKING lease during an emergency (it has no
  // opinion on render order), so this player-side guard is the actual enforcement point.
  if (!state.emergencyActive && state.roomBooking) {
    if (!isModuleLeaseValid(state.moduleLeases, 'ROOM_BOOKING')) {
      return (
        <FullscreenContainer orientation={state.orientation} aspectRatio={state.aspectRatio}>
          <Splash text="Reconnecting to restore Room Booking content…" />
        </FullscreenContainer>
      );
    }
    return (
      <FullscreenContainer orientation={state.orientation} aspectRatio={state.aspectRatio}>
        <RoomBookingView payload={state.roomBooking} />
      </FullscreenContainer>
    );
  }

  if (state.wayfinding) {
    // Offline module lease (docs/adr/platform-modules-and-entitlements.md §8.3) — bounds how
    // long this kiosk keeps showing wayfinding content restored from local storage with no live
    // check-in. A no-op on the live path (a freshly-fetched state's lease was just issued, so
    // it's always valid); this only actually fires for a presentation restored offline past its
    // grace period. The cached data itself is never deleted — a fresh state from the next
    // successful sync (or coming back online) renews the lease and this splash goes away on its
    // own, no reconstruction needed.
    if (!isModuleLeaseValid(state.moduleLeases, 'WAYFINDING')) {
      return (
        <FullscreenContainer orientation={state.orientation} aspectRatio={state.aspectRatio}>
          <Splash text="Reconnecting to restore Wayfinding content…" />
        </FullscreenContainer>
      );
    }

    // Wayfinding mode — a real touchscreen gets the interactive pan/zoom/tap kiosk map (Phase
    // 7.2); a cheap non-touch panel (still a real, supported deployment target per Phase 7.1)
    // falls back to the passive auto-rotating directory board. No per-screen config needed: the
    // browser's own touch-capability signal is the right source of truth here.
    return (
      <FullscreenContainer orientation={state.orientation} aspectRatio={state.aspectRatio}>
        {isTouchCapable()
          ? <WayfindingKioskMap state={state} onAssetChange={id => { currentAssetRef.current = id; }} />
          : <WayfindingDirectoryBoard directory={state.wayfinding} />}
      </FullscreenContainer>
    );
  }

  // Streaming type is WAYFINDING but state.wayfinding came back null — the screen has no
  // KioskLocation yet (dashboard: Screens > this screen > Kiosk floor). Distinct from the
  // generic "no content" splash below so this is diagnosable on-site instead of looking
  // identical to an unconfigured playlist.
  if (state.streamingType === 'WAYFINDING') {
    return (
      <FullscreenContainer orientation={state.orientation} aspectRatio={state.aspectRatio}>
        <Splash text="Wayfinding kiosk location not set — configure it for this screen in the dashboard" />
      </FullscreenContainer>
    );
  }

  // Streaming type is ROOM_BOOKING but state.roomBooking came back null — either no room is
  // bound to this screen yet (dashboard: Room Booking > Displays), or an active emergency is
  // suppressing it (handled above; a screen that reaches here mid-emergency with no binding falls
  // through to this same diagnosable message rather than the generic "no content" splash below).
  if (state.streamingType === 'ROOM_BOOKING') {
    return (
      <FullscreenContainer orientation={state.orientation} aspectRatio={state.aspectRatio}>
        <Splash text="No room assigned to this display — configure it in Room Booking > Displays" />
      </FullscreenContainer>
    );
  }

  // Single-playlist mode (schedule-resolved) — a playlist item can itself be a THEME, a LAYOUT,
  // or an APP-type asset; ZonePlayer (via ZoneRenderer for LAYOUT items) handles all of it.
  if (!activePlaylist || activePlaylist.items.length === 0) {
    return <FullscreenContainer orientation={state.orientation} aspectRatio={state.aspectRatio}><Splash text="No content scheduled right now" /></FullscreenContainer>;
  }

  return (
    <FullscreenContainer orientation={state.orientation} aspectRatio={state.aspectRatio} showClock={state.showClock} timezone={state.timezone}>
      <ZonePlayer
        ref={zonePlayerRef}
        playlist={activePlaylist}
        state={state}
        volume={state.volume}
        forceMuted={muted}
        onAssetChange={id => { currentAssetRef.current = id; }}
        controllable={state.streamingType === 'ASSET'}
        onPlaybackProgress={handlePlaybackProgress}
      />
    </FullscreenContainer>
  );
}

// "16:9"/"9:16" as [width-parts, height-parts] — kept as integer ratios (not a precomputed float)
// so the CSS below stays exact instead of accumulating floating-point rounding at the pixel edge.
const ASPECT_RATIO_PARTS: Record<'16:9' | '9:16', [number, number]> = {
  '16:9': [16, 9],
  '9:16': [9, 16],
};

// Letterboxes/pillarboxes content to the screen's *intended* aspect ratio (Screen.aspectRatio,
// dashboard Settings tab) instead of always stretching it to fill whatever the device's real
// panel happens to be — e.g. a 16:9-designed layout shown on a non-16:9 panel gets black bars
// instead of visibly distorted content. "stretch" (or no value, e.g. cached pre-upgrade state)
// opts back out and fills the box exactly like before this field existed.
// `avail` is expressed in the *pre-rotation* box's own units (vw/vh already swapped for sideways
// orientations by the caller — see FullscreenContainer below), so this only ever does simple
// same-unit arithmetic and never needs to know the real device pixel size.
function letterboxSize(aspectRatio: '16:9' | '9:16' | 'stretch' | undefined, availW: string, availH: string): React.CSSProperties {
  if (!aspectRatio || aspectRatio === 'stretch') return { width: '100%', height: '100%' };
  const [w, h] = ASPECT_RATIO_PARTS[aspectRatio];
  return {
    width: `min(${availW}, ${availH} * ${w} / ${h})`,
    height: `min(${availH}, ${availW} * ${h} / ${w})`,
  };
}

// Rotates the whole display for kiosks physically mounted sideways/upside-down. Dashboard-driven
// (Screen.orientation, see ScreensPage's Settings tab) rather than a device setting, so it can be
// set remotely without anyone standing at the screen. Centers a box sized to the *rotated*
// dimensions inside the true (unrotated) viewport so it fills the screen exactly at every angle:
// rotation happens about the box's own center, which `translate(-50%, -50%)` has already pinned
// to the viewport's center, so the two operations commute regardless of transform order.
function FullscreenContainer({ children, orientation = 0, aspectRatio, showClock, timezone, hideControls }: { children?: React.ReactNode; orientation?: 0 | 90 | 180 | 270; aspectRatio?: '16:9' | '9:16' | 'stretch'; showClock?: boolean; timezone?: string; hideControls?: boolean }) {
  const deviceMuted = useDeviceSettingsStore(s => s.muted);
  const sideways = orientation === 90 || orientation === 270;
  // Matches the swap applied to the rotate wrapper's own width/height just below — the box this
  // letterboxes into is the *pre-rotation* one, so "available width" here is 100vh, not 100vw,
  // whenever the panel is mounted sideways.
  const box = letterboxSize(aspectRatio, sideways ? '100vh' : '100vw', sideways ? '100vw' : '100vh');
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#000', overflow: 'hidden', position: 'fixed', inset: 0 }}>
      <div
        style={{
          position: 'absolute', top: '50%', left: '50%',
          width: sideways ? '100vh' : '100vw',
          height: sideways ? '100vw' : '100vh',
          transform: `translate(-50%, -50%) rotate(${orientation}deg)`,
        }}
      >
        <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ ...box, background: '#000', position: 'relative', overflow: 'hidden' }}>
              {children}
            </div>
          </div>
          {showClock && timezone && <ClockOverlay timezone={timezone} />}
          {!hideControls && !deviceMuted && <SoundLockedIndicator />}
          {!hideControls && <PlayerControlPanel />}
        </div>
      </div>
    </div>
  );
}

// Chrome/Firefox refuse unmuted autoplay until the page has seen a real click/tap/keypress (see
// audioUnlock.ts) — with autoStart on (the default), that gesture may never happen on its own, so
// video/app content that's meant to have sound silently plays muted instead, with nothing on
// screen to explain why. This surfaces that state and doubles as an obvious tap target: any click
// on it (or anywhere else in the document) unlocks audio for every player already mounted.
function SoundLockedIndicator() {
  const [unlocked, setUnlocked] = useState(isAudioUnlocked);
  useEffect(() => {
    if (unlocked) return;
    return onAudioUnlock(() => setUnlocked(true));
  }, [unlocked]);
  if (unlocked) return null;
  return (
    <div
      style={{
        position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 9998,
        display: 'flex', alignItems: 'center', gap: 8, color: '#fff', background: 'rgba(0,0,0,0.55)',
        padding: '8px 16px', borderRadius: 999, fontFamily: 'system-ui, sans-serif', fontSize: '0.9rem',
        pointerEvents: 'none',
      }}
    >
      <MutedSpeakerIcon />
      Tap anywhere for sound
    </div>
  );
}

function MutedSpeakerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  );
}

const startButtonStyle: React.CSSProperties = {
  position: 'absolute', inset: 0, width: '100%', height: '100%',
  background: '#000', color: '#fff', border: 'none', cursor: 'pointer',
  fontFamily: 'system-ui, sans-serif', fontSize: '1.5rem', fontWeight: 600, letterSpacing: '0.02em',
};

function ClockOverlay({ timezone }: { timezone: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: timezone });
  return (
    <div
      style={{
        position: 'absolute', top: 16, right: 16, zIndex: 9999,
        color: '#fff', background: 'rgba(0,0,0,0.55)', padding: '6px 16px', borderRadius: 8,
        fontFamily: 'system-ui, sans-serif', fontSize: '1.75rem', fontWeight: 600, letterSpacing: '0.02em',
      }}
    >
      {time}
    </div>
  );
}
