// The predicate the nav registries gate on. Its only interesting property is
// what happens before the answer arrives, and what a misconfigured backend
// counts as.
import { describe, expect, it } from 'vitest';

import { modeFromConfig, visibleInMode } from '@/hooks/useAionMode';

describe('modeFromConfig', () => {
  it('reads a null config as the legacy plane', () => {
    expect(modeFromConfig(null)).toBe('legacy');
  });

  it('counts a working remote backend as aion', () => {
    expect(
      modeFromConfig({ edgeBaseUrl: 'http://edge.test', apiKey: 'k' })
    ).toBe('aion');
  });

  it('counts a misconfigured remote backend as aion too', () => {
    // The desktop was pointed at an edge, so the legacy screens are dead here
    // as well. Reading this as 'legacy' would un-hide them at exactly the
    // moment the user is already looking for something that works.
    expect(modeFromConfig({ error: 'EIGENT_REMOTE_BACKEND_URL is not a URL' })).toBe(
      'aion'
    );
  });
});

describe('visibleInMode', () => {
  const items = [
    { id: 'models' },
    { id: 'skills' },
    { id: 'sub-agents' },
    { id: 'memory' },
  ] as const;
  const legacyOnly = ['models', 'sub-agents'];

  it('keeps every entry on the legacy plane', () => {
    expect(visibleInMode(items, 'legacy', legacyOnly).map((i) => i.id)).toEqual([
      'models',
      'skills',
      'sub-agents',
      'memory',
    ]);
  });

  it('drops the legacy-only entries in aion mode', () => {
    expect(visibleInMode(items, 'aion', legacyOnly).map((i) => i.id)).toEqual([
      'skills',
      'memory',
    ]);
  });

  it('hides them while the mode is still unknown', () => {
    // The asymmetry is the point: a dead entry that flashes into the nav and
    // then disappears is worse than one that appears a beat late.
    expect(visibleInMode(items, 'unknown', legacyOnly).map((i) => i.id)).toEqual(
      ['skills', 'memory']
    );
  });

  it('gates aion-only entries the same way, from the other side', () => {
    const withUsage = [...items, { id: 'usage' }] as const;
    const aionOnly = ['usage'];
    expect(
      visibleInMode(withUsage, 'aion', legacyOnly, aionOnly).map((i) => i.id)
    ).toEqual(['skills', 'memory', 'usage']);
    expect(
      visibleInMode(withUsage, 'legacy', legacyOnly, aionOnly).map((i) => i.id)
    ).toEqual(['models', 'skills', 'sub-agents', 'memory']);
    expect(
      visibleInMode(withUsage, 'unknown', legacyOnly, aionOnly).map((i) => i.id)
    ).toEqual(['skills', 'memory']);
  });
});
