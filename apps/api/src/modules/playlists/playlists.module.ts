import { Module } from '@nestjs/common';
import { PlaylistsService } from './playlists.service';
import { PlaylistsController, PlaylistsPreviewController } from './playlists.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [PlaylistsService],
  controllers: [PlaylistsController, PlaylistsPreviewController],
})
export class PlaylistsModule {}
