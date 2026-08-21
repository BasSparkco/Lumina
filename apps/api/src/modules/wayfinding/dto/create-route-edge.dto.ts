import { IsString, IsOptional, IsNumber, IsIn, Min } from 'class-validator';

const ROUTE_EDGE_TYPES = ['WALK', 'ELEVATOR', 'ESCALATOR', 'STAIRS'] as const;

export class CreateRouteEdgeDto {
  @IsString()
  fromNodeId!: string;

  @IsString()
  toNodeId!: string;

  @IsIn(ROUTE_EDGE_TYPES)
  @IsOptional()
  type?: (typeof ROUTE_EDGE_TYPES)[number];

  @IsNumber()
  @Min(0.01)
  weight!: number;
}
