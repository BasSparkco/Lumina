import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, it, expect } from 'vitest';
import { PlayerStatus } from '../ScreenOverview';
import type { Screen } from '@/lib/api';
import en from '../../../../messages/en.json';

const device = { streamingType: 'ASSET', stopped: false, emergencyActive: false } as Screen;
const progress = { screenId: 'one', currentTime: 12, duration: 60, paused: false, rate: 1, receivedAt: 1000, advancing: true };
function view(now: number, status: Screen['status'] = 'ONLINE', overrides = {}) {
  return render(<NextIntlClientProvider locale="en" messages={en}><PlayerStatus screen={device} status={status} progress={{ ...progress, ...overrides }} now={now} /></NextIntlClientProvider>);
}
describe('reported playback', () => {
  it('shows a real reported counter while playback advances', () => {
    view(2000);
    expect(screen.getByText('Playback advancing')).toBeInTheDocument();
    expect(screen.getByText('0:12 / 1:00')).toBeInTheDocument();
  });
  it('never treats old telemetry as playback confirmation', () => {
    view(12000);
    expect(screen.getByText('Playback unconfirmed')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
  it('does not show a counter for disconnected players', () => {
    view(2000, 'OFFLINE');
    expect(screen.getByText('Player unreachable')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
  it('distinguishes paused and non-advancing playback', () => {
    view(2000, 'ONLINE', { paused: true });
    expect(screen.getByText('Paused · player reported')).toBeInTheDocument();
  });
  it('waits for advancement before confirming playback', () => {
    view(2000, 'ONLINE', { advancing: false });
    expect(screen.getByText('Waiting for progress')).toBeInTheDocument();
  });
});
