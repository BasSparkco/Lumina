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

// PUT /designs/:id/name — deliberately its own tiny DTO rather than reusing DesignDto: a rename
// is name-only and must not accidentally accept/ignore a designJson/revision payload the way a
// PATCH built on DesignDto's all-optional fields could.
export class RenameDesignDto {
  @IsString() name!: string;
}
