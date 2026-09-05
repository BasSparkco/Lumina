import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasUsableModule,
} from '../tsc-out/module-capabilities-test/moduleCapabilities.js';

const NOW = new Date('2026-09-05T00:00:00.000Z');

function capabilities(tenantStatus, modules) {
  return { tenantStatus, modules };
}

function module_(key, status, expiresAt = null) {
  return { key, status, expiresAt };
}

test('active independent module is usable', () => {
  const caps = capabilities('ACTIVE', [module_('ROOM_BOOKING', 'ACTIVE')]);
  assert.equal(hasUsableModule(caps, 'ROOM_BOOKING', NOW), true);
});

test('active dependent module with an active dependency is usable', () => {
  const caps = capabilities('ACTIVE', [
    module_('WAYFINDING_AI', 'ACTIVE'),
    module_('WAYFINDING', 'ACTIVE'),
  ]);
  assert.equal(hasUsableModule(caps, 'WAYFINDING_AI', NOW), true);
});

test('active dependent module with a missing dependency fails closed', () => {
  const caps = capabilities('ACTIVE', [module_('WAYFINDING_AI', 'ACTIVE')]);
  assert.equal(hasUsableModule(caps, 'WAYFINDING_AI', NOW), false);
});

test('a disabled dependency makes the dependent module unusable', () => {
  const caps = capabilities('ACTIVE', [
    module_('WAYFINDING_AI', 'ACTIVE'),
    module_('WAYFINDING', 'DISABLED'),
  ]);
  assert.equal(hasUsableModule(caps, 'WAYFINDING_AI', NOW), false);
});

test('an expired trial dependency makes the dependent module unusable', () => {
  const caps = capabilities('ACTIVE', [
    module_('WAYFINDING_AI', 'ACTIVE'),
    module_('WAYFINDING', 'TRIAL', '2020-01-01T00:00:00.000Z'),
  ]);
  assert.equal(hasUsableModule(caps, 'WAYFINDING_AI', NOW), false);
});

test('an unexpired trial dependency makes the dependent module usable', () => {
  const caps = capabilities('ACTIVE', [
    module_('WAYFINDING_AI', 'ACTIVE'),
    module_('WAYFINDING', 'TRIAL', '2099-01-01T00:00:00.000Z'),
  ]);
  assert.equal(hasUsableModule(caps, 'WAYFINDING_AI', NOW), true);
});

test('a TRIAL dependency with no expiry at all is usable', () => {
  const caps = capabilities('ACTIVE', [
    module_('WAYFINDING_AI', 'ACTIVE'),
    module_('WAYFINDING', 'TRIAL', null),
  ]);
  assert.equal(hasUsableModule(caps, 'WAYFINDING_AI', NOW), true);
});

test('a suspended tenant fails closed regardless of module/dependency status', () => {
  const caps = capabilities('SUSPENDED', [
    module_('WAYFINDING_AI', 'ACTIVE'),
    module_('WAYFINDING', 'ACTIVE'),
  ]);
  assert.equal(hasUsableModule(caps, 'WAYFINDING_AI', NOW), false);
  assert.equal(hasUsableModule(caps, 'WAYFINDING', NOW), false);
});

test('a dependency cycle fails closed instead of recursing forever', () => {
  const cyclicDependencies = {
    WAYFINDING: 'WAYFINDING_AI',
    WAYFINDING_AI: 'WAYFINDING',
    ROOM_BOOKING: null,
    INDOOR_POSITIONING: null,
  };
  const caps = capabilities('ACTIVE', [
    module_('WAYFINDING', 'ACTIVE'),
    module_('WAYFINDING_AI', 'ACTIVE'),
  ]);
  assert.equal(
    hasUsableModule(caps, 'WAYFINDING', NOW, undefined, cyclicDependencies),
    false,
  );
});

test('ROOM_BOOKING remains independent of WAYFINDING', () => {
  const caps = capabilities('ACTIVE', [module_('ROOM_BOOKING', 'ACTIVE')]);
  // No WAYFINDING row at all — if ROOM_BOOKING secretly depended on it, this would fail closed.
  assert.equal(hasUsableModule(caps, 'ROOM_BOOKING', NOW), true);
});

test('WAYFINDING_AI and INDOOR_POSITIONING both require a usable WAYFINDING', () => {
  const withoutWayfinding = capabilities('ACTIVE', [
    module_('WAYFINDING_AI', 'ACTIVE'),
    module_('INDOOR_POSITIONING', 'ACTIVE'),
  ]);
  assert.equal(hasUsableModule(withoutWayfinding, 'WAYFINDING_AI', NOW), false);
  assert.equal(hasUsableModule(withoutWayfinding, 'INDOOR_POSITIONING', NOW), false);

  const withWayfinding = capabilities('ACTIVE', [
    module_('WAYFINDING_AI', 'ACTIVE'),
    module_('INDOOR_POSITIONING', 'ACTIVE'),
    module_('WAYFINDING', 'ACTIVE'),
  ]);
  assert.equal(hasUsableModule(withWayfinding, 'WAYFINDING_AI', NOW), true);
  assert.equal(hasUsableModule(withWayfinding, 'INDOOR_POSITIONING', NOW), true);
});
