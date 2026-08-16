// The skills list has one store behind it now, so the states worth pinning are
// the ones that look identical on screen when they degrade: a stack that cannot
// serve skills has to say so rather than render an empty list (which reads as
// "you have no skills"), and a mutation the store refused must leave its row
// exactly where it was instead of vanishing until the next refresh.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Skill } from '@/store/skillsStore';

const aion = vi.hoisted(() => ({
  getAionSkillsMode: vi.fn(),
  listAionSkills: vi.fn(),
  deleteAionSkill: vi.fn(),
  setAionSkillEnabled: vi.fn(),
  putAionSkill: vi.fn(),
  captureAionSyncUpCandidates: vi.fn(),
}));

const toast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
}));

vi.mock('@/store/aionSkillsStore', () => aion);
vi.mock('sonner', () => ({ toast }));

function skillRow(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'skill-1',
    name: 'pdf-report',
    description: 'Render a PDF',
    filePath: 'SKILL.md',
    fileContent: '',
    addedAt: 1,
    scope: { isGlobal: true, selectedAgents: [] },
    enabled: true,
    isExample: false,
    ...overrides,
  };
}

async function freshStore(rows: Skill[] = []) {
  vi.resetModules();
  const { useSkillsStore } = await import('@/store/skillsStore');
  useSkillsStore.setState({ skills: rows, remoteMode: { kind: 'local' } });
  return useSkillsStore;
}

beforeEach(() => {
  vi.clearAllMocks();
  // The store persists, so every mutation reaches Web Storage. Give it one
  // that starts empty rather than whichever implementation the host runtime
  // happens to have put on the global.
  const stored = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => {
        stored.set(key, value);
      },
      removeItem: (key: string) => {
        stored.delete(key);
      },
      clear: () => stored.clear(),
    },
  });
});

describe('skillsStore', () => {
  it('names a backend too old to serve skills instead of emptying the list', async () => {
    aion.getAionSkillsMode.mockResolvedValue({
      kind: 'unsupported',
      edgeApiVersion: '1.3.0',
    });
    const store = await freshStore([skillRow()]);

    await store.getState().refresh();

    expect(store.getState().remoteMode).toEqual({
      kind: 'unsupported',
      edgeApiVersion: '1.3.0',
    });
    expect(store.getState().skills).toHaveLength(1);
    expect(aion.listAionSkills).not.toHaveBeenCalled();
  });

  it('turns a failed listing into a visible error, not an empty list', async () => {
    aion.getAionSkillsMode.mockResolvedValue({ kind: 'remote', usage: true });
    aion.listAionSkills.mockRejectedValue(new Error('edge unreachable'));
    const store = await freshStore([skillRow()]);

    await store.getState().refresh();

    expect(store.getState().remoteMode).toEqual({
      kind: 'error',
      message: 'edge unreachable',
    });
    expect(store.getState().skills).toHaveLength(1);
  });

  it('keeps a row the store refused to delete', async () => {
    aion.getAionSkillsMode.mockResolvedValue({ kind: 'remote', usage: true });
    aion.deleteAionSkill.mockRejectedValue(new Error('skill in use'));
    const store = await freshStore([skillRow()]);

    await store.getState().deleteSkill('skill-1');

    expect(store.getState().skills).toHaveLength(1);
    expect(toast.error).toHaveBeenCalled();
  });

  it('reverts a toggle the store refused', async () => {
    aion.getAionSkillsMode.mockResolvedValue({ kind: 'remote', usage: true });
    aion.setAionSkillEnabled.mockRejectedValue(new Error('nope'));
    const store = await freshStore([skillRow({ enabled: true })]);

    await store.getState().toggleSkill('skill-1');

    expect(store.getState().skills[0].enabled).toBe(true);
  });

  it('holds an added skill in this renderer alone when no transport resolved', async () => {
    aion.getAionSkillsMode.mockResolvedValue({ kind: 'local' });
    const store = await freshStore();

    await store.getState().addSkill({
      name: 'local-only',
      description: '',
      filePath: 'SKILL.md',
      fileContent: '',
      skillDirName: undefined,
      scope: { isGlobal: true, selectedAgents: [] },
      enabled: true,
    });

    expect(store.getState().skills.map((s) => s.name)).toEqual(['local-only']);
    expect(aion.putAionSkill).not.toHaveBeenCalled();
  });

  it('refuses an add against a backend that cannot store it', async () => {
    aion.getAionSkillsMode.mockResolvedValue({
      kind: 'error',
      message: 'edge unreachable',
    });
    const store = await freshStore();

    await expect(
      store.getState().addSkill({
        name: 'nope',
        description: '',
        filePath: 'SKILL.md',
        fileContent: '',
        scope: { isGlobal: true, selectedAgents: [] },
        enabled: true,
      })
    ).rejects.toThrow('edge unreachable');
    expect(store.getState().skills).toHaveLength(0);
  });
});
