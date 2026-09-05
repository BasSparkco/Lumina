import { MODULE_DEPENDENCIES, type ModuleKey, type TenantCapabilities } from '@lumina/types';

// docs/modules/modules_shared_preflight_plan.md §6.1 — the one pure dependency-aware
// capability resolver. The API (EntitlementsService.hasModule()) already walks
// MODULE_DEPENDENCIES recursively; this mirrors that exact rule client-side so nav/route
// gating never disagrees with what the API would actually reject once a dependent module
// (WAYFINDING_AI, INDOOR_POSITIONING) is exposed. This is a UI convenience only — the API
// remains the security boundary and always re-checks for real.
//
// `dependencies` defaults to the real shared catalog; it's an explicit parameter (not just a
// closed-over import) so a cyclic map can be injected in tests without ever needing a real
// cycle to exist in `@lumina/types` — the shipped catalog is a straight-line chain today and
// should never need one.
export function hasUsableModule(
  capabilities: TenantCapabilities,
  key: ModuleKey,
  now: Date,
  visiting: Set<ModuleKey> = new Set(),
  dependencies: Record<ModuleKey, ModuleKey | null> = MODULE_DEPENDENCIES,
): boolean {
  if (capabilities.tenantStatus !== 'ACTIVE') return false;
  if (visiting.has(key)) return false;

  const assignment = capabilities.modules.find((module) => module.key === key);
  if (!assignment) return false;

  const usable =
    assignment.status === 'ACTIVE' ||
    (assignment.status === 'TRIAL' &&
      (!assignment.expiresAt || new Date(assignment.expiresAt) > now));
  if (!usable) return false;

  const dependency = dependencies[key];
  if (!dependency) return true;

  const next = new Set(visiting);
  next.add(key);
  return hasUsableModule(capabilities, dependency, now, next, dependencies);
}
