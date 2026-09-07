import 'dotenv/config';
import { PrismaClient } from '@lumina/db';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const normalize = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

async function main() {
  // Deliberately restricted to the demo tenant; never seed every tenant.
  const org = await prisma.organization.findUniqueOrThrow({ where: { slug: 'demo' } });
  const building = await prisma.building.findFirstOrThrow({
    where: { organizationId: org.id, name: 'Lumina Galleria Mall' },
    include: { floors: { orderBy: { level: 'asc' }, include: { pois: true } } },
  });
  const ground = building.floors[0];
  if (!ground) throw new Error('Run db:seed-wayfinding first: demo floors are missing.');
  await prisma.$transaction(async (tx) => {
    for (const moduleKey of ['WAYFINDING', 'WAYFINDING_AI', 'ROOM_BOOKING']) {
      await tx.tenantModule.upsert({
        where: { organizationId_moduleKey: { organizationId: org.id, moduleKey } },
        create: { organizationId: org.id, moduleKey, status: 'ACTIVE' },
        update: { status: 'ACTIVE', expiresAt: null },
      });
    }
    const kiosk = await tx.screen.upsert({
      where: { id: `demo-ai-kiosk-${org.id}` }, update: {},
      create: { id: `demo-ai-kiosk-${org.id}`, organizationId: org.id, name: 'Demo — AI Wayfinding Kiosk', streamingType: 'WAYFINDING' },
    });
    await tx.kioskLocation.upsert({ where: { screenId: kiosk.id }, update: {}, create: { organizationId: org.id, screenId: kiosk.id, floorId: ground.id, x: 50, y: 95 } });
    await tx.wayfindingAiScreenConfig.upsert({
      where: { screenId: kiosk.id }, update: {},
      create: { screenId: kiosk.id, enabled: true, welcomeMessage: 'Welcome to the demo! Try coffee, food court, cinema, or parking.', welcomeMessageAr: 'مرحباً بك! جرّب قهوة أو مطاعم أو سينما.' },
    });
    const aliases: Record<string, [string[], string[]]> = {
      'Aroma Coffee House': [['coffee', 'Where can I get coffee?', 'cafe'], ['قهوة', 'أين أجد القهوة؟']],
      'Fresh Bites Food Court': [['food court', 'Where can I eat?', 'restaurants'], ['مطاعم', 'أين يمكنني تناول الطعام؟']],
      'CineMax Theater': [['cinema', 'movies', 'Where is the cinema?'], ['سينما', 'أين السينما؟']],
      'Restrooms — Ground': [['toilets', 'restroom', 'Where are the toilets?'], ['دورات المياه', 'أين الحمامات؟']],
      'Lumina Info Desk': [['help desk', 'lost and found'], ['استعلامات']],
      'Wellness Medical Clinic': [['clinic', 'medical help'], ['عيادة']],
      'Parking Garage Access': [['parking', 'car park'], ['مواقف السيارات']],
    };
    let aliasCount = 0;
    for (const poi of building.floors.flatMap((floor) => floor.pois)) {
      const values = aliases[poi.name];
      if (!values) continue;
      for (const [index, language] of ['en', 'ar'].entries()) {
        for (const value of values[index]!) {
          const normalizedValue = normalize(value);
          await tx.poiAlias.upsert({ where: { poiId_language_normalizedValue: { poiId: poi.id, language, normalizedValue } }, update: {}, create: { poiId: poi.id, language, value, normalizedValue } });
          aliasCount++;
        }
      }
    }
    const definitions = [
      { name: 'Demo — Aurora Boardroom', capacity: 12, privacyMode: 'SHOW_ORGANIZER' as const, amenities: ['Video conferencing', 'Display', 'Whiteboard'] },
      { name: 'Demo — Cedar Meeting Room', capacity: 6, privacyMode: 'SHOW_TITLE' as const, amenities: ['Display', 'Whiteboard'] },
      { name: 'Demo — Focus Pod', capacity: 2, privacyMode: 'BUSY_ONLY' as const, amenities: ['Desk', 'Power outlets'] },
      { name: 'Demo — Workshop Studio', capacity: 20, privacyMode: 'SHOW_TITLE' as const, amenities: ['Projector', 'Movable seating'], status: 'OUT_OF_SERVICE' as const },
    ];
    let added = 0;
    for (const [index, definition] of definitions.entries()) {
      const room = await tx.bookableRoom.upsert({
        where: { organizationId_normalizedName: { organizationId: org.id, normalizedName: normalize(definition.name) } }, update: {},
        create: { ...definition, organizationId: org.id, normalizedName: normalize(definition.name), timezone: 'UTC', locationLabel: `Demo Conference Centre · Floor ${index < 2 ? 1 : 2}` },
      });
      const screenId = `demo-room-${index}-${org.id}`;
      await tx.screen.upsert({ where: { id: screenId }, update: {}, create: { id: screenId, organizationId: org.id, name: `${definition.name} Display`, streamingType: 'ROOM_BOOKING' } });
      await tx.roomDisplayBinding.upsert({ where: { screenId }, update: {}, create: { organizationId: org.id, screenId, roomId: room.id, quickBookingEnabled: true } });
      if (room.status !== 'ACTIVE' || room.providerKey !== 'LUMINA') continue;
      for (let day = 0; day < 30; day++) {
        for (const [slot, hour] of [9, 13, 16].entries()) {
          const startsAt = new Date();
          startsAt.setUTCDate(startsAt.getUTCDate() + day);
          startsAt.setUTCHours(hour + (index === 2 ? 1 : 0), 0, 0, 0);
          const endsAt = new Date(startsAt.getTime() + 45 * 60_000);
          const id = `demo-reservation-${room.id}-${startsAt.toISOString().slice(0, 10)}-${slot}`;
          if (await tx.roomReservation.findUnique({ where: { id } })) continue;
          // Preserve visitor reservations and cancelled/edited demo bookings on reruns.
          if (await tx.roomReservation.findFirst({ where: { roomId: room.id, status: 'CONFIRMED', startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } })) continue;
          await tx.roomReservation.create({ data: { id, organizationId: org.id, roomId: room.id, startsAt, endsAt, title: ['Demo · Team stand-up', 'Demo · Product review', 'Demo · Visitor workshop'][slot], organizerDisplayName: 'Lumina Demo Team', providerKey: 'LUMINA', origin: 'DASHBOARD' } });
          added++;
        }
      }
    }
    console.log(`Demo ready: ${aliasCount} search aliases, AI kiosk, 4 rooms/displays, ${added} new reservations (30-day window).`);
  }, { timeout: 120_000 });
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
