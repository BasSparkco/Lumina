import type { ModuleKey, PlayerModuleLease } from '@lumina/types';

// Bounds how long a restored/cached PlayerState may keep rendering a paid module's content —
// see docs/adr/platform-modules-and-entitlements.md. A freshly-fetched state's lease is always
// valid by construction (the server just issued it), so this check is a no-op on the live path
// and only actually matters for a presentation restored from offline storage with no network
// round-trip. A missing or malformed lease is treated as expired, never as "no restriction" —
// fail closed, matching the ADR's explicit instruction, not fail open.
export function isModuleLeaseValid(leases: PlayerModuleLease[] | undefined, key: ModuleKey, now: Date = new Date()): boolean {
  if (!Array.isArray(leases)) return false;
  const lease = leases.find(l => l?.key === key);
  if (!lease) return false;
  const validUntil = new Date(lease.validUntil);
  if (Number.isNaN(validUntil.getTime())) return false;
  return validUntil.getTime() > now.getTime();
}
