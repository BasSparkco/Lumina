import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { DesignsService } from './designs.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/types/jwt-user';

// designer.md §21 "Customer Designs" — only the read side plus template-clone creation
// (TemplatesController's create-design, via DesignsService.createFromTemplate) exist yet, per
// designer.md Phase 5's own scope. PATCH/DELETE/duplicate/restore/versions/autosave-draft are
// designer.md Phase 10 — not built here.
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
}
