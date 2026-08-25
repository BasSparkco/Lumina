import type { UserRole } from '@lumina/db';

export interface JwtUser {
  sub: string;
  orgId: string;
  role: UserRole;
  isSuperAdmin: boolean;
}

export interface ScreenJwtUser {
  sub: string;
  orgId: string;
  type: 'screen';
}
