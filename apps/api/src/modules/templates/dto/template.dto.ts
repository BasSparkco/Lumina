import { IsArray, IsIn, IsObject, IsOptional, IsString } from 'class-validator';

const THEME_CATEGORIES = ['RESTAURANT_MENU', 'RETAIL_PROMO', 'HOTEL_LOBBY', 'CLINIC_WAITING', 'MOSQUE', 'GENERIC'] as const;
// designer.md §10.2 also names TENANT_GROUP — omitted, see the DesignTemplateVisibility enum
// comment in schema.prisma for why.
const TEMPLATE_VISIBILITIES = ['GLOBAL', 'SELECTED_TENANTS', 'HIDDEN'] as const;

// Outer shape only — class-validator can't express the DesignDocument discriminated union;
// designJson is re-validated against @lumina/design-schema's DesignDocumentSchema in the
// service, the authoritative check (same split ThemeDto/ThemeInputSchema already uses).
// Used for both create and update: on create, an omitted designJson gets a fresh blank
// DesignDocument built server-side (see TemplatesService.buildBlankDesignDocument). `name` is
// optional here even though it's required at creation (TemplatesService.adminCreate enforces
// that itself) — designer2's own Save button (DesignerShell.handleSave) PUTs only `{designJson}`
// while authoring a Template's content, and must not be forced to also resend metadata it never
// touched just to pass validation.
export class TemplateDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() description?: string;
  @IsIn(THEME_CATEGORIES) @IsOptional() category?: (typeof THEME_CATEGORIES)[number];
  @IsIn(TEMPLATE_VISIBILITIES) @IsOptional() visibility?: (typeof TEMPLATE_VISIBILITIES)[number];
  @IsObject() @IsOptional() designJson?: Record<string, unknown>;
}

export class TenantAccessDto {
  @IsArray()
  @IsString({ each: true })
  tenantIds!: string[];
}
