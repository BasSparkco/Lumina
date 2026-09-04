import { randomBytes } from 'node:crypto';
import { PrismaClient, type Prisma } from '@lumina/db';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { ThemeInputSchema, POI_CATEGORY_PRESETS } from '@lumina/types';
import { THEME_PRESETS } from './theme-presets';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const org = await prisma.organization.upsert({
    where: { slug: 'demo' },
    update: {},
    create: { name: 'Demo Org', slug: 'demo' },
  });

  // The tenant-modules migration backfills WAYFINDING for every organization that already
  // existed when it ran — it can't reach an org created afterward by this seed on a fresh
  // database, so the demo org needs the same entitlement granted here instead. Keeps
  // `db:seed-wayfinding`'s demo content usable once Wayfinding enforcement ships.
  await prisma.tenantModule.upsert({
    where: { organizationId_moduleKey: { organizationId: org.id, moduleKey: 'WAYFINDING' } },
    update: {},
    create: { organizationId: org.id, moduleKey: 'WAYFINDING', status: 'ACTIVE' },
  });

  await prisma.user.upsert({
    where: { email: 'admin@demo.com' },
    update: {},
    create: {
      email: 'admin@demo.com',
      passwordHash: await bcrypt.hash('changeme', 12),
      name: 'Admin User',
      role: 'OWNER',
      organizationId: org.id,
    },
  });

  await prisma.user.upsert({
    where: { email: 'viewer@demo.com' },
    update: {},
    create: {
      email: 'viewer@demo.com',
      passwordHash: await bcrypt.hash('changeme', 12),
      name: 'Viewer User',
      role: 'VIEWER',
      organizationId: org.id,
    },
  });

  // Dedicated org for platform-staff accounts — a Super Admin still needs a real organizationId
  // (the FK is required), but their cross-tenant power comes entirely from isSuperAdmin, not from
  // anything about this org or their role within it.
  const platformOrg = await prisma.organization.upsert({
    where: { slug: 'lumina-platform' },
    update: {},
    create: { name: 'Lumina Platform', slug: 'lumina-platform' },
  });

  const superAdminExists = await prisma.user.findUnique({ where: { email: 'superadmin@lumina.internal' } });
  let generatedSuperAdminPassword: string | null = null;
  if (!superAdminExists) {
    const superAdminPassword = process.env.SUPER_ADMIN_SEED_PASSWORD ?? randomBytes(18).toString('base64url');
    if (!process.env.SUPER_ADMIN_SEED_PASSWORD) generatedSuperAdminPassword = superAdminPassword;

    await prisma.user.create({
      data: {
        email: 'superadmin@lumina.internal',
        passwordHash: await bcrypt.hash(superAdminPassword, 12),
        name: 'Platform Super Admin',
        role: 'OWNER',
        organizationId: platformOrg.id,
        isSuperAdmin: true,
      },
    });
  }

  // Fake test screens — not real paired devices, just enough rows to test
  // multi-screen UI (schedules, layouts, etc.) without pairing real hardware.
  const testScreens = [
    { name: 'Test Screen — Lobby', timezone: 'America/New_York' },
    { name: 'Test Screen — Cairo Branch', timezone: 'Africa/Cairo' },
    { name: 'Test Screen — Tokyo Branch', timezone: 'Asia/Tokyo' },
  ];
  for (const s of testScreens) {
    const existing = await prisma.screen.findFirst({ where: { organizationId: org.id, name: s.name } });
    if (!existing) {
      await prisma.screen.create({
        data: { name: s.name, timezone: s.timezone, organizationId: org.id, paired: true, status: 'OFFLINE' },
      });
    }
  }

  // System theme presets — organizationId: null so every org can see and duplicate them.
  for (const preset of THEME_PRESETS) {
    const existing = await prisma.theme.findFirst({ where: { organizationId: null, name: preset.name } });
    if (existing) continue;
    const validated = ThemeInputSchema.parse(preset);
    await prisma.theme.create({
      data: {
        name: validated.name,
        category: validated.category,
        aspectRatio: validated.aspectRatio,
        palette: validated.palette,
        typography: validated.typography,
        elements: validated.elements as unknown as Prisma.InputJsonValue,
        organizationId: null,
      },
    });
  }

  // System POI category presets — organizationId: null so every org can see and use them,
  // same pattern as the theme presets above.
  for (const preset of POI_CATEGORY_PRESETS) {
    const existing = await prisma.poiCategory.findFirst({ where: { organizationId: null, label: preset.label } });
    if (existing) continue;
    await prisma.poiCategory.create({
      data: {
        label: preset.label,
        labelAr: preset.labelAr,
        icon: preset.icon,
        color: preset.color,
        organizationId: null,
      },
    });
  }

  console.log('Seed complete. Logins: admin@demo.com / changeme (OWNER), viewer@demo.com / changeme (VIEWER)');
  if (generatedSuperAdminPassword) {
    console.log(
      `Super Admin created: superadmin@lumina.internal / ${generatedSuperAdminPassword}\n` +
        '  ⚠ Generated password — copy it now, it is not stored anywhere and will not be printed again.\n' +
        '  ⚠ This account has no real cross-tenant capability yet (Phase 5 wires that up), but rotate/disable it before any production exposure.\n' +
        '  Set SUPER_ADMIN_SEED_PASSWORD to control this password instead of generating one.',
    );
  } else if (process.env.SUPER_ADMIN_SEED_PASSWORD) {
    console.log('Super Admin ready: superadmin@lumina.internal (password from SUPER_ADMIN_SEED_PASSWORD)');
  } else {
    console.log('Super Admin already exists: superadmin@lumina.internal');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
