import { Module } from '@nestjs/common';
import { ProofOfPlayService } from './proof-of-play.service';
import { ProofOfPlayController } from './proof-of-play.controller';

@Module({
  providers: [ProofOfPlayService],
  controllers: [ProofOfPlayController],
  exports: [ProofOfPlayService],
})
export class ProofOfPlayModule {}
