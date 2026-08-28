import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { PrismaClient } from '@lumina/db';
import { PrismaPg } from '@prisma/adapter-pg';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Queue } from 'bullmq';

// Full demo/sample content for the Wayfinding module — a 3-floor mall with a floor plan
// image per floor, POIs in every category, a routable node graph (incl. cross-floor
// elevator/stairs links), and a kiosk screen so a visitor can open /wayfinding in the
// dashboard, or view the live kiosk on "Test Screen — Lobby", and see a complete example
// rather than an empty state. Safe to re-run — skipped once the demo building exists.
//
// Floor plan photos are real mall directory maps from Wikimedia Commons (CC-BY-SA):
//   ground-floor.jpg  — "Floorplan of Lulu Mall, Kochi"
//   first-floor.jpg   — "Centerplan" (mall directory)
//   second-floor.jpg  — "SM City General Santos - Second Floor Map" (panoramio)

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? 'us-east-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? '',
    secretAccessKey: process.env.S3_SECRET_KEY ?? '',
  },
  forcePathStyle: true,
});
const bucket = process.env.S3_BUCKET ?? 'lumina-media';
const mediaQueue = new Queue('media', { connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6381' } });

const ASSETS_DIR = path.join(__dirname, 'wayfinding-assets');
const BUILDING_NAME = 'Lumina Galleria Mall';

async function uploadFloorPlan(orgId: string, filename: string, displayName: string) {
  const filePath = path.join(ASSETS_DIR, filename);
  const buffer = fs.readFileSync(filePath);
  const key = `${orgId}/assets/${crypto.randomUUID()}.jpg`;
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: 'image/jpeg' }));

  const asset = await prisma.asset.create({
    data: {
      name: displayName,
      type: 'IMAGE',
      mimeType: 'image/jpeg',
      storageKey: key,
      sizeBytes: buffer.length,
      category: 'BACKGROUND',
      tags: ['wayfinding', 'floor-plan'],
      organizationId: orgId,
      status: 'PROCESSING',
    },
  });
  await mediaQueue.add('generate-thumbnail', { assetId: asset.id, key, type: 'IMAGE', mimeType: 'image/jpeg' });
  return asset;
}

type PoiSeed = {
  name: string;
  nameAr: string;
  category: string;
  x: number;
  y: number;
  description: string;
  status?: 'OPEN' | 'CLOSED' | 'RELOCATED';
};

type NodeSeed = { key: string; x: number; y: number; label?: string };
type EdgeSeed = { from: string; to: string; type?: 'WALK' | 'ELEVATOR' | 'ESCALATOR' | 'STAIRS' };

function dist(a: NodeSeed, b: NodeSeed) {
  return Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) * 10) / 10);
}

// Same node layout (a center hub plus four corridor corners, an elevator and a stairwell)
// is reused on every floor so the elevator/stairs nodes line up vertically for cross-floor edges.
const NODES: NodeSeed[] = [
  { key: 'entrance', x: 50, y: 95, label: 'Main Entrance' },
  { key: 'hub', x: 50, y: 50, label: 'Center Court' },
  { key: 'elevator', x: 52, y: 48, label: 'Elevator Lobby' },
  { key: 'stairs', x: 15, y: 68, label: 'Stairwell A' },
  { key: 'nw', x: 20, y: 20 },
  { key: 'ne', x: 78, y: 20 },
  { key: 'sw', x: 20, y: 78 },
  { key: 'se', x: 78, y: 78 },
];

const EDGES: EdgeSeed[] = [
  { from: 'entrance', to: 'hub' },
  { from: 'hub', to: 'elevator' },
  { from: 'hub', to: 'stairs' },
  { from: 'hub', to: 'nw' },
  { from: 'hub', to: 'ne' },
  { from: 'hub', to: 'sw' },
  { from: 'hub', to: 'se' },
  { from: 'nw', to: 'ne' },
  { from: 'sw', to: 'se' },
  { from: 'nw', to: 'sw' },
  { from: 'ne', to: 'se' },
];

const FLOORS: { level: number; label: string; file: string; pois: PoiSeed[] }[] = [
  {
    level: 0,
    label: 'Ground Floor',
    file: 'ground-floor.jpg',
    pois: [
      { name: 'Lumina Info Desk', nameAr: 'مكتب الاستعلامات', category: 'Information', x: 22, y: 18, description: 'Ask staff for directions, lost & found, or gift cards.' },
      { name: 'Main Entrance / Exit', nameAr: 'المدخل الرئيسي', category: 'Exit', x: 50, y: 96, description: 'Main street-facing entrance and emergency exit.' },
      { name: 'TechHub Electronics', nameAr: 'تك هاب للإلكترونيات', category: 'Store', x: 30, y: 30, description: 'Phones, laptops, and accessories.' },
      { name: 'Sparkle Fashion Boutique', nameAr: 'بوتيك سباركل للأزياء', category: 'Store', x: 46, y: 20, description: 'Women’s and men’s fashion.', status: 'RELOCATED' },
      { name: 'Aroma Coffee House', nameAr: 'مقهى أروما', category: 'Food & Dining', x: 72, y: 25, description: 'Coffee, pastries, and light bites.' },
      { name: 'Golden Bank ATM', nameAr: 'صراف بنك الذهب الآلي', category: 'ATM / Bank', x: 60, y: 50, description: '24-hour cash withdrawal.' },
      { name: 'Restrooms — Ground', nameAr: 'دورات مياه - الأرضي', category: 'Restroom', x: 80, y: 60, description: 'Includes accessible and family stalls.' },
      { name: 'Center Court Elevator', nameAr: 'مصعد الساحة المركزية', category: 'Elevator', x: 52, y: 48, description: 'Serves all 3 levels.' },
      { name: 'Stairwell A', nameAr: 'الدرج أ', category: 'Stairs', x: 15, y: 68, description: 'Connects to all floors.' },
      { name: 'Parking Garage Access', nameAr: 'مدخل موقف السيارات', category: 'Parking', x: 10, y: 90, description: 'Elevator to the underground parking garage.' },
      { name: 'Fresh Bites Food Court', nameAr: 'ساحة فريش بايتس للطعام', category: 'Food & Dining', x: 66, y: 72, description: 'Multiple quick-service kitchens and shared seating.' },
      { name: 'Mobility Scooter Rental', nameAr: 'تأجير سكوتر الحركة', category: 'Accessibility', x: 28, y: 46, description: 'Free wheelchair and scooter rental at guest services.' },
    ],
  },
  {
    level: 1,
    label: 'First Floor',
    file: 'first-floor.jpg',
    pois: [
      { name: 'Info Kiosk', nameAr: 'كشك المعلومات', category: 'Information', x: 20, y: 20, description: 'Directory, maps, and event schedules.' },
      { name: 'CineMax Theater', nameAr: 'سينما سينماكس', category: 'Store', x: 35, y: 25, description: '8-screen cinema, now showing new releases.' },
      { name: 'Kids Play Zone', nameAr: 'منطقة ألعاب الأطفال', category: 'Baby Care', x: 75, y: 20, description: 'Supervised indoor play area and nursing room.' },
      { name: 'Books & Beyond', nameAr: 'بوكس آند بيوند', category: 'Store', x: 25, y: 55, description: 'Books, stationery, and gifts.', status: 'CLOSED' },
      { name: 'Restrooms — First Floor', nameAr: 'دورات مياه - الطابق الأول', category: 'Restroom', x: 80, y: 60, description: 'Includes accessible and family stalls.' },
      { name: 'Wellness Medical Clinic', nameAr: 'عيادة العافية الطبية', category: 'Medical / Clinic', x: 60, y: 80, description: 'Walk-in clinic, open mall hours.' },
      { name: 'Emergency Exit East', nameAr: 'مخرج الطوارئ الشرقي', category: 'Exit', x: 92, y: 50, description: 'Fire exit to the east parking lot.' },
      { name: 'Skyline Bank ATM', nameAr: 'صراف بنك سكايلاين الآلي', category: 'ATM / Bank', x: 40, y: 72, description: '24-hour cash withdrawal.' },
      { name: 'Center Court Elevator', nameAr: 'مصعد الساحة المركزية', category: 'Elevator', x: 52, y: 48, description: 'Serves all 3 levels.' },
      { name: 'Stairwell A', nameAr: 'الدرج أ', category: 'Stairs', x: 15, y: 68, description: 'Connects to all floors.' },
    ],
  },
  {
    level: 2,
    label: 'Second Floor',
    file: 'second-floor.jpg',
    pois: [
      { name: 'Gourmet Food Hall', nameAr: 'قاعة الطعام الفاخر', category: 'Food & Dining', x: 50, y: 30, description: 'Sit-down restaurants and a rooftop terrace.' },
      { name: 'Skyline Rooftop Lounge', nameAr: 'صالة سكايلاين على السطح', category: 'Store', x: 70, y: 25, description: 'Open-air lounge with city views.' },
      { name: 'Executive Restrooms', nameAr: 'دورات مياه تنفيذية', category: 'Restroom', x: 80, y: 55, description: 'Includes accessible and family stalls.' },
      { name: 'Observation Deck Info Point', nameAr: 'نقطة معلومات منصة المراقبة', category: 'Information', x: 50, y: 88, description: 'Guided tours of the rooftop observation deck.' },
      { name: 'Emergency Exit West', nameAr: 'مخرج الطوارئ الغربي', category: 'Exit', x: 8, y: 50, description: 'Fire exit to the west parking lot.' },
      { name: 'Family Nursing Room', nameAr: 'غرفة رعاية الأسرة', category: 'Baby Care', x: 30, y: 62, description: 'Private nursing and diaper-change room.' },
      { name: 'Center Court Elevator', nameAr: 'مصعد الساحة المركزية', category: 'Elevator', x: 52, y: 48, description: 'Serves all 3 levels.' },
      { name: 'Stairwell A', nameAr: 'الدرج أ', category: 'Stairs', x: 15, y: 68, description: 'Connects to all floors.' },
    ],
  },
];

async function main() {
  const org = await prisma.organization.findUnique({ where: { slug: 'demo' } });
  if (!org) {
    console.error('Demo org (slug "demo") not found — run `pnpm --filter api db:seed` first.');
    process.exit(1);
  }

  const existing = await prisma.building.findFirst({ where: { organizationId: org.id, name: BUILDING_NAME } });
  if (existing) {
    console.log(`"${BUILDING_NAME}" already exists for the demo org — nothing to do. Delete it in the dashboard first to reseed.`);
    return;
  }

  const categories = await prisma.poiCategory.findMany({ where: { organizationId: null } });
  const categoryByLabel = new Map(categories.map((c) => [c.label, c]));
  for (const label of new Set(FLOORS.flatMap((f) => f.pois.map((p) => p.category)))) {
    if (!categoryByLabel.has(label)) {
      console.error(`Missing POI category preset "${label}" — run \`pnpm --filter api db:seed\` first.`);
      process.exit(1);
    }
  }

  const building = await prisma.building.create({
    data: { name: BUILDING_NAME, address: '4500 Signage Avenue, Springfield', organizationId: org.id },
  });
  console.log(`Created building ${building.name} (${building.id})`);

  // floorId per level, and routeNode id per (level, nodeKey) — needed to wire cross-floor edges once all floors exist.
  const floorIdByLevel = new Map<number, string>();
  const nodeIdByLevelKey = new Map<string, string>();

  for (const floorDef of FLOORS) {
    const asset = await uploadFloorPlan(org.id, floorDef.file, `${BUILDING_NAME} — ${floorDef.label}`);
    const floor = await prisma.floor.create({
      data: {
        level: floorDef.level,
        label: floorDef.label,
        buildingId: building.id,
        floorPlanAssetId: asset.id,
      },
    });
    floorIdByLevel.set(floorDef.level, floor.id);
    console.log(`  Created floor "${floor.label}" with floor plan asset ${asset.id}`);

    for (const poi of floorDef.pois) {
      const category = categoryByLabel.get(poi.category)!;
      await prisma.poi.create({
        data: {
          name: poi.name,
          nameAr: poi.nameAr,
          x: poi.x,
          y: poi.y,
          description: poi.description,
          status: poi.status ?? 'OPEN',
          floorId: floor.id,
          categoryId: category.id,
        },
      });
    }
    console.log(`    Added ${floorDef.pois.length} POIs`);

    const createdNodes = await Promise.all(
      NODES.map((n) => prisma.routeNode.create({ data: { x: n.x, y: n.y, label: n.label ?? null, floorId: floor.id } })),
    );
    createdNodes.forEach((n, i) => nodeIdByLevelKey.set(`${floorDef.level}:${NODES[i]!.key}`, n.id));

    for (const edge of EDGES) {
      const fromDef = NODES.find((n) => n.key === edge.from)!;
      const toDef = NODES.find((n) => n.key === edge.to)!;
      await prisma.routeEdge.create({
        data: {
          type: edge.type ?? 'WALK',
          weight: dist(fromDef, toDef),
          fromNodeId: nodeIdByLevelKey.get(`${floorDef.level}:${edge.from}`)!,
          toNodeId: nodeIdByLevelKey.get(`${floorDef.level}:${edge.to}`)!,
        },
      });
    }
    console.log(`    Added ${NODES.length} route nodes / ${EDGES.length} route edges`);
  }

  // Cross-floor edges: elevator connects every floor, stairs connects every adjacent pair.
  const levels = FLOORS.map((f) => f.level).sort((a, b) => a - b);
  for (let i = 0; i < levels.length - 1; i++) {
    const lower = levels[i];
    const upper = levels[i + 1];
    await prisma.routeEdge.create({
      data: {
        type: 'ELEVATOR',
        weight: 15,
        fromNodeId: nodeIdByLevelKey.get(`${lower}:elevator`)!,
        toNodeId: nodeIdByLevelKey.get(`${upper}:elevator`)!,
      },
    });
    await prisma.routeEdge.create({
      data: {
        type: 'STAIRS',
        weight: 20,
        fromNodeId: nodeIdByLevelKey.get(`${lower}:stairs`)!,
        toNodeId: nodeIdByLevelKey.get(`${upper}:stairs`)!,
      },
    });
  }
  console.log(`Linked ${levels.length} floors with elevator + stairs edges`);

  // Bind the existing demo "Lobby" screen as a kiosk at the ground-floor entrance, and switch
  // it to WAYFINDING streaming so visiting /player for that screen shows the live kiosk view.
  const lobbyScreen = await prisma.screen.findFirst({ where: { organizationId: org.id, name: 'Test Screen — Lobby' } });
  if (lobbyScreen) {
    const groundFloorId = floorIdByLevel.get(0)!;
    await prisma.kioskLocation.upsert({
      where: { screenId: lobbyScreen.id },
      update: { x: 50, y: 95, floorId: groundFloorId },
      create: { screenId: lobbyScreen.id, x: 50, y: 95, floorId: groundFloorId },
    });
    await prisma.screen.update({ where: { id: lobbyScreen.id }, data: { streamingType: 'WAYFINDING' } });
    console.log(`Set "${lobbyScreen.name}" as a wayfinding kiosk at the ground-floor entrance`);
  } else {
    console.log('No "Test Screen — Lobby" found for the demo org — skipped kiosk binding (run `pnpm --filter api db:seed` for demo screens).');
  }

  console.log('\nWayfinding demo seeded. Open the dashboard → Wayfinding to browse it, or check "Test Screen — Lobby" in Screens for the live kiosk.');
  console.log('Floor plan thumbnails finish asynchronously — make sure apps/worker is running.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await mediaQueue.close();
    await prisma.$disconnect();
  });
