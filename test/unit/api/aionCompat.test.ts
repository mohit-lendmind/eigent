// Safe version negotiation (doc 10 §12 diagnostics/updates row): the verdict
// is pure, fails closed on garbage, and treats same-major drift as the
// additive evolution the N/N-1 matrix guarantees.
import { describe, expect, it } from 'vitest';

import {
  negotiateCompatibility,
  supportsProjectList,
  supportsSkillUsage,
  supportsSkills,
  supportsWorkforceEvents,
  supportsConnectors,
  supportsSchedules,
  supportsRunRecovery,
  supportsAttachments,
} from '@/api/aion/v1/compat';
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
      expect(verdict.reason).toContain('Update Eternyl');
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

  it('never reports skills on an incompatible pairing', () => {
    // 2.1 clears the [1,4] floor numerically but speaks a different major.
    expect(supportsSkills(status({ edge_api_version: '2.1.0' }))).toBe(false);
    expect(
      supportsSkills(status({ minimum_desktop_version: '999.0.0' }))
    ).toBe(false);
  });
});

describe('supportsSkillUsage', () => {
  it('gates one minor above the skills floor', () => {
    // The floors are separate because a 1.4 edge serves skills but reports no
    // counters: a caller that conflated them would read every row's missing
    // counters as "never used".
    expect(supportsSkillUsage(status({ edge_api_version: '1.4.9' }))).toBe(
      false
    );
    expect(supportsSkillUsage(status({ edge_api_version: '1.5.0' }))).toBe(true);
    expect(supportsSkillUsage(status({ edge_api_version: '1.6.0' }))).toBe(true);
  });

  it('fails closed on garbage and on a foreign major', () => {
    expect(supportsSkillUsage(status({ edge_api_version: 'new' }))).toBe(false);
    expect(supportsSkillUsage(status({ edge_api_version: '2.5.0' }))).toBe(
      false
    );
  });
});

describe('supportsProjectList', () => {
  it('gates on the 1.6 project-list floor', () => {
    expect(supportsProjectList(status({ edge_api_version: '1.5.9' }))).toBe(
      false
    );
    expect(supportsProjectList(status({ edge_api_version: '1.6.0' }))).toBe(
      true
    );
    expect(supportsProjectList(status({ edge_api_version: '1.7.3' }))).toBe(
      true
    );
  });

  it('fails closed on garbage and on a foreign major', () => {
    // 2.0.0 clears [1,6] numerically and must still be refused: the full
    // verdict gates first, so a contract this build cannot read never passes.
    expect(supportsProjectList(status({ edge_api_version: '2.0.0' }))).toBe(
      false
    );
    expect(supportsProjectList(status({ edge_api_version: '1.six' }))).toBe(
      false
    );
    expect(
      supportsProjectList(status({ minimum_desktop_version: '999.0.0' }))
    ).toBe(false);
  });
});

describe('supportsWorkforceEvents', () => {
  it('gates on the 1.8 typed-subagent floor', () => {
    // Below the floor the worker events are retained at internal visibility,
    // which the reducer drops — so an empty workforce there is silence, not
    // the fact that the run ran alone.
    expect(supportsWorkforceEvents(status({ edge_api_version: '1.7.9' }))).toBe(
      false
    );
    expect(supportsWorkforceEvents(status({ edge_api_version: '1.8.0' }))).toBe(
      true
    );
  });

  it('fails closed on garbage and on a foreign major', () => {
    expect(supportsWorkforceEvents(status({ edge_api_version: '2.0.0' }))).toBe(
      false
    );
    expect(supportsWorkforceEvents(status({ edge_api_version: '1.eight' }))).toBe(
      false
    );
  });
});

describe('supportsConnectors', () => {
  it('gates on the 1.9 connectors floor', () => {
    // Below the floor the route does not exist, and an empty catalog would say
    // this tenant has no integrations rather than that the backend cannot list
    // them.
    expect(supportsConnectors(status({ edge_api_version: '1.8.9' }))).toBe(
      false
    );
    expect(supportsConnectors(status({ edge_api_version: '1.9.0' }))).toBe(true);
  });

  it('fails closed on garbage and on a foreign major', () => {
    expect(supportsConnectors(status({ edge_api_version: '2.0.0' }))).toBe(
      false
    );
    expect(supportsConnectors(status({ edge_api_version: '1.nine' }))).toBe(
      false
    );
  });
});

describe('supportsSchedules', () => {
  it('gates on the 1.10 schedules floor', () => {
    // 1.9 is below 1.10 despite sorting after it as a string — the floor is
    // compared numerically per field, or every 1.9.x edge would be told it can
    // serve triggers and then 404.
    expect(supportsSchedules(status({ edge_api_version: '1.9.9' }))).toBe(false);
    expect(supportsSchedules(status({ edge_api_version: '1.10.0' }))).toBe(true);
    expect(supportsSchedules(status({ edge_api_version: '1.11.0' }))).toBe(true);
  });

  it('fails closed on garbage and on a foreign major', () => {
    expect(supportsSchedules(status({ edge_api_version: '2.10.0' }))).toBe(
      false
    );
    expect(supportsSchedules(status({ edge_api_version: '1.ten' }))).toBe(false);
  });
});

describe('supportsRunRecovery', () => {
  it('gates on the 1.15 run_recovery floor', () => {
    // Below the floor a parked run emits nothing, so a stopped stream means
    // either "still thinking" or "stuck behind a quarantined record" and this
    // client cannot tell which — the surface must say so rather than report
    // the run as healthy.
    expect(supportsRunRecovery(status({ edge_api_version: '1.14.9' }))).toBe(
      false
    );
    expect(supportsRunRecovery(status({ edge_api_version: '1.15.0' }))).toBe(
      true
    );
    expect(supportsRunRecovery(status({ edge_api_version: '1.16.0' }))).toBe(
      true
    );
  });

  it('fails closed on garbage and on a foreign major', () => {
    expect(supportsRunRecovery(status({ edge_api_version: '2.15.0' }))).toBe(
      false
    );
    expect(supportsRunRecovery(status({ edge_api_version: '1.fifteen' }))).toBe(
      false
    );
  });
});

describe('supportsAttachments', () => {
  it('gates on the 1.16 attachment-upload floor', () => {
    // Below the floor there is nowhere to put the bytes and submitCommand
    // rejects attachment_ids outright, so the composer must not offer an
    // attach affordance it can only fail after the user picked a file.
    expect(supportsAttachments(status({ edge_api_version: '1.15.9' }))).toBe(
      false
    );
    expect(supportsAttachments(status({ edge_api_version: '1.16.0' }))).toBe(
      true
    );
    expect(supportsAttachments(status({ edge_api_version: '1.17.0' }))).toBe(
      true
    );
  });

  it('fails closed on garbage and on a foreign major', () => {
    expect(supportsAttachments(status({ edge_api_version: '2.16.0' }))).toBe(
      false
    );
    expect(supportsAttachments(status({ edge_api_version: '1.sixteen' }))).toBe(
      false
    );
  });
});
