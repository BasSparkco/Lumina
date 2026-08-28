import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { StreamingType } from '@lumina/db';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ScreenGateway } from '../ws/screen.gateway';
import { OrgScopedService } from '../../common/org-scoped.service';
import type { CreateScreenDto } from './dto/create-screen.dto';
import type { UpdatePrayerDto } from './dto/update-prayer.dto';

const CRASH_ROLLUP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class ScreensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly gateway: ScreenGateway,
    private readonly storage: StorageService,
    private readonly orgScoped: OrgScopedService,
  ) {}

  // Screen setting changes push to the screen immediately only when the org has opted into
  // auto-publish; otherwise they're saved but held back until the explicit Publish button
  // (publishToScreen, below) fires the same 'publish' push.
  private async isAutoPublishEnabled(orgId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { autoPublish: true } });
    return org?.autoPublish ?? false;
  }

  private async pushIfAutoPublish(orgId: string, screenId: string) {
    if (await this.isAutoPublishEnabled(orgId)) {
      this.gateway.sendToScreen(screenId, { type: 'publish' });
    }
  }

  private withScreenshotUrl<T extends { id: string; organizationId: string | null; screenshotUpdatedAt: Date | null }>(screen: T) {
    return {
      ...screen,
      screenshotUrl: screen.screenshotUpdatedAt && screen.organizationId
        ? this.storage.publicUrl(this.storage.screenshotKey(screen.organizationId, screen.id))
        : null,
    };
  }

  async create(orgId: string, dto: CreateScreenDto) {
    return this.prisma.screen.create({
      data: {
        name: dto.name,
        timezone: dto.timezone ?? 'UTC',
        organizationId: orgId,
      },
    });
  }

  async list(orgId: string) {
    const screens = await this.prisma.screen.findMany({
      where: { organizationId: orgId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      include: {
        playlist: { select: { id: true, name: true } },
        // Without this, the dashboard's Screens page (which lists off this endpoint, not
        // findOne) always saw kioskLocation as undefined — the kiosk floor/pin picker looked
        // like it forgot the saved location on every refetch even though it was still in the DB.
        kioskLocation: { include: { floor: { include: { building: { select: { id: true, name: true } } } } } },
      },
    });
    return screens.map(s => this.withScreenshotUrl(s));
  }

  async findOne(orgId: string, id: string) {
    const screen = await this.orgScoped.assertOwns(
      () => this.prisma.screen.findFirst({
        where: { id, organizationId: orgId },
        include: {
          playlist: { select: { id: true, name: true } },
          kioskLocation: { include: { floor: { include: { building: { select: { id: true, name: true } } } } } },
        },
      }),
      'Screen not found',
    );
    return this.withScreenshotUrl(screen);
  }

  async remove(orgId: string, id: string) {
    const screen = await this.findOne(orgId, id);
    if (screen.screenshotUpdatedAt) await this.storage.delete(this.storage.screenshotKey(orgId, id));
    // Unlike `unpair`, this row (and any pairing code re-pairing could hand back) is gone for
    // good, so there's nothing to hand the device to resume into — just tell it to drop its
    // credentials and go request a brand new pairing. Without this the player never learns its
    // screen was deleted: its JWT keeps verifying (10y expiry, no DB check on the socket or
    // JWT guard), so it silently loops its last cached playlist forever.
    this.gateway.sendToScreen(id, { type: 'deleted' });
    await this.prisma.screen.delete({ where: { id } });
  }

  // Distinct from `remove`: keeps the screen's row (name, history, settings) so it still shows
  // up in the dashboard, but disconnects the paired device — its player JWT has no expiry-side
  // revocation, so a still-online player is told over the socket to drop its stored credentials
  // and go back to the pairing screen; a fresh pairing code is generated for whatever device
  // re-pairs into this screen next (the same one, or a swapped-in replacement).
  async unpair(orgId: string, id: string) {
    await this.findOne(orgId, id);

    let code: string;
    let attempts = 0;
    do {
      code = Math.random().toString(36).substring(2, 8).toUpperCase();
      attempts++;
    } while (attempts < 10 && (await this.prisma.screen.findUnique({ where: { pairingCode: code } })));

    const updated = await this.prisma.screen.update({
      where: { id },
      data: { paired: false, playerToken: null, pairingCode: code, status: 'OFFLINE' },
    });
    // Hands the new code straight to the still-connected device rather than making it request
    // its own via /player/init — that would mint an unrelated orphan screen row instead of
    // re-pairing back into this one, losing its name/history/settings in the dashboard.
    this.gateway.sendToScreen(id, { type: 'unpair', pairingCode: code });
    return updated;
  }

  async rename(orgId: string, id: string, name: string) {
    await this.findOne(orgId, id);
    return this.prisma.screen.update({ where: { id }, data: { name } });
  }

  async reorder(orgId: string, orderedIds: string[]) {
    const ownedCount = await this.prisma.screen.count({
      where: { id: { in: orderedIds }, organizationId: orgId },
    });
    if (ownedCount !== orderedIds.length) throw new NotFoundException('Screen not found');
    // No unique constraint on sortOrder, so (as with PlaylistsService.reorderPlaylists) a
    // single-pass update can't collide mid-transaction — just write final values directly.
    await this.prisma.$transaction(
      orderedIds.map((id, i) => this.prisma.screen.update({ where: { id }, data: { sortOrder: i } })),
    );
  }

  async assignPlaylist(orgId: string, screenId: string, playlistId: string | null) {
    const screen = await this.findOne(orgId, screenId);
    if (playlistId) {
      const playlist = await this.orgScoped.assertOwns(
        () => this.prisma.playlist.findFirst({ where: { id: playlistId, organizationId: orgId } }),
        'Playlist not found',
      );
      if (playlist.approvalStatus !== 'APPROVED') {
        throw new BadRequestException('Only approved playlists can be assigned to a screen');
      }
    }
    const updated = await this.prisma.screen.update({
      where: { id: screen.id },
      data: { playlistId },
    });
    await this.pushIfAutoPublish(orgId, screenId);
    return updated;
  }

  // Unlike assignPlaylist, this never touches playlistId/assetId — those stay exactly as they
  // were, so switching types and back restores whatever was last chosen in each.
  async setStreamingType(orgId: string, screenId: string, streamingType: StreamingType) {
    await this.findOne(orgId, screenId);
    const updated = await this.prisma.screen.update({ where: { id: screenId }, data: { streamingType } });
    await this.pushIfAutoPublish(orgId, screenId);
    return updated;
  }

  async setAsset(orgId: string, screenId: string, assetId: string | null) {
    await this.findOne(orgId, screenId);
    if (assetId) {
      const asset = await this.orgScoped.assertOwns(
        () => this.prisma.asset.findFirst({ where: { id: assetId, organizationId: orgId } }),
        'Asset not found',
      );
      if (asset.status !== 'READY') throw new BadRequestException('Only ready assets can be assigned to a screen');
    }
    const updated = await this.prisma.screen.update({ where: { id: screenId }, data: { assetId } });
    await this.pushIfAutoPublish(orgId, screenId);
    return updated;
  }

  // Binds a screen to a "you are here" floor coordinate for wayfinding (Phase 7) — the target
  // lives in its own KioskLocation table (it carries x/y placement, not just a foreign key)
  // rather than a column on Screen. Deliberately doesn't touch streamingType, same as setAsset —
  // the dashboard flips that separately via setStreamingType so switching types and back doesn't
  // lose the binding.
  async setKioskLocation(orgId: string, screenId: string, floorId: string, x: number, y: number) {
    await this.findOne(orgId, screenId);
    await this.orgScoped.assertOwns(
      () => this.prisma.floor.findFirst({ where: { id: floorId, building: { organizationId: orgId } } }),
      'Floor not found',
    );
    const updated = await this.prisma.kioskLocation.upsert({
      where: { screenId },
      create: { screenId, floorId, x, y },
      update: { floorId, x, y },
    });
    await this.pushIfAutoPublish(orgId, screenId);
    return updated;
  }

  async clearKioskLocation(orgId: string, screenId: string) {
    await this.findOne(orgId, screenId);
    await this.prisma.kioskLocation.deleteMany({ where: { screenId } });
    await this.pushIfAutoPublish(orgId, screenId);
    return { ok: true };
  }

  // Idle/attract-loop content (Phase 7.2) — a Playlist or Theme shown on the kiosk map while
  // untouched. Requires a KioskLocation to already exist (there's nothing to attach attract
  // content to otherwise); picking one clears the other, same "only one live at a time" pattern
  // as assignPlaylist clearing layoutId.
  async setKioskAttractPlaylist(orgId: string, screenId: string, playlistId: string | null) {
    await this.findOne(orgId, screenId);
    const kiosk = await this.prisma.kioskLocation.findUnique({ where: { screenId } });
    if (!kiosk) throw new NotFoundException('Set a kiosk floor/location before choosing attract-loop content');
    if (playlistId) {
      const playlist = await this.orgScoped.assertOwns(
        () => this.prisma.playlist.findFirst({ where: { id: playlistId, organizationId: orgId } }),
        'Playlist not found',
      );
      if (playlist.approvalStatus !== 'APPROVED') {
        throw new BadRequestException('Only approved playlists can be used as attract-loop content');
      }
    }
    const updated = await this.prisma.kioskLocation.update({
      where: { screenId },
      data: { attractPlaylistId: playlistId, ...(playlistId ? { attractThemeId: null } : {}) },
    });
    await this.pushIfAutoPublish(orgId, screenId);
    return updated;
  }

  async setKioskAttractTheme(orgId: string, screenId: string, themeId: string | null) {
    await this.findOne(orgId, screenId);
    const kiosk = await this.prisma.kioskLocation.findUnique({ where: { screenId } });
    if (!kiosk) throw new NotFoundException('Set a kiosk floor/location before choosing attract-loop content');
    if (themeId) {
      await this.orgScoped.assertOwns(
        () => this.prisma.theme.findFirst({
          where: { id: themeId, OR: [{ organizationId: null }, { organizationId: orgId }] },
        }),
        'Theme not found',
      );
    }
    const updated = await this.prisma.kioskLocation.update({
      where: { screenId },
      data: { attractThemeId: themeId, ...(themeId ? { attractPlaylistId: null } : {}) },
    });
    await this.pushIfAutoPublish(orgId, screenId);
    return updated;
  }

  async publishToScreen(orgId: string, screenId: string) {
    await this.findOne(orgId, screenId);
    this.gateway.sendToScreen(screenId, { type: 'publish' });
    return { ok: true };
  }

  async reloadScreen(orgId: string, screenId: string) {
    await this.findOne(orgId, screenId);
    this.gateway.sendToScreen(screenId, { type: 'reload' });
    return { ok: true };
  }

  // Stronger than reloadScreen: clears the player's own IndexedDB cache (cached playlist/asset
  // data — see apps/player/src/lib/db.ts) before reloading, and a fresh page load also gives the
  // browser's service worker a chance to fetch a newer deployed bundle. Exists as its own command
  // (not folded into reload) since a plain reload doesn't clear anything — most of the time
  // that's what you want (fast, no re-fetching), this is for when the player seems stuck on old
  // cached data/code and a plain reload alone doesn't shake it loose.
  async clearCacheScreen(orgId: string, screenId: string) {
    await this.findOne(orgId, screenId);
    this.gateway.sendToScreen(screenId, { type: 'clear-cache' });
    return { ok: true };
  }

  async captureScreenshot(orgId: string, screenId: string) {
    await this.findOne(orgId, screenId);
    this.gateway.sendToScreen(screenId, { type: 'capture-screenshot' });
    return { ok: true };
  }

  // Custom Player (appsroadmap.md Phase 9) — remote control of whatever video the screen is
  // currently playing. Fire-and-forget over the socket, same shape as publish/reload/
  // capture-screenshot above; the player itself decides whether anything controllable is on
  // screen right now (see Phase 10), so there's nothing to validate here beyond screen ownership.
  async pauseScreen(orgId: string, screenId: string) {
    await this.findOne(orgId, screenId);
    this.gateway.sendToScreen(screenId, { type: 'pause' });
    return { ok: true };
  }

  async resumeScreen(orgId: string, screenId: string) {
    await this.findOne(orgId, screenId);
    this.gateway.sendToScreen(screenId, { type: 'resume' });
    return { ok: true };
  }

  async seekScreen(orgId: string, screenId: string, toSeconds: number) {
    await this.findOne(orgId, screenId);
    this.gateway.sendToScreen(screenId, { type: 'seek', toSeconds });
    return { ok: true };
  }

  async setScreenSpeed(orgId: string, screenId: string, rate: number) {
    await this.findOne(orgId, screenId);
    this.gateway.sendToScreen(screenId, { type: 'setSpeed', rate });
    return { ok: true };
  }

  async crashReports(orgId: string, screenId: string) {
    await this.findOne(orgId, screenId);
    return this.prisma.crashReport.findMany({
      where: { screenId, organizationId: orgId },
      orderBy: { occurredAt: 'desc' },
      take: 20,
    });
  }

  // Emergency/evacuation override — unlike ordinary content edits (pushIfAutoPublish), this
  // always pushes instantly regardless of the org's autoPublish setting: a safety toggle can't
  // sit waiting on someone to remember to click Publish. See also BuildingsService.setEvacuation,
  // which calls this per-screen for every kiosk in a building during a drill/real evacuation.
  async setEmergency(orgId: string, screenId: string, active: boolean, playlistId?: string) {
    await this.findOne(orgId, screenId);
    if (playlistId) {
      await this.orgScoped.assertOwns(
        () => this.prisma.playlist.findFirst({ where: { id: playlistId, organizationId: orgId } }),
        'Playlist not found',
      );
    }
    const updated = await this.prisma.screen.update({
      where: { id: screenId },
      data: { emergencyActive: active, ...(playlistId ? { emergencyPlaylistId: playlistId } : {}) },
    });
    this.gateway.sendToScreen(screenId, { type: 'publish' });
    return updated;
  }

  async setStopped(orgId: string, screenId: string, stopped: boolean) {
    await this.findOne(orgId, screenId);
    const updated = await this.prisma.screen.update({ where: { id: screenId }, data: { stopped } });
    await this.pushIfAutoPublish(orgId, screenId);
    return updated;
  }

  async setShowClock(orgId: string, screenId: string, showClock: boolean) {
    await this.findOne(orgId, screenId);
    const updated = await this.prisma.screen.update({ where: { id: screenId }, data: { showClock } });
    this.gateway.sendToScreen(screenId, { type: 'publish' });
    return updated;
  }

  async setOrientation(orgId: string, screenId: string, orientation: 0 | 90 | 180 | 270) {
    await this.findOne(orgId, screenId);
    const updated = await this.prisma.screen.update({ where: { id: screenId }, data: { orientation } });
    this.gateway.sendToScreen(screenId, { type: 'publish' });
    return updated;
  }

  async setAspectRatio(orgId: string, screenId: string, aspectRatio: '16:9' | '9:16' | 'stretch') {
    await this.findOne(orgId, screenId);
    const updated = await this.prisma.screen.update({ where: { id: screenId }, data: { aspectRatio } });
    this.gateway.sendToScreen(screenId, { type: 'publish' });
    return updated;
  }

  async updatePrayerConfig(orgId: string, screenId: string, dto: UpdatePrayerDto) {
    await this.findOne(orgId, screenId);
    const updated = await this.prisma.screen.update({
      where: { id: screenId },
      data: {
        ...(dto.latitude !== undefined ? { latitude: dto.latitude } : {}),
        ...(dto.longitude !== undefined ? { longitude: dto.longitude } : {}),
        ...(dto.prayerMethod !== undefined ? { prayerMethod: dto.prayerMethod } : {}),
        ...(dto.athanEnabled !== undefined ? { athanEnabled: dto.athanEnabled } : {}),
        ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
        ...(dto.timezoneEnabled !== undefined ? { timezoneEnabled: dto.timezoneEnabled } : {}),
      },
    });
    // Without this, a screen already displaying a Prayer/Weather zone keeps showing "no
    // location set" (or stale times) until its next periodic 60s state refresh — every other
    // screen setter below pushes live, this one silently didn't.
    await this.pushIfAutoPublish(orgId, screenId);
    return updated;
  }

  async setVolume(orgId: string, screenId: string, volume: number | null) {
    await this.findOne(orgId, screenId);
    const clamped = volume === null ? null : Math.max(0, Math.min(100, Math.round(volume)));
    const updated = await this.prisma.screen.update({ where: { id: screenId }, data: { volume: clamped } });
    await this.pushIfAutoPublish(orgId, screenId);
    return updated;
  }

  async setGroup(orgId: string, screenId: string, groupId: string | null) {
    await this.findOne(orgId, screenId);
    if (groupId) {
      await this.orgScoped.assertOwns(
        () => this.prisma.screenGroup.findFirst({ where: { id: groupId, organizationId: orgId } }),
        'Screen group not found',
      );
    }
    return this.prisma.screen.update({ where: { id: screenId }, data: { groupId } });
  }

  async fleetStatus(orgId: string) {
    const screens = await this.prisma.screen.findMany({
      where: { organizationId: orgId },
      orderBy: { name: 'asc' },
      include: {
        alerts: { where: { resolvedAt: null }, orderBy: { createdAt: 'desc' } },
      },
    });

    const crashCounts = await this.prisma.crashReport.groupBy({
      by: ['screenId'],
      where: { organizationId: orgId, occurredAt: { gte: new Date(Date.now() - CRASH_ROLLUP_WINDOW_MS) } },
      _count: { id: true },
    });
    const crashCountByScreen = Object.fromEntries(crashCounts.map(c => [c.screenId, c._count.id]));

    const now = Date.now();
    const items = screens.map(s => ({
      id: s.id,
      name: s.name,
      status: s.status,
      lastSeenAt: s.lastSeenAt,
      offlineForMs: s.status === 'OFFLINE' && s.lastSeenAt ? now - s.lastSeenAt.getTime() : null,
      alerts: s.alerts,
      crashCount7d: crashCountByScreen[s.id] ?? 0,
    }));

    return {
      total: items.length,
      online: items.filter(i => i.status === 'ONLINE').length,
      offline: items.filter(i => i.status === 'OFFLINE').length,
      screens: items,
    };
  }

  // Dashboard: confirm a pairing code → associates screen with org, returns screen
  async confirmPairing(orgId: string, code: string) {
    const screen = await this.prisma.screen.findUnique({ where: { pairingCode: code } });
    if (!screen) throw new BadRequestException('Invalid or expired pairing code');
    if (screen.paired) throw new BadRequestException('Screen already paired');

    const token = this.jwt.sign(
      { sub: screen.id, orgId, type: 'screen' },
      { expiresIn: '10y' },
    );

    // Give still-default-named screens a running serial ("Unnamed Screen 3") instead of a
    // bare, indistinguishable "Unnamed Screen" — based on how many screens this org already
    // has, so the number reflects the order they were added in even once some get renamed.
    const name = screen.name === 'Unnamed Screen'
      ? `Unnamed Screen ${(await this.prisma.screen.count({ where: { organizationId: orgId } })) + 1}`
      : screen.name;

    // Compare-and-swap: `paired: false` is re-checked here, at the moment of the actual write,
    // not just in the read above — a single UPDATE's WHERE clause is evaluated and applied
    // atomically per row by Postgres. Two concurrent pair attempts on the same code (e.g. a
    // client retry after a timeout) used to both pass the `screen.paired` check above and race
    // on the plain `update` that followed, silently reassigning the screen's organizationId/
    // playerToken to whichever request's write landed last. Now only the first one's WHERE
    // clause still matches by the time it runs; the second gets `count: 0` back instead.
    const result = await this.prisma.screen.updateMany({
      where: { id: screen.id, paired: false },
      data: { paired: true, pairingCode: null, playerToken: token, organizationId: orgId, name },
    });
    if (result.count === 0) throw new BadRequestException('Screen already paired');

    return this.prisma.screen.findUniqueOrThrow({ where: { id: screen.id } });
  }
}
