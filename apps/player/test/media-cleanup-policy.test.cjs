const test = require('node:test');
const assert = require('node:assert/strict');
const {
  planMediaCleanup,
} = require('../tsc-out/media-storage-policy-test/cleanup-policy.js');

function candidate(storageKey, fileSize, lastUsedAt) {
  return { storageKey, fileSize, lastUsedAt };
}

test('quota cleanup removes least-recently-used unprotected media only until under the limit', () => {
  const plan = planMediaCleanup(
    [candidate('new', 40, 300), candidate('old', 40, 100), candidate('middle', 40, 200)],
    { maxMediaBytes: 80 },
    new Set(),
    1_000,
  );

  assert.deepEqual(plan.removedStorageKeys, ['old']);
  assert.equal(plan.removedBytes, 40);
  assert.equal(plan.remainingBytes, 80);
});

test('age cleanup removes every expired item while retaining active and explicitly protected versions', () => {
  const plan = planMediaCleanup(
    [
      candidate('expired', 20, 100),
      candidate('active', 20, 100),
      candidate('retained', 20, 100),
      candidate('fresh', 20, 950),
    ],
    { maxUnusedMs: 500, retainStorageKeys: new Set(['retained']) },
    new Set(['active']),
    1_000,
  );

  assert.deepEqual(plan.removedStorageKeys, ['expired']);
  assert.equal(plan.remainingBytes, 60);
});

test('quota pressure never evicts an active lease even when the target cannot be reached', () => {
  const plan = planMediaCleanup(
    [candidate('active-a', 60, 100), candidate('active-b', 60, 200)],
    { maxMediaBytes: 10 },
    new Set(['active-a', 'active-b']),
    1_000,
  );

  assert.deepEqual(plan.removedStorageKeys, []);
  assert.equal(plan.remainingBytes, 120);
});
