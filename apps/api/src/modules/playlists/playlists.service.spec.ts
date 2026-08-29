import { NotFoundException } from '@nestjs/common';
import { PlaylistsService } from './playlists.service';
import { OrgScopedService } from '../../common/org-scoped.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';
import type { JwtService } from '@nestjs/jwt';

// Regression coverage for the cross-tenant IDOR fixed this audit: updateItem/removeItem/
// reorderItems used to only verify the *playlist* belonged to the caller's org, never that the
// itemId(s) in the request actually belonged to that playlist — so any authenticated org member
// could mutate another org's playlist items by guessing/leaking a PlaylistItem id. These tests
// pin the fix so it can't silently regress.
describe('PlaylistsService — cross-tenant item ownership', () => {
  const ORG_ID = 'org_mine';
  const PLAYLIST_ID = 'playlist_mine';
  const FOREIGN_ITEM_ID = 'item_belongs_to_another_playlist';

  function makeService(prismaOverrides: Record<string, unknown>) {
    const prisma = {
      playlist: { findFirst: jest.fn().mockResolvedValue({ id: PLAYLIST_ID, organizationId: ORG_ID }) },
      playlistItem: {
        findFirst: jest.fn().mockResolvedValue(null), // the foreign item never belongs to PLAYLIST_ID
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0), // 0 of the requested ids actually belong here
      },
      $transaction: jest.fn(fn => (typeof fn === 'function' ? fn(prisma) : Promise.all(fn))),
      ...prismaOverrides,
    } as unknown as PrismaService;
    const storage = { publicUrl: jest.fn((key: string) => `https://cdn.example/${key}`) } as unknown as StorageService;
    const orgScoped = new OrgScopedService();
    const jwt = { sign: jest.fn(), verify: jest.fn() } as unknown as JwtService;
    return { service: new PlaylistsService(prisma, storage, orgScoped, jwt), prisma };
  }

  it('updateItem rejects an itemId that belongs to a different playlist, without writing', async () => {
    const { service, prisma } = makeService({});

    await expect(
      service.updateItem(ORG_ID, PLAYLIST_ID, FOREIGN_ITEM_ID, 10),
    ).rejects.toThrow(new NotFoundException('Playlist item not found'));

    expect(prisma.playlistItem.update).not.toHaveBeenCalled();
  });

  it('removeItem rejects an itemId that belongs to a different playlist, without deleting', async () => {
    const { service, prisma } = makeService({});

    await expect(
      service.removeItem(ORG_ID, PLAYLIST_ID, FOREIGN_ITEM_ID),
    ).rejects.toThrow(new NotFoundException('Playlist item not found'));

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('reorderItems rejects a batch containing an id from a different playlist, without writing', async () => {
    const { service, prisma } = makeService({});

    await expect(
      service.reorderItems(ORG_ID, PLAYLIST_ID, ['item_mine_1', FOREIGN_ITEM_ID]),
    ).rejects.toThrow(new NotFoundException('Playlist item not found'));

    // count() found fewer owned items than requested — the batch write must never run.
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('updateItem succeeds when the item genuinely belongs to the playlist', async () => {
    const { service, prisma } = makeService({
      playlistItem: {
        findFirst: jest.fn().mockResolvedValue({ id: 'item_mine', playlistId: PLAYLIST_ID }),
        update: jest.fn().mockResolvedValue({
          id: 'item_mine',
          durationSecs: 10,
          asset: { type: 'IMAGE', storageKey: 'k', thumbnailKey: null, pageCount: null, sizeBytes: 0n },
        }),
        count: jest.fn(),
      },
    });

    await expect(service.updateItem(ORG_ID, PLAYLIST_ID, 'item_mine', 10)).resolves.toBeDefined();
    expect(prisma.playlistItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'item_mine' } }),
    );
  });
});
