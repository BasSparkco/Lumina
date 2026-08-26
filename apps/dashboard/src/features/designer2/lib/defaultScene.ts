import type { DesignDocument, DesignScene } from '@lumina/design-schema';

export function createScene(document: DesignDocument): DesignScene {
  return {
    id: `scene_${crypto.randomUUID()}`,
    name: `Scene ${document.scenes.length + 1}`,
    durationMs: document.settings.defaultSceneDurationMs,
    background: { type: 'color', color: document.canvas.backgroundColor },
    elements: [],
  };
}
