-- Data migration: StreamingType.LAYOUT/THEME/APPS are going away (see the next migration) in
-- favor of Playlist items that can themselves be a layout/theme/app. Every screen currently in
-- one of those three modes gets a brand-new playlist wrapping whatever it was showing, so it
-- keeps showing the same thing once those modes are gone — no admin action required.
--
-- IDs are generated with md5(random()...) rather than gen_random_uuid()/pgcrypto: this avoids
-- depending on an extension being installed/enabled on whatever Postgres this runs against. The
-- app's own `cuid()` id format is a client-side Prisma convention, not a DB constraint, so any
-- unique string id works here.
WITH src AS (
  SELECT
    s.id AS screen_id,
    s.name AS screen_name,
    s."organizationId" AS org_id,
    s."streamingType" AS st,
    s."layoutId" AS layout_id,
    s."themeId" AS theme_id,
    s."appAssetId" AS app_asset_id,
    md5(random()::text || clock_timestamp()::text || s.id || ':playlist') AS new_playlist_id,
    md5(random()::text || clock_timestamp()::text || s.id || ':item') AS new_item_id
  FROM "Screen" s
  WHERE s."organizationId" IS NOT NULL
    AND (
      (s."streamingType" = 'LAYOUT' AND s."layoutId" IS NOT NULL) OR
      (s."streamingType" = 'THEME' AND s."themeId" IS NOT NULL) OR
      (s."streamingType" = 'APPS' AND s."appAssetId" IS NOT NULL)
    )
),
new_playlists AS (
  INSERT INTO "Playlist" (id, name, "approvalStatus", "transitionStyle", "transitionDurationMs", "playbackOrder", "createdAt", "updatedAt", "organizationId")
  SELECT new_playlist_id, screen_name || ' (migrated)', 'APPROVED', 'NONE', 500, 'SEQUENTIAL', now(), now(), org_id
  FROM src
  RETURNING id
),
new_items AS (
  INSERT INTO "PlaylistItem" (id, position, "durationSecs", muted, "playFullVideo", "createdAt", "updatedAt", "playlistId", kind, "assetId", "themeId", "layoutId")
  SELECT
    new_item_id, 0, 10, true, true, now(), now(),
    new_playlist_id,
    CASE
      WHEN st = 'LAYOUT' THEN 'LAYOUT'::"PlaylistItemKind"
      WHEN st = 'THEME' THEN 'THEME'::"PlaylistItemKind"
      ELSE 'ASSET'::"PlaylistItemKind"
    END,
    CASE WHEN st = 'APPS' THEN app_asset_id ELSE NULL END,
    CASE WHEN st = 'THEME' THEN theme_id ELSE NULL END,
    CASE WHEN st = 'LAYOUT' THEN layout_id ELSE NULL END
  FROM src
  RETURNING "playlistId"
)
UPDATE "Screen"
SET "playlistId" = src.new_playlist_id, "streamingType" = 'PLAYLIST'
FROM src
WHERE "Screen".id = src.screen_id;

-- Screens left in LAYOUT/THEME/APPS mode with nothing actually assigned (the FK above was null)
-- weren't touched by the WITH above — just flip their mode, there's no content to wrap.
UPDATE "Screen"
SET "streamingType" = 'PLAYLIST'
WHERE "streamingType" IN ('LAYOUT', 'THEME', 'APPS');
