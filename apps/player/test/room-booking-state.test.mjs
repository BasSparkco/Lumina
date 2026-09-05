import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRoomDisplayState, computeServerOffsetMs, isPayloadStale } from '../tsc-out/room-booking-state-test/roomBookingState.js';

function reservation(id, startsAt, endsAt, title = 'Meeting', organizerDisplayName = 'Alice') {
  return { id, startsAt, endsAt, title, organizerDisplayName };
}

test('resolveRoomDisplayState returns OUT_OF_SERVICE regardless of reservations', () => {
  const state = resolveRoomDisplayState(new Date('2026-01-01T10:00:00Z'), [reservation('r1', '2026-01-01T09:00:00Z', '2026-01-01T11:00:00Z')], 10, 'OUT_OF_SERVICE');
  assert.deepEqual(state, { kind: 'OUT_OF_SERVICE' });
});

test('resolveRoomDisplayState returns OCCUPIED when now falls in [startsAt, endsAt)', () => {
  const r = reservation('r1', '2026-01-01T10:00:00Z', '2026-01-01T11:00:00Z');
  const state = resolveRoomDisplayState(new Date('2026-01-01T10:30:00Z'), [r], 10, 'ACTIVE');
  assert.equal(state.kind, 'OCCUPIED');
  assert.equal(state.currentReservation.id, 'r1');
});

test('resolveRoomDisplayState treats endsAt as exclusive — back-to-back is AVAILABLE, not OCCUPIED', () => {
  const r = reservation('r1', '2026-01-01T09:00:00Z', '2026-01-01T10:00:00Z');
  const state = resolveRoomDisplayState(new Date('2026-01-01T10:00:00Z'), [r], 10, 'ACTIVE');
  assert.notEqual(state.kind, 'OCCUPIED');
});

test('resolveRoomDisplayState returns STARTING_SOON within the configured window', () => {
  const r = reservation('r1', '2026-01-01T10:05:00Z', '2026-01-01T10:30:00Z');
  const state = resolveRoomDisplayState(new Date('2026-01-01T10:00:00Z'), [r], 10, 'ACTIVE');
  assert.equal(state.kind, 'STARTING_SOON');
  assert.equal(state.nextReservation.id, 'r1');
});

test('resolveRoomDisplayState returns AVAILABLE with the next start time when outside the starting-soon window', () => {
  const r = reservation('r1', '2026-01-01T12:00:00Z', '2026-01-01T13:00:00Z');
  const state = resolveRoomDisplayState(new Date('2026-01-01T10:00:00Z'), [r], 10, 'ACTIVE');
  assert.equal(state.kind, 'AVAILABLE');
  assert.equal(state.availableUntil, '2026-01-01T12:00:00Z');
});

test('resolveRoomDisplayState returns AVAILABLE with null availableUntil when nothing is scheduled', () => {
  const state = resolveRoomDisplayState(new Date('2026-01-01T10:00:00Z'), [], 10, 'ACTIVE');
  assert.deepEqual(state, { kind: 'AVAILABLE', availableUntil: null });
});

test('resolveRoomDisplayState picks the soonest upcoming reservation, not list order', () => {
  const later = reservation('later', '2026-01-01T14:00:00Z', '2026-01-01T15:00:00Z');
  const sooner = reservation('sooner', '2026-01-01T11:00:00Z', '2026-01-01T12:00:00Z');
  const state = resolveRoomDisplayState(new Date('2026-01-01T10:00:00Z'), [later, sooner], 10, 'ACTIVE');
  assert.equal(state.kind, 'AVAILABLE');
  assert.equal(state.availableUntil, '2026-01-01T11:00:00Z');
});

test('computeServerOffsetMs reflects the gap between payload.serverNow and the device clock', () => {
  const realNow = Date.now();
  const payload = { serverNow: new Date(realNow + 5000).toISOString() };
  const offset = computeServerOffsetMs(payload);
  assert.ok(offset > 4000 && offset < 6000, `expected ~5000ms offset, got ${offset}`);
});

test('isPayloadStale is false just under the threshold and true just over it', () => {
  const payload = { generatedAt: '2026-01-01T10:00:00.000Z' };
  assert.equal(isPayloadStale(payload, new Date('2026-01-01T10:04:59.000Z'), 5 * 60_000), false);
  assert.equal(isPayloadStale(payload, new Date('2026-01-01T10:05:01.000Z'), 5 * 60_000), true);
});
