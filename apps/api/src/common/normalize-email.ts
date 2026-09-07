// Shared by every flow that writes or looks up a User/OrgInvite email (auth register/login, org
// invite/accept) so "Foo@Example.com" and "foo@example.com" are always treated as the same
// address. Deliberately does not touch any row already in the database — see
// prisma/audit-email-normalization.ts for detecting existing case-divergent duplicates instead of
// silently rewriting them.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
