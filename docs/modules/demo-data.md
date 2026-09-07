# Module demo data

The `demo` organization has sample content for `/wayfinding/ai` and `/room-booking`.
Sign in with an existing demo-organization account to use it; other tenants are unaffected.

- AI Wayfinding: select **Lumina Galleria Mall** in the aliases/test sections. Try `coffee`, `Where can I eat?`, `cinema`, or `أين الحمامات؟` (Arabic). The dedicated **Demo — AI Wayfinding Kiosk** is enabled and located at the ground-floor entrance. Existing floor maps in MinIO are reused.
- Room Booking: four clearly labeled demo rooms demonstrate capacities, amenities, all three privacy settings, and an out-of-service room. Select an active room and today's date to see reservations. Free gaps allow visitors to create and cancel their own reservations. Dedicated room displays have quick booking enabled; pair them through the normal screen workflow to test on a player.
- Bookings use UTC and span 30 calendar days from the seed run, with three 45-minute meetings per active room per day. The UI may show times in the viewer's local timezone.
- Calendar integrations remain unconnected. Usage statistics represent real requests, not fabricated seed history. Exact destination names and seeded aliases work without an AI provider; broader conversational searches require deployment configuration for `AI_WAYFINDING_API_KEY`.

## Rerun / refresh

After the base demo organization and wayfinding seed exist:

```bash
pnpm --filter api db:seed-module-demos
```

For the current production image (which omits the root TypeScript configuration):

```bash
docker compose -f docker-compose.prod.yml cp apps/api/prisma/seed-module-demos.ts api:/repo/apps/api/prisma/seed-module-demos.ts
docker compose -f docker-compose.prod.yml exec -T api node_modules/.bin/ts-node --skip-project --compiler-options '{"module":"CommonJS","target":"ES2022","esModuleInterop":true}' prisma/seed-module-demos.ts
```

The seed runs in one database transaction, activates the three relevant modules only for the `demo` tenant, and creates missing content. It preserves edits to existing demo records, skips reservations overlapping visitor bookings, and never replaces cancelled demo reservations. Rerun periodically to extend the 30-day booking window; no automatic recurring job is installed. Existing physical screens are not repurposed. No new MinIO files are needed.
