import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { DesignsService } from './designs.service';
import { DesignDto, DesignDraftDto, RenameDesignDto } from './dto/design.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/types/jwt-user';

// designer.md §21 "Customer Designs" + §26 "Autosave / Versioning" — designer.md Phase 10.
// Duplicate/delete are still not built (no UI trigger point without a "My Designs" browse page).
@ApiTags('designs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('designs')
export class DesignsController {
  constructor(private readonly designs: DesignsService) {}

  @Get()
  list(@CurrentUser() user: JwtUser) {
    return this.designs.list(user.orgId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.designs.findOne(user.orgId, id);
  }

  @Post()
  create(@CurrentUser() user: JwtUser, @Body() dto: DesignDto) {
    return this.designs.create(user.orgId, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: DesignDto) {
    return this.designs.update(user.orgId, id, dto);
  }

  @Put(':id/name')
  rename(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: RenameDesignDto) {
    return this.designs.rename(user.orgId, id, dto.name);
  }

  @Get(':id/versions')
  listVersions(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.designs.listVersions(user.orgId, id);
  }

  @Post(':id/restore/:versionId')
  restoreVersion(@CurrentUser() user: JwtUser, @Param('id') id: string, @Param('versionId') versionId: string) {
    return this.designs.restoreVersion(user.orgId, id, versionId);
  }
}

// designer.md §21 "Autosave Draft" — keyed by the client-generated DesignDocument.id
// (`documentId`), not a DesignAsset id, so a brand-new unsaved design can autosave before it has
// ever been persisted as a real DesignAsset row (see DesignDraft's schema comment).
@ApiTags('design-drafts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('design-drafts')
export class DesignDraftsController {
  constructor(private readonly designs: DesignsService) {}

  @Get(':documentId')
  get(@CurrentUser() user: JwtUser, @Param('documentId') documentId: string) {
    return this.designs.getDraft(user.orgId, documentId);
  }

  @Put(':documentId')
  put(@CurrentUser() user: JwtUser, @Param('documentId') documentId: string, @Body() dto: DesignDraftDto) {
    return this.designs.putDraft(user.orgId, user.sub, documentId, dto.draftJson);
  }

  @Delete(':documentId')
  remove(@CurrentUser() user: JwtUser, @Param('documentId') documentId: string) {
    return this.designs.removeDraft(user.orgId, documentId);
  }
}
