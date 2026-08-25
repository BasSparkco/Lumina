// The registry of embeddable "apps" offered on the Assets page's Apps tab. Adding a new app
// later means adding an entry here plus a resolver case in AppsService — no changes anywhere
// else in the API, and (per appsroadmap.md) no player/device-app changes at all, since these
// assets aren't wired into playback yet.
export interface AppProvider {
  id: string;
  name: string;
  // 'iframe' = the provider allows plain <iframe> embedding of its resolved embedUrl.
  // 'script' covers providers that need their own embed widget script instead — no resolver
  // uses it yet, but the field exists so the dashboard/player can branch on it once one does.
  renderKind: 'iframe' | 'script';
}

export const APP_PROVIDERS: AppProvider[] = [{ id: 'youtube', name: 'YouTube', renderKind: 'iframe' }];

export function getProvider(id: string): AppProvider | undefined {
  return APP_PROVIDERS.find(p => p.id === id);
}
