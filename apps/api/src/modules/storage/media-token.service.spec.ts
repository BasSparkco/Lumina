import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { MediaTokenService } from './media-token.service';

// P4 (docs/tenant_isolation_and_platform_admin_plan.md §P4 task 5) — MediaController's routes are
// deliberately unauthenticated (an <img>/<video> tag can't send a Bearer header), so this token
// *is* the entire authorization decision. These tests pin the properties that matter: a token
// only ever authorizes the exact resource/kind/page it was minted for, and a tampered or expired
// token is rejected rather than silently accepted.
describe('MediaTokenService', () => {
  function makeService() {
    return new MediaTokenService(new JwtService({ secret: 'test-secret' }));
  }

  it('round-trips a token minted for the same kind/resource', () => {
    const service = makeService();
    const token = service.sign('asset', 'asset_1', 60);
    expect(() => service.verify(token, 'asset', 'asset_1')).not.toThrow();
  });

  it('round-trips a page token only when the page number also matches', () => {
    const service = makeService();
    const token = service.sign('asset-page', 'asset_1', 60, 3);
    expect(() => service.verify(token, 'asset-page', 'asset_1', 3)).not.toThrow();
    expect(() => service.verify(token, 'asset-page', 'asset_1', 4)).toThrow(UnauthorizedException);
  });

  it('rejects a token presented for a different resource id', () => {
    const service = makeService();
    const token = service.sign('asset', 'asset_1', 60);
    expect(() => service.verify(token, 'asset', 'asset_2')).toThrow(UnauthorizedException);
  });

  it('rejects a token presented for a different kind', () => {
    const service = makeService();
    const token = service.sign('asset', 'asset_1', 60);
    expect(() => service.verify(token, 'asset-thumb', 'asset_1')).toThrow(UnauthorizedException);
  });

  it('rejects a token signed with a different secret', () => {
    const service = makeService();
    const foreignToken = new JwtService({ secret: 'someone-elses-secret' }).sign(
      { sub: 'asset_1', kind: 'asset', type: 'media' },
      { expiresIn: 60 },
    );
    expect(() => service.verify(foreignToken, 'asset', 'asset_1')).toThrow(UnauthorizedException);
  });

  it('rejects an expired token', () => {
    const service = makeService();
    const token = service.sign('asset', 'asset_1', -1);
    expect(() => service.verify(token, 'asset', 'asset_1')).toThrow(UnauthorizedException);
  });

  it('rejects a missing token', () => {
    const service = makeService();
    expect(() => service.verify(undefined, 'asset', 'asset_1')).toThrow(UnauthorizedException);
  });

  it('rejects a token minted by an unrelated auth flow that happens to share a payload shape', () => {
    const service = makeService();
    const nonMediaToken = new JwtService({ secret: 'test-secret' }).sign(
      { sub: 'asset_1', kind: 'asset' }, // no `type: 'media'` discriminator
      { expiresIn: 60 },
    );
    expect(() => service.verify(nonMediaToken, 'asset', 'asset_1')).toThrow(UnauthorizedException);
  });
});
