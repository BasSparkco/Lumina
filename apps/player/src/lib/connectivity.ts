export type ConnectivityState = 'ONLINE' | 'OFFLINE' | 'CHECKING' | 'DEGRADED';

export interface ConnectivityDiagnostic {
  state: ConnectivityState;
  browserOnline: boolean;
  message: string;
  changedAt: number;
  lastSuccessAt: number | null;
}

interface ConnectivityEventSource {
  addEventListener(type: 'online' | 'offline', listener: EventListener): void;
  removeEventListener(type: 'online' | 'offline', listener: EventListener): void;
}

type Listener = () => void;

function initialMessage(browserOnline: boolean): string {
  return browserOnline
    ? 'Checking server reachability; committed media remains available locally.'
    : 'No network detected; playing the last committed local presentation.';
}

/**
 * navigator.onLine is only a link signal, not proof that Lumina's API is reachable. This
 * monitor keeps those two facts separate: browser events provide immediate OFFLINE/CHECKING
 * transitions, while successful and failed API requests establish ONLINE/DEGRADED.
 */
export class BrowserConnectivityMonitor {
  private readonly listeners = new Set<Listener>();
  private started = false;
  private diagnostic: ConnectivityDiagnostic;

  private readonly handleOnline = () => {
    this.update({
      state: 'CHECKING',
      browserOnline: true,
      message: 'Network returned; checking the server before synchronizing.',
    });
  };

  private readonly handleOffline = () => {
    this.update({
      state: 'OFFLINE',
      browserOnline: false,
      message: 'No network detected; playing the last committed local presentation.',
    });
  };

  constructor(
    private readonly eventSource: ConnectivityEventSource | null,
    private readonly readBrowserOnline: () => boolean,
    private readonly now: () => number = Date.now,
  ) {
    const browserOnline = readBrowserOnline();
    this.diagnostic = {
      state: browserOnline ? 'CHECKING' : 'OFFLINE',
      browserOnline,
      message: initialMessage(browserOnline),
      changedAt: now(),
      lastSuccessAt: null,
    };
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.eventSource?.addEventListener('online', this.handleOnline);
    this.eventSource?.addEventListener('offline', this.handleOffline);
    const browserOnline = this.readBrowserOnline();
    if (!browserOnline) this.handleOffline();
    else if (this.diagnostic.state === 'OFFLINE') this.handleOnline();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.eventSource?.removeEventListener('online', this.handleOnline);
    this.eventSource?.removeEventListener('offline', this.handleOffline);
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ConnectivityDiagnostic => this.diagnostic;

  shouldAttemptNetwork(): boolean {
    return this.diagnostic.state !== 'OFFLINE';
  }

  reportSuccess(message = 'Server reachable; playback media is loaded from local storage.'): void {
    if (!this.readBrowserOnline()) {
      this.handleOffline();
      return;
    }
    const timestamp = this.now();
    this.update({
      state: 'ONLINE',
      browserOnline: true,
      message,
      lastSuccessAt: timestamp,
    });
  }

  reportFailure(message = 'Server is unreachable; continuing the local presentation.'): void {
    const browserOnline = this.readBrowserOnline();
    this.update({
      state: browserOnline ? 'DEGRADED' : 'OFFLINE',
      browserOnline,
      message,
    });
  }

  private update(change: Pick<ConnectivityDiagnostic, 'state' | 'browserOnline' | 'message'> & Partial<Pick<ConnectivityDiagnostic, 'lastSuccessAt'>>): void {
    const lastSuccessAt = change.lastSuccessAt ?? this.diagnostic.lastSuccessAt;
    if (
      change.state === this.diagnostic.state
      && change.browserOnline === this.diagnostic.browserOnline
      && change.message === this.diagnostic.message
      && lastSuccessAt === this.diagnostic.lastSuccessAt
    ) return;
    this.diagnostic = {
      ...this.diagnostic,
      ...change,
      lastSuccessAt,
      changedAt: this.now(),
    };
    for (const listener of this.listeners) listener();
  }
}

const browserEventSource = typeof window === 'undefined' ? null : window;
const readBrowserOnline = () => typeof navigator === 'undefined' || navigator.onLine;
const connectivityMonitor = new BrowserConnectivityMonitor(browserEventSource, readBrowserOnline);

export const startConnectivityMonitoring = () => connectivityMonitor.start();
export const stopConnectivityMonitoring = () => connectivityMonitor.stop();
export const subscribeConnectivity = connectivityMonitor.subscribe;
export const getConnectivityDiagnostic = connectivityMonitor.getSnapshot;
export const shouldAttemptNetwork = () => connectivityMonitor.shouldAttemptNetwork();
export const reportNetworkSuccess = (message?: string) => connectivityMonitor.reportSuccess(message);
export const reportNetworkFailure = (message?: string) => connectivityMonitor.reportFailure(message);

export async function synchronizeAfterReconnect(
  heartbeat: () => Promise<void>,
  refreshPresentation: () => Promise<void>,
  canContinue: () => boolean = shouldAttemptNetwork,
): Promise<void> {
  await heartbeat();
  if (canContinue()) await refreshPresentation();
}

function publishBrowserDiagnostic(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.connectivityState = connectivityMonitor.getSnapshot().state;
}

connectivityMonitor.subscribe(publishBrowserDiagnostic);
publishBrowserDiagnostic();
