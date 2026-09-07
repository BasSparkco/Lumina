import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export type MediaTokenKind = 'asset' | 'asset-thumb' | 'asset-page' | 'binary' | 'screenshot';

interface MediaTokenPayload {
  sub: string; // the authorized resource id (assetId, AssetBinary id, or screenId — never a raw storage key)
  kind: MediaTokenKind;
  page?: number; // asset-page only — the 1-indexed document page this token authorizes
  type: 'media';
}

// P4 (docs/tenant_isolation_and_platform_admin_plan.md) — short-lived capability tokens for
// media delivery. Mirrors PlaylistsService.createPreviewToken/getForPreview's manual-verify
// pattern rather than a guard: MediaController's routes are deliberately unauthenticated (an
// <img>/<video> tag can't send a Bearer header), so the token itself has to carry the entire
// authorization decision. It's only ever minted after the caller already ran a real ownership/
// visibility check (asset listing, manifest build, screenshot lookup, etc.) — this class just
// freezes that decision into a signed, resource-scoped, time-bounded capability instead of the
// previous "the storage key itself is the secret" design (P4 task 5).
@Injectable()
export class MediaTokenService {
  constructor(private readonly jwt: JwtService) {}

  sign(kind: MediaTokenKind, resourceId: string, ttlSec: number, page?: number): string {
    const payload: MediaTokenPayload = { sub: resourceId, kind, type: 'media', ...(page !== undefined ? { page } : {}) };
    return this.jwt.sign(payload, { expiresIn: ttlSec });
  }

  // Throws rather than returning null so every call site fails closed by construction.
  verify(token: string | undefined, kind: MediaTokenKind, resourceId: string, page?: number): void {
    if (!token) throw new UnauthorizedException('Missing media token');
    let payload: MediaTokenPayload;
    try {
      payload = this.jwt.verify<MediaTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Media link has expired or is invalid');
    }
    if (
      payload.type !== 'media' ||
      payload.kind !== kind ||
      payload.sub !== resourceId ||
      (page !== undefined && payload.page !== page)
    ) {
      throw new UnauthorizedException('Media link has expired or is invalid');
    }
  }
}
