import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useScreenSocket } from '../useScreenSocket';
const events = vi.hoisted(() => ({} as Record<string, (value?: unknown) => void>));
vi.mock('socket.io-client', () => ({ io: () => ({ on: (name: string, fn: (value?: unknown) => void) => { events[name] = fn; }, disconnect: vi.fn() }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@/lib/api', () => ({ getToken: () => 'test', clearToken: vi.fn(), loginPath: () => '/en/login' }));
const report = { screenId: 'a', currentTime: 1, duration: 30, paused: false, rate: 1 };
describe('player telemetry freshness', () => {
  beforeEach(() => { Object.keys(events).forEach(key => delete events[key]); });
  it('requires consecutive advancing reports and clears them on disconnect', () => {
    const { result } = renderHook(useScreenSocket);
    act(() => events['playback-progress']!(report));
    expect(result.current.playbackProgress.a?.advancing).toBe(false);
    act(() => events['playback-progress']!({ ...report, currentTime: 2 }));
    expect(result.current.playbackProgress.a?.advancing).toBe(true);
    act(() => events.disconnect!());
    expect(result.current.playbackProgress).toEqual({});
  });
  it('clears disconnected screen telemetry and rejects invalid counters', () => {
    const { result } = renderHook(useScreenSocket);
    act(() => events['playback-progress']!(report));
    act(() => events['screen-status']!({ screenId: 'a', status: 'OFFLINE' }));
    expect(result.current.playbackProgress).toEqual({});
    act(() => events['playback-progress']!({ ...report, duration: NaN }));
    expect(result.current.playbackProgress).toEqual({});
  });
});
