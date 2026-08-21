import { Injectable, NotFoundException } from '@nestjs/common';

// Nearly every module's service has its own private `assertOwns`/`assertXOwned`/`getMember`
// method that does exactly this: run an org-scoped lookup, throw NotFoundException if it comes
// back empty, hand the record back to the caller otherwise. Centralizing just that three-line
// shape here — rather than a full generic CRUD base class — means a new module reaches for one
// well-known helper instead of re-deriving the pattern from scratch, without fighting Prisma's
// per-model delegate types: `lookup` is a plain thunk the caller already had to write anyway
// (`() => this.prisma.x.findFirst({ where: {...} })`), so this only ever sees the result, never
// Prisma's argument types.
@Injectable()
export class OrgScopedService {
  async assertOwns<T>(lookup: () => Promise<T | null>, notFoundMessage: string): Promise<T> {
    const record = await lookup();
    if (!record) throw new NotFoundException(notFoundMessage);
    return record;
  }
}
