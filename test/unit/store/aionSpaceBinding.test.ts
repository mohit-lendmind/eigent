// The join between the Space the renderer minted and the Space aion owns.
// Three properties carry it: a create that has not returned yet still files the
// Project that follows it, an edge that refuses never takes the local Space (or
// the turn) down with it, and a rename on an unbound Space binds it rather than
// renaming nothing.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createAionSpace, renameAionSpace, fileProjectInAionSpace, spacesMode } =
  vi.hoisted(() => ({
    createAionSpace: vi.fn(),
    renameAionSpace: vi.fn(),
    fileProjectInAionSpace: vi.fn(),
    spacesMode: { current: { kind: 'remote' } as { kind: string } },
  }));

vi.mock('@/store/aionSpacesStore', () => ({
  createAionSpace,
  renameAionSpace,
  fileProjectInAionSpace,
  getAionSpacesMode: () => Promise.resolve(spacesMode.current),
}));

import {
  aionSpaceIdFor,
  bindSpaceToAion,
  fileProjectUnderBoundSpace,
  renameBoundSpace,
} from '@/store/aionSpaceBinding';
import { useSpaceStore } from '@/store/spaceStore';

const AION_SPACE = 'spc_01JY0000000000000000000001';
const AION_PROJECT = 'prj_01JY0000000000000000000001';

/** A local Space, minted the way the switcher mints one. */
function localSpace(name = 'Research'): string {
  return useSpaceStore.getState().createSpace({
    name,
    sourceType: 'blank',
    setActive: false,
  });
}

/** Lets the fire-and-forget filing chain settle before it is asserted on. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('aion space binding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spacesMode.current = { kind: 'remote' };
    createAionSpace.mockResolvedValue({ spaceId: AION_SPACE, name: 'Research' });
    renameAionSpace.mockResolvedValue({ spaceId: AION_SPACE, name: 'Renamed' });
    fileProjectInAionSpace.mockResolvedValue(AION_SPACE);
    useSpaceStore.setState({
      activeSpaceId: null,
      spaces: {},
      projectsBySpaceId: {},
      projectIdIndex: {},
    });
  });

  it('records the aion Space the local one stands for', async () => {
    const spaceId = localSpace();
    bindSpaceToAion(spaceId, 'Research');

    expect(await aionSpaceIdFor(spaceId)).toBe(AION_SPACE);
    expect(createAionSpace).toHaveBeenCalledWith('Research');
    expect(useSpaceStore.getState().spaces[spaceId]?.aionSpaceId).toBe(
      AION_SPACE
    );
  });

  it('files a Project created while the Space create is still in flight', async () => {
    let release: (space: { spaceId: string }) => void = () => {};
    createAionSpace.mockReturnValue(
      new Promise<{ spaceId: string }>((resolve) => {
        release = resolve;
      })
    );

    const spaceId = localSpace();
    bindSpaceToAion(spaceId, 'Research');
    // The submission beats the create home — the filing has to wait for it
    // rather than read an id that is not there yet and give up.
    fileProjectUnderBoundSpace(spaceId, AION_PROJECT);
    await settle();
    expect(fileProjectInAionSpace).not.toHaveBeenCalled();

    release({ spaceId: AION_SPACE });
    await settle();
    expect(fileProjectInAionSpace).toHaveBeenCalledWith(
      AION_PROJECT,
      AION_SPACE
    );
  });

  it('keeps the local Space usable when the edge refuses the create', async () => {
    createAionSpace.mockRejectedValue(new Error('space_quota_exhausted'));
    const spaceId = localSpace();
    bindSpaceToAion(spaceId, 'Research');

    expect(await aionSpaceIdFor(spaceId)).toBeUndefined();
    expect(useSpaceStore.getState().spaces[spaceId]?.name).toBe('Research');
  });

  it('files nothing when the Space never bound', async () => {
    createAionSpace.mockRejectedValue(new Error('space_quota_exhausted'));
    const spaceId = localSpace();
    bindSpaceToAion(spaceId, 'Research');
    await aionSpaceIdFor(spaceId);

    fileProjectUnderBoundSpace(spaceId, AION_PROJECT);
    await settle();
    expect(fileProjectInAionSpace).not.toHaveBeenCalled();
  });

  it('writes a rename through to the bound Space', async () => {
    const spaceId = localSpace();
    bindSpaceToAion(spaceId, 'Research');
    await aionSpaceIdFor(spaceId);

    await renameBoundSpace(spaceId, 'Renamed');
    expect(renameAionSpace).toHaveBeenCalledWith(AION_SPACE, 'Renamed');
  });

  it('binds an unbound Space on rename instead of renaming nothing', async () => {
    createAionSpace.mockRejectedValueOnce(new Error('edge down'));
    const spaceId = localSpace();
    bindSpaceToAion(spaceId, 'Research');
    await aionSpaceIdFor(spaceId);

    await renameBoundSpace(spaceId, 'Renamed');
    expect(renameAionSpace).not.toHaveBeenCalled();
    expect(await aionSpaceIdFor(spaceId)).toBe(AION_SPACE);
    expect(createAionSpace).toHaveBeenLastCalledWith('Renamed');
  });

  it('leaves the edge alone when Spaces are not aion-backed', async () => {
    spacesMode.current = { kind: 'local' };
    const spaceId = localSpace();
    bindSpaceToAion(spaceId, 'Research');

    expect(await aionSpaceIdFor(spaceId)).toBeUndefined();
    expect(createAionSpace).not.toHaveBeenCalled();

    await renameBoundSpace(spaceId, 'Renamed');
    expect(createAionSpace).not.toHaveBeenCalled();
    expect(renameAionSpace).not.toHaveBeenCalled();
  });
});
