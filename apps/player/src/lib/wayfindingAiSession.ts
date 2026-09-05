import type { WayfindingPoi, WayfindingRouteEdge, WayfindingRouteNode } from './api';
import { computeRoute, findNearestNode, type RouteOptions } from './routing.js';

export interface ConversationTurn {
  role: 'user' | 'assistant';
  text: string;
}

// docs/modules/ai_wayfinding_module_plan.md §9.3 — "keep at most the configured number of turns
// in memory," applied on every append rather than trusting callers to slice before sending, so
// the in-memory session can never silently grow past what the screen's own config allows.
export function appendTurn(turns: ConversationTurn[], turn: ConversationTurn, maxTurns: number): ConversationTurn[] {
  const next = [...turns, turn];
  return next.length > maxTurns ? next.slice(next.length - maxTurns) : next;
}

// §4.1 step 11 — for a NEAREST_DESTINATION resolution, the player (never the model) computes
// real route cost to every bounded, server-verified candidate and picks the lowest-cost
// *reachable* one. A candidate with no computable route (e.g. a disconnected floor) is skipped
// rather than crashing or defaulting to the first candidate in provider-returned order.
export function pickNearestReachableCandidate(
  candidatePoiIds: string[],
  pois: WayfindingPoi[],
  routeNodes: WayfindingRouteNode[],
  routeEdges: WayfindingRouteEdge[],
  kioskNode: WayfindingRouteNode,
  options: RouteOptions = {},
): WayfindingPoi | null {
  const byId = new Map(pois.map((p) => [p.id, p]));
  let best: { poi: WayfindingPoi; weight: number } | null = null;

  for (const id of candidatePoiIds) {
    const poi = byId.get(id);
    if (!poi) continue; // already validated server-side, but never trust client-side re-derivation blindly
    const destinationNode = findNearestNode(routeNodes, poi.floorId, poi.x, poi.y);
    if (!destinationNode) continue;
    const route = computeRoute(routeNodes, routeEdges, kioskNode.id, destinationNode.id, options);
    if (!route) continue;
    if (!best || route.totalWeight < best.weight) best = { poi, weight: route.totalWeight };
  }

  return best?.poi ?? null;
}
