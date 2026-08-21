import { Module } from '@nestjs/common';
import { BuildingsService } from './buildings.service';
import { BuildingsController } from './buildings.controller';
import { PoiCategoriesService } from './poi-categories.service';
import { PoiCategoriesController } from './poi-categories.controller';
import { PoisService } from './pois.service';
import { PoisController } from './pois.controller';
import { RoutesService } from './routes.service';
import { RoutesController } from './routes.controller';
import { AuthModule } from '../auth/auth.module';
import { WsModule } from '../ws/ws.module';
import { ScreensModule } from '../screens/screens.module';

@Module({
  imports: [AuthModule, WsModule, ScreensModule],
  providers: [BuildingsService, PoiCategoriesService, PoisService, RoutesService],
  controllers: [BuildingsController, PoiCategoriesController, PoisController, RoutesController],
  exports: [BuildingsService, PoiCategoriesService, PoisService, RoutesService],
})
export class WayfindingModule {}
