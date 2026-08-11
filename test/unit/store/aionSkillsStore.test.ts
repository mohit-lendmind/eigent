// The remote skills provider (SkillStore train C3): mode negotiation gates
// on the 1.4 skills floor, store rows project onto the UI Skill type, and
// every mutation carries the contract's concurrency semantics (If-Match from
// the last seen version) and invalidates the catalog cache.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getIntegrationStatus, listSkills, putSkill, deleteSkill, setSkillStatus } =
  vi.hoisted(() => ({
    getIntegrationStatus: vi.fn(),
    listSkills: vi.fn(),
    putSkill: vi.fn(),
    deleteSkill: vi.fn(),
    setSkillStatus: vi.fn(),
  }));

vi.mock('@/api/aion/v1/transport', () => ({
  EdgeTransport: class {
    getIntegrationStatus = getIntegrationStatus;
    listSkills = listSkills;
    putSkill = putSkill;
    deleteSkill = deleteSkill;
    setSkillStatus = setSkillStatus;
  },
}));

const fixturesDir = join(__dirname, '../../fixtures/aion/eigent/v1');
const fixture = (name: string): any =>
  JSON.parse(readFileSync(join(fixturesDir, name), 'utf-8'));

function remoteStatus(edgeApiVersion = '1.4.0') {
  return {
    edge_api_version: edgeApiVersion,
    event_schema_version: '1.0',
    minimum_desktop_version: '1.0.0',
  };
}

function setRemoteConfig() {
  (globalThis as Record<string, any>).electronAPI = {
    getAionTransportConfig: async () => ({
      mode: 'remote',
      edgeBaseUrl: 'http://edge.test/eigent/v1',
      apiKey: 'test-key',
    }),
  };
}

async function freshModule() {
  vi.resetModules();
  return import('@/store/aionSkillsStore');
}

beforeEach(() => {
  vi.clearAllMocks();
  delete (globalThis as Record<string, any>).electronAPI;
});

describe('aionSkillsStore mode negotiation', () => {
  it('resolves local when no remote config exists', async () => {
    const store = await freshModule();
    expect(await store.getAionSkillsMode()).toEqual({ kind: 'local' });
    expect(getIntegrationStatus).not.toHaveBeenCalled();
  });

  it('gates on the skills minor floor with a visible unsupported state', async () => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus('1.3.0'));
    const store = await freshModule();
    expect(await store.getAionSkillsMode()).toEqual({
      kind: 'unsupported',
      edgeApiVersion: '1.3.0',
    });
    await expect(store.listAionSkills()).rejects.toThrow(
      /does not serve the skills surface/
    );
  });

  it('surfaces a misconfigured remote mode as an error, never local', async () => {
    (globalThis as Record<string, any>).electronAPI = {
      getAionTransportConfig: async () => ({
        mode: 'remote',
        error: 'EIGENT_REMOTE_BACKEND_URL is not a valid URL',
      }),
    };
    const store = await freshModule();
    expect(await store.getAionSkillsMode()).toEqual({
      kind: 'error',
      message: 'EIGENT_REMOTE_BACKEND_URL is not a valid URL',
    });
  });

  it('retries the handshake after a failed status fetch', async () => {
    setRemoteConfig();
    getIntegrationStatus
      .mockRejectedValueOnce(new Error('edge unreachable'))
      .mockResolvedValueOnce(remoteStatus());
    const store = await freshModule();
    expect(await store.getAionSkillsMode()).toEqual({
      kind: 'error',
      message: 'edge unreachable',
    });
    expect(await store.getAionSkillsMode()).toEqual({ kind: 'remote' });
  });
});

describe('aionSkillsStore catalog', () => {
  it('projects store rows onto the UI Skill type', async () => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus());
    listSkills.mockResolvedValue(fixture('skill_catalog_response.json'));
    const store = await freshModule();

    const skills = await store.listAionSkills();
    expect(skills.map((s) => s.name)).toEqual([
      'release-notes',
      'triage-report',
    ]);
    const [releaseNotes, triage] = skills;
    expect(releaseNotes).toMatchObject({
      id: 'aion-release-notes',
      skillDirName: 'release-notes',
      enabled: true,
      isExample: false,
      scope: { isGlobal: true, selectedAgents: [] },
    });
    expect(releaseNotes.description).toContain('release notes');
    // The UI-side SKILL.md reconstruction keeps # picker and save flows fed.
    expect(releaseNotes.fileContent).toContain('name: release-notes');
    expect(releaseNotes.fileContent).toContain(
      'Summarise the change set as customer-facing release notes'
    );
    expect(triage.enabled).toBe(false); // status: disabled
    // The Metadata scope tag projects onto the UI scope shape (SK-D).
    expect(triage.scope).toEqual({
      isGlobal: false,
      selectedAgents: ['developer_agent', 'search_agent'],
    });
  });

  it('shares one fetch across concurrent opens and refetches after invalidation', async () => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus());
    listSkills.mockResolvedValue(fixture('skill_catalog_response.json'));
    const store = await freshModule();

    await Promise.all([store.listAionSkills(), store.listAionSkills()]);
    expect(listSkills).toHaveBeenCalledTimes(1);
    store.invalidateAionSkillCatalog();
    await store.listAionSkills();
    expect(listSkills).toHaveBeenCalledTimes(2);
  });
});

describe('aionSkillsStore mutations', () => {
  it('puts with If-Match from the last seen version and invalidates', async () => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus());
    listSkills.mockResolvedValue(fixture('skill_catalog_response.json'));
    putSkill.mockResolvedValue(fixture('put_skill_response.json'));
    const store = await freshModule();

    await store.listAionSkills(); // learns release-notes @ version 3
    await store.putAionSkill(
      {
        name: 'release-notes',
        description: 'Draft release notes.',
        body: 'Do the thing.',
      },
      [{ path: 'template.md', contentBase64: 'IyBSZWxlYXNlCg==' }],
      { entrypoint: 'template.md' }
    );

    expect(putSkill).toHaveBeenCalledTimes(1);
    const [name, request, ifMatch] = putSkill.mock.calls[0];
    expect(name).toBe('release-notes');
    expect(ifMatch).toBe(3);
    expect(request.origin).toBe('desktop_ui');
    expect(request.document).toMatchObject({
      Name: 'release-notes',
      Description: 'Draft release notes.',
      PromptText: 'Do the thing.',
    });
    // Annotations ride the Metadata map — never the document root, whose
    // unknown keys the store's strict decoder rejects.
    expect(request.document.Metadata).toEqual({ entrypoint: 'template.md' });
    expect(request.document).not.toHaveProperty('entrypoint');
    expect(request.document.Files).toEqual([
      { Path: 'template.md', Content: 'IyBSZWxlYXNlCg==', Mode: 0o644 },
    ]);

    // A brand-new name has no known version: the put is unconditional.
    await store.putAionSkill({ name: 'fresh', description: 'd', body: 'b' });
    expect(putSkill.mock.calls[1][2]).toBeUndefined();
    expect(putSkill.mock.calls[1][1].document).not.toHaveProperty('Metadata');

    await store.listAionSkills();
    expect(listSkills).toHaveBeenCalledTimes(2); // invalidated by the puts
  });

  it('echoes the stored document so partial updates never strip fields', async () => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus());
    listSkills.mockResolvedValue(fixture('skill_catalog_response.json'));
    // The store echoes back the document it just wrote (the canonical shape),
    // which is what feeds the next put's baseline.
    putSkill.mockImplementation(async (_name: string, request: any) => ({
      skill: {
        ...fixture('put_skill_response.json').skill,
        version: 4,
        document: request.document,
      },
      changed: true,
    }));
    const store = await freshModule();
    await store.listAionSkills(); // learns release-notes' stored document

    // A scope-only update: content unchanged, Files preserved from the echo.
    await store.putAionSkill(
      {
        name: 'release-notes',
        description: 'Draft customer-facing release notes from a change summary.',
        body: 'Summarise the change set as customer-facing release notes using template.md.',
      },
      [],
      { scope: 'developer_agent' }
    );
    const first = putSkill.mock.calls[0][1].document;
    expect(first.Metadata).toEqual({ scope: 'developer_agent' });
    expect(first.Files).toEqual([
      { Path: 'template.md', Content: 'IyBSZWxlYXNlIG5vdGVzCg==', Mode: 420 },
    ]);

    // A later content-only edit keeps the annotation…
    await store.putAionSkill({
      name: 'release-notes',
      description: 'Sharper notes.',
      body: 'New body.',
    });
    const second = putSkill.mock.calls[1][1].document;
    expect(second.Metadata).toEqual({ scope: 'developer_agent' });
    expect(second.Files).toHaveLength(1);
    expect(second.PromptText).toBe('New body.');

    // …and an empty value clears it (scope back to global).
    await store.putAionSkill(
      { name: 'release-notes', description: 'Sharper notes.', body: 'New body.' },
      [],
      { scope: '' }
    );
    const third = putSkill.mock.calls[2][1].document;
    expect(third).not.toHaveProperty('Metadata');
  });

  it('maps enabled to the status row and delete to DELETE', async () => {
    setRemoteConfig();
    getIntegrationStatus.mockResolvedValue(remoteStatus());
    setSkillStatus.mockResolvedValue(fixture('skill_response.json'));
    deleteSkill.mockResolvedValue(undefined);
    const store = await freshModule();

    await store.setAionSkillEnabled('release-notes', false);
    expect(setSkillStatus).toHaveBeenCalledWith('release-notes', {
      status: 'disabled',
    });
    await store.setAionSkillEnabled('release-notes', true);
    expect(setSkillStatus).toHaveBeenLastCalledWith('release-notes', {
      status: 'active',
    });
    await store.deleteAionSkill('release-notes');
    expect(deleteSkill).toHaveBeenCalledWith('release-notes');
  });
});

describe('aionSkillsStore sync-up capture', () => {
  it('keeps only the first snapshot and filters examples and empty content', async () => {
    const store = await freshModule();
    const skill = (overrides: Record<string, unknown>) => ({
      id: 'x',
      name: 'x',
      description: '',
      filePath: 'x/SKILL.md',
      fileContent: '---\nname: x\ndescription: d\n---\nbody',
      addedAt: 0,
      scope: { isGlobal: true, selectedAgents: [] },
      enabled: true,
      isExample: false,
      ...overrides,
    });
    store.captureAionSyncUpCandidates(
      [
        skill({ id: 'a', name: 'a' }),
        skill({ id: 'b', name: 'b', isExample: true }),
        skill({ id: 'c', name: 'c', fileContent: '  ' }),
      ],
      new Set<string>()
    );
    expect(store.getAionSyncUpCandidates().map((s) => s.id)).toEqual(['a']);
    // A later (post-remote-sync) call must not overwrite the snapshot.
    store.captureAionSyncUpCandidates(
      [skill({ id: 'd', name: 'd' })],
      new Set<string>()
    );
    expect(store.getAionSyncUpCandidates().map((s) => s.id)).toEqual(['a']);
  });

  it('never offers rows whose name is already on the remote store', async () => {
    // Restart scenario: the persisted rows ARE the previous remote list, so
    // every name matches remotely and nothing is a sync-up candidate.
    const store = await freshModule();
    const skill = (name: string) => ({
      id: `aion-${name}`,
      name,
      description: '',
      filePath: `${name}/SKILL.md`,
      fileContent: `---\nname: ${name}\ndescription: d\n---\nbody`,
      addedAt: 0,
      scope: { isGlobal: true, selectedAgents: [] },
      enabled: true,
      isExample: false,
    });
    store.captureAionSyncUpCandidates(
      [skill('remote-one'), skill('local-only')],
      new Set(['remote-one'])
    );
    expect(store.getAionSyncUpCandidates().map((s) => s.name)).toEqual([
      'local-only',
    ]);
  });
});
