// Which alias a new turn binds. The catalog is the operator's, not this build's:
// the resolution order is project pin → global selection → the catalog's own
// default → catalog order, and every candidate must be one the picker would
// also show, so a submitted alias is never an alias the user cannot see.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/aion/v1/transport', () => ({
  EdgeTransport: class {},
}));

const { getState } = vi.hoisted(() => ({ getState: vi.fn() }));

vi.mock('@/store/aionModelStore', () => ({
  useAionModelStore: { getState },
}));

type Alias = {
  alias: string;
  is_default?: boolean;
  internal?: boolean;
};

function catalog(...aliases: Alias[]) {
  return { aliases } as never;
}

async function subject() {
  vi.resetModules();
  return (await import('@/store/aionChatBridge')).resolveModelAlias;
}

beforeEach(() => {
  vi.clearAllMocks();
  getState.mockReturnValue({ projectAlias: {}, selectedAlias: undefined });
});

describe('resolveModelAlias', () => {
  it("prefers the project pin, then the global selection", async () => {
    getState.mockReturnValue({
      projectAlias: { 'proj-1': 'reasoning_deep' },
      selectedAlias: 'coding_balanced',
    });
    const resolve = await subject();
    const offered = catalog(
      { alias: 'coding_balanced', is_default: true },
      { alias: 'reasoning_deep' }
    );
    expect(resolve(offered, 'proj-1')).toBe('reasoning_deep');
    expect(resolve(offered, 'proj-2')).toBe('coding_balanced');
  });

  it("falls back to the catalog's own default, not a vendor name", async () => {
    const resolve = await subject();
    // kimi-k3 is first in catalog order and was hardcoded here before; the
    // operator's default has to win or this build overrides the catalog it reads.
    expect(
      resolve(
        catalog({ alias: 'kimi-k3' }, { alias: 'gemini_fast', is_default: true })
      )
    ).toBe('gemini_fast');
  });

  it('falls back to catalog order when no row is default', async () => {
    const resolve = await subject();
    expect(
      resolve(catalog({ alias: 'kimi-k3' }, { alias: 'gemini_fast' }))
    ).toBe('kimi-k3');
  });

  it('ignores a selection the catalog no longer offers', async () => {
    getState.mockReturnValue({
      projectAlias: { 'proj-1': 'retired_alias' },
      selectedAlias: 'also_gone',
    });
    const resolve = await subject();
    expect(
      resolve(catalog({ alias: 'coding_balanced', is_default: true }), 'proj-1')
    ).toBe('coding_balanced');
  });

  it('never falls back onto an internal alias the picker hides', async () => {
    const resolve = await subject();
    // An internal fixture row that is also the catalog default: the offered
    // rows still decide, because a submitted alias the picker refuses to show
    // cannot be changed by the user afterwards.
    expect(
      resolve(
        catalog(
          { alias: 'fixture_echo', is_default: true, internal: true },
          { alias: 'coding_balanced' }
        )
      )
    ).toBe('coding_balanced');
  });

  it('still resolves on an internal-only catalog so keyless stacks run', async () => {
    const resolve = await subject();
    expect(
      resolve(
        catalog(
          { alias: 'fixture_tools', internal: true },
          { alias: 'fixture_echo', internal: true, is_default: true }
        )
      )
    ).toBe('fixture_echo');
  });

  it('returns null for an empty catalog rather than inventing an alias', async () => {
    const resolve = await subject();
    expect(resolve(catalog())).toBeNull();
  });
});
