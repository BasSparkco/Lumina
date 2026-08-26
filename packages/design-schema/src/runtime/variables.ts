import type { DesignElement } from '../element.schema';

// designer.md §4.1/§17.2 — variable resolution is explicitly NOT Fabric's job, and (Phase 11) not
// duplicated server-side either. This module is pure data transformation (no fabric import, no
// React, no Node/Nest dependency) so it can be shared verbatim by CanvasViewport.tsx (resolves
// client-side for the Designer's own live preview) and player.service.ts (resolves server-side
// during manifest hydration) — the same resolution logic in both places, not two definitions that
// could silently disagree. Moved here from
// apps/dashboard/src/features/designer2/runtime/variables.ts in designer.md Phase 11.
export type VariableMap = Record<string, string>;

// Per-type property setters for the properties a binding can target today (designer.md §17.2's
// own example binds `text`; QR's `value` is the other concrete V1 case). Image `assetId` binding
// ("where supported") is deferred — see the Phase 8 amendment.
function applyResolvedProperty(element: DesignElement, property: string, value: string): DesignElement {
  if (property === 'text' && element.type === 'text') return { ...element, text: value };
  if (property === 'value' && element.type === 'qr') return { ...element, value };
  return element;
}

// Resolves every dynamicBinding on one element against `variables`, falling back to the
// binding's own `fallback`, then to the element's originally-authored value if neither resolves.
export function resolveElementBindings(element: DesignElement, variables: VariableMap): DesignElement {
  if (!element.dynamicBindings || element.dynamicBindings.length === 0) return element;
  let resolved = element;
  for (const binding of element.dynamicBindings) {
    const value = variables[binding.variable] ?? binding.fallback;
    if (value !== undefined) resolved = applyResolvedProperty(resolved, binding.property, value);
  }
  return resolved;
}
