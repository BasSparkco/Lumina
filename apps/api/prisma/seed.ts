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

  console.log('Seed complete. Login: admin@demo.com / changeme');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
