export * from './animation.schema';
export * from './variables.schema';
export * from './media.schema';
export * from './element.schema';
export * from './scene.schema';
export * from './design.schema';
export * from './player-contract';
export * from './runtime/animations';
export * from './runtime/variables';

// Explicit re-exports of runtime values (schemas), same reasoning as packages/types/src/index.ts:
// `export *` alone isn't statically analyzable by every bundler's CJS/ESM interop.
export { AnimationPresetSchema, ElementAnimationSchema } from './animation.schema';
export { DynamicFieldDefinitionSchema, DynamicBindingSchema } from './variables.schema';
export { MediaReferenceSchema } from './media.schema';
export {
  TemplateLayerPolicySchema,
  TextElementSchema,
  ImageElementSchema,
  ShapeKindSchema,
  ShapeElementSchema,
  VideoElementSchema,
  QrElementSchema,
  DesignElementSchema,
} from './element.schema';
export { DesignSceneSchema } from './scene.schema';
export { DesignDocumentSchema, buildBlankDesignDocument } from './design.schema';
export { ANIMATION_MOTION, EASING_FUNCTIONS, resolveEasing } from './runtime/animations';
export { resolveElementBindings } from './runtime/variables';
