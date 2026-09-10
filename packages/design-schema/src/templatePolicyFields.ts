import type { DesignElement } from './element.schema';

// designer_modernization_plan.md M5 — the same content-vs-style partition
// apps/api/src/modules/designs/designs.service.ts's assertTemplatePolicyRespected already
// enforces server-side (moved here, not duplicated, so a future field addition to one side can't
// silently reopen the client/server drift M5 closed). "Content" is what's shown (the element's
// subject matter); "style" is how it looks. Geometry (x/y/width/height/rotation) is a separate
// axis, gated by movable/resizable, which every element already carries regardless of type.
export const CONTENT_PROPS_BY_TYPE: Record<DesignElement['type'], readonly string[]> = {
  text: ['text'],
  image: ['assetId'],
  shape: ['shape'],
  video: ['assetId', 'posterAssetId'],
  qr: ['value'],
};

export const STYLE_PROPS_BY_TYPE: Record<DesignElement['type'], readonly string[]> = {
  text: ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fill', 'textAlign', 'direction', 'lineHeight', 'charSpacing'],
  image: ['cropZoom', 'cropOffsetX', 'cropOffsetY', 'fit', 'adjustments', 'borderRadius', 'flipX', 'flipY'],
  shape: ['fill', 'stroke', 'strokeWidth', 'radius'],
  video: ['startOffsetMs', 'endOffsetMs', 'muted', 'volume', 'loop', 'fit', 'autoplay'],
  qr: ['foregroundColor', 'backgroundColor', 'errorCorrection'],
};
