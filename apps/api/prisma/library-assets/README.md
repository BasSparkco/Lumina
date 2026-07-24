# Stock asset library

Drop image/video/audio files here to make them available to every organization as
ready-to-use stock assets — backgrounds, icons, stock photos, logos, video loops, jingles.
Orgs browse and "Add to my assets" from the dashboard's Assets → Library tab; they never
see this folder or upload here themselves.

## Adding assets

1. Put files in the matching category subfolder (create it if it doesn't exist):
   `BACKGROUND/`, `ICON/`, `ILLUSTRATION/`, `STOCK_PHOTO/`, `LOGO/`, `VIDEO_LOOP/`,
   `AUDIO_JINGLE/`, or `GENERIC/` — these match the `AssetCategory` enum in `schema.prisma`.
2. Name files descriptively with hyphens or underscores (e.g. `warm-coffee-shop-bg.jpg`) —
   the filename becomes the asset's display name and its search tags.
3. Run `pnpm --filter api db:seed-library` (requires `apps/worker` running to pick up the
   thumbnail/transcode jobs it queues).

Re-running the command is safe — it skips files that were already seeded (matched by name +
category) so you can keep adding new files to these folders over time.

Supported extensions: `.jpg` `.jpeg` `.png` `.gif` `.webp` `.mp4` `.webm` `.mov` `.mp3` `.m4a` `.wav`.
