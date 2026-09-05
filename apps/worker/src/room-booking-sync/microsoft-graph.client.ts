import { Logger } from '@nestjs/common';

// Duplicated from apps/api/.../microsoft365/microsoft-graph.client.ts — see that file for the
// client-credentials-grant reasoning. Kept byte-for-byte equivalent in behavior; only the module
// boundary differs (the worker consumes/reconciles, the api owns connect/disconnect/mapping).
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
    if (!res.ok) throw new MicrosoftGraphError(`Microsoft 365 token request failed (${res.status})`, res.status);
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
}
