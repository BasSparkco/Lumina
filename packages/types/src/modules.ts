import { z } from 'zod';

/**
 * The authoritative catalog of purchasable Lumina platform modules — used by API validation
 * (Super Admin tenant-module assignment DTOs), Super Admin forms, dashboard capability checks
 * (`hasModule()`, nav/route gating), and tests. Add a module here once; every consumer imports
 * this list rather than declaring its own string union.
 *
 * `SIGNAGE_CORE` is deliberately not a row here — it's the base product every ACTIVE tenant
 * already has, not an optional entitlement. Suspending a whole tenant is `Organization.status`
 * (see `OrganizationStatusSchema` below), never done by removing a core-module row.
 */
export const MODULE_KEYS = ['WAYFINDING', 'WAYFINDING_AI', 'ROOM_BOOKING', 'INDOOR_POSITIONING'] as const;

export const ModuleKeySchema = z.enum(MODULE_KEYS);
export type ModuleKey = z.infer<typeof ModuleKeySchema>;

/**
 * Optional-module dependency graph: a module that requires another cannot be usable unless its
 * dependency is also usable (active/trial-unexpired, on an ACTIVE organization). `null` means no
 * optional-module dependency. `EntitlementsService.validateDependencies()` (Phase B) is the only
 * place this map is evaluated — this file just declares the graph, it doesn't walk it.
 */
export const MODULE_DEPENDENCIES: Record<ModuleKey, ModuleKey | null> = {
  WAYFINDING: null,
  WAYFINDING_AI: 'WAYFINDING',
  ROOM_BOOKING: null,
  INDOOR_POSITIONING: 'WAYFINDING',
};

export const TenantModuleStatusSchema = z.enum(['ACTIVE', 'TRIAL', 'DISABLED']);
export type TenantModuleStatus = z.infer<typeof TenantModuleStatusSchema>;

export const OrganizationStatusSchema = z.enum(['ACTIVE', 'SUSPENDED']);
export type OrganizationStatus = z.infer<typeof OrganizationStatusSchema>;

export interface TenantCapabilityModule {
  key: ModuleKey;
  status: TenantModuleStatus;
  // ISO 8601. Null means no expiry (a permanent ACTIVE assignment, or a TRIAL with no end date).
  expiresAt: string | null;
}

/**
 * The one server-owned response shape for `GET /v1/org/capabilities`. Never accept this shape
 * as client input, and never encode it into the JWT — a JWT can stay valid for days while a
 * Super Admin needs a module change to take effect immediately, so this must always be resolved
 * live from the database when enforced.
 */
export interface TenantCapabilities {
  tenantStatus: OrganizationStatus;
  modules: TenantCapabilityModule[];
}
