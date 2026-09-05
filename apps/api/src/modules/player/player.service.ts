import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import QRCode from 'qrcode';
import { DesignDocumentSchema, resolveElementBindings, type DesignElement, type ResolvedDesignPayload, type ResolvedElement, type ResolvedScene, type VariableMap } from '@lumina/design-schema';
import type { PlayerAssetManifestItem, PlayerContentManifest, PlayerManifestAssetType, PlayerModuleLease, PlayerNetworkDependency, WayfindingAiPlayerConfig, RoomBookingPlayerPayload } from '@lumina/types';
import { RoomPlayerStateService } from '../room-booking/room-player-state.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ScreenGateway } from '../ws/screen.gateway';
import { SchedulesService } from '../schedules/schedules.service';
import { PowerSchedulesService } from '../power-schedules/power-schedules.service';
import { ScreensService } from '../screens/screens.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import type { ScreenJwtUser } from '../../common/types/jwt-user';
import { collectManifestReferences, manifestRevision } from './player-manifest';

const DEFAULT_OFFLINE_GRACE_HOURS = 168;

// Phase 12 (update_payer.md) sync telemetry — every field independently optional, see heartbeat().
export interface HeartbeatTelemetry {
  syncState?: 'UNKNOWN' | 'SYNCING' | 'READY' | 'DEGRADED' | 'FAILED';
  assetsTotal?: number;
  assetsReady?: number;
  assetsDownloading?: number;
  assetsFailed?: number;
  cacheBytes?: number;
  freeStorageBytes?: number;
  storagePersistent?: boolean;
  lastSuccessfulSyncAt?: string;
}

// hydratePlaylist/hydrateZones/hydrateAssetAsPlaylist call each other (a LAYOUT-kind playlist
// item's zones can each play a playlist, whose items can themselves be THEME/LAYOUT-kind) —
// explicit return types on all three break that mutual-recursion type inference cycle.
interface HydratedPlaylistItemAsset {
  id: string; name: string; type: string; mimeType: string; url: string | null; thumbnailUrl: string | null;
  pageUrls: string[]; textContent: string | null; textFontFamily: string | null; textColor: string | null;
  textSize: string | null; textBackgroundColor: string | null; textTickerEnabled: boolean;
  textTickerDirection: string; textTickerSpeed: number | null; textTickerCrossOffset: number | null;
  // APP-type assets only — an embedded item from an external service (e.g. YouTube). Present on
  // every item regardless of type (null for non-APP) rather than a separate field, so the player
  // can key off `asset.type === 'APP'` the same way it already does for every other type.
  appProviderId: string | null; appConfig: unknown;
}
interface HydratedTheme {
  id: string; name: string; category: string; aspectRatio: string; palette: unknown; typography: unknown; elements: unknown;
}
interface HydratedZone {
  id: string; name: string; x: number; y: number; width: number; height: number; zIndex: number; rotation: number;
  zoneType: string; shape: string; widgetConfig: unknown; audioPriority: boolean; audioVolume: number | null;
  playlist: HydratedPlaylist | null;
}
interface HydratedLayout { id: string; name: string; zones: HydratedZone[]; }
interface HydratedPlaylistItem {
  id: string; position: number; durationSecs: number; muted: boolean; playFullVideo: boolean;
  cropZoom: number | null; cropOffsetX: number | null; cropOffsetY: number | null; kind: string;
  // Per-item transition override — null means "inherit the parent HydratedPlaylist's
  // transitionStyle/transitionDurationMs"; resolved player-side via resolveEffectiveTransition.
  transitionStyle: string | null; transitionDurationMs: number | null;
  asset: HydratedPlaylistItemAsset | null; theme: HydratedTheme | null; layout: HydratedLayout | null;
  // designer.md Phase 11 — a DESIGN-kind item's fully resolved payload (§23.1's contract:
  // dynamic variables already substituted, every assetId already a signed/CDN URL).
  design: ResolvedDesignPayload | null;
}
interface HydratedPlaylist {
  id: string; name: string; transitionStyle: string; transitionDurationMs: number; playbackOrder: string;
  // playsetting.md Phase 1 — { [assetType]: 'contain' | 'cover' | 'fill' }, already sanitized by
  // PlaylistsService before it ever reaches the DB. Player-side consumption is Phase 3.
  scaleSettings: unknown;
  items: HydratedPlaylistItem[];
}

@Injectable()
export class PlayerService {
  // A playlist item can be a THEME whose elements can include a PLAYLIST, or a LAYOUT whose zone
  // can play a PLAYLIST — and now that a playlist item can itself be a THEME/LAYOUT, that new
  // reference can point right back at an ancestor, a cycle that was structurally impossible before
  // playlist items only ever pointed at plain assets. This bounds worst-case hydration work
  // regardless of whether the data actually cycles: depth 0 is the screen's own playlist, depth 1
  // is one level of THEME/LAYOUT nesting inside it; past that, THEME/LAYOUT items stop expanding.
  private static readonly MAX_PLAYLIST_ITEM_DEPTH = 2;
  private readonly logger = new Logger(PlayerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly gateway: ScreenGateway,
    private readonly schedules: SchedulesService,
    private readonly powerSchedules: PowerSchedulesService,
    private readonly screens: ScreensService,
    private readonly entitlements: EntitlementsService,
    private readonly roomPlayerState: RoomPlayerStateService,
  ) {}

  // Device-initiated unpair (PlayerControlPanel's "Unpair" button) — delegates to
  // ScreensService.unpair with origin DEVICE so the reset (paired/playerToken/pairingCode/
  // status), the live 'screen-unpaired' nudge to the org's dashboard clients, and the audit log
  // entry are all the exact same code path the dashboard's own Unpair button uses, just without
  // re-pushing the WS 'unpair' command back at the device that's already tearing itself down.
  // Returns the freshly generated pairing code so the device can resume polling on this same
  // screen entity instead of minting an orphan one.
  async selfUnpair(screen: ScreenJwtUser, deviceInfo?: string): Promise<{ pairingCode: string }> {
    const updated = await this.screens.unpair(screen.orgId, screen.sub, { type: 'DEVICE', deviceInfo });
    if (!updated.pairingCode) throw new NotFoundException();
    return { pairingCode: updated.pairingCode };
  }

  async requestPairingCode(): Promise<{ pairingCode: string; screenId: string }> {
    let code: string;
    let attempts = 0;
    do {
      code = Math.random().toString(36).substring(2, 8).toUpperCase();
      attempts++;
    } while (attempts < 10 && (await this.prisma.screen.findUnique({ where: { pairingCode: code } })));

    const screen = await this.prisma.screen.create({
      data: { name: 'Unnamed Screen', pairingCode: code, paired: false },
    });

    return { pairingCode: code, screenId: screen.id };
  }

  async checkPairingById(screenId: string): Promise<{ paired: false } | { paired: true; token: string }> {
    const screen = await this.prisma.screen.findUnique({ where: { id: screenId } });
    if (!screen) return { paired: false };
    if (screen.paired && screen.playerToken) return { paired: true, token: screen.playerToken };
    return { paired: false };
  }

  /** Legacy single-playlist endpoint — kept for backwards compat */
  async getPlaylist(screenId: string) {
    const screen = await this.prisma.screen.findUnique({
      where: { id: screenId },
      include: {
        playlist: {
          include: { items: { orderBy: { position: 'asc' }, include: { asset: true } } },
        },
      },
    });
    if (!screen) throw new NotFoundException('Screen not found');
    if (!screen.playlist) return null;

    return this.hydratePlaylist(screen.organizationId, screen.playlist);
  }

  // The single source of the screen relationships every getState() response variant (normal,
  // suspended-neutral, suspended-emergency) needs — extracted so its return type can be reused
  // as the parameter type for the private helpers below (same `Awaited<ReturnType<...>>` pattern
  // getManifest() already uses for getState() itself).
  private async loadScreenForState(screenId: string) {
    return this.prisma.screen.findUnique({
      where: { id: screenId },
      include: {
        organization: { select: { status: true } },
        asset: true,
        emergencyPlaylist: {
          include: { items: { orderBy: { position: 'asc' }, include: { asset: true } } },
        },
        playlist: {
          include: { items: { orderBy: { position: 'asc' }, include: { asset: true } } },
        },
        kioskLocation: {
          include: {
            floor: {
              include: {
                building: {
                  include: {
                    floors: {
                      orderBy: { level: 'asc' },
                      include: {
                        floorPlanAsset: true,
                        pois: {
                          orderBy: { name: 'asc' },
                          include: { category: true, iconAsset: true },
                        },
                        routeNodes: true,
                      },
                    },
                  },
                },
              },
            },
            attractPlaylist: {
              include: { items: { orderBy: { position: 'asc' }, include: { asset: true } } },
            },
            attractTheme: true,
          },
        },
        // AI Wayfinding (docs/modules/ai_wayfinding_module_plan.md §9.1) — loaded alongside
        // kioskLocation regardless of entitlement/emergency state; buildWayfindingPayload always
        // returns `aiAssistant: null`, and only getState()'s normal (non-suspended,
        // non-emergency) path may ever overwrite it with a real value.
        wayfindingAiConfig: true,
        // Room Booking (docs/modules/room_booking_module_plan.md §9.1) — loaded regardless of
        // entitlement/emergency state, same "always load, gate rendering separately" pattern as
        // every other optional-module relation above. No Room Booking business-rule bypass
        // exists (§9.2) — unlike Wayfinding, there is no emergency-driven reason to ever expose
        // this during a suspended-emergency response, so the suspended builders below always
        // leave `roomBooking: null` by construction, never by an extra check.
        roomDisplayBinding: true,
        group: { select: { volume: true } },
      },
    });
  }

  // The scalar screen fields identical across every getState() response variant — factored out
  // so the normal/suspended-neutral/suspended-emergency builders below don't each restate them.
  private commonScreenFields(screen: NonNullable<Awaited<ReturnType<PlayerService['loadScreenForState']>>>, screenId: string) {
    return {
      screenId,
      streamingType: screen.streamingType,
      timezone: screen.timezone,
      latitude: screen.latitude,
      longitude: screen.longitude,
      prayerMethod: screen.prayerMethod,
      athanEnabled: screen.athanEnabled,
      stopped: screen.stopped,
      showClock: screen.showClock,
      orientation: screen.orientation,
      aspectRatio: screen.aspectRatio,
      volume: screen.volume ?? screen.group?.volume ?? 100,
    };
  }

  // docs/modules/modules_shared_preflight_plan.md §5.1 — the one private Wayfinding
  // hydration implementation shared by normal rendering and the suspended-emergency evacuation
  // path, so entitlement/renderability/route-graph logic is never duplicated or allowed to drift
  // between the two callers. `includeAttract` forces attract playlist/theme to null in the
  // suspended-emergency response even when a bypass makes the rest of the payload renderable;
  // `allowEmergencyEntitlementBypass` mirrors the pre-existing evacuation-bypass rule (docs/adr/
  // platform-modules-and-entitlements.md) without ever earning an offline lease — callers decide
  // lease issuance from the returned `entitled` flag, never from `renderable`.
  private async buildWayfindingPayload(
    screen: NonNullable<Awaited<ReturnType<PlayerService['loadScreenForState']>>>,
    opts: { includeAttract: boolean; allowEmergencyEntitlementBypass: boolean },
  ) {
    const configured = screen.streamingType === 'WAYFINDING' && !!screen.kioskLocation;
    const entitled = configured
      ? !screen.organizationId || (await this.entitlements.hasModule(screen.organizationId, 'WAYFINDING'))
      : false;
    const renderable = entitled || (configured && opts.allowEmergencyEntitlementBypass);

    const kioskLocation = screen.kioskLocation;
    if (!renderable || !kioskLocation) {
      return { configured, entitled, renderable, payload: null };
    }

    // Route graph edges (Phase 7.3) — can't be pulled through the floors->pois nested include
    // above since an edge connects two RouteNodes that may sit on different floors, so it's
    // fetched separately, scoped to the kiosk's whole building, same as RoutesService.graph.
    const routeEdges = await this.prisma.routeEdge.findMany({
      where: { fromNode: { floor: { buildingId: kioskLocation.floor.building.id } } },
    });

    const payload = {
      kiosk: {
        floorId: kioskLocation.floorId,
        x: kioskLocation.x,
        y: kioskLocation.y,
      },
      building: {
        id: kioskLocation.floor.building.id,
        name: kioskLocation.floor.building.name,
      },
      floors: kioskLocation.floor.building.floors.map(f => ({
        id: f.id,
        level: f.level,
        label: f.label,
        floorPlanAssetId: f.floorPlanAsset?.id ?? null,
        floorPlanUrl: f.floorPlanAsset ? this.storage.publicUrl(f.floorPlanAsset.storageKey) : null,
      })),
      pois: kioskLocation.floor.building.floors.flatMap(f => f.pois.map(p => ({
        id: p.id,
        name: p.name,
        nameAr: p.nameAr,
        x: p.x,
        y: p.y,
        description: p.description,
        descriptionAr: p.descriptionAr,
        status: p.status,
        floorId: f.id,
        floorLabel: f.label,
        category: {
          id: p.category.id,
          label: p.category.label,
          labelAr: p.category.labelAr,
          icon: p.category.icon,
          color: p.category.color,
        },
        iconAssetId: p.iconAsset?.id ?? null,
        iconUrl: p.iconAsset ? this.storage.publicUrl(p.iconAsset.storageKey) : null,
      }))),
      // Route graph (Phase 7.3) — the whole building's nodes/edges, so the player can
      // compute a shortest path to any POI on any floor entirely on-device (offline-capable,
      // same philosophy as the local schedule resolver).
      routeNodes: kioskLocation.floor.building.floors.flatMap(f => f.routeNodes.map(n => ({
        id: n.id,
        floorId: f.id,
        x: n.x,
        y: n.y,
        label: n.label,
      }))),
      routeEdges: routeEdges.map(e => ({
        id: e.id,
        fromNodeId: e.fromNodeId,
        toNodeId: e.toNodeId,
        type: e.type,
        weight: e.weight,
      })),
      // Idle/attract-loop content (Phase 7.2) — at most one of these is ever set
      // (ScreensService.setKioskAttractPlaylist/setKioskAttractTheme each clear the
      // other), the player just shows whichever is non-null after its idle timeout.
      // `includeAttract: false` (suspended-emergency evacuation) forces both to null even when
      // the underlying rows exist — a de-licensed/suspended kiosk's emergency response must
      // never resume idle/attract content.
      attractPlaylist: opts.includeAttract && kioskLocation.attractPlaylist
        ? await this.hydratePlaylist(screen.organizationId, kioskLocation.attractPlaylist)
        : null,
      attractTheme: opts.includeAttract && kioskLocation.attractTheme
        ? {
            id: kioskLocation.attractTheme.id,
            name: kioskLocation.attractTheme.name,
            category: kioskLocation.attractTheme.category,
            aspectRatio: kioskLocation.attractTheme.aspectRatio,
            palette: kioskLocation.attractTheme.palette,
            typography: kioskLocation.attractTheme.typography,
            elements: await this.hydrateThemeElements(screen.organizationId, kioskLocation.attractTheme.elements),
          }
        : null,
      // AI Wayfinding (docs/modules/ai_wayfinding_module_plan.md §5/§9.1) — this shared builder
      // never populates it; only getState()'s normal (non-suspended, non-emergency) path may
      // overwrite this after the fact, once it has separately confirmed live WAYFINDING_AI
      // entitlement, per-screen enablement, and !screen.emergencyActive. The suspended-emergency
      // evacuation path always leaves this null, by construction, not by an extra check.
      aiAssistant: null as WayfindingAiPlayerConfig | null,
    };

    return { configured, entitled, renderable, payload };
  }

  // Suspended tenant, no active emergency: return 200 with neutral content, never a 401/404.
  // Both players (web and the Flutter native player) treat 401/404 on this endpoint as "this
  // screen's own credential is dead" (unpaired/deleted) and react by wiping local pairing state
  // and returning to the pairing screen — see ScreenRevokedException in the Flutter app. A
  // suspended tenant is a temporary, reversible business state, not a dead credential, so it
  // must never trigger that path. This also means `Screen.streamingType`/`KioskLocation`/etc.
  // are never touched here — same "preserve everything, hide the content" pattern as a disabled
  // module (see docs/adr/platform-modules-and-entitlements.md). Never calls
  // buildWayfindingPayload — there is nothing to render.
  private buildSuspendedNeutralState(screen: NonNullable<Awaited<ReturnType<PlayerService['loadScreenForState']>>>, screenId: string) {
    return {
      ...this.commonScreenFields(screen, screenId),
      emergencyActive: false,
      emergencyPlaylist: null,
      asset: null,
      wayfinding: null,
      roomBooking: null,
      scheduleRules: [],
      resolvedPlaylistId: null,
      defaultPlaylist: null,
      poweredOn: true,
      powerScheduleRules: [],
      moduleLeases: [],
    };
  }

  // Suspended tenant with an active emergency: docs/modules/modules_shared_preflight_plan.md
  // §4.1/§5.2/§5.3 — an already-active emergency playlist or Wayfinding evacuation route must
  // keep rendering even though the tenant is suspended, exactly as it already survives module
  // disablement and lease expiry. This branch is deliberately never reached by falling through
  // the normal state builder (that would hydrate and transmit lower-priority ordinary content
  // just because the player happens to render the emergency branch first) — it hydrates only
  // the one allowed emergency source and nothing else. No module lease is ever issued here: the
  // response is read-only and does not reactivate the tenant.
  private async buildSuspendedEmergencyState(screen: NonNullable<Awaited<ReturnType<PlayerService['loadScreenForState']>>>, screenId: string) {
    const base = {
      ...this.commonScreenFields(screen, screenId),
      emergencyActive: true,
      asset: null,
      roomBooking: null,
      scheduleRules: [],
      resolvedPlaylistId: null,
      defaultPlaylist: null,
      poweredOn: true,
      powerScheduleRules: [],
      moduleLeases: [],
    };

    // Emergency playlist takes priority over the Wayfinding evacuation view (§4.2's existing
    // precedence, unchanged by this preflight) — wayfinding stays null here rather than also
    // hydrating the evacuation payload nobody will render.
    if (screen.emergencyPlaylist) {
      return {
        ...base,
        emergencyPlaylist: await this.hydratePlaylist(screen.organizationId, screen.emergencyPlaylist),
        wayfinding: null,
      };
    }

    // No emergency playlist: fall back to the Wayfinding evacuation route if (and only if) this
    // screen is a configured Wayfinding kiosk. `buildWayfindingPayload` returns a null payload on
    // its own when the screen isn't a configured kiosk, so a suspended screen with
    // emergencyActive but no playlist and no kiosk correctly renders nothing extra here.
    const wayfinding = await this.buildWayfindingPayload(screen, {
      includeAttract: false,
      allowEmergencyEntitlementBypass: true,
    });

    return {
      ...base,
      emergencyPlaylist: null,
      wayfinding: wayfinding.payload,
    };
  }

  /**
   * Full player state:
   *   - poweredOn + powerScheduleRules (highest priority — outside its window the display
   *     blanks to black regardless of everything below, including stopped/emergency)
   *   - stopped (blanks the screen regardless of everything below, including an active
   *     emergency override)
   *   - emergencyActive + emergencyPlaylist (takes priority over layout/schedule)
   *   - layout with signed-URL playlists per zone (if a layout is assigned)
   *   - scheduleRules (with their playlists pre-fetched) for local resolver
   *   - defaultPlaylist as fallback when no schedule rule matches
   *   - volume (0-100): the screen's own value, else its group's, else 100
   */
  async getState(screenId: string) {
    const screen = await this.loadScreenForState(screenId);
    if (!screen) throw new NotFoundException('Screen not found');

    if (screen.organization?.status === 'SUSPENDED') {
      return screen.emergencyActive
        ? this.buildSuspendedEmergencyState(screen, screenId)
        : this.buildSuspendedNeutralState(screen, screenId);
    }

    // Schedule rules only ever resolve a *playlist* to swap in/out — meaningless (and, if left
    // computed, a source of stale leakage) outside Playlist mode: a screen that used to be
    // Playlist mode with Schedule rows still in the DB, then switched to Asset or Layout mode,
    // would otherwise still resolve and could leak a scheduled playlist through.
    const rules = screen.streamingType === 'PLAYLIST' ? await this.schedules.getSchedulesForScreen(screenId) : [];

    // Collect all unique playlist IDs needed by schedule rules
    const rulePlaylistIds = [...new Set(rules.map(r => r.playlistId))];
    const rulePlaylists = await Promise.all(
      rulePlaylistIds.map(id =>
        this.prisma.playlist.findUnique({
          where: { id },
          include: { items: { orderBy: { position: 'asc' }, include: { asset: true } } },
        }),
      ),
    );
    const rulePlaylistMap = Object.fromEntries(
      rulePlaylists.filter(Boolean).map(p => [p!.id, p!]),
    );

    // Resolve what's playing right now (server-side, as a hint)
    const resolvedPlaylistId = screen.streamingType === 'PLAYLIST'
      ? this.schedules.resolveNow(rules, new Date(), screen.timezone)
      : null;

    // Item 6 (display power schedule) — screen-level rules override the screen's group's; no
    // rules anywhere means the feature is unset for this screen, i.e. always on.
    const power = await this.powerSchedules.resolveForScreen(screen);

    // Item 10 (volume control) — screen's own value wins, else its group's, else full volume.
    const volume = screen.volume ?? screen.group?.volume ?? 100;

    // Module entitlement (docs/adr/platform-modules-and-entitlements.md §8.3), via the shared
    // buildWayfindingPayload helper. `wayfinding.entitled` is the real check — used to decide
    // whether to issue an offline lease. `includeAttract: true` because this is normal
    // (non-suspended) rendering; `allowEmergencyEntitlementBypass: screen.emergencyActive`
    // reproduces the pre-existing evacuation bypass — WayfindingEvacuationView depends on a
    // populated `wayfinding` payload, and an active emergency must never be suppressed by
    // unrelated business-rule enforcement (mirrors ScreensService.setEmergency's existing
    // autoPublish bypass for the same reason). A lease is never issued off the back of this
    // bypass — only genuine entitlement (`wayfinding.entitled`, never `.renderable`) earns one.
    const wayfinding = await this.buildWayfindingPayload(screen, {
      includeAttract: true,
      allowEmergencyEntitlementBypass: screen.emergencyActive,
    });

    if (wayfinding.configured && !wayfinding.renderable) {
      this.logger.log(`Screen ${screenId} is configured for WAYFINDING but the module is not entitled for its organization — no active module payload will be returned.`);
    }

    const moduleLeases: PlayerModuleLease[] = [];
    const issuedAt = new Date();
    const graceHours = Number(process.env.PLAYER_ENTITLEMENT_OFFLINE_GRACE_HOURS) || DEFAULT_OFFLINE_GRACE_HOURS;
    const validUntil = new Date(issuedAt.getTime() + graceHours * 60 * 60 * 1000).toISOString();
    if (wayfinding.entitled) {
      moduleLeases.push({ key: 'WAYFINDING', issuedAt: issuedAt.toISOString(), validUntil });
    }

    // AI Wayfinding (docs/modules/ai_wayfinding_module_plan.md §9.1/§11.4) — computed as two
    // separate booleans, but unlike ordinary Wayfinding's entitled/renderable split, AI's lease
    // is gated on `!screen.emergencyActive` too: "an emergency bypass must never expose the
    // assistant or earn a WAYFINDING_AI lease" (§5) is deliberately read broadly here — any
    // active emergency blacks out AI entirely, lease renewal included, not only the case where
    // WAYFINDING's own bypass is what's rendering the payload. A provider/AI outage or a stale
    // cached lease must never affect evacuation, and evacuation must never quietly keep AI's
    // cache warm either.
    const wayfindingAiEntitled = wayfinding.configured && !screen.emergencyActive
      ? !screen.organizationId || (await this.entitlements.hasModule(screen.organizationId, 'WAYFINDING_AI'))
      : false;
    const wayfindingAiRenderable = wayfindingAiEntitled && screen.wayfindingAiConfig?.enabled === true;

    if (wayfindingAiRenderable && wayfinding.payload) {
      wayfinding.payload.aiAssistant = {
        enabled: true,
        welcomeMessage: screen.wayfindingAiConfig!.welcomeMessage,
        welcomeMessageAr: screen.wayfindingAiConfig!.welcomeMessageAr,
        maxTurns: screen.wayfindingAiConfig!.maxTurns,
      };
    }
    if (wayfindingAiEntitled) {
      moduleLeases.push({ key: 'WAYFINDING_AI', issuedAt: issuedAt.toISOString(), validUntil });
    }

    // Room Booking (docs/modules/room_booking_module_plan.md §9.2) — independent of Wayfinding
    // entirely; a screen is either WAYFINDING or ROOM_BOOKING mode, never both, so this and the
    // wayfinding computation above are mutually exclusive in practice but computed the same way
    // for consistency. "No Room Booking business-rule bypass exists" — entitlement is the only
    // gate, there is no emergency-driven exception to reproduce here.
    const roomBookingConfigured = screen.streamingType === 'ROOM_BOOKING' && !!screen.roomDisplayBinding;
    const roomBookingEntitled = roomBookingConfigured
      ? !screen.organizationId || (await this.entitlements.hasModule(screen.organizationId, 'ROOM_BOOKING'))
      : false;
    let roomBooking: RoomBookingPlayerPayload | null = null;
    if (roomBookingEntitled && screen.roomDisplayBinding) {
      roomBooking = await this.roomPlayerState.buildPayload(screen.roomDisplayBinding);
      if (!roomBooking) {
        this.logger.log(`Screen ${screenId} is configured for ROOM_BOOKING but its bound room could not be loaded — no active module payload will be returned.`);
      }
    } else if (roomBookingConfigured) {
      this.logger.log(`Screen ${screenId} is configured for ROOM_BOOKING but the module is not entitled for its organization — no active module payload will be returned.`);
    }
    if (roomBookingEntitled && roomBooking) {
      moduleLeases.push({ key: 'ROOM_BOOKING', issuedAt: issuedAt.toISOString(), validUntil });
    }

    return {
      screenId,
      streamingType: screen.streamingType,
      timezone: screen.timezone,
      latitude: screen.latitude,
      longitude: screen.longitude,
      prayerMethod: screen.prayerMethod,
      athanEnabled: screen.athanEnabled,
      stopped: screen.stopped,
      showClock: screen.showClock,
      orientation: screen.orientation,
      aspectRatio: screen.aspectRatio,
      emergencyActive: screen.emergencyActive,
      emergencyPlaylist: screen.emergencyPlaylist
        ? await this.hydratePlaylist(screen.organizationId, screen.emergencyPlaylist)
        : null,
      asset: screen.streamingType === 'ASSET' && screen.asset ? await this.hydrateAssetAsPlaylist(screen.organizationId, screen.asset) : null,
      wayfinding: wayfinding.payload,
      roomBooking,
      scheduleRules: await Promise.all(rules.map(async r => ({
        id: r.id,
        name: r.name,
        priority: r.priority,
        startTime: r.startTime,
        endTime: r.endTime,
        daysOfWeek: r.daysOfWeek,
        startDate: r.startDate?.toISOString() ?? null,
        endDate: r.endDate?.toISOString() ?? null,
        playlistId: r.playlistId,
        playlist: rulePlaylistMap[r.playlistId]
          ? await this.hydratePlaylist(screen.organizationId, rulePlaylistMap[r.playlistId]!)
          : null,
      }))),
      resolvedPlaylistId,
      defaultPlaylist: screen.streamingType === 'PLAYLIST' && screen.playlist ? await this.hydratePlaylist(screen.organizationId, screen.playlist) : null,
      poweredOn: power.poweredOn,
      powerScheduleRules: power.rules.map(r => ({
        id: r.id,
        daysOfWeek: r.daysOfWeek,
        startTime: r.startTime,
        endTime: r.endTime,
      })),
      volume,
      moduleLeases,
    };
  }

  async getManifest(screenId: string): Promise<PlayerContentManifest<Awaited<ReturnType<PlayerService['getState']>>>> {
    const desiredState = await this.getState(screenId);
    const references = collectManifestReferences(desiredState);
    if (references.unresolvedDependencies.length > 0) {
      throw new ConflictException({
        code: 'MANIFEST_DEPENDENCY_GRAPH_INCOMPLETE',
        message: 'Player content contains missing, cyclic, or depth-limited dependencies',
        dependencies: references.unresolvedDependencies,
      });
    }

    const referencedIds = [...references.assetPriorities.keys()];
    const owner = await this.prisma.screen.findUnique({ where: { id: screenId }, select: { organizationId: true } });
    if (!owner) throw new NotFoundException('Screen not found');
    const records = referencedIds.length
      ? await this.prisma.asset.findMany({
          // References are hydrated from this screen's content, but enforce ownership again at
          // the manifest boundary. organizationId=null is the shared system library/preset scope.
          where: {
            id: { in: referencedIds },
            OR: [{ organizationId: owner.organizationId }, { organizationId: null }],
          },
          include: { binaries: { orderBy: [{ kind: 'asc' }, { ordinal: 'asc' }] } },
        })
      : [];
    const foundIds = new Set(records.map(asset => asset.id));
    const missingIntegrity = referencedIds
      .filter(id => !foundIds.has(id))
      .map(id => `asset:${id}:not-found`);
    const assets: PlayerAssetManifestItem[] = [];
    const networkDependencies: PlayerNetworkDependency[] = [];

    for (const asset of records) {
      const priority = references.assetPriorities.get(asset.id) ?? 'fallback';
      if (asset.type === 'TEXT') continue;
      if (asset.type === 'APP') {
        const config = asset.appConfig as { embedUrl?: string; items?: { embedUrl?: string }[] } | null;
        networkDependencies.push({
          assetId: asset.id,
          type: 'application',
          providerId: asset.appProviderId,
          remoteUrl: asset.sourceUrl ?? config?.embedUrl ?? config?.items?.[0]?.embedUrl ?? null,
          priority,
          networkRequired: true,
        });
        continue;
      }
      if (asset.status !== 'READY') {
        missingIntegrity.push(`asset:${asset.id}:status-${asset.status.toLowerCase()}`);
        continue;
      }

      const requiredBinaries = asset.type === 'DOCUMENT'
        ? asset.binaries.filter(binary => binary.kind === 'DOCUMENT_PAGE')
        : asset.binaries.filter(binary => binary.kind === 'PRIMARY' && binary.ordinal === 0);
      if (requiredBinaries.length === 0) {
        missingIntegrity.push(`asset:${asset.id}:integrity-metadata-missing`);
        continue;
      }
      if (asset.type === 'DOCUMENT' && requiredBinaries.length !== (asset.pageCount ?? 0)) {
        missingIntegrity.push(`asset:${asset.id}:document-page-count-mismatch`);
        continue;
      }

      for (const binary of requiredBinaries) {
        const fileSize = Number(binary.sizeBytes);
        if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || !/^[a-f0-9]{64}$/i.test(binary.sha256)) {
          missingIntegrity.push(`asset:${asset.id}:invalid-integrity:${binary.id}`);
          continue;
        }
        const isPage = binary.kind === 'DOCUMENT_PAGE';
        assets.push({
          assetId: asset.id,
          binaryId: isPage ? `${asset.id}:page:${binary.ordinal}` : `${asset.id}:primary`,
          type: isPage ? 'document-page' : manifestAssetType(asset.type),
          remoteUrl: this.storage.publicUrl(binary.storageKey),
          binaryVersion: `sha256-${binary.sha256.toLowerCase()}`,
          sha256: binary.sha256.toLowerCase(),
          mimeType: binary.mimeType,
          fileSize,
          priority,
          networkRequired: false,
        });
      }
    }

    if (missingIntegrity.length > 0) {
      throw new ConflictException({
        code: 'MANIFEST_INTEGRITY_INCOMPLETE',
        message: 'One or more local media dependencies lack verified final binary metadata',
        dependencies: [...new Set(missingIntegrity)].sort(),
      });
    }

    assets.sort((a, b) => a.binaryId.localeCompare(b.binaryId));
    networkDependencies.sort((a, b) => a.assetId.localeCompare(b.assetId));
    const revisionInput = {
      schemaVersion: 1,
      desiredState,
      assets: assets.map(({ remoteUrl: _remoteUrl, ...asset }) => asset),
      networkDependencies,
      packagedFonts: references.packagedFonts,
    };
    return {
      schemaVersion: 1,
      screenId,
      contentRevision: manifestRevision(revisionInput),
      generatedAt: new Date().toISOString(),
      desiredState,
      assets,
      networkDependencies,
      packagedFonts: references.packagedFonts,
    };
  }

  // A raw Asset played standalone (Screen-level ASSET streaming mode, or a Zone's asset media
  // mode) has no PlaylistItem to carry a placement-specific duration/muted flag, so this
  // fabricates a single-item playlist reusing hydratePlaylist's URL/thumbnail/TEXT handling —
  // letting the player's existing single-item-playlist looping render it with no new code path.
  // durationSecs mirrors the PlaylistItem schema default; muted follows the asset's own audio
  // choice, since that's the only place such a choice can be recorded for a non-playlist placement.
  private hydrateAssetAsPlaylist(orgId: string | null, asset: {
    id: string; name: string; type: string; mimeType: string; storageKey: string; thumbnailKey: string | null; pageCount: number | null;
    textContent: string | null; textFontFamily: string | null; textColor: string | null; textSize: string | null; textBackgroundColor: string | null;
    textTickerEnabled: boolean; textTickerDirection: string; textTickerSpeed: number | null; textTickerCrossOffset: number | null;
    hasAudioTrack: boolean; audioEnabled: boolean; appProviderId: string | null; appConfig: unknown;
  }, crop?: { cropZoom?: number | null; cropOffsetX?: number | null; cropOffsetY?: number | null }): Promise<HydratedPlaylist> {
    return this.hydratePlaylist(orgId, {
      id: `asset:${asset.id}`,
      name: asset.name,
      transitionStyle: 'NONE',
      transitionDurationMs: 0,
      playbackOrder: 'SEQUENTIAL',
      items: [{
        id: `asset-item:${asset.id}`,
        position: 0,
        durationSecs: 10,
        // VIDEO only gets sound once a track's actually been detected on it; every other
        // audio-capable type (currently just APP/YouTube, which has no hasAudioTrack probe of
        // its own) just follows the asset's own audio toggle, defaulting to unmuted.
        muted: asset.type === 'VIDEO' ? (asset.hasAudioTrack ? !asset.audioEnabled : true) : !asset.audioEnabled,
        playFullVideo: true,
        cropZoom: crop?.cropZoom,
        cropOffsetX: crop?.cropOffsetX,
        cropOffsetY: crop?.cropOffsetY,
        kind: 'ASSET',
        assetId: asset.id,
        themeId: null,
        layoutId: null,
        designAssetId: null,
        asset,
      }],
    });
  }

  async uploadScreenshot(orgId: string, screenId: string, jpeg: Buffer) {
    await this.storage.upload(this.storage.screenshotKey(orgId, screenId), jpeg, 'image/jpeg');
    await this.prisma.screen.update({ where: { id: screenId }, data: { screenshotUpdatedAt: new Date() } });
    return { ok: true };
  }

  async ingestCrashReports(orgId: string, screenId: string, events: { type: string; summary: string; stackTrace?: string; occurredAt: string }[]) {
    if (events.length === 0) return { ok: true, count: 0 };
    const { count } = await this.prisma.crashReport.createMany({
      data: events.map(e => ({
        screenId,
        organizationId: orgId,
        type: e.type,
        summary: e.summary,
        stackTrace: e.stackTrace,
        occurredAt: new Date(e.occurredAt),
      })),
    });
    return { ok: true, count };
  }

  async heartbeat(
    screenId: string,
    _currentAssetId: string | null,
    hasContent?: boolean,
    telemetry?: HeartbeatTelemetry,
  ) {
    const screen = await this.prisma.screen.update({
      where: { id: screenId },
      data: {
        lastSeenAt: new Date(),
        status: 'ONLINE',
        // Only the player knows whether *right now* actually resolves to playable content
        // (schedule gaps, locally-resolved layout zones) — omit means "unchanged," not "false,"
        // so older player builds that don't send this yet don't flip screens to the badge.
        ...(hasContent !== undefined ? { hasContent } : {}),
        // Phase 12 sync telemetry — every field is independently optional so an older player
        // build (or a heartbeat sent before the first manifest sync completes) only updates
        // whatever it actually knows this tick, instead of zeroing out the rest.
        ...(telemetry?.syncState !== undefined ? { syncState: telemetry.syncState } : {}),
        ...(telemetry?.assetsTotal !== undefined ? { assetsTotal: telemetry.assetsTotal } : {}),
        ...(telemetry?.assetsReady !== undefined ? { assetsReady: telemetry.assetsReady } : {}),
        ...(telemetry?.assetsDownloading !== undefined
          ? { assetsDownloading: telemetry.assetsDownloading } : {}),
        ...(telemetry?.assetsFailed !== undefined ? { assetsFailed: telemetry.assetsFailed } : {}),
        ...(telemetry?.cacheBytes !== undefined ? { cacheBytes: BigInt(telemetry.cacheBytes) } : {}),
        ...(telemetry?.freeStorageBytes !== undefined
          ? { freeStorageBytes: BigInt(telemetry.freeStorageBytes) } : {}),
        ...(telemetry?.storagePersistent !== undefined
          ? { storagePersistent: telemetry.storagePersistent } : {}),
        ...(telemetry?.lastSuccessfulSyncAt !== undefined
          ? { lastSuccessfulSyncAt: new Date(telemetry.lastSuccessfulSyncAt) } : {}),
      },
    });
    if (screen.organizationId) {
      this.gateway.sendStatusToOrg(screen.organizationId, screenId, 'ONLINE');
    }
    return { ok: true };
  }

  /**
   * Theme elements reference assets/playlists by id (like layout zones do). Resolve IMAGE/VIDEO
   * elements to a signed-URL, DOCUMENT elements to per-page signed-URLs, PLAYLIST elements to a
   * fully hydrated playlist, and TEXT elements with an assetId to that TEXT asset's own
   * content/styling/ticker fields — everything else (SHAPE/WIDGET/BRUSH, and TEXT with no
   * assetId) passes through untouched.
   */
  private async hydrateThemeElements(orgId: string | null, elements: unknown, depth = 0): Promise<unknown> {
    if (!Array.isArray(elements)) return [];
    const els = elements as { kind: string; content: Record<string, unknown> }[];

    const assetIds = [...new Set(
      els.filter(e => e.kind === 'IMAGE' || e.kind === 'VIDEO' || e.kind === 'DOCUMENT' || e.kind === 'TEXT')
        .map(e => e.content.assetId as string | null)
        .filter((id): id is string => !!id),
    )];
    // A PLAYLIST element's playlist can itself now contain THEME/LAYOUT items that reference a
    // theme with its own PLAYLIST element, and so on — a cycle is representable in the data even
    // if nobody built one on purpose. Past MAX_PLAYLIST_ITEM_DEPTH (see hydratePlaylist), stop
    // resolving further and just leave these elements pointing at an id with no playlist data.
    const playlistIds = depth >= PlayerService.MAX_PLAYLIST_ITEM_DEPTH ? [] : [...new Set(
      els.filter(e => e.kind === 'PLAYLIST')
        .map(e => e.content.playlistId as string | null)
        .filter((id): id is string => !!id),
    )];

    const assets = assetIds.length
      ? await this.prisma.asset.findMany({ where: { id: { in: assetIds } } })
      : [];
    const assetMap = new Map(assets.map(a => [a.id, {
      // TEXT assets have no real object behind storageKey (see AssetsService.createText) — skip
      // resolving a url for them, same as hydratePlaylist below.
      url: a.type === 'TEXT' ? null : this.storage.publicUrl(a.storageKey),
      pageUrls: a.type === 'DOCUMENT' ? this.documentPageUrls(a.storageKey, a.pageCount) : [],
      textContent: a.textContent,
      textFontFamily: a.textFontFamily,
      textColor: a.textColor,
      textSize: a.textSize,
      textBackgroundColor: a.textBackgroundColor,
      textTickerEnabled: a.textTickerEnabled,
      textTickerDirection: a.textTickerDirection,
      textTickerSpeed: a.textTickerSpeed,
      textTickerCrossOffset: a.textTickerCrossOffset,
    }]));

    const playlists = playlistIds.length
      ? await this.prisma.playlist.findMany({
          where: { id: { in: playlistIds } },
          include: { items: { orderBy: { position: 'asc' }, include: { asset: true } } },
        })
      : [];
    const playlistMap = new Map(
      await Promise.all(playlists.map(async p => [p.id, await this.hydratePlaylist(orgId, p, depth + 1)] as const)),
    );

    return els.map(e => {
      if (e.kind === 'TEXT') {
        const assetId = e.content.assetId as string | null | undefined;
        const resolved = assetId ? assetMap.get(assetId) : undefined;
        return {
          ...e,
          content: {
            text: e.content.text,
            translations: e.content.translations,
            assetId: assetId ?? null,
            ...(resolved
              ? {
                  textContent: resolved.textContent,
                  textFontFamily: resolved.textFontFamily,
                  textColor: resolved.textColor,
                  textSize: resolved.textSize,
                  textBackgroundColor: resolved.textBackgroundColor,
                  textTickerEnabled: resolved.textTickerEnabled,
                  textTickerDirection: resolved.textTickerDirection,
                  textTickerSpeed: resolved.textTickerSpeed,
                  textTickerCrossOffset: resolved.textTickerCrossOffset,
                }
              : {}),
          },
        };
      }
      if (e.kind === 'IMAGE' || e.kind === 'VIDEO') {
        const assetId = e.content.assetId as string | null;
        return { ...e, content: { assetId, url: assetId ? (assetMap.get(assetId)?.url ?? null) : null } };
      }
      if (e.kind === 'DOCUMENT') {
        const assetId = e.content.assetId as string | null;
        return {
          ...e,
          content: {
            assetId,
            pageUrls: assetId ? (assetMap.get(assetId)?.pageUrls ?? []) : [],
            secondsPerPage: e.content.secondsPerPage,
          },
        };
      }
      if (e.kind === 'PLAYLIST') {
        const playlistId = e.content.playlistId as string | null;
        return { ...e, content: { playlistId, playlist: playlistId ? (playlistMap.get(playlistId) ?? null) : null } };
      }
      return e;
    });
  }

  private async hydratePlaylist(orgId: string | null, playlist: {
    id: string;
    name: string;
    transitionStyle: string;
    transitionDurationMs: number;
    playbackOrder: string;
    scaleSettings?: unknown;
    items: {
      id: string; position: number; durationSecs: number; muted: boolean; playFullVideo: boolean;
      cropZoom?: number | null; cropOffsetX?: number | null; cropOffsetY?: number | null;
      // Per-item transition override — undefined/null means "inherit the playlist's
      // transitionStyle/transitionDurationMs above" (resolved player-side, see
      // resolveEffectiveTransition in @lumina/types).
      transitionStyle?: string | null; transitionDurationMs?: number | null;
      kind: string; assetId?: string | null; themeId?: string | null; layoutId?: string | null; designAssetId?: string | null;
      asset: { id: string; name: string; type: string; mimeType: string; storageKey: string; thumbnailKey: string | null; pageCount: number | null; textContent: string | null; textFontFamily: string | null; textColor: string | null; textSize: string | null; textBackgroundColor: string | null; textTickerEnabled: boolean; textTickerDirection: string; textTickerSpeed: number | null; textTickerCrossOffset: number | null; appProviderId: string | null; appConfig: unknown } | null;
    }[];
  }, depth = 0): Promise<HydratedPlaylist> {
    const canExpand = depth < PlayerService.MAX_PLAYLIST_ITEM_DEPTH;
    const items = await Promise.all(playlist.items.map(async item => {
      const base = {
        id: item.id,
        position: item.position,
        durationSecs: item.durationSecs,
        muted: item.muted,
        playFullVideo: item.playFullVideo,
        cropZoom: item.cropZoom ?? null,
        cropOffsetX: item.cropOffsetX ?? null,
        cropOffsetY: item.cropOffsetY ?? null,
        transitionStyle: item.transitionStyle ?? null,
        transitionDurationMs: item.transitionDurationMs ?? null,
        kind: item.kind,
      };

      if (item.kind === 'THEME' && item.themeId && canExpand) {
        const theme = await this.prisma.theme.findUnique({ where: { id: item.themeId } });
        return {
          ...base,
          asset: null,
          layout: null,
          design: null,
          theme: theme
            ? {
                id: theme.id,
                name: theme.name,
                category: theme.category,
                aspectRatio: theme.aspectRatio,
                palette: theme.palette,
                typography: theme.typography,
                elements: await this.hydrateThemeElements(orgId, theme.elements, depth + 1),
              }
            : null,
        };
      }

      if (item.kind === 'LAYOUT' && item.layoutId && canExpand) {
        const layout = await this.prisma.layout.findUnique({
          where: { id: item.layoutId },
          include: {
            zones: {
              orderBy: { zIndex: 'asc' },
              include: {
                playlist: { include: { items: { orderBy: { position: 'asc' }, include: { asset: true } } } },
                asset: true,
              },
            },
          },
        });
        return {
          ...base,
          asset: null,
          theme: null,
          design: null,
          layout: layout ? { id: layout.id, name: layout.name, zones: await this.hydrateZones(orgId, layout.zones, depth + 1) } : null,
        };
      }

      // designer.md Phase 11 — no depth-cap concern here the way THEME/LAYOUT have: a Design
      // can't reference a playlist (no PLAYLIST-kind element in DesignElement at all), so there's
      // no cycle to bound.
      if (item.kind === 'DESIGN' && item.designAssetId) {
        const designAsset = await this.prisma.designAsset.findFirst({ where: { id: item.designAssetId, deletedAt: null } });
        return {
          ...base,
          asset: null,
          theme: null,
          layout: null,
          design: designAsset ? await this.hydrateDesign(orgId, designAsset) : null,
        };
      }

      // ASSET kind (the common case), or a THEME/LAYOUT item past the depth cap — either way,
      // nothing further to expand, and an ASSET item always carries its asset per the CHECK
      // constraint enforced at the DB level.
      if (!item.asset) return { ...base, asset: null, theme: null, layout: null, design: null };

      // TEXT assets have no real object behind storageKey (see AssetsService.createText) —
      // the player renders textContent directly instead of loading a url.
      const isText = item.asset.type === 'TEXT';
      return {
        ...base,
        theme: null,
        layout: null,
        design: null,
        asset: {
          id: item.asset.id,
          name: item.asset.name,
          type: item.asset.type,
          mimeType: item.asset.mimeType,
          url: isText ? null : this.storage.publicUrl(item.asset.storageKey),
          thumbnailUrl: !isText && item.asset.thumbnailKey
            ? this.storage.publicUrl(item.asset.thumbnailKey)
            : null,
          // Per-page images for DOCUMENT assets — durationSecs above doubles as "seconds per
          // page" for this type, cycled through client-side (see ZonePlayer).
          pageUrls: item.asset.type === 'DOCUMENT'
            ? this.documentPageUrls(item.asset.storageKey, item.asset.pageCount)
            : [],
          textContent: item.asset.textContent,
          textFontFamily: item.asset.textFontFamily,
          textColor: item.asset.textColor,
          textSize: item.asset.textSize,
          textBackgroundColor: item.asset.textBackgroundColor,
          textTickerEnabled: item.asset.textTickerEnabled,
          textTickerDirection: item.asset.textTickerDirection,
          textTickerSpeed: item.asset.textTickerSpeed,
          textTickerCrossOffset: item.asset.textTickerCrossOffset,
          appProviderId: item.asset.appProviderId,
          appConfig: item.asset.appConfig,
        },
      };
    }));
    return {
      id: playlist.id,
      name: playlist.name,
      transitionStyle: playlist.transitionStyle,
      transitionDurationMs: playlist.transitionDurationMs,
      playbackOrder: playlist.playbackOrder,
      scaleSettings: playlist.scaleSettings ?? null,
      items,
    };
  }

  // designer.md §23.1/Phase 11 — turns a stored DesignAsset (raw designJson, possibly with
  // unresolved {{variable}} tokens and bare assetIds) into a ResolvedDesignPayload (§23.1's
  // Player contract: variables substituted, every media reference a real URL). Mirrors
  // hydrateThemeElements's batch-asset-resolution shape, plus the variable-resolution step Theme
  // has no equivalent of.
  private async hydrateDesign(orgId: string | null, designAsset: { designJson: unknown }): Promise<ResolvedDesignPayload | null> {
    const parsed = DesignDocumentSchema.safeParse(designAsset.designJson);
    if (!parsed.success) return null;
    const document = parsed.data;

    // designer.md §17.2 — same source/precedence CanvasViewport.tsx already uses client-side for
    // the Designer's own live preview: {{business.name}} auto-seeded from Organization.name
    // (the only field that exists for it — see designer.md Phase 8's amendment), overridable by
    // this document's own instance variables.
    const org = orgId ? await this.prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } }) : null;
    const variables: VariableMap = { ...(org ? { 'business.name': org.name } : {}), ...document.variables };

    const assetIds = new Set<string>();
    for (const scene of document.scenes) {
      if (scene.background.type !== 'color') assetIds.add(scene.background.assetId);
      for (const element of scene.elements) {
        if (element.type === 'image' && element.assetId) assetIds.add(element.assetId);
        if (element.type === 'video') {
          if (element.assetId) assetIds.add(element.assetId);
          if (element.posterAssetId) assetIds.add(element.posterAssetId);
        }
      }
    }
    const assets = assetIds.size ? await this.prisma.asset.findMany({ where: { id: { in: [...assetIds] } } }) : [];
    const urlMap = new Map(assets.map(a => [a.id, this.storage.publicUrl(a.storageKey)]));

    const scenes: ResolvedScene[] = await Promise.all(document.scenes.map(async scene => ({
      id: scene.id,
      durationMs: scene.durationMs,
      background:
        scene.background.type === 'color'
          ? { type: 'color' as const, color: scene.background.color }
          : { type: scene.background.type, assetId: scene.background.assetId, resolvedSrc: urlMap.get(scene.background.assetId) },
      elements: await Promise.all(
        scene.elements.map(element => this.resolveDesignElement(resolveElementBindings(element, variables), urlMap)),
      ),
    })));

    return { schemaVersion: 1, id: document.id, canvas: document.canvas, scenes };
  }

  // QR elements are rendered to a data URL here (server-side, same `qrcode` package the Designer
  // and Player-adjacent apps already use) rather than shipping a QR library to the player at
  // all — resolvedSrc already means "a ready-to-render image" for Image/Video, so QR just reuses
  // that same field instead of inventing a second resolved-content shape.
  private async resolveDesignElement(element: DesignElement, urlMap: Map<string, string>): Promise<ResolvedElement> {
    if (element.type === 'image') {
      return { ...element, resolvedSrc: element.assetId ? urlMap.get(element.assetId) : undefined };
    }
    if (element.type === 'video') {
      return {
        ...element,
        resolvedSrc: element.assetId ? urlMap.get(element.assetId) : undefined,
        posterResolvedSrc: element.posterAssetId ? urlMap.get(element.posterAssetId) : undefined,
      };
    }
    if (element.type === 'qr' && element.value?.trim()) {
      try {
        const resolvedSrc = await QRCode.toDataURL(element.value, {
          margin: 1,
          color: { dark: element.foregroundColor, light: element.backgroundColor },
          errorCorrectionLevel: element.errorCorrection,
        });
        return { ...element, resolvedSrc };
      } catch {
        return element;
      }
    }
    return element;
  }

  // Shared by a LAYOUT-kind playlist item (via hydratePlaylist above) — Screen-level LAYOUT
  // streaming mode is gone, so this is its only caller now.
  private async hydrateZones(
    orgId: string | null,
    zones: {
      id: string; name: string; x: number; y: number; width: number; height: number; zIndex: number; rotation: number;
      zoneType: string; shape: string; widgetConfig: unknown; audioPriority: boolean; audioVolume: number | null;
      cropZoom: number | null; cropOffsetX: number | null; cropOffsetY: number | null;
      playlist: Parameters<PlayerService['hydratePlaylist']>[1] | null;
      asset: Parameters<PlayerService['hydrateAssetAsPlaylist']>[1] | null;
    }[],
    depth = 0,
  ): Promise<HydratedZone[]> {
    return Promise.all(zones.map(async z => ({
      id: z.id,
      name: z.name,
      x: z.x,
      y: z.y,
      width: z.width,
      height: z.height,
      zIndex: z.zIndex,
      rotation: z.rotation,
      zoneType: z.zoneType,
      shape: z.shape,
      widgetConfig: z.widgetConfig,
      audioPriority: z.audioPriority,
      audioVolume: z.audioVolume,
      // A zone's MEDIA content is either a playlist or a single asset, never both (enforced
      // in LayoutsService) — asset wins the null-coalesce below only because at most one of
      // the two is ever actually set.
      playlist: z.playlist
        ? await this.hydratePlaylist(orgId, z.playlist, depth)
        : z.asset
          ? await this.hydrateAssetAsPlaylist(orgId, z.asset, { cropZoom: z.cropZoom, cropOffsetX: z.cropOffsetX, cropOffsetY: z.cropOffsetY })
          : null,
    })));
  }

  // Reconstructs the derived page-image keys media.processor.ts uploaded during DOCUMENT
  // conversion (1-indexed `_p${n}.webp` siblings of storageKey) into signed/public URLs.
  private documentPageUrls(storageKey: string, pageCount: number | null): string[] {
    return Array.from({ length: pageCount ?? 0 }, (_, i) =>
      this.storage.publicUrl(storageKey.replace(/(\.[^.]+)$/, `_p${i + 1}.webp`)),
    );
  }
}

function manifestAssetType(type: string): PlayerManifestAssetType {
  if (type === 'VIDEO') return 'video';
  if (type === 'IMAGE') return 'image';
  if (type === 'AUDIO') return 'audio';
  return 'other';
}
