import { IsIn } from 'class-validator';

const STREAMING_TYPES = ['ASSET', 'PLAYLIST', 'WAYFINDING', 'ROOM_BOOKING'] as const;

export class SetStreamingTypeDto {
  @IsIn(STREAMING_TYPES)
  streamingType!: (typeof STREAMING_TYPES)[number];
}
