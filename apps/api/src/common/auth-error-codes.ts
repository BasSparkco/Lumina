// The three "your existing session is no longer valid" reasons P2 introduces — not a general
// HTTP error-code catalog. Attach via the object form of UnauthorizedException/ForbiddenException
// (`new UnauthorizedException({ message, code: AuthErrorCode.X })`) so
// AllExceptionsFilter can surface `code` in the response body, letting the dashboard (and the
// WebSocket gateway's `auth-invalidated` event, which has no HTTP response to key off) tell a
// dead session apart from an ordinary network error. See
// docs/adr/tenant-isolation-and-shared-content.md §Session revocation.
export enum AuthErrorCode {
  USER_NOT_FOUND = 'AUTH_USER_NOT_FOUND',
  AUTH_VERSION_MISMATCH = 'AUTH_VERSION_MISMATCH',
  ORG_SUSPENDED = 'AUTH_ORG_SUSPENDED',
  // WebSocket-only (ScreenGateway) — a screen socket whose token no longer matches a paired,
  // live screen. Never surfaced through AllExceptionsFilter/HTTP; player REST already has its
  // own 401/404 split for this in PlayerJwtStrategy.
  SCREEN_NOT_PAIRED = 'AUTH_SCREEN_NOT_PAIRED',
}
