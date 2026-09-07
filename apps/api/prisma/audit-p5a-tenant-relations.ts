import { PrismaClient } from '@lumina/db';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

// Read-only pre-migration audit for P5a (docs/tenant_isolation_and_platform_admin_plan.md §P5a
// "Pre-migration audits and decisions"). Makes no writes. Every check below either (a) counts rows
// that would violate a composite tenant foreign key/constraint P5a proposes to add, or (b) answers
// one of the plan's four explicit pre-migration questions. A clean report means the corresponding
// constraint can be added without a repair migration; a non-empty one means real rows need an
// explicit decision (never an automatic guess — plan §5.4) before that constraint is enabled.
let totalIssues = 0;

async function report(label: string, rows: unknown[]) {
  if (rows.length === 0) {
    console.log(`[OK] ${label}: 0`);
    return;
  }
  totalIssues += rows.length;
  console.log(`[ISSUE] ${label}: ${rows.length}`);
  for (const row of rows.slice(0, 10)) console.log('   -', JSON.stringify(row));
  if (rows.length > 10) console.log(`   ... and ${rows.length - 10} more`);
}

async function main() {
  // P5a task 1 originally counted unowned Screen rows (organizationId IS NULL) — resolved
  // 2026-09-05 (68 found, all genuinely abandoned pairing attempts, deleted) and structurally
  // closed for good by the schema-task-4 migration that made Screen.organizationId NOT NULL: a
  // Screen row can no longer exist without a tenant. `POST /player/init` now creates a
  // short-lived PairingSession instead — this replaces the old check with the equivalent
  // "accumulating unclaimed rows" watch on that table.
  console.log('=== P5a task 1 (superseded): stale/outstanding PairingSession rows ===');
  const pairingSessions = await prisma.pairingSession.findMany({
    select: { id: true, pairingCode: true, createdAt: true },
  });
  const now = Date.now();
  const buckets = { under1h: 0, under1d: 0, under7d: 0, older: 0 };
  for (const s of pairingSessions) {
    const ageMs = now - s.createdAt.getTime();
    if (ageMs < 60 * 60 * 1000) buckets.under1h++;
    else if (ageMs < 24 * 60 * 60 * 1000) buckets.under1d++;
    else if (ageMs < 7 * 24 * 60 * 60 * 1000) buckets.under7d++;
    else buckets.older++;
  }
  console.log(`Total outstanding: ${pairingSessions.length}`, buckets);
  if (buckets.older > 0) {
    console.log(`  ${buckets.older} row(s) older than 7 days — apps/worker's pairing-cleanup cron (15-min TTL) should have reaped these; investigate why it hasn't rather than deleting by hand.`);
  }

  console.log('\n=== P5a task 2: DesignDraft duplicates under the proposed (organizationId, userId, documentId) scope ===');
  const draftDupes = await prisma.$queryRaw<{ organizationid: string; userid: string; documentid: string; count: bigint }[]>`
    SELECT "organizationId" as organizationid, "userId" as userid, "documentId" as documentid, COUNT(*) as count
    FROM "DesignDraft" GROUP BY "organizationId", "userId", "documentId" HAVING COUNT(*) > 1`;
  await report('DesignDraft rows sharing (org, user, documentId)', draftDupes);
  console.log('  Note: documentId is currently globally @unique, which already forbids any duplicate under a narrower scope — a clean result here is expected, not just lucky.');

  console.log('\n=== P5a task 3: AuditLog.userId belonging to a different org than AuditLog.organizationId ===');
  const crossOrgAudit = await prisma.$queryRaw<{ auditlogid: string; action: string; auditorg: string; useractualorg: string; userid: string }[]>`
    SELECT a.id as auditlogid, a.action, a."organizationId" as auditorg, u."organizationId" as useractualorg, a."userId" as userid
    FROM "AuditLog" a JOIN "User" u ON u.id = a."userId"
    WHERE a."organizationId" != u."organizationId"`;
  await report('AuditLog rows with a cross-org actor', crossOrgAudit);
  if (crossOrgAudit.length > 0) {
    const byAction = new Map<string, number>();
    for (const r of crossOrgAudit) byAction.set(r.action, (byAction.get(r.action) ?? 0) + 1);
    console.log('  By action:', Object.fromEntries(byAction));
  }

  console.log('\n=== P5a task 4 / schema task 2: composite tenant FK candidates ===');

  await report('Screen.playlistId pointing at another org\'s Playlist', await prisma.$queryRaw`
    SELECT s.id as screenid, s."organizationId" as screenorg, p."organizationId" as playlistorg
    FROM "Screen" s JOIN "Playlist" p ON p.id = s."playlistId"
    WHERE s."organizationId" IS DISTINCT FROM p."organizationId"`);

  await report('Screen.emergencyPlaylistId pointing at another org\'s Playlist', await prisma.$queryRaw`
    SELECT s.id as screenid, s."organizationId" as screenorg, p."organizationId" as playlistorg
    FROM "Screen" s JOIN "Playlist" p ON p.id = s."emergencyPlaylistId"
    WHERE s."organizationId" IS DISTINCT FROM p."organizationId"`);

  await report('Screen.assetId pointing at another (non-shared) org\'s Asset', await prisma.$queryRaw`
    SELECT s.id as screenid, s."organizationId" as screenorg, a."organizationId" as assetorg
    FROM "Screen" s JOIN "Asset" a ON a.id = s."assetId"
    WHERE a."organizationId" IS NOT NULL AND s."organizationId" IS DISTINCT FROM a."organizationId"`);

  await report('Screen.groupId pointing at another org\'s ScreenGroup', await prisma.$queryRaw`
    SELECT s.id as screenid, s."organizationId" as screenorg, g."organizationId" as grouporg
    FROM "Screen" s JOIN "ScreenGroup" g ON g.id = s."groupId"
    WHERE s."organizationId" IS DISTINCT FROM g."organizationId"`);

  await report('Schedule.screenId pointing at another org\'s Screen', await prisma.$queryRaw`
    SELECT sc.id as scheduleid, sc."organizationId" as scheduleorg, s."organizationId" as screenorg
    FROM "Schedule" sc JOIN "Screen" s ON s.id = sc."screenId"
    WHERE sc."organizationId" IS DISTINCT FROM s."organizationId"`);

  await report('Schedule.playlistId pointing at another org\'s Playlist', await prisma.$queryRaw`
    SELECT sc.id as scheduleid, sc."organizationId" as scheduleorg, p."organizationId" as playlistorg
    FROM "Schedule" sc JOIN "Playlist" p ON p.id = sc."playlistId"
    WHERE sc."organizationId" IS DISTINCT FROM p."organizationId"`);

  await report('PowerSchedule.screenId pointing at another org\'s Screen', await prisma.$queryRaw`
    SELECT ps.id as powerscheduleid, ps."organizationId" as psorg, s."organizationId" as screenorg
    FROM "PowerSchedule" ps JOIN "Screen" s ON s.id = ps."screenId"
    WHERE ps."screenId" IS NOT NULL AND ps."organizationId" IS DISTINCT FROM s."organizationId"`);

  await report('PowerSchedule.groupId pointing at another org\'s ScreenGroup', await prisma.$queryRaw`
    SELECT ps.id as powerscheduleid, ps."organizationId" as psorg, g."organizationId" as grouporg
    FROM "PowerSchedule" ps JOIN "ScreenGroup" g ON g.id = ps."groupId"
    WHERE ps."groupId" IS NOT NULL AND ps."organizationId" IS DISTINCT FROM g."organizationId"`);

  await report('Zone.assetId pointing at another (non-shared) org\'s Asset', await prisma.$queryRaw`
    SELECT z.id as zoneid, l."organizationId" as layoutorg, a."organizationId" as assetorg
    FROM "Zone" z JOIN "Layout" l ON l.id = z."layoutId" JOIN "Asset" a ON a.id = z."assetId"
    WHERE a."organizationId" IS NOT NULL AND l."organizationId" IS DISTINCT FROM a."organizationId"`);

  await report('Zone.playlistId pointing at another org\'s Playlist', await prisma.$queryRaw`
    SELECT z.id as zoneid, l."organizationId" as layoutorg, p."organizationId" as playlistorg
    FROM "Zone" z JOIN "Layout" l ON l.id = z."layoutId" JOIN "Playlist" p ON p.id = z."playlistId"
    WHERE l."organizationId" IS DISTINCT FROM p."organizationId"`);

  await report('PlaylistItem.assetId pointing at another (non-shared) org\'s Asset', await prisma.$queryRaw`
    SELECT pi.id as itemid, p."organizationId" as playlistorg, a."organizationId" as assetorg
    FROM "PlaylistItem" pi JOIN "Playlist" p ON p.id = pi."playlistId" JOIN "Asset" a ON a.id = pi."assetId"
    WHERE a."organizationId" IS NOT NULL AND p."organizationId" IS DISTINCT FROM a."organizationId"`);

  await report('PlaylistItem.themeId pointing at another (non-shared) org\'s Theme', await prisma.$queryRaw`
    SELECT pi.id as itemid, p."organizationId" as playlistorg, t."organizationId" as themeorg
    FROM "PlaylistItem" pi JOIN "Playlist" p ON p.id = pi."playlistId" JOIN "Theme" t ON t.id = pi."themeId"
    WHERE t."organizationId" IS NOT NULL AND p."organizationId" IS DISTINCT FROM t."organizationId"`);

  await report('PlaylistItem.layoutId pointing at another org\'s Layout', await prisma.$queryRaw`
    SELECT pi.id as itemid, p."organizationId" as playlistorg, l."organizationId" as layoutorg
    FROM "PlaylistItem" pi JOIN "Playlist" p ON p.id = pi."playlistId" JOIN "Layout" l ON l.id = pi."layoutId"
    WHERE p."organizationId" IS DISTINCT FROM l."organizationId"`);

  await report('PlaylistItem.designAssetId pointing at another org\'s DesignAsset', await prisma.$queryRaw`
    SELECT pi.id as itemid, p."organizationId" as playlistorg, d."organizationId" as designorg
    FROM "PlaylistItem" pi JOIN "Playlist" p ON p.id = pi."playlistId" JOIN "DesignAsset" d ON d.id = pi."designAssetId"
    WHERE p."organizationId" IS DISTINCT FROM d."organizationId"`);

  await report('Floor.floorPlanAssetId pointing at another (non-shared) org\'s Asset', await prisma.$queryRaw`
    SELECT f.id as floorid, b."organizationId" as buildingorg, a."organizationId" as assetorg
    FROM "Floor" f JOIN "Building" b ON b.id = f."buildingId" JOIN "Asset" a ON a.id = f."floorPlanAssetId"
    WHERE a."organizationId" IS NOT NULL AND b."organizationId" IS DISTINCT FROM a."organizationId"`);

  await report('Poi.categoryId pointing at another (non-shared) org\'s PoiCategory', await prisma.$queryRaw`
    SELECT poi.id as poiid, b."organizationId" as buildingorg, c."organizationId" as categoryorg
    FROM "Poi" poi JOIN "Floor" f ON f.id = poi."floorId" JOIN "Building" b ON b.id = f."buildingId"
    JOIN "PoiCategory" c ON c.id = poi."categoryId"
    WHERE c."organizationId" IS NOT NULL AND b."organizationId" IS DISTINCT FROM c."organizationId"`);

  await report('Poi.iconAssetId pointing at another (non-shared) org\'s Asset', await prisma.$queryRaw`
    SELECT poi.id as poiid, b."organizationId" as buildingorg, a."organizationId" as assetorg
    FROM "Poi" poi JOIN "Floor" f ON f.id = poi."floorId" JOIN "Building" b ON b.id = f."buildingId"
    JOIN "Asset" a ON a.id = poi."iconAssetId"
    WHERE a."organizationId" IS NOT NULL AND b."organizationId" IS DISTINCT FROM a."organizationId"`);

  await report('KioskLocation.attractPlaylistId pointing at another org\'s Playlist', await prisma.$queryRaw`
    SELECT kl.id as kiosklocationid, b."organizationId" as buildingorg, p."organizationId" as playlistorg
    FROM "KioskLocation" kl JOIN "Floor" f ON f.id = kl."floorId" JOIN "Building" b ON b.id = f."buildingId"
    JOIN "Playlist" p ON p.id = kl."attractPlaylistId"
    WHERE b."organizationId" IS DISTINCT FROM p."organizationId"`);

  await report('KioskLocation.attractThemeId pointing at another (non-shared) org\'s Theme', await prisma.$queryRaw`
    SELECT kl.id as kiosklocationid, b."organizationId" as buildingorg, t."organizationId" as themeorg
    FROM "KioskLocation" kl JOIN "Floor" f ON f.id = kl."floorId" JOIN "Building" b ON b.id = f."buildingId"
    JOIN "Theme" t ON t.id = kl."attractThemeId"
    WHERE t."organizationId" IS NOT NULL AND b."organizationId" IS DISTINCT FROM t."organizationId"`);

  await report('RoomDisplayBinding: room and screen in different orgs', await prisma.$queryRaw`
    SELECT rdb.id as bindingid, r."organizationId" as roomorg, s."organizationId" as screenorg
    FROM "RoomDisplayBinding" rdb JOIN "BookableRoom" r ON r.id = rdb."roomId" JOIN "Screen" s ON s.id = rdb."screenId"
    WHERE r."organizationId" IS DISTINCT FROM s."organizationId"`);

  await report('BookableRoom.wayfindingPoiId resolving to a different tenant (via floor/building)', await prisma.$queryRaw`
    SELECT r.id as roomid, r."organizationId" as roomorg, b."organizationId" as poibuildingorg
    FROM "BookableRoom" r JOIN "Poi" poi ON poi.id = r."wayfindingPoiId"
    JOIN "Floor" f ON f.id = poi."floorId" JOIN "Building" b ON b.id = f."buildingId"
    WHERE r."organizationId" IS DISTINCT FROM b."organizationId"`);

  await report('DesignAsset.thumbnailAssetId pointing at another (non-shared) org\'s Asset', await prisma.$queryRaw`
    SELECT d.id as designassetid, d."organizationId" as designorg, a."organizationId" as assetorg
    FROM "DesignAsset" d JOIN "Asset" a ON a.id = d."thumbnailAssetId"
    WHERE a."organizationId" IS NOT NULL AND d."organizationId" IS DISTINCT FROM a."organizationId"`);

  console.log('\n=== Bonus (P3/P7-adjacent, not in P5a\'s own list, cheap to check while here) ===');
  await report('DesignTemplate.thumbnailAssetId referencing a tenant-owned (non-shared) Asset', await prisma.$queryRaw`
    SELECT dt.id as templateid, a."organizationId" as assetorg
    FROM "DesignTemplate" dt JOIN "Asset" a ON a.id = dt."thumbnailAssetId"
    WHERE a."organizationId" IS NOT NULL`);

  console.log(`\n${totalIssues === 0 ? 'All checks clean.' : `${totalIssues} total issue(s) found across the checks above.`} No rows were changed.`);
  process.exitCode = totalIssues > 0 ? 1 : 0;
}

main()
  .catch(console.error)
  .finally(() => void prisma.$disconnect());
