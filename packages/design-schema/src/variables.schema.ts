import { z } from 'zod';

// designer.md §17.2 — how a Template author declares a customer-fillable field.
export const DynamicFieldDefinitionSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(['text', 'number', 'currency', 'image', 'url']),
  required: z.boolean(),
  defaultValue: z.unknown().optional(),
});
export type DynamicFieldDefinition = z.infer<typeof DynamicFieldDefinitionSchema>;

// designer.md §17.2 — binds one element property to a {{variable}} token, with a fallback
// rendered whenever the variable has no resolved value.
export const DynamicBindingSchema = z.object({
  property: z.string(),
  variable: z.string(),
  fallback: z.string().optional(),
});
export type DynamicBinding = z.infer<typeof DynamicBindingSchema>;
