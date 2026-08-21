import type { WayfindingRouteNode, WayfindingRouteEdge, RouteEdgeType } from './api';
import type { WayfindingLang } from './wayfindingLang';

export interface RouteSegment {
  type: RouteEdgeType;
  fromNode: WayfindingRouteNode;
  toNode: WayfindingRouteNode;
}

export interface ComputedRoute {
  nodes: WayfindingRouteNode[];
  segments: RouteSegment[];
  totalWeight: number;
}

// The closest route node to an arbitrary point on a floor (kiosk's own "you are here" position,
// or a POI's pin) — POIs aren't graph nodes themselves, so routing always starts/ends at
// whichever node sits nearest the actual point being navigated to/from.
export function findNearestNode(nodes: WayfindingRouteNode[], floorId: string, x: number, y: number): WayfindingRouteNode | null {
  let best: WayfindingRouteNode | null = null;
  let bestDist = Infinity;
  for (const n of nodes) {
    if (n.floorId !== floorId) continue;
    const d = Math.hypot(n.x - x, n.y - y);
    if (d < bestDist) { bestDist = d; best = n; }
  }
  return best;
}

export interface RouteOptions {
  // Wheelchair-accessible mode (7.3) — excludes STAIRS.
  accessible?: boolean;
  // Evacuation mode (7.4) — elevators must never be used during a fire, so exclude ELEVATOR
  // instead of STAIRS. The two modes are mutually exclusive in practice (a kiosk is either
  // routing a visitor normally or evacuating, never both), but nothing stops passing both.
  avoidElevators?: boolean;
}

// Plain Dijkstra (no heap — a building's route graph is at most a few hundred nodes, well within
// O(n^2) territory) run entirely on-device so kiosk routing keeps working offline, same
// philosophy as the local schedule resolver. Every edge is treated as bidirectional.
export function computeRoute(
  nodes: WayfindingRouteNode[],
  edges: WayfindingRouteEdge[],
  startNodeId: string,
  endNodeId: string,
  options: RouteOptions = {},
): ComputedRoute | null {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  if (!nodeById.has(startNodeId) || !nodeById.has(endNodeId)) return null;
  if (startNodeId === endNodeId) return { nodes: [nodeById.get(startNodeId)!], segments: [], totalWeight: 0 };

  const usableEdges = edges.filter(e =>
    (!options.accessible || e.type !== 'STAIRS') && (!options.avoidElevators || e.type !== 'ELEVATOR'),
  );
  const adjacency = new Map<string, { to: string; edge: WayfindingRouteEdge }[]>();
  for (const e of usableEdges) {
    if (!adjacency.has(e.fromNodeId)) adjacency.set(e.fromNodeId, []);
    if (!adjacency.has(e.toNodeId)) adjacency.set(e.toNodeId, []);
    adjacency.get(e.fromNodeId)!.push({ to: e.toNodeId, edge: e });
    adjacency.get(e.toNodeId)!.push({ to: e.fromNodeId, edge: e });
  }

  const dist = new Map<string, number>([[startNodeId, 0]]);
  const prev = new Map<string, { nodeId: string; edge: WayfindingRouteEdge }>();
  const unvisited = new Set(nodes.map(n => n.id));

  while (unvisited.size) {
    let currentId: string | null = null;
    let currentDist = Infinity;
    for (const id of unvisited) {
      const d = dist.get(id) ?? Infinity;
      if (d < currentDist) { currentDist = d; currentId = id; }
    }
    if (currentId === null || currentDist === Infinity) break;
    unvisited.delete(currentId);
    if (currentId === endNodeId) break;

    for (const { to, edge } of adjacency.get(currentId) ?? []) {
      if (!unvisited.has(to)) continue;
      const alt = currentDist + edge.weight;
      if (alt < (dist.get(to) ?? Infinity)) {
        dist.set(to, alt);
        prev.set(to, { nodeId: currentId, edge });
      }
    }
  }

  if (!prev.has(endNodeId)) return null;

  const pathNodeIds: string[] = [endNodeId];
  const segments: RouteSegment[] = [];
  let cur = endNodeId;
  while (cur !== startNodeId) {
    const step = prev.get(cur);
    if (!step) return null;
    segments.unshift({ type: step.edge.type, fromNode: nodeById.get(step.nodeId)!, toNode: nodeById.get(cur)! });
    pathNodeIds.unshift(step.nodeId);
    cur = step.nodeId;
  }

  return { nodes: pathNodeIds.map(id => nodeById.get(id)!), segments, totalWeight: dist.get(endNodeId) ?? 0 };
}

// Turn-by-turn text is necessarily approximate — the graph carries distance/time and edge type,
// not headings, so "turn left/right" isn't derivable. What it can say precisely is every floor
// change, which is the part a visitor actually needs help with ("go straight, take the elevator
// to floor 2") — walking segments within a floor collapse into the surrounding instruction.
const DIRECTION_STRINGS: Record<WayfindingLang, {
  alreadyHere: (dest: string) => string;
  headStraight: string;
  thisFloor: string;
  verb: (type: RouteEdgeType) => string;
  toFloor: (verb: string, floor: string) => string;
  continueTo: (dest: string) => string;
}> = {
  en: {
    alreadyHere: dest => `You're already here — ${dest} is right around you.`,
    headStraight: 'Head straight from your location.',
    thisFloor: 'this floor',
    verb: type => (type === 'ELEVATOR' ? 'Take the elevator' : type === 'ESCALATOR' ? 'Take the escalator' : 'Take the stairs'),
    toFloor: (verb, floor) => `${verb} to ${floor}.`,
    continueTo: dest => `Continue to ${dest}.`,
  },
  ar: {
    alreadyHere: dest => `أنت هنا بالفعل — ${dest} على مقربة منك.`,
    headStraight: 'توجه مباشرة من موقعك.',
    thisFloor: 'هذا الطابق',
    verb: type => (type === 'ELEVATOR' ? 'استخدم المصعد' : type === 'ESCALATOR' ? 'استخدم السلم المتحرك' : 'استخدم الدرج'),
    toFloor: (verb, floor) => `${verb} إلى ${floor}.`,
    continueTo: dest => `تابع إلى ${dest}.`,
  },
};

export function buildDirectionSteps(
  route: ComputedRoute,
  floors: { id: string; label: string }[],
  destinationLabel: string,
  lang: WayfindingLang = 'en',
): string[] {
  const s = DIRECTION_STRINGS[lang];
  if (route.segments.length === 0) return [s.alreadyHere(destinationLabel)];

  const floorLabel = (floorId: string) => floors.find(f => f.id === floorId)?.label ?? s.thisFloor;
  const steps: string[] = [s.headStraight];

  for (const seg of route.segments) {
    if (seg.type === 'WALK') continue;
    steps.push(s.toFloor(s.verb(seg.type), floorLabel(seg.toNode.floorId)));
  }

  steps.push(s.continueTo(destinationLabel));
  return steps;
}
