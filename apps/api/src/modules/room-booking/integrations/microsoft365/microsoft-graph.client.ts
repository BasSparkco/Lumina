import { Logger } from '@nestjs/common';

// docs/modules/room_booking_module_plan.md §13.4 — least-privilege application permissions via
// the client-credentials grant (not a per-user delegated authorization-code flow): a room
// resource mailbox's calendar is accessed the same way regardless of which admin connected it,
// so app-only access (Place.Read.All, Calendars.ReadWrite as *application* permissions, granted
// once via Entra admin consent) is the correct model here — there is no per-user delegation to
// maintain. "OAuth" in the plan's connection-security language covers this grant type too.
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const TOKEN_ENDPOINT = (tenantId: string) => `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
const SCOPE = 'https://graph.microsoft.com/.default';

export interface Microsoft365Credentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export class MicrosoftGraphError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message);
  }
}

// One instance per connection (constructed with that connection's own credentials) — never a
// singleton shared across tenants. Caches its own access token in memory only, never persisted.
export class MicrosoftGraphClient {
  private readonly logger = new Logger(MicrosoftGraphClient.name);
  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor(private readonly credentials: Microsoft365Credentials) {}

  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 30_000) {
      return this.cachedToken.value;
    }
    const body = new URLSearchParams({
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
      scope: SCOPE,
      grant_type: 'client_credentials',
    });
    const res = await fetch(TOKEN_ENDPOINT(this.credentials.tenantId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      throw new MicrosoftGraphError(`Microsoft 365 token request failed (${res.status})`, res.status);
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return this.cachedToken.value;
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.getAccessToken();
    const res = await fetch(`${GRAPH_BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    if (res.status === 204) return undefined as T;
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(`Graph request failed: ${init.method ?? 'GET'} ${path} -> ${res.status}`);
      throw new MicrosoftGraphError(`Microsoft Graph request failed (${res.status})`, res.status, text.slice(0, 200));
    }
    return res.json() as Promise<T>;
  }

  // Validates the credentials actually work — used at connect time so a typo'd secret fails
  // immediately with a clear error instead of silently on the first sync.
  async testConnection(): Promise<void> {
    await this.request('/places/microsoft.graph.room?$top=1');
  }
}
