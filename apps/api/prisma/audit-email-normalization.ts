import { PrismaClient } from '@lumina/db';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Read-only pre-flight for P2's shared email normalization (org.service.ts / auth.service.ts).
// Reports collisions instead of fixing them: two existing rows that would become the *same*
// address once normalization is enforced are exactly the case P1/P2 deliberately don't
// auto-rewrite — whoever ships this needs to look at each one and decide (merge, rename, contact
// the account holder) rather than have a migration guess. Makes no writes; exits non-zero only to
// make "found something" visible in a CI/manual run, never to block anything automatically.
async function main() {
  const users = await prisma.user.findMany({ select: { id: true, email: true, organizationId: true } });
  const invites = await prisma.orgInvite.findMany({
    where: { acceptedAt: null },
    select: { id: true, email: true, organizationId: true },
  });

  let collisions = 0;

  const usersByNormalized = new Map<string, typeof users>();
  for (const user of users) {
    const key = normalizeEmail(user.email);
    usersByNormalized.set(key, [...(usersByNormalized.get(key) ?? []), user]);
  }
  for (const [normalized, group] of usersByNormalized) {
    const distinctRaw = new Set(group.map(u => u.email));
    if (distinctRaw.size > 1) {
      collisions++;
      console.log(`[USER COLLISION] "${normalized}" — ${group.length} rows with different casing:`);
      for (const u of group) console.log(`  - User ${u.id} (org ${u.organizationId}): "${u.email}"`);
    }
  }

  // A User and a still-pending OrgInvite that normalize to the same address but aren't an exact
  // match today — accepting that invite as-is is about to collide with the shared helper's
  // existing-user check for the first time.
  const usersByExact = new Map(users.map(u => [normalizeEmail(u.email), u]));
  for (const invite of invites) {
    const normalized = normalizeEmail(invite.email);
    const matchingUser = usersByExact.get(normalized);
    if (matchingUser && matchingUser.email !== invite.email) {
      collisions++;
      console.log(`[INVITE/USER COLLISION] Invite ${invite.id} ("${invite.email}", org ${invite.organizationId}) ` +
        `normalizes to the same address as existing User ${matchingUser.id} ("${matchingUser.email}", org ${matchingUser.organizationId}).`);
    }
  }

  if (collisions === 0) {
    console.log('No email-normalization collisions found.');
  } else {
    console.log(`\n${collisions} collision(s) found. No rows were changed — resolve these manually before relying on normalized-email uniqueness.`);
  }
  process.exitCode = collisions > 0 ? 1 : 0;
}

main()
  .catch(console.error)
  .finally(() => void prisma.$disconnect());
