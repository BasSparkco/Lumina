import { z } from 'zod';
import { ThemeImageAdjustmentsSchema } from '@lumina/types';
import { ElementAnimationSchema } from './animation.schema';
import { DynamicBindingSchema } from './variables.schema';

// designer.md §7 (amended 2026-08-25) — Template-specific editability, narrowed to the two axes
// that aren't already expressed by every element's own capability flags below (movable/
// resizable/deletable/selectable). Absent entirely (not just all-false) means "not a
// template-managed element" — a plain customer DesignAsset element has no policy at all.
export const TemplateLayerPolicySchema = z.object({
  styleEditable: z.boolean(),
  contentEditable: z.boolean(),
});
export type TemplateLayerPolicy = z.infer<typeof TemplateLayerPolicySchema>;

// designer.md §6 — properties common to every element type.
const BaseElementSchema = z.object({
  id: z.string(),
  name: z.string(),

  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),

  rotation: z.number().default(0),
  opacity: z.number().min(0).max(1).default(1),

  visible: z.boolean().default(true),
  zIndex: z.number(),

  editable: z.boolean().default(true),

  // Capability-based interaction flags (amended 2026-08-25, replacing a single `locked`
  // boolean, which couldn't express designer.md §7's own examples — e.g. a logo placeholder
  // that's selectable/content-editable but position-locked). Every element carries these, not
  // just Template-managed ones.
  selectable: z.boolean().default(true),
  movable: z.boolean().default(true),
  resizable: z.boolean().default(true),
  deletable: z.boolean().default(true),

  animation: ElementAnimationSchema.optional(),
  dynamicBindings: z.array(DynamicBindingSchema).optional(),
  templatePolicy: TemplateLayerPolicySchema.optional(),
});

// designer.md §6 — Text
export const TextElementSchema = BaseElementSchema.extend({
  type: z.literal('text'),
  text: z.string(),

  fontFamily: z.string(),
  fontSize: z.number().positive(),
  fontWeight: z.union([z.number(), z.string()]),
  fontStyle: z.enum(['normal', 'italic']).optional(),

  fill: z.string(),
  textAlign: z.enum(['left', 'center', 'right']),
  direction: z.enum(['ltr', 'rtl']),

  lineHeight: z.number().optional(),
  charSpacing: z.number().optional(),
});
export type TextElement = z.infer<typeof TextElementSchema>;

// designer.md §6 — Image
//
// Amendment (2026-08-25, Phase 4): `crop`/`filters` were redrafted at Phase 0 before any picker
// UI existed. designer.md's Phase 4 amendment mandates reusing the existing
// CropEditor.tsx/AdjustmentsEditor.tsx components as-is rather than building new ones — so their
// actual data contracts (MediaCrop's flat cropZoom/cropOffsetX/cropOffsetY, and the full
// ThemeImageAdjustments used by every other placement-level image in this app) are adopted
// directly in place of the originally-drafted box-crop and 4-field filter shapes. This also means
// Image elements share the exact same crop/adjustment math (mediaCropStyle/buildImageFilterCss in
// @lumina/types) that the Player will eventually use to render `<img>` elements per designer.md
// §23.2 — one shared runtime instead of a second, divergent implementation. `filters` is renamed
// to `adjustments` accordingly; ThemeImageAdjustments is already a strict superset of §14's
// suggested brightness/contrast/saturation/grayscale baseline (grayscale = saturation: -100).
export const ImageElementSchema = BaseElementSchema.extend({
  type: z.literal('image'),
  // Optional: a Phase 2 placeholder image element has no bound media yet — the real asset
  // picker is designer.md Phase 4. Undefined renders as a placeholder box in the editor.
  assetId: z.string().optional(),
  cropZoom: z.number().min(1).max(4).optional(),
  cropOffsetX: z.number().optional(),
  cropOffsetY: z.number().optional(),
  fit: z.enum(['contain', 'cover', 'fill']).default('contain'),
  adjustments: ThemeImageAdjustmentsSchema.optional(),
  borderRadius: z.number().optional(),
  flipX: z.boolean().optional(),
  flipY: z.boolean().optional(),
});
export type ImageElement = z.infer<typeof ImageElementSchema>;

// designer.md §6 — Shape
export const ShapeKindSchema = z.enum(['rectangle', 'rounded-rectangle', 'circle', 'ellipse', 'triangle', 'line']);
export const ShapeElementSchema = BaseElementSchema.extend({
  type: z.literal('shape'),
  shape: ShapeKindSchema,
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().optional(),
  radius: z.number().optional(),
});
export type ShapeElement = z.infer<typeof ShapeElementSchema>;

// designer.md §6 — Video
//
// Amendment (2026-08-26, Phase 9): `assetId` was originally required, but the "Add X" sidebar
// flow every other element type uses (Text/Shape/Image/QR) always inserts an empty placeholder
// first, then the author picks media via the element's own Properties panel — matching
// ImageElementSchema's own optional `assetId` for the same reason. Nothing depended on `assetId`
// being required (Phase 9 hadn't shipped), so this is a clean change, not a migration.
export const VideoElementSchema = BaseElementSchema.extend({
  type: z.literal('video'),
  assetId: z.string().optional(),
  startOffsetMs: z.number().nonnegative().default(0),
  endOffsetMs: z.number().nonnegative().optional(),
  muted: z.boolean().default(true),
  volume: z.number().min(0).max(1).default(1),
  loop: z.boolean().default(true),
  fit: z.enum(['contain', 'cover', 'fill']).default('cover'),
  autoplay: z.boolean().default(true),
  posterAssetId: z.string().optional(),
});
export type VideoElement = z.infer<typeof VideoElementSchema>;

// designer.md §6 — QR
//
// Amendment (2026-08-26, Phase 8): the Phase 0 draft's separate `dynamicValue` field is dropped.
// designer.md §17.1's "static/dynamic mode" is expressed through the generic `dynamicBindings`
// mechanism every element already has (§6/§17.2) — `{property: 'value', variable, fallback}` —
// rather than a second, QR-only binding mechanism. Nothing persisted real data through the old
// field yet (Phase 0 scaffolding only), so this is a clean removal, not a migration.
export const QrElementSchema = BaseElementSchema.extend({
  type: z.literal('qr'),
  value: z.string().optional(),
  foregroundColor: z.string().default('#000000'),
  backgroundColor: z.string().default('#ffffff'),
  errorCorrection: z.enum(['L', 'M', 'Q', 'H']).default('M'),
});
export type QrElement = z.infer<typeof QrElementSchema>;

export const DesignElementSchema = z.discriminatedUnion('type', [
  TextElementSchema,
  ImageElementSchema,
  ShapeElementSchema,
  VideoElementSchema,
  QrElementSchema,
]);
export type DesignElement = z.infer<typeof DesignElementSchema>;
