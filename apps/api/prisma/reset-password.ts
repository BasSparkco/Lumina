import { PrismaClient } from '@lumina/db';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

function generatePassword(length = 16): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from(crypto.randomFillSync(new Uint8Array(length)))
    .map(b => alphabet[b % alphabet.length])
    .join('');
}

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: pnpm db:reset-password <email>');
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user found with email ${email}`);
    process.exitCode = 1;
    return;
  }

  const newPassword = generatePassword();
  await prisma.user.update({
    where: { email },
    data: { passwordHash: await bcrypt.hash(newPassword, 12) },
  });

  console.log(`Password reset for ${email}`);
  console.log(`New password: ${newPassword}`);
}

main()
  .catch(console.error)
  .finally(() => void prisma.$disconnect());
