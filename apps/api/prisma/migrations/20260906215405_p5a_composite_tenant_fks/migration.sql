-- P5a schema tasks 1/2/7 (docs/tenant_isolation_and_platform_admin_plan.md) — adds a direct
-- organizationId to every child table the plan's composite-tenant-FK list names that didn't
-- already have one, backfills it through its verified parent path (the 2026-09-05 pre-migration
-- audit — apps/api/prisma/audit-p5a-tenant-relations.ts — found zero cross-tenant/orphan rows
-- across every one of these relations, so every backfill below is a plain, lossless copy), then
-- adds a same-tenant invariant on every cross-reference these tables carry.
--
-- Plain Postgres composite foreign keys were deliberately not used for the cross-reference
-- invariants themselves, for two reasons that apply throughout this migration:
--   1. Several referenced parents (Asset, Theme, PoiCategory) are legitimately shared — their
--      organizationId is NULL for a platform preset, readable by every tenant. A composite FK
--      can only express "must equal," never "must equal, or the parent is shared" — only a
--      trigger can express the OR-NULL condition these need.
--   2. Several of the child FK columns use ON DELETE SET NULL (see each table's existing
--      migration) so the referenced content can be removed without deleting the row that pointed
--      to it. A composite FK's ON DELETE SET NULL nulls every column in the FK as one unit — it
--      would null organizationId too, which is NOT NULL, and the delete would fail outright.
-- A hand-written trigger sidesteps both: it only runs on INSERT/UPDATE of the child row itself,
-- never touches the parent's own delete behavior, and can express the OR-NULL shared-content
-- case directly. This is the same approach — and the same reasoning — as AuditLog's
-- `check_auditlog_actor_same_org` trigger (migration 20260905223040_...); every function below
-- follows its naming and structure for consistency.

-- ── New organizationId columns, backfilled through each table's verified parent path ──────────

-- Floor ← Building (always tenant-owned, never shared)
ALTER TABLE "Floor" ADD COLUMN "organizationId" TEXT;
UPDATE "Floor" f SET "organizationId" = b."organizationId" FROM "Building" b WHERE b.id = f."buildingId";
ALTER TABLE "Floor" ALTER COLUMN "organizationId" SET NOT NULL;
CREATE INDEX "Floor_organizationId_idx" ON "Floor"("organizationId");

-- Poi ← Floor (now backfilled above; always tenant-owned)
ALTER TABLE "Poi" ADD COLUMN "organizationId" TEXT;
UPDATE "Poi" p SET "organizationId" = f."organizationId" FROM "Floor" f WHERE f.id = p."floorId";
ALTER TABLE "Poi" ALTER COLUMN "organizationId" SET NOT NULL;
CREATE INDEX "Poi_organizationId_idx" ON "Poi"("organizationId");

-- RouteNode ← Floor
ALTER TABLE "RouteNode" ADD COLUMN "organizationId" TEXT;
UPDATE "RouteNode" n SET "organizationId" = f."organizationId" FROM "Floor" f WHERE f.id = n."floorId";
ALTER TABLE "RouteNode" ALTER COLUMN "organizationId" SET NOT NULL;
CREATE INDEX "RouteNode_organizationId_idx" ON "RouteNode"("organizationId");

-- RouteEdge ← its fromNode (now backfilled above)
ALTER TABLE "RouteEdge" ADD COLUMN "organizationId" TEXT;
UPDATE "RouteEdge" e SET "organizationId" = n."organizationId" FROM "RouteNode" n WHERE n.id = e."fromNodeId";
ALTER TABLE "RouteEdge" ALTER COLUMN "organizationId" SET NOT NULL;
CREATE INDEX "RouteEdge_organizationId_idx" ON "RouteEdge"("organizationId");

-- Zone ← Layout (always tenant-owned, never shared)
ALTER TABLE "Zone" ADD COLUMN "organizationId" TEXT;
UPDATE "Zone" z SET "organizationId" = l."organizationId" FROM "Layout" l WHERE l.id = z."layoutId";
ALTER TABLE "Zone" ALTER COLUMN "organizationId" SET NOT NULL;
CREATE INDEX "Zone_organizationId_idx" ON "Zone"("organizationId");

-- PlaylistItem ← Playlist (always tenant-owned, never shared)
ALTER TABLE "PlaylistItem" ADD COLUMN "organizationId" TEXT;
UPDATE "PlaylistItem" pi SET "organizationId" = p."organizationId" FROM "Playlist" p WHERE p.id = pi."playlistId";
ALTER TABLE "PlaylistItem" ALTER COLUMN "organizationId" SET NOT NULL;
CREATE INDEX "PlaylistItem_organizationId_idx" ON "PlaylistItem"("organizationId");

-- KioskLocation ← Screen (NOT NULL as of the previous P5a migration)
ALTER TABLE "KioskLocation" ADD COLUMN "organizationId" TEXT;
UPDATE "KioskLocation" kl SET "organizationId" = s."organizationId" FROM "Screen" s WHERE s.id = kl."screenId";
ALTER TABLE "KioskLocation" ALTER COLUMN "organizationId" SET NOT NULL;
CREATE INDEX "KioskLocation_organizationId_idx" ON "KioskLocation"("organizationId");

-- RoomDisplayBinding ← BookableRoom (always tenant-owned, never shared)
ALTER TABLE "RoomDisplayBinding" ADD COLUMN "organizationId" TEXT;
UPDATE "RoomDisplayBinding" rdb SET "organizationId" = r."organizationId" FROM "BookableRoom" r WHERE r.id = rdb."roomId";
ALTER TABLE "RoomDisplayBinding" ALTER COLUMN "organizationId" SET NOT NULL;
CREATE INDEX "RoomDisplayBinding_organizationId_idx" ON "RoomDisplayBinding"("organizationId");

-- RoomReservation ← BookableRoom
ALTER TABLE "RoomReservation" ADD COLUMN "organizationId" TEXT;
UPDATE "RoomReservation" rr SET "organizationId" = r."organizationId" FROM "BookableRoom" r WHERE r.id = rr."roomId";
ALTER TABLE "RoomReservation" ALTER COLUMN "organizationId" SET NOT NULL;
CREATE INDEX "RoomReservation_organizationId_idx" ON "RoomReservation"("organizationId");

-- ── Same-tenant invariant triggers ──────────────────────────────────────────────────────────

-- Screen → Playlist (playlistId, emergencyPlaylistId; both ON DELETE SET NULL, never shared),
-- Asset (assetId; ON DELETE SET NULL, may be shared — OR NULL), ScreenGroup (groupId; ON DELETE
-- SET NULL, never shared).
CREATE OR REPLACE FUNCTION check_screen_tenant_refs() RETURNS trigger AS $$
BEGIN
  IF NEW."playlistId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Playlist" WHERE id = NEW."playlistId" AND "organizationId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'Screen.playlistId % does not belong to Screen.organizationId %', NEW."playlistId", NEW."organizationId";
  END IF;
  IF NEW."emergencyPlaylistId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Playlist" WHERE id = NEW."emergencyPlaylistId" AND "organizationId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'Screen.emergencyPlaylistId % does not belong to Screen.organizationId %', NEW."emergencyPlaylistId", NEW."organizationId";
  END IF;
  IF NEW."assetId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Asset" WHERE id = NEW."assetId" AND ("organizationId" IS NULL OR "organizationId" = NEW."organizationId")
  ) THEN
    RAISE EXCEPTION 'Screen.assetId % does not belong to Screen.organizationId % and is not a shared asset', NEW."assetId", NEW."organizationId";
  END IF;
  IF NEW."groupId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "ScreenGroup" WHERE id = NEW."groupId" AND "organizationId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'Screen.groupId % does not belong to Screen.organizationId %', NEW."groupId", NEW."organizationId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS screen_tenant_refs ON "Screen";
CREATE TRIGGER screen_tenant_refs
  BEFORE INSERT OR UPDATE ON "Screen"
  FOR EACH ROW EXECUTE FUNCTION check_screen_tenant_refs();

-- Schedule → Playlist (playlistId, required, ON DELETE RESTRICT), Screen (screenId, required,
-- ON DELETE CASCADE). Neither can legitimately be shared.
CREATE OR REPLACE FUNCTION check_schedule_tenant_refs() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Playlist" WHERE id = NEW."playlistId" AND "organizationId" = NEW."organizationId") THEN
    RAISE EXCEPTION 'Schedule.playlistId % does not belong to Schedule.organizationId %', NEW."playlistId", NEW."organizationId";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Screen" WHERE id = NEW."screenId" AND "organizationId" = NEW."organizationId") THEN
    RAISE EXCEPTION 'Schedule.screenId % does not belong to Schedule.organizationId %', NEW."screenId", NEW."organizationId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS schedule_tenant_refs ON "Schedule";
CREATE TRIGGER schedule_tenant_refs
  BEFORE INSERT OR UPDATE ON "Schedule"
  FOR EACH ROW EXECUTE FUNCTION check_schedule_tenant_refs();

-- PowerSchedule → Screen (screenId, optional — exactly one of screenId/groupId is set),
-- ScreenGroup (groupId, optional). Both ON DELETE CASCADE; neither can be shared.
CREATE OR REPLACE FUNCTION check_powerschedule_tenant_refs() RETURNS trigger AS $$
BEGIN
  IF NEW."screenId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Screen" WHERE id = NEW."screenId" AND "organizationId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'PowerSchedule.screenId % does not belong to PowerSchedule.organizationId %', NEW."screenId", NEW."organizationId";
  END IF;
  IF NEW."groupId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "ScreenGroup" WHERE id = NEW."groupId" AND "organizationId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'PowerSchedule.groupId % does not belong to PowerSchedule.organizationId %', NEW."groupId", NEW."organizationId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS powerschedule_tenant_refs ON "PowerSchedule";
CREATE TRIGGER powerschedule_tenant_refs
  BEFORE INSERT OR UPDATE ON "PowerSchedule"
  FOR EACH ROW EXECUTE FUNCTION check_powerschedule_tenant_refs();

-- Zone → Layout (layoutId, required, ON DELETE CASCADE, never shared), Playlist (playlistId,
-- optional, ON DELETE SET NULL, never shared), Asset (assetId, optional, ON DELETE SET NULL, may
-- be shared — OR NULL).
CREATE OR REPLACE FUNCTION check_zone_tenant_refs() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Layout" WHERE id = NEW."layoutId" AND "organizationId" = NEW."organizationId") THEN
    RAISE EXCEPTION 'Zone.layoutId % does not belong to Zone.organizationId %', NEW."layoutId", NEW."organizationId";
  END IF;
  IF NEW."playlistId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Playlist" WHERE id = NEW."playlistId" AND "organizationId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'Zone.playlistId % does not belong to Zone.organizationId %', NEW."playlistId", NEW."organizationId";
  END IF;
  IF NEW."assetId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Asset" WHERE id = NEW."assetId" AND ("organizationId" IS NULL OR "organizationId" = NEW."organizationId")
  ) THEN
    RAISE EXCEPTION 'Zone.assetId % does not belong to Zone.organizationId % and is not a shared asset', NEW."assetId", NEW."organizationId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS zone_tenant_refs ON "Zone";
CREATE TRIGGER zone_tenant_refs
  BEFORE INSERT OR UPDATE ON "Zone"
  FOR EACH ROW EXECUTE FUNCTION check_zone_tenant_refs();

-- PlaylistItem → Playlist (playlistId, required, ON DELETE CASCADE, never shared), Asset
-- (assetId, optional, ON DELETE SET NULL, may be shared — OR NULL), Theme (themeId, optional, ON
-- DELETE SET NULL, may be shared — OR NULL), Layout (layoutId, optional, ON DELETE SET NULL,
-- never shared), DesignAsset (designAssetId, optional, ON DELETE SET NULL, never shared).
CREATE OR REPLACE FUNCTION check_playlistitem_tenant_refs() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Playlist" WHERE id = NEW."playlistId" AND "organizationId" = NEW."organizationId") THEN
    RAISE EXCEPTION 'PlaylistItem.playlistId % does not belong to PlaylistItem.organizationId %', NEW."playlistId", NEW."organizationId";
  END IF;
  IF NEW."assetId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Asset" WHERE id = NEW."assetId" AND ("organizationId" IS NULL OR "organizationId" = NEW."organizationId")
  ) THEN
    RAISE EXCEPTION 'PlaylistItem.assetId % does not belong to PlaylistItem.organizationId % and is not a shared asset', NEW."assetId", NEW."organizationId";
  END IF;
  IF NEW."themeId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Theme" WHERE id = NEW."themeId" AND ("organizationId" IS NULL OR "organizationId" = NEW."organizationId")
  ) THEN
    RAISE EXCEPTION 'PlaylistItem.themeId % does not belong to PlaylistItem.organizationId % and is not a shared theme', NEW."themeId", NEW."organizationId";
  END IF;
  IF NEW."layoutId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Layout" WHERE id = NEW."layoutId" AND "organizationId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'PlaylistItem.layoutId % does not belong to PlaylistItem.organizationId %', NEW."layoutId", NEW."organizationId";
  END IF;
  IF NEW."designAssetId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "DesignAsset" WHERE id = NEW."designAssetId" AND "organizationId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'PlaylistItem.designAssetId % does not belong to PlaylistItem.organizationId %', NEW."designAssetId", NEW."organizationId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS playlistitem_tenant_refs ON "PlaylistItem";
CREATE TRIGGER playlistitem_tenant_refs
  BEFORE INSERT OR UPDATE ON "PlaylistItem"
  FOR EACH ROW EXECUTE FUNCTION check_playlistitem_tenant_refs();

-- Floor → Building (buildingId, required, ON DELETE CASCADE, never shared), Asset
-- (floorPlanAssetId, optional, ON DELETE SET NULL, may be shared — OR NULL).
CREATE OR REPLACE FUNCTION check_floor_tenant_refs() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Building" WHERE id = NEW."buildingId" AND "organizationId" = NEW."organizationId") THEN
    RAISE EXCEPTION 'Floor.buildingId % does not belong to Floor.organizationId %', NEW."buildingId", NEW."organizationId";
  END IF;
  IF NEW."floorPlanAssetId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Asset" WHERE id = NEW."floorPlanAssetId" AND ("organizationId" IS NULL OR "organizationId" = NEW."organizationId")
  ) THEN
    RAISE EXCEPTION 'Floor.floorPlanAssetId % does not belong to Floor.organizationId % and is not a shared asset', NEW."floorPlanAssetId", NEW."organizationId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS floor_tenant_refs ON "Floor";
CREATE TRIGGER floor_tenant_refs
  BEFORE INSERT OR UPDATE ON "Floor"
  FOR EACH ROW EXECUTE FUNCTION check_floor_tenant_refs();

-- Poi → Floor (floorId, required, ON DELETE CASCADE, never shared), PoiCategory (categoryId,
-- required, ON DELETE RESTRICT, may be shared — OR NULL), Asset (iconAssetId, optional, ON
-- DELETE SET NULL, may be shared — OR NULL).
CREATE OR REPLACE FUNCTION check_poi_tenant_refs() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Floor" WHERE id = NEW."floorId" AND "organizationId" = NEW."organizationId") THEN
    RAISE EXCEPTION 'Poi.floorId % does not belong to Poi.organizationId %', NEW."floorId", NEW."organizationId";
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "PoiCategory" WHERE id = NEW."categoryId" AND ("organizationId" IS NULL OR "organizationId" = NEW."organizationId")
  ) THEN
    RAISE EXCEPTION 'Poi.categoryId % does not belong to Poi.organizationId % and is not a shared category', NEW."categoryId", NEW."organizationId";
  END IF;
  IF NEW."iconAssetId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Asset" WHERE id = NEW."iconAssetId" AND ("organizationId" IS NULL OR "organizationId" = NEW."organizationId")
  ) THEN
    RAISE EXCEPTION 'Poi.iconAssetId % does not belong to Poi.organizationId % and is not a shared asset', NEW."iconAssetId", NEW."organizationId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS poi_tenant_refs ON "Poi";
CREATE TRIGGER poi_tenant_refs
  BEFORE INSERT OR UPDATE ON "Poi"
  FOR EACH ROW EXECUTE FUNCTION check_poi_tenant_refs();

-- KioskLocation → Screen (screenId, required, ON DELETE CASCADE), Floor (floorId, required, ON
-- DELETE CASCADE), Playlist (attractPlaylistId, optional, ON DELETE SET NULL), Theme
-- (attractThemeId, optional, ON DELETE SET NULL, may be shared — OR NULL). Screen/Floor/Playlist
-- can never be shared.
CREATE OR REPLACE FUNCTION check_kiosklocation_tenant_refs() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Screen" WHERE id = NEW."screenId" AND "organizationId" = NEW."organizationId") THEN
    RAISE EXCEPTION 'KioskLocation.screenId % does not belong to KioskLocation.organizationId %', NEW."screenId", NEW."organizationId";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Floor" WHERE id = NEW."floorId" AND "organizationId" = NEW."organizationId") THEN
    RAISE EXCEPTION 'KioskLocation.floorId % does not belong to KioskLocation.organizationId %', NEW."floorId", NEW."organizationId";
  END IF;
  IF NEW."attractPlaylistId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Playlist" WHERE id = NEW."attractPlaylistId" AND "organizationId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'KioskLocation.attractPlaylistId % does not belong to KioskLocation.organizationId %', NEW."attractPlaylistId", NEW."organizationId";
  END IF;
  IF NEW."attractThemeId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Theme" WHERE id = NEW."attractThemeId" AND ("organizationId" IS NULL OR "organizationId" = NEW."organizationId")
  ) THEN
    RAISE EXCEPTION 'KioskLocation.attractThemeId % does not belong to KioskLocation.organizationId % and is not a shared theme', NEW."attractThemeId", NEW."organizationId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS kiosklocation_tenant_refs ON "KioskLocation";
CREATE TRIGGER kiosklocation_tenant_refs
  BEFORE INSERT OR UPDATE ON "KioskLocation"
  FOR EACH ROW EXECUTE FUNCTION check_kiosklocation_tenant_refs();

-- RouteNode → Floor (floorId, required, ON DELETE CASCADE, never shared).
CREATE OR REPLACE FUNCTION check_routenode_tenant_refs() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Floor" WHERE id = NEW."floorId" AND "organizationId" = NEW."organizationId") THEN
    RAISE EXCEPTION 'RouteNode.floorId % does not belong to RouteNode.organizationId %', NEW."floorId", NEW."organizationId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS routenode_tenant_refs ON "RouteNode";
CREATE TRIGGER routenode_tenant_refs
  BEFORE INSERT OR UPDATE ON "RouteNode"
  FOR EACH ROW EXECUTE FUNCTION check_routenode_tenant_refs();

-- RouteEdge → RouteNode (fromNodeId, toNodeId; both required, ON DELETE CASCADE, never shared) —
-- the actual invariant this protects: an edge can no longer link two different tenants' route
-- graphs, since both endpoints must match this same edge's own organizationId.
CREATE OR REPLACE FUNCTION check_routeedge_tenant_refs() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "RouteNode" WHERE id = NEW."fromNodeId" AND "organizationId" = NEW."organizationId") THEN
    RAISE EXCEPTION 'RouteEdge.fromNodeId % does not belong to RouteEdge.organizationId %', NEW."fromNodeId", NEW."organizationId";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "RouteNode" WHERE id = NEW."toNodeId" AND "organizationId" = NEW."organizationId") THEN
    RAISE EXCEPTION 'RouteEdge.toNodeId % does not belong to RouteEdge.organizationId %', NEW."toNodeId", NEW."organizationId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS routeedge_tenant_refs ON "RouteEdge";
CREATE TRIGGER routeedge_tenant_refs
  BEFORE INSERT OR UPDATE ON "RouteEdge"
  FOR EACH ROW EXECUTE FUNCTION check_routeedge_tenant_refs();

-- RoomDisplayBinding → BookableRoom (roomId, required, ON DELETE CASCADE), Screen (screenId,
-- required, ON DELETE CASCADE). Neither can be shared.
CREATE OR REPLACE FUNCTION check_roomdisplaybinding_tenant_refs() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "BookableRoom" WHERE id = NEW."roomId" AND "organizationId" = NEW."organizationId") THEN
    RAISE EXCEPTION 'RoomDisplayBinding.roomId % does not belong to RoomDisplayBinding.organizationId %', NEW."roomId", NEW."organizationId";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Screen" WHERE id = NEW."screenId" AND "organizationId" = NEW."organizationId") THEN
    RAISE EXCEPTION 'RoomDisplayBinding.screenId % does not belong to RoomDisplayBinding.organizationId %', NEW."screenId", NEW."organizationId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS roomdisplaybinding_tenant_refs ON "RoomDisplayBinding";
CREATE TRIGGER roomdisplaybinding_tenant_refs
  BEFORE INSERT OR UPDATE ON "RoomDisplayBinding"
  FOR EACH ROW EXECUTE FUNCTION check_roomdisplaybinding_tenant_refs();

-- RoomReservation → BookableRoom (roomId, required, ON DELETE CASCADE, never shared).
CREATE OR REPLACE FUNCTION check_roomreservation_tenant_refs() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "BookableRoom" WHERE id = NEW."roomId" AND "organizationId" = NEW."organizationId") THEN
    RAISE EXCEPTION 'RoomReservation.roomId % does not belong to RoomReservation.organizationId %', NEW."roomId", NEW."organizationId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS roomreservation_tenant_refs ON "RoomReservation";
CREATE TRIGGER roomreservation_tenant_refs
  BEFORE INSERT OR UPDATE ON "RoomReservation"
  FOR EACH ROW EXECUTE FUNCTION check_roomreservation_tenant_refs();

-- BookableRoom → Poi (wayfindingPoiId, optional, ON DELETE SET NULL). Poi is never shared (it
-- always resolves to a real floor/building), so this is an exact match, not OR NULL — the plan's
-- own named target for this invariant (§2.4/§5.4 task 5: "BookableRoom.wayfindingPoiId must
-- resolve through floor/building to the same tenant"), now checkable directly against Poi's own
-- organizationId instead of a floor/building join.
CREATE OR REPLACE FUNCTION check_bookableroom_tenant_refs() RETURNS trigger AS $$
BEGIN
  IF NEW."wayfindingPoiId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Poi" WHERE id = NEW."wayfindingPoiId" AND "organizationId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'BookableRoom.wayfindingPoiId % does not belong to BookableRoom.organizationId %', NEW."wayfindingPoiId", NEW."organizationId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bookableroom_tenant_refs ON "BookableRoom";
CREATE TRIGGER bookableroom_tenant_refs
  BEFORE INSERT OR UPDATE ON "BookableRoom"
  FOR EACH ROW EXECUTE FUNCTION check_bookableroom_tenant_refs();

-- DesignAsset → Asset (thumbnailAssetId, optional, ON DELETE SET NULL, may be shared — OR NULL).
CREATE OR REPLACE FUNCTION check_designasset_tenant_refs() RETURNS trigger AS $$
BEGIN
  IF NEW."thumbnailAssetId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Asset" WHERE id = NEW."thumbnailAssetId" AND ("organizationId" IS NULL OR "organizationId" = NEW."organizationId")
  ) THEN
    RAISE EXCEPTION 'DesignAsset.thumbnailAssetId % does not belong to DesignAsset.organizationId % and is not a shared asset', NEW."thumbnailAssetId", NEW."organizationId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS designasset_tenant_refs ON "DesignAsset";
CREATE TRIGGER designasset_tenant_refs
  BEFORE INSERT OR UPDATE ON "DesignAsset"
  FOR EACH ROW EXECUTE FUNCTION check_designasset_tenant_refs();

-- Bonus (P3/P7-adjacent, flagged by the same pre-migration audit's bonus check, not itself named
-- in the plan's P5a list) — DesignTemplate is platform-private, with no organizationId of its own
-- to compare against: the invariant here has the opposite shape from every trigger above. A
-- template is Super-Admin-authored platform content, so its thumbnail must always be a *shared*
-- asset (organizationId IS NULL) — never a tenant-owned one, which would otherwise let a template
-- (visible to every tenant that has access to it) leak a reference to one specific tenant's
-- private asset.
CREATE OR REPLACE FUNCTION check_designtemplate_thumbnail_shared() RETURNS trigger AS $$
BEGIN
  IF NEW."thumbnailAssetId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Asset" WHERE id = NEW."thumbnailAssetId" AND "organizationId" IS NULL
  ) THEN
    RAISE EXCEPTION 'DesignTemplate.thumbnailAssetId % must reference a shared asset (organizationId IS NULL)', NEW."thumbnailAssetId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS designtemplate_thumbnail_shared ON "DesignTemplate";
CREATE TRIGGER designtemplate_thumbnail_shared
  BEFORE INSERT OR UPDATE ON "DesignTemplate"
  FOR EACH ROW EXECUTE FUNCTION check_designtemplate_thumbnail_shared();
