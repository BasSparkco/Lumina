import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.upsert({
    where: { slug: 'demo' },
    update: {},
    create: { name: 'Demo Org', slug: 'demo' },
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

  console.log('Seed complete. Logins: admin@demo.com / changeme (OWNER), viewer@demo.com / changeme (VIEWER)');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
