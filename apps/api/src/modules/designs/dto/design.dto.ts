import { IsInt, IsObject, IsOptional, IsString } from 'class-validator';

// Outer shape only — class-validator can't express the DesignDocument discriminated union;
// designJson is re-validated against @lumina/design-schema's DesignDocumentSchema in the
// service, same split TemplateDto/DesignDocumentSchema already uses. Shared by create (name
// required, enforced in the service — an omitted designJson gets a fresh blank document) and
// update (designJson/revision required, also enforced in the service — a manual save always
// sends both).
export class DesignDto {
  @IsString() @IsOptional() name?: string;
  @IsObject() @IsOptional() designJson?: Record<string, unknown>;
  // Optimistic concurrency token — required on update, ignored on create.
  @IsInt() @IsOptional() revision?: number;
}

export class DesignDraftDto {
  @IsObject() draftJson!: Record<string, unknown>;
}
