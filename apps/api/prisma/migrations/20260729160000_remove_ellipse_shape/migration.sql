-- Postgres has no direct "DROP VALUE" for enums, so recreate the type without 'ellipse' and swap
-- the column over to it. Safe here since no existing Zone row uses 'ellipse' (verified before
-- writing this migration) — 'circle' already renders as an ellipse on a non-square box via
-- border-radius: 50%, so the separate option was redundant.
BEGIN;
CREATE TYPE "ZoneShape_new" AS ENUM ('rectangle', 'rounded', 'circle', 'triangle');
ALTER TABLE "Zone" ALTER COLUMN "shape" DROP DEFAULT;
ALTER TABLE "Zone" ALTER COLUMN "shape" TYPE "ZoneShape_new" USING ("shape"::text::"ZoneShape_new");
ALTER TYPE "ZoneShape" RENAME TO "ZoneShape_old";
ALTER TYPE "ZoneShape_new" RENAME TO "ZoneShape";
DROP TYPE "ZoneShape_old";
ALTER TABLE "Zone" ALTER COLUMN "shape" SET DEFAULT 'rectangle';
COMMIT;
