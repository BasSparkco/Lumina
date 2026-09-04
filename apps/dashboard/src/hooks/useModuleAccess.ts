import type { ModuleKey } from '@lumina/types';
import { useCapabilities } from './useCapabilities';

// Single-module convenience wrapper over useCapabilities() — for a page/component that only
// cares about one module (nav filtering, route guards), rather than every call site re-deriving
// `hasModule(key)` and the loading flag separately.
export function useModuleAccess(moduleKey: ModuleKey): { allowed: boolean; loading: boolean } {
  const { hasModule, isLoading } = useCapabilities();
  return { allowed: hasModule(moduleKey), loading: isLoading };
}
