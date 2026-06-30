import type { UserRole } from '@prisma/client';

export interface JwtUser {
  sub: string;
  orgId: string;
  role: UserRole;
}

export interface ScreenJwtUser {
  sub: string;
  orgId: string;
  type: 'screen';
}
