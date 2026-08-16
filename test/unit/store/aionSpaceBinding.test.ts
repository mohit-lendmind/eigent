// The join between the Space the renderer minted and the Space aion owns.
//
// Four properties carry it. A Space nobody has used is nowhere but here, so an
// abandoned placeholder leaves nothing behind on the edge. A create that has
// not returned yet still files the Project that follows it. An edge that
// refuses never takes the local Space — or the turn — down with it. And a
// removal goes the other way round from every other write: the edge decides,
// and a refusal leaves the local record standing.
//
// The fifth is hydration, which is what makes a Space outlive the machine that
// made it: the edge listing is projected onto this renderer's own records, and
// the projection is deliberately timid about deleting.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createAionSpace,
  deleteAionSpace,
  renameAionSpace,
  fileProjectInAionSpace,
  loadAionSpaces,
  spacesMode,
} = vi.hoisted(() => ({
  createAionSpace: vi.fn(),
  deleteAionSpace: vi.fn(),
  renameAionSpace: vi.fn(),
  fileProjectInAionSpace: vi.fn(),
  loadAionSpaces: vi.fn(),
  spacesMode: { current: { kind: 'remote' } as { kind: string } },
}));

vi.mock('@/store/aionSpacesStore', () => ({
  createAionSpace,
  deleteAionSpace,
  renameAionSpace,
  fileProjectInAionSpace,
  loadAionSpaces,
  getAionSpacesMode: () => Promise.resolve(spacesMode.current),
}));

import {
  aionSpaceIdFor,
  deleteBoundSpace,
  ensureAionSpaceId,
  fileProjectUnderBoundSpace,
  hydrateSpacesFromAion,
  renameBoundSpace,
} from '@/store/aionSpaceBinding';
import { useSpaceStore, type Space } from '@/store/spaceStore';

const AION_SPACE = 'spc_01JY0000000000000000000001';
const OTHER_AION_SPACE = 'spc_01JY0000000000000000000002';
const AION_PROJECT = 'prj_01JY0000000000000000000001';

/** A local Space, minted the way the switcher mints one. */
function localSpace(name = 'Research'): string {
  return useSpaceStore.getState().createSpace({
    name,
    sourceType: 'blank',
    setActive: false,
  });
}

function spaceRecord(id: string): Space | undefined {
  return useSpaceStore.getState().spaces[id];
}

/** An edge row, in the shape the Spaces store hands back. */
function edgeSpace(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    spaceId: AION_SPACE,
    name: 'Research',
    status: 'active',
    projectCount: 0,
    createdAt: '2026-08-16T00:00:00Z',
    updatedAt: '2026-08-16T00:00:00Z',
    ...overrides,
  };
}

/**
 * Drains the microtask queue. Used for the assertions that something did NOT
 * happen; a positive assertion polls with `vi.waitFor` instead, because the
 * filing chain is several awaits deep and counting them is how a test starts
 * passing for the wrong reason.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
}

describe('aion space binding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spacesMode.current = { kind: 'remote' };
    createAionSpace.mockResolvedValue({
      spaceId: AION_SPACE,
      name: 'Research',
    });
    deleteAionSpace.mockResolvedValue(undefined);
    renameAionSpace.mockResolvedValue({ spaceId: AION_SPACE, name: 'Renamed' });
    fileProjectInAionSpace.mockResolvedValue(AION_SPACE);
    loadAionSpaces.mockResolvedValue({ spaces: [] });
    useSpaceStore.setState({
      activeSpaceId: null,
      spaces: {},
      projectsBySpaceId: {},
      projectIdIndex: {},
    });
  });

  describe('binding on first use', () => {
    it('puts nothing on the edge for a Space nobody has used', async () => {
      // The switcher mints a placeholder on every click and prunes the ones
      // that are walked away from. Binding at the click would leave one edge
      // Space per abandoned click, with no local record left pointing at it.
      localSpace();
      await settle();
      expect(createAionSpace).not.toHaveBeenCalled();
    });

    it('binds when the first Project is filed under it', async () => {
      const spaceId = localSpace();
      fileProjectUnderBoundSpace(spaceId, AION_PROJECT);

      await vi.waitFor(() =>
        expect(fileProjectInAionSpace).toHaveBeenCalledWith(
          AION_PROJECT,
          AION_SPACE
        )
      );
      expect(createAionSpace).toHaveBeenCalledWith('Research');
      expect(spaceRecord(spaceId)?.aionSpaceId).toBe(AION_SPACE);
    });

    it('files a Project created while the Space create is still in flight', async () => {
      let release: (space: { spaceId: string }) => void = () => {};
      createAionSpace.mockReturnValue(
        new Promise<{ spaceId: string }>((resolve) => {
          release = resolve;
        })
      );

      const spaceId = localSpace();
      void ensureAionSpaceId(spaceId);
      // The submission beats the create home — the filing has to join the
      // in-flight create rather than start a second one or give up.
      fileProjectUnderBoundSpace(spaceId, AION_PROJECT);
      await settle();
      expect(createAionSpace).toHaveBeenCalledTimes(1);
      expect(fileProjectInAionSpace).not.toHaveBeenCalled();

      release({ spaceId: AION_SPACE });
      await vi.waitFor(() =>
        expect(fileProjectInAionSpace).toHaveBeenCalledWith(
          AION_PROJECT,
          AION_SPACE
        )
      );
    });

    it('never binds the legacy Space', async () => {
      // Only the hosted cloud could mint one and it is read-only there, so an
      // edge Space standing for it is a group nothing can ever be filed into.
      const spaceId = useSpaceStore.getState().ensureLegacySpace();
      expect(await ensureAionSpaceId(spaceId)).toBeUndefined();
      expect(createAionSpace).not.toHaveBeenCalled();
    });

    it('keeps the local Space usable when the edge refuses the create', async () => {
      createAionSpace.mockRejectedValue(new Error('space_quota_exhausted'));
      const spaceId = localSpace();

      expect(await ensureAionSpaceId(spaceId)).toBeUndefined();
      expect(spaceRecord(spaceId)?.name).toBe('Research');
    });

    it('files nothing when the Space never bound', async () => {
      createAionSpace.mockRejectedValue(new Error('space_quota_exhausted'));
      const spaceId = localSpace();
      fileProjectUnderBoundSpace(spaceId, AION_PROJECT);
      await settle();

      expect(fileProjectInAionSpace).not.toHaveBeenCalled();
    });

    it('retries a refused create on the next use', async () => {
      // The in-flight entry is per create, not per Space. Keeping it would both
      // grow for the renderer's lifetime and pin a Space to its first failure.
      createAionSpace.mockRejectedValueOnce(new Error('edge down'));
      const spaceId = localSpace();
      expect(await ensureAionSpaceId(spaceId)).toBeUndefined();

      expect(await ensureAionSpaceId(spaceId)).toBe(AION_SPACE);
      expect(createAionSpace).toHaveBeenCalledTimes(2);
    });

    it('drops the aion Space when the local one is deleted mid-create', async () => {
      let release: (space: { spaceId: string }) => void = () => {};
      createAionSpace.mockReturnValue(
        new Promise<{ spaceId: string }>((resolve) => {
          release = resolve;
        })
      );

      const spaceId = localSpace();
      void ensureAionSpaceId(spaceId);
      await settle();
      useSpaceStore.getState().deleteSpace(spaceId);
      release({ spaceId: AION_SPACE });

      // Nothing will ever point at it again, so it is removed rather than left
      // on the edge under a name this desktop no longer holds.
      await vi.waitFor(() =>
        expect(deleteAionSpace).toHaveBeenCalledWith(AION_SPACE)
      );
    });

    it('leaves the edge alone when Spaces are not aion-backed', async () => {
      spacesMode.current = { kind: 'local' };
      const spaceId = localSpace();

      expect(await ensureAionSpaceId(spaceId)).toBeUndefined();
      await renameBoundSpace(spaceId, 'Renamed');
      expect(createAionSpace).not.toHaveBeenCalled();
      expect(renameAionSpace).not.toHaveBeenCalled();
    });
  });

  describe('rename', () => {
    it('writes through to the bound Space', async () => {
      const spaceId = localSpace();
      await ensureAionSpaceId(spaceId);

      await renameBoundSpace(spaceId, 'Renamed');
      expect(renameAionSpace).toHaveBeenCalledWith(AION_SPACE, 'Renamed');
    });

    it('binds an unbound Space instead of renaming nothing', async () => {
      const spaceId = localSpace();

      await renameBoundSpace(spaceId, 'Renamed');
      expect(renameAionSpace).not.toHaveBeenCalled();
      expect(createAionSpace).toHaveBeenCalledWith('Renamed');
      expect(await aionSpaceIdFor(spaceId)).toBe(AION_SPACE);
    });
  });

  describe('delete', () => {
    it('removes the Space from the edge before removing it here', async () => {
      const spaceId = localSpace();
      await ensureAionSpaceId(spaceId);

      await deleteBoundSpace(spaceId);
      expect(deleteAionSpace).toHaveBeenCalledWith(AION_SPACE);
      expect(spaceRecord(spaceId)).toBeUndefined();
    });

    it('keeps the local Space when the edge refuses the delete', async () => {
      // The edge refuses a Space that still holds Projects. A local record that
      // vanished anyway would report the work gone while the server still has
      // it — the one write in this module that is not best effort.
      deleteAionSpace.mockRejectedValue(new Error('space_in_use'));
      const spaceId = localSpace();
      await ensureAionSpaceId(spaceId);

      await expect(deleteBoundSpace(spaceId)).rejects.toThrow('space_in_use');
      expect(spaceRecord(spaceId)).toBeDefined();
    });

    it('removes an unbound Space without asking the edge', async () => {
      const spaceId = localSpace();

      await deleteBoundSpace(spaceId);
      expect(deleteAionSpace).not.toHaveBeenCalled();
      expect(spaceRecord(spaceId)).toBeUndefined();
    });
  });

  describe('hydration', () => {
    it('gives a cold profile the tenant Spaces', async () => {
      // The whole point: a second machine holds no local records, and without
      // this it draws an empty switcher beside Projects filed under Spaces it
      // cannot see.
      loadAionSpaces.mockResolvedValue({
        spaces: [
          edgeSpace(),
          edgeSpace({ spaceId: OTHER_AION_SPACE, name: 'Ops' }),
        ],
      });

      await hydrateSpacesFromAion(true);
      const bound = Object.values(useSpaceStore.getState().spaces);
      expect(bound.map((space) => space.aionSpaceId).sort()).toEqual([
        AION_SPACE,
        OTHER_AION_SPACE,
      ]);
      expect(bound.map((space) => space.name).sort()).toEqual([
        'Ops',
        'Research',
      ]);
    });

    it('walks every page before it decides what the tenant has', async () => {
      loadAionSpaces
        .mockResolvedValueOnce({ spaces: [edgeSpace()], nextPageToken: 'p2' })
        .mockResolvedValueOnce({
          spaces: [edgeSpace({ spaceId: OTHER_AION_SPACE, name: 'Ops' })],
        });

      await hydrateSpacesFromAion(true);
      expect(loadAionSpaces).toHaveBeenNthCalledWith(2, 'p2');
      expect(Object.keys(useSpaceStore.getState().spaces)).toHaveLength(2);
    });

    it('keeps what only this machine knows about a Space', async () => {
      // The folder a Space is rooted at is this desktop's alone; the edge has
      // never heard of it and must not erase it by answering with a name.
      const spaceId = useSpaceStore.getState().createSpace({
        name: 'Local name',
        sourceType: 'folder',
        rootPath: '/work/repo',
        setActive: false,
      });
      useSpaceStore
        .getState()
        .updateSpace(spaceId, { aionSpaceId: AION_SPACE });
      loadAionSpaces.mockResolvedValue({
        spaces: [edgeSpace({ name: 'Renamed elsewhere' })],
      });

      await hydrateSpacesFromAion(true);
      const space = spaceRecord(spaceId);
      expect(space?.name).toBe('Renamed elsewhere');
      expect(space?.rootPath).toBe('/work/repo');
      expect(space?.sourceType).toBe('folder');
    });

    it('removes a Space another client deleted', async () => {
      const spaceId = localSpace();
      await ensureAionSpaceId(spaceId);
      loadAionSpaces.mockResolvedValue({ spaces: [] });

      await hydrateSpacesFromAion(true);
      expect(spaceRecord(spaceId)).toBeUndefined();
    });

    it('never removes a Space that is bound to nothing', async () => {
      // An unbound Space is either a placeholder nobody has used or a local
      // record whose create was refused. Neither is the edge's to delete.
      const spaceId = localSpace();
      loadAionSpaces.mockResolvedValue({ spaces: [] });

      await hydrateSpacesFromAion(true);
      expect(spaceRecord(spaceId)).toBeDefined();
    });

    it('removes nothing when the listing could not be read to the end', async () => {
      const spaceId = localSpace();
      await ensureAionSpaceId(spaceId);
      // A page that never stops asking for the next one is a walk that reached
      // no conclusion — acting on it would delete Spaces simply not yet seen.
      loadAionSpaces.mockResolvedValue({
        spaces: [],
        nextPageToken: 'forever',
      });

      await hydrateSpacesFromAion(true);
      expect(spaceRecord(spaceId)).toBeDefined();
    });

    it('survives a listing the edge refuses', async () => {
      const spaceId = localSpace();
      await ensureAionSpaceId(spaceId);
      loadAionSpaces.mockRejectedValue(new Error('edge down'));

      await expect(hydrateSpacesFromAion(true)).resolves.toBeUndefined();
      expect(spaceRecord(spaceId)).toBeDefined();
    });

    it('shelves a Space the edge reports as archived', async () => {
      const spaceId = localSpace();
      await ensureAionSpaceId(spaceId);
      loadAionSpaces.mockResolvedValue({
        spaces: [edgeSpace({ status: 'archived' })],
      });

      await hydrateSpacesFromAion(true);
      expect(spaceRecord(spaceId)?.status).toBe('archived');
    });

    it('leaves the local status alone for a status this build predates', async () => {
      // Reading an unrecognized status as active would put a Space this desktop
      // cannot describe back into the switcher.
      const spaceId = localSpace();
      await ensureAionSpaceId(spaceId);
      useSpaceStore.getState().updateSpace(spaceId, { status: 'archived' });
      loadAionSpaces.mockResolvedValue({
        spaces: [edgeSpace({ status: 'unknown' })],
      });

      await hydrateSpacesFromAion(true);
      expect(spaceRecord(spaceId)?.status).toBe('archived');
    });

    it('does nothing at all outside aion mode', async () => {
      spacesMode.current = { kind: 'local' };
      await hydrateSpacesFromAion(true);
      expect(loadAionSpaces).not.toHaveBeenCalled();
    });
  });
});
