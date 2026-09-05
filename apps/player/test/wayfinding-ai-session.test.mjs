import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendTurn,
  pickNearestReachableCandidate,
} from '../tsc-out/wayfinding-ai-test/wayfindingAiSession.js';

test('appendTurn keeps at most maxTurns, dropping the oldest first', () => {
  let turns = [];
  for (let i = 0; i < 10; i++) {
    turns = appendTurn(turns, { role: 'user', text: `turn ${i}` }, 4);
  }
  assert.equal(turns.length, 4);
  assert.deepEqual(turns.map((t) => t.text), ['turn 6', 'turn 7', 'turn 8', 'turn 9']);
});

test('appendTurn never grows past maxTurns even starting under the limit', () => {
  const turns = appendTurn([{ role: 'assistant', text: 'hi' }], { role: 'user', text: 'hello' }, 8);
  assert.equal(turns.length, 2);
});

function poi(id, floorId, x, y) {
  return { id, name: id, nameAr: null, x, y, description: null, descriptionAr: null, status: 'OPEN', floorId, floorLabel: floorId, category: { id: 'c', label: 'c', labelAr: null, icon: 'x', color: '#000' }, iconAssetId: null, iconUrl: null };
}
function node(id, floorId, x, y) {
  return { id, floorId, x, y, label: null };
}
function edge(id, fromNodeId, toNodeId, weight, type = 'WALK') {
  return { id, fromNodeId, toNodeId, type, weight };
}

test('pickNearestReachableCandidate picks the lowest-cost reachable candidate, not the first in list order', () => {
  const pois = [poi('far', 'f1', 90, 90), poi('near', 'f1', 15, 15)];
  const nodes = [node('kiosk', 'f1', 0, 0), node('n_near', 'f1', 10, 10), node('n_far', 'f1', 90, 90)];
  const edges = [edge('e1', 'kiosk', 'n_near', 1), edge('e2', 'kiosk', 'n_far', 100)];
  const kioskNode = nodes[0];

  const winner = pickNearestReachableCandidate(['far', 'near'], pois, nodes, edges, kioskNode);

  assert.equal(winner.id, 'near');
});

test('pickNearestReachableCandidate skips a candidate with no computable route and still returns a reachable one', () => {
  const pois = [poi('isolated', 'f2', 50, 50), poi('reachable', 'f1', 15, 15)];
  const nodes = [node('kiosk', 'f1', 0, 0), node('n_reachable', 'f1', 10, 10), node('n_isolated', 'f2', 50, 50)];
  // No edge connects n_isolated to anything — computeRoute must return null for it.
  const edges = [edge('e1', 'kiosk', 'n_reachable', 1)];
  const kioskNode = nodes[0];

  const winner = pickNearestReachableCandidate(['isolated', 'reachable'], pois, nodes, edges, kioskNode);

  assert.equal(winner.id, 'reachable');
});

test('pickNearestReachableCandidate returns null when no candidate is reachable', () => {
  const pois = [poi('isolated', 'f2', 50, 50)];
  const nodes = [node('kiosk', 'f1', 0, 0), node('n_isolated', 'f2', 50, 50)];
  const edges = [];
  const kioskNode = nodes[0];

  const winner = pickNearestReachableCandidate(['isolated'], pois, nodes, edges, kioskNode);

  assert.equal(winner, null);
});

test('pickNearestReachableCandidate ignores a candidate id absent from the local POI list', () => {
  const pois = [poi('known', 'f1', 10, 10)];
  const nodes = [node('kiosk', 'f1', 0, 0), node('n_known', 'f1', 10, 10)];
  const edges = [edge('e1', 'kiosk', 'n_known', 1)];
  const kioskNode = nodes[0];

  const winner = pickNearestReachableCandidate(['fabricated', 'known'], pois, nodes, edges, kioskNode);

  assert.equal(winner.id, 'known');
});
