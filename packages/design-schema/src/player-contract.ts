import type { DesignElement } from './element.schema';

/**
 * designer.md §23.1 — what the Player consumes. This is the POST-resolution shape: dynamic
 * variable tokens already substituted, every assetId already resolved to a signed/CDN URL.
 * The Player never receives a raw DesignDocument with unresolved {{variable}} tokens, and never
 * receives Fabric serialization of any kind. The resolver that turns a DesignDocument into this
 * shape is Player Integration (designer.md Phase 11) — not implemented here; this file defines
 * the contract only, so Designer/API/Player work can proceed against a shared shape.
 */
export interface ResolvedDesignPayload {
  schemaVersion: 1;
  id: string;
  canvas: { width: number; height: number; backgroundColor: string };
  scenes: ResolvedScene[];
}

export interface ResolvedScene {
  id: string;
  durationMs: number;
  background: ResolvedBackground;
  elements: ResolvedElement[];
}

// DesignElement with dynamicBindings already substituted into the underlying property and
// assetId already resolved to a signed/CDN URL.
export type ResolvedElement = DesignElement & { resolvedSrc?: string };

export interface ResolvedBackground {
  type: 'color' | 'image' | 'video';
  color?: string;
  resolvedSrc?: string;
}
