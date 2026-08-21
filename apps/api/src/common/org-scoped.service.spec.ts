import { NotFoundException } from '@nestjs/common';
import { OrgScopedService } from './org-scoped.service';

describe('OrgScopedService', () => {
  const guard = new OrgScopedService();

  it('returns the record when the lookup finds one', async () => {
    const record = { id: 'screen_1', organizationId: 'org_1' };
    await expect(guard.assertOwns(() => Promise.resolve(record), 'not found')).resolves.toBe(record);
  });

  it('throws NotFoundException with the given message when the lookup returns null', async () => {
    await expect(guard.assertOwns(() => Promise.resolve(null), 'Playlist not found')).rejects.toThrow(
      new NotFoundException('Playlist not found'),
    );
  });
});
