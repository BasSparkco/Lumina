import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ProofOfPlayService } from './proof-of-play.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/types/jwt-user';

@ApiTags('proof-of-play')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('proof-of-play')
export class ProofOfPlayController {
  constructor(private readonly proofOfPlay: ProofOfPlayService) {}

  @Get()
  query(
    @CurrentUser() user: JwtUser,
    @Query('screenId') screenId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.proofOfPlay.query(user.orgId, {
      screenId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      page: Number(page) || 1,
      pageSize: Math.min(Number(pageSize) || 50, 200),
    });
  }

  @Get('export')
  async export(
    @CurrentUser() user: JwtUser,
    @Res() res: Response,
    @Query('screenId') screenId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const csv = await this.proofOfPlay.exportCsv(user.orgId, {
      screenId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="proof-of-play.csv"');
    res.send(csv);
  }
}
