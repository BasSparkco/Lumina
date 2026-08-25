import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsUrl } from 'class-validator';
import { AppsService } from './apps.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

class ResolveAppDto {
  @IsString() providerId!: string;
  @IsUrl() sourceUrl!: string;
}

@ApiTags('apps')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('apps')
export class AppsController {
  constructor(private readonly apps: AppsService) {}

  @Get('providers')
  listProviders() {
    return this.apps.listProviders();
  }

  // Resolves a pasted URL into preview metadata (title/thumbnail) without creating anything —
  // used by the Assets page's Apps tab to show a preview before the user confirms.
  @Post('resolve')
  resolve(@Body() dto: ResolveAppDto) {
    return this.apps.resolve(dto.providerId, dto.sourceUrl);
  }
}
