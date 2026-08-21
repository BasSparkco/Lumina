-- Replace the 2-value TickerDirection enum (HORIZONTAL/VERTICAL) with 4 explicit travel
-- directions, preserving existing data: HORIZONTAL -> RIGHT_TO_LEFT (the direction it already
-- visually scrolled), VERTICAL -> BOTTOM_TO_TOP (ditto).
CREATE TYPE "TickerDirection_new" AS ENUM ('LEFT_TO_RIGHT', 'RIGHT_TO_LEFT', 'TOP_TO_BOTTOM', 'BOTTOM_TO_TOP');

ALTER TABLE "Asset" ALTER COLUMN "textTickerDirection" DROP DEFAULT;

ALTER TABLE "Asset" ALTER COLUMN "textTickerDirection" TYPE "TickerDirection_new" USING (
  CASE "textTickerDirection"::text
    WHEN 'HORIZONTAL' THEN 'RIGHT_TO_LEFT'
    WHEN 'VERTICAL' THEN 'BOTTOM_TO_TOP'
  END
)::"TickerDirection_new";

ALTER TABLE "Asset" ALTER COLUMN "textTickerDirection" SET DEFAULT 'RIGHT_TO_LEFT';

DROP TYPE "TickerDirection";
ALTER TYPE "TickerDirection_new" RENAME TO "TickerDirection";
