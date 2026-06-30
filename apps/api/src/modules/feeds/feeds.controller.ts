import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { FeedsService } from './feeds.service';
import { PlayerJwtGuard } from '../../common/guards/player-jwt.guard';

@ApiTags('feeds')
@ApiBearerAuth()
@UseGuards(PlayerJwtGuard)
@Controller('feeds')
export class FeedsController {
  constructor(private readonly feeds: FeedsService) {}

  @Get('weather')
  getWeather(@Query('lat') lat: string, @Query('lon') lon: string) {
    return this.feeds.getWeatherDirect(parseFloat(lat), parseFloat(lon));
  }

  @Get('currency')
  getCurrency(@Query('base') base: string = 'USD') {
    return this.feeds.getCurrency(base);
  }

  @Get('ticker')
  getTicker(@Query('url') url: string) {
    return this.feeds.getTicker(url);
  }
}
