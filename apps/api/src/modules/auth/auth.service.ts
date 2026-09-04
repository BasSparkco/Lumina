import { ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import type { RegisterDto } from './dto/register.dto';
import type { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    // The production business flow is Super-Admin-provisioned tenants (see the platform-tenants
    // module) — this stays behind an explicit opt-in flag rather than being deleted, so local
    // dev/testing and a possible future self-service plan both keep working.
    //
    // Read directly from process.env, not ConfigService — same convention main.ts already uses
    // for PORT/HOST. ConfigModule.forRoot's `load: [() => ({ ...process.env })]` factory takes
    // precedence in ConfigService.get() over the validated/coerced object `validate` produces,
    // so a boolean-transformed var like this one would come back as the raw, untransformed
    // string via ConfigService — for a var this security-sensitive, that footgun isn't worth it.
    if (process.env.ALLOW_SELF_REGISTRATION !== 'true') {
      throw new ForbiddenException('Self-registration is disabled');
    }

    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already in use');

    const slug = dto.orgName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '-' + Date.now();

    // A failure between the two creates used to leave an orphan Organization row with no owner —
    // the same atomicity fix the Super-Admin-provisioned create-tenant flow requires anyway.
    const user = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: { name: dto.orgName, slug } });
      return tx.user.create({
        data: {
          email: dto.email,
          passwordHash: await hash(dto.password, 12),
          name: dto.name,
          role: 'OWNER',
          organizationId: org.id,
        },
      });
    });

    return this.buildTokenResponse(user.id, user.organizationId, user.role, user.name, user.email, false);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { organization: { select: { status: true } } },
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    // Checked after the password so a suspended tenant's login attempt doesn't leak whether the
    // credentials themselves were correct.
    if (user.organization.status === 'SUSPENDED') {
      throw new UnauthorizedException('This organization has been suspended');
    }

    return this.buildTokenResponse(
      user.id,
      user.organizationId,
      user.role,
      user.name,
      user.email,
      user.isSuperAdmin,
    );
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        organizationId: true,
        isSuperAdmin: true,
        createdAt: true,
      },
    });
    return user;
  }

  private buildTokenResponse(
    userId: string,
    orgId: string,
    role: string,
    name: string,
    email: string,
    isSuperAdmin: boolean,
  ) {
    const token = this.jwt.sign({ sub: userId, orgId, role, isSuperAdmin });
    return { token, user: { id: userId, email, name, role, orgId, isSuperAdmin } };
  }
}
