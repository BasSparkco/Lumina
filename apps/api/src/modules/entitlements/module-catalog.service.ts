import { Injectable } from '@nestjs/common';
import { MODULE_KEYS, MODULE_DEPENDENCIES, type ModuleKey } from '@lumina/types';

/**
 * Injectable wrapper around @lumina/types' static module catalog — the single source of truth
 * for which module keys exist and what each depends on (see
 * docs/adr/platform-modules-and-entitlements.md). EntitlementsService asks this rather than
 * importing MODULE_KEYS/MODULE_DEPENDENCIES directly, so the catalog can move to a real data
 * source later without touching every caller.
 */
@Injectable()
export class ModuleCatalogService {
  readonly keys: readonly ModuleKey[] = MODULE_KEYS;

  isValidKey(key: string): key is ModuleKey {
    return (MODULE_KEYS as readonly string[]).includes(key);
  }

  dependencyOf(key: ModuleKey): ModuleKey | null {
    return MODULE_DEPENDENCIES[key];
  }
}
