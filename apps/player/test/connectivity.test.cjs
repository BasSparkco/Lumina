const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BrowserConnectivityMonitor,
  synchronizeAfterReconnect,
} = require('../tsc-out/connectivity-test/connectivity.js');

function harness(initialOnline) {
  const events = new EventTarget();
  let online = initialOnline;
  let now = 100;
  const monitor = new BrowserConnectivityMonitor(events, () => online, () => ++now);
  return {
    events,
    monitor,
    setOnline(value) { online = value; },
  };
}

test('offline boot immediately suppresses network work', () => {
  const { monitor } = harness(false);
  assert.equal(monitor.getSnapshot().state, 'OFFLINE');
  assert.equal(monitor.shouldAttemptNetwork(), false);
});

test('browser reconnect remains CHECKING until the server responds', () => {
  const { events, monitor, setOnline } = harness(false);
  monitor.start();
  setOnline(true);
  events.dispatchEvent(new Event('online'));
  assert.equal(monitor.getSnapshot().state, 'CHECKING');
  assert.equal(monitor.shouldAttemptNetwork(), true);

  monitor.reportSuccess();
  assert.equal(monitor.getSnapshot().state, 'ONLINE');
  assert.equal(monitor.getSnapshot().lastSuccessAt, 103);
});

test('request failure distinguishes a missing link from a degraded server path', () => {
  const { monitor, setOnline } = harness(true);
  monitor.reportFailure('API unavailable');
  assert.equal(monitor.getSnapshot().state, 'DEGRADED');

  setOnline(false);
  monitor.reportFailure('Link lost');
  assert.equal(monitor.getSnapshot().state, 'OFFLINE');
  assert.equal(monitor.shouldAttemptNetwork(), false);
});

test('stopping the monitor removes browser event listeners', () => {
  const { events, monitor, setOnline } = harness(true);
  monitor.start();
  monitor.stop();
  setOnline(false);
  events.dispatchEvent(new Event('offline'));
  assert.equal(monitor.getSnapshot().state, 'CHECKING');
});

test('reconnect synchronization always sends heartbeat before fetching the manifest', async () => {
  const calls = [];
  await synchronizeAfterReconnect(
    async () => { calls.push('heartbeat'); },
    async () => { calls.push('manifest'); },
    () => true,
  );
  assert.deepEqual(calls, ['heartbeat', 'manifest']);
});

test('reconnect synchronization stops if the link disappears after heartbeat', async () => {
  const calls = [];
  await synchronizeAfterReconnect(
    async () => { calls.push('heartbeat'); },
    async () => { calls.push('manifest'); },
    () => false,
  );
  assert.deepEqual(calls, ['heartbeat']);
});
