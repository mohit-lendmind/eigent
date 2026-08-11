// Safe version negotiation (doc 10 §12 diagnostics/updates row): the verdict
// is pure, fails closed on garbage, and treats same-major drift as the
// additive evolution the N/N-1 matrix guarantees.
import { describe, expect, it } from 'vitest';

import { negotiateCompatibility, supportsSkills } from '@/api/aion/v1/compat';
import {
  DESKTOP_CLIENT_VERSION,
  EDGE_API_VERSION,
  EVENT_SCHEMA_VERSION,
} from '@/api/aion/v1/gen/meta';
import type { IntegrationStatus } from '@/api/aion/v1/transport';

function status(overrides: Partial<IntegrationStatus> = {}): IntegrationStatus {
  return {
    edge_api_version: EDGE_API_VERSION,
    event_schema_version: EVENT_SCHEMA_VERSION,
    minimum_desktop_version: '1.0.0',
    ...overrides,
  } as IntegrationStatus;
}

describe('negotiateCompatibility', () => {
  it('accepts the exact advertised tuple', () => {
    expect(negotiateCompatibility(status())).toEqual({ compatible: true });
  });

  it('accepts same-major drift in both directions (additive contract)', () => {
    expect(
      negotiateCompatibility(status({ edge_api_version: '1.999.0' }))
    ).toEqual({ compatible: true });
    expect(
      negotiateCompatibility(status({ edge_api_version: '1.0.0' }))
    ).toEqual({ compatible: true });
  });

  it('accepts a minimum_desktop equal to the client version', () => {
    expect(
      negotiateCompatibility(
        status({ minimum_desktop_version: DESKTOP_CLIENT_VERSION })
      )
    ).toEqual({ compatible: true });
  });

  it('accepts a pre-release minimum whose numeric core is satisfied', () => {
    expect(
      negotiateCompatibility(
        status({ minimum_desktop_version: `${DESKTOP_CLIENT_VERSION}-rc.1` })
      )
    ).toEqual({ compatible: true });
  });

  it('refuses a desktop below the backend floor, naming both versions', () => {
    const verdict = negotiateCompatibility(
      status({ minimum_desktop_version: '999.0.0' })
    );
    expect(verdict.compatible).toBe(false);
    if (!verdict.compatible) {
      expect(verdict.reason).toContain(DESKTOP_CLIENT_VERSION);
      expect(verdict.reason).toContain('999.0.0');
      expect(verdict.reason).toContain('Update Eigent');
    }
  });

  it('refuses an edge API major mismatch', () => {
    const verdict = negotiateCompatibility(
      status({ edge_api_version: '2.0.0' })
    );
    expect(verdict.compatible).toBe(false);
    if (!verdict.compatible) {
      expect(verdict.reason).toContain('2.0.0');
      expect(verdict.reason).toContain(EDGE_API_VERSION);
    }
  });

  it('refuses an event schema major change', () => {
    const verdict = negotiateCompatibility(
      status({ event_schema_version: '2.0' })
    );
    expect(verdict.compatible).toBe(false);
    if (!verdict.compatible) {
      expect(verdict.reason).toContain('2.0');
    }
  });

  it('fails closed on a version string it cannot parse', () => {
    const verdict = negotiateCompatibility(
      status({ minimum_desktop_version: 'latest' })
    );
    expect(verdict.compatible).toBe(false);
    if (!verdict.compatible) {
      expect(verdict.reason).toContain('"latest"');
    }
  });
});

describe('supportsSkills', () => {
  it('gates on the 1.4 minor floor within the shared major', () => {
    expect(supportsSkills(status({ edge_api_version: '1.4.0' }))).toBe(true);
    expect(supportsSkills(status({ edge_api_version: '1.9.2' }))).toBe(true);
    expect(supportsSkills(status({ edge_api_version: '1.3.0' }))).toBe(false);
  });

  it('fails closed on an unparseable edge version', () => {
    expect(supportsSkills(status({ edge_api_version: 'new' }))).toBe(false);
  });
});
