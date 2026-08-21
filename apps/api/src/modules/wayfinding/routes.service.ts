import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgScopedService } from '../../common/org-scoped.service';
import type { CreateRouteNodeDto } from './dto/create-route-node.dto';
import type { CreateRouteEdgeDto } from './dto/create-route-edge.dto';

@Injectable()
export class RoutesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgScoped: OrgScopedService,
  ) {}

  // Full node+edge graph for a building — used by the dashboard's route graph editor (which
  // needs every floor's nodes to offer as the other end of a cross-floor edge) and by the
  // player's on-device routing engine (which needs the whole graph to route across floors).
  async graph(orgId: string, buildingId: string) {
    await this.assertOwnsBuilding(orgId, buildingId);
    const [nodes, edges] = await Promise.all([
      this.prisma.routeNode.findMany({ where: { floor: { buildingId } } }),
      this.prisma.routeEdge.findMany({ where: { fromNode: { floor: { buildingId } } } }),
    ]);
    return { nodes, edges };
  }

  async createNode(orgId: string, floorId: string, dto: CreateRouteNodeDto) {
    await this.assertOwnsFloor(orgId, floorId);
    return this.prisma.routeNode.create({ data: { floorId, x: dto.x, y: dto.y, label: dto.label } });
  }

  async updateNode(orgId: string, id: string, dto: CreateRouteNodeDto) {
    await this.assertOwnsNode(orgId, id);
    return this.prisma.routeNode.update({ where: { id }, data: { x: dto.x, y: dto.y, label: dto.label ?? null } });
  }

  async removeNode(orgId: string, id: string) {
    await this.assertOwnsNode(orgId, id);
    // RouteEdge cascades on either endpoint, so removing a node silently prunes every edge
    // touching it — acceptable here (unlike the building/floor kiosk-in-use guard) since a route
    // graph is redrawable data, not a live binding another record depends on.
    await this.prisma.routeNode.delete({ where: { id } });
  }

  async createEdge(orgId: string, buildingId: string, dto: CreateRouteEdgeDto) {
    await this.assertOwnsBuilding(orgId, buildingId);
    const [fromNode, toNode] = await Promise.all([
      this.assertNodeInBuilding(buildingId, dto.fromNodeId),
      this.assertNodeInBuilding(buildingId, dto.toNodeId),
    ]);
    if (fromNode.id === toNode.id) throw new BadRequestException('An edge must connect two different nodes');
    return this.prisma.routeEdge.create({
      data: { fromNodeId: dto.fromNodeId, toNodeId: dto.toNodeId, type: dto.type ?? 'WALK', weight: dto.weight },
    });
  }

  async updateEdge(orgId: string, id: string, dto: Pick<CreateRouteEdgeDto, 'type' | 'weight'>) {
    await this.assertOwnsEdge(orgId, id);
    return this.prisma.routeEdge.update({ where: { id }, data: { type: dto.type ?? 'WALK', weight: dto.weight } });
  }

  async removeEdge(orgId: string, id: string) {
    await this.assertOwnsEdge(orgId, id);
    await this.prisma.routeEdge.delete({ where: { id } });
  }

  private async assertOwnsBuilding(orgId: string, buildingId: string) {
    return this.orgScoped.assertOwns(
      () => this.prisma.building.findFirst({ where: { id: buildingId, organizationId: orgId } }),
      'Building not found',
    );
  }

  private async assertOwnsFloor(orgId: string, floorId: string) {
    return this.orgScoped.assertOwns(
      () => this.prisma.floor.findFirst({ where: { id: floorId, building: { organizationId: orgId } } }),
      'Floor not found',
    );
  }

  private async assertOwnsNode(orgId: string, id: string) {
    return this.orgScoped.assertOwns(
      () => this.prisma.routeNode.findFirst({ where: { id, floor: { building: { organizationId: orgId } } } }),
      'Route node not found',
    );
  }

  private async assertOwnsEdge(orgId: string, id: string) {
    return this.orgScoped.assertOwns(
      () => this.prisma.routeEdge.findFirst({
        where: { id, fromNode: { floor: { building: { organizationId: orgId } } } },
      }),
      'Route edge not found',
    );
  }

  // Cross-floor edges are only meaningful within the same building — a node id valid for this
  // org but belonging to a different building would silently create a nonsensical inter-building
  // "shortcut" the routing engine would happily (and wrongly) use.
  private async assertNodeInBuilding(buildingId: string, nodeId: string) {
    return this.orgScoped.assertOwns(
      () => this.prisma.routeNode.findFirst({ where: { id: nodeId, floor: { buildingId } } }),
      `Route node ${nodeId} not found in this building`,
    );
  }
}
