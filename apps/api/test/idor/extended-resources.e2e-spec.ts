import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { PrismaClient } from '@lumina/db';
import { createTestApp, createTestPrisma } from '../utils/test-app';
import { buildTwoTenantFixture, type TwoTenantFixture } from '../utils/fixture';

// P9 (docs/tenant_isolation_and_platform_admin_plan.md) — extends tenant-isolation.e2e-spec.ts's
// pattern (same fixture, same app bootstrap) across every remaining tenant-private resource
// controller with a plain get/update/delete-by-id shape: Layouts, Themes, Schedules,
// PowerSchedules, ScreenGroups, PoiCategories, Buildings/Floors, Pois, RouteNodes/RouteEdges,
// and Rooms (Room Booking). Each block runs the same three rows from the plan's matrix table —
// A gets B's id (404), A updates B's id (404, no mutation), A deletes B's id (404, row
// survives) — with a valid request body for the update case so a 400 (payload validation) can
// never be mistaken for the 404 (ownership) this suite is actually checking.
describe('Tenant isolation — extended resource IDOR matrix', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixture: TwoTenantFixture;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = createTestPrisma();
    fixture = await buildTwoTenantFixture(prisma, app.get(JwtService));
  });

  afterAll(async () => {
    await fixture.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const asA = () => auth(fixture.tenantA.owner.token);

  // Shared shape for the get/update/delete triad — not every resource has all three (Pois/
  // RouteNodes/RouteEdges have no single-resource GET, only nested-list + PUT/DELETE), so each
  // call site only supplies what that controller actually exposes.
  async function expectGet404(path: string) {
    const res = await request(app.getHttpServer()).get(path).set(asA());
    expect(res.status).toBe(404);
  }
  async function expectUpdate404NoMutation<T extends { updatedAt: Date }>(
    path: string,
    body: Record<string, unknown>,
    findRow: () => Promise<T>,
  ) {
    const before = await findRow();
    const res = await request(app.getHttpServer()).put(path).set(asA()).send(body);
    expect(res.status).toBe(404);
    const after = await findRow();
    expect(after.updatedAt).toEqual(before.updatedAt);
  }
  async function expectDelete404RowSurvives(path: string, findRow: () => Promise<unknown>) {
    const res = await request(app.getHttpServer()).delete(path).set(asA());
    expect(res.status).toBe(404);
    await expect(findRow()).resolves.toBeDefined();
  }

  describe('Layouts', () => {
    const bId = () => fixture.tenantB.layoutId;
    it('A cannot GET/PUT/DELETE B\'s layout', async () => {
      await expectGet404(`/v1/layouts/${bId()}`);
      await expectUpdate404NoMutation(`/v1/layouts/${bId()}`, { name: 'Hijacked', zones: [] }, () =>
        prisma.layout.findUniqueOrThrow({ where: { id: bId() } }));
      await expectDelete404RowSurvives(`/v1/layouts/${bId()}`, () => prisma.layout.findUniqueOrThrow({ where: { id: bId() } }));
    });
  });

  describe('Themes', () => {
    const bId = () => fixture.tenantB.themeId;
    it('A cannot GET/PUT/DELETE B\'s theme', async () => {
      await expectGet404(`/v1/themes/${bId()}`);
      await expectUpdate404NoMutation(
        `/v1/themes/${bId()}`,
        { name: 'Hijacked', category: 'GENERIC', palette: {}, typography: {}, elements: [] },
        () => prisma.theme.findUniqueOrThrow({ where: { id: bId() } }),
      );
      await expectDelete404RowSurvives(`/v1/themes/${bId()}`, () => prisma.theme.findUniqueOrThrow({ where: { id: bId() } }));
    });
  });

  describe('Schedules', () => {
    const bId = () => fixture.tenantB.scheduleId;
    it('A cannot GET/PUT/DELETE B\'s schedule', async () => {
      await expectGet404(`/v1/schedules/${bId()}`);
      // screenId/playlistId reference A's own resources — irrelevant to this check, since the
      // ownership check on the :id param itself is expected to reject the request first.
      await expectUpdate404NoMutation(
        `/v1/schedules/${bId()}`,
        { name: 'Hijacked', screenId: fixture.tenantA.screenId, playlistId: fixture.tenantA.playlistId },
        () => prisma.schedule.findUniqueOrThrow({ where: { id: bId() } }),
      );
      await expectDelete404RowSurvives(`/v1/schedules/${bId()}`, () => prisma.schedule.findUniqueOrThrow({ where: { id: bId() } }));
    });
  });

  describe('Power schedules', () => {
    const bId = () => fixture.tenantB.powerScheduleId;
    it('A cannot GET/PUT/DELETE B\'s power schedule', async () => {
      await expectGet404(`/v1/power-schedules/${bId()}`);
      await expectUpdate404NoMutation(
        `/v1/power-schedules/${bId()}`,
        { startTime: '09:00', endTime: '17:00' },
        () => prisma.powerSchedule.findUniqueOrThrow({ where: { id: bId() } }),
      );
      await expectDelete404RowSurvives(`/v1/power-schedules/${bId()}`, () => prisma.powerSchedule.findUniqueOrThrow({ where: { id: bId() } }));
    });
  });

  describe('Screen groups', () => {
    it("A cannot rename or delete B's screen group: 404, no mutation", async () => {
      const bId = fixture.tenantB.screenGroupId;
      const before = await prisma.screenGroup.findUniqueOrThrow({ where: { id: bId } });

      const renameRes = await request(app.getHttpServer()).put(`/v1/screen-groups/${bId}`).set(asA()).send({ name: 'Hijacked' });
      expect(renameRes.status).toBe(404);
      const afterRename = await prisma.screenGroup.findUniqueOrThrow({ where: { id: bId } });
      expect(afterRename.name).toBe(before.name);

      const deleteRes = await request(app.getHttpServer()).delete(`/v1/screen-groups/${bId}`).set(asA());
      expect(deleteRes.status).toBe(404);
      await expect(prisma.screenGroup.findUniqueOrThrow({ where: { id: bId } })).resolves.toBeDefined();
    });
  });

  describe('POI categories', () => {
    it("A cannot rename or delete B's POI category: 404, no mutation", async () => {
      const bId = fixture.tenantB.poiCategoryId;
      const before = await prisma.poiCategory.findUniqueOrThrow({ where: { id: bId } });

      const renameRes = await request(app.getHttpServer())
        .put(`/v1/poi-categories/${bId}`)
        .set(asA())
        .send({ label: 'Hijacked', icon: 'pin', color: '#112233' });
      expect(renameRes.status).toBe(404);
      const afterRename = await prisma.poiCategory.findUniqueOrThrow({ where: { id: bId } });
      expect(afterRename.label).toBe(before.label);

      const deleteRes = await request(app.getHttpServer()).delete(`/v1/poi-categories/${bId}`).set(asA());
      expect(deleteRes.status).toBe(404);
      await expect(prisma.poiCategory.findUniqueOrThrow({ where: { id: bId } })).resolves.toBeDefined();
    });
  });

  describe('Buildings and floors', () => {
    it("A cannot GET/PUT/DELETE B's building", async () => {
      const bId = fixture.tenantB.buildingId;
      await expectGet404(`/v1/buildings/${bId}`);
      await expectUpdate404NoMutation(`/v1/buildings/${bId}`, { name: 'Hijacked' }, () =>
        prisma.building.findUniqueOrThrow({ where: { id: bId } }));
      await expectDelete404RowSurvives(`/v1/buildings/${bId}`, () => prisma.building.findUniqueOrThrow({ where: { id: bId } }));
    });

    it("A cannot PUT/DELETE B's floor (no single-floor GET exists)", async () => {
      const bId = fixture.tenantB.floorId;
      await expectUpdate404NoMutation(`/v1/floors/${bId}`, { level: 9, label: 'Hijacked' }, () =>
        prisma.floor.findUniqueOrThrow({ where: { id: bId } }));
      await expectDelete404RowSurvives(`/v1/floors/${bId}`, () => prisma.floor.findUniqueOrThrow({ where: { id: bId } }));
    });

    it("A listing B's floor's POIs via the nested list route: 404 (PoisService.list calls assertOwnsFloor first)", async () => {
      await expectGet404(`/v1/floors/${fixture.tenantB.floorId}/pois`);
    });
  });

  describe('POIs', () => {
    it("A cannot PUT/DELETE B's POI (no single-POI GET exists)", async () => {
      const bId = fixture.tenantB.poiId;
      await expectUpdate404NoMutation(
        `/v1/pois/${bId}`,
        { name: 'Hijacked', x: 5, y: 5, categoryId: fixture.tenantA.poiCategoryId },
        () => prisma.poi.findUniqueOrThrow({ where: { id: bId } }),
      );
      await expectDelete404RowSurvives(`/v1/pois/${bId}`, () => prisma.poi.findUniqueOrThrow({ where: { id: bId } }));
    });
  });

  describe('Route nodes and edges', () => {
    it("A cannot PUT/DELETE B's route node", async () => {
      const bId = fixture.tenantB.routeNodeId;
      await expectUpdate404NoMutation(`/v1/route-nodes/${bId}`, { x: 1, y: 1 }, () =>
        prisma.routeNode.findUniqueOrThrow({ where: { id: bId } }));
      await expectDelete404RowSurvives(`/v1/route-nodes/${bId}`, () => prisma.routeNode.findUniqueOrThrow({ where: { id: bId } }));
    });

    it("A cannot PUT/DELETE B's route edge", async () => {
      const bId = fixture.tenantB.routeEdgeId;
      await expectUpdate404NoMutation(
        `/v1/route-edges/${bId}`,
        { fromNodeId: fixture.tenantB.routeNodeId, toNodeId: fixture.tenantB.routeNodeId2, weight: 2 },
        () => prisma.routeEdge.findUniqueOrThrow({ where: { id: bId } }),
      );
      await expectDelete404RowSurvives(`/v1/route-edges/${bId}`, () => prisma.routeEdge.findUniqueOrThrow({ where: { id: bId } }));
    });

    it("A cannot read B's building route graph: 404", async () => {
      // GET /buildings/:buildingId/route-graph — unlike the floor/pois nested list above, this
      // one does ownership-check the buildingId (confirmed by the 404 here), so B's route
      // topology doesn't leak through it. Included specifically to contrast with the floor/pois
      // finding above — the same "nested-under-a-parent-id" shape gets inconsistent treatment
      // across these two wayfinding controllers.
      await expectGet404(`/v1/buildings/${fixture.tenantB.buildingId}/route-graph`);
    });
  });

  describe('Rooms (Room Booking)', () => {
    it("A cannot GET/PUT/DELETE B's room", async () => {
      const bId = fixture.tenantB.roomId;
      await expectGet404(`/v1/rooms/${bId}`);
      await expectUpdate404NoMutation(
        `/v1/rooms/${bId}`,
        { name: 'Hijacked', timezone: 'UTC' },
        () => prisma.bookableRoom.findUniqueOrThrow({ where: { id: bId } }),
      );
      await expectDelete404RowSurvives(`/v1/rooms/${bId}`, () => prisma.bookableRoom.findUniqueOrThrow({ where: { id: bId } }));
    });
  });
});
