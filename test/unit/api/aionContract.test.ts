import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  decodeProjectEvent,
  encodeProjectEvent,
  isKnownProjectEventKind,
  parseProjectEventJSON,
} from '@/api/aion/v1/contracts';

const fixtureRoot = resolve(
  process.cwd(),
  'test/fixtures/aion/eigent/v1'
);

function readFixture(name: string): string {
  return readFileSync(resolve(fixtureRoot, name), 'utf8');
}

const manifest = JSON.parse(readFixture('manifest.json')) as {
  events: string[];
};

describe('aion public Project event contract', () => {
  it('covers every golden event fixture the manifest lists', () => {
    expect(manifest.events.length).toBeGreaterThanOrEqual(9);
  });

  it.each(manifest.events)('decodes the golden fixture %s', (name) => {
    const event = parseProjectEventJSON(readFixture(name));
    expect(isKnownProjectEventKind(event.kind)).toBe(true);
  });

  it('preserves additive fields through decode and re-encode', () => {
    const event = parseProjectEventJSON(
      readFixture('event_run_accepted.json')
    );
    expect(event.future_extension).toEqual({ must_survive_decode: true });
    expect(JSON.parse(encodeProjectEvent(event))).toHaveProperty(
      'future_extension.must_survive_decode',
      true
    );
  });

  it('passes unknown kind and visibility through (additive evolution)', () => {
    const future = {
      ...JSON.parse(readFixture('event_run_accepted.json')),
      kind: 'hologram_created',
      visibility: 'operator',
      schema_version: '1.7',
    };
    const event = decodeProjectEvent(future);
    expect(event.kind).toBe('hologram_created');
    expect(isKnownProjectEventKind(event.kind)).toBe(false);
    expect(event.visibility).toBe('operator');
  });

  it('rejects a schema major version newer than this client', () => {
    const breaking = {
      ...JSON.parse(readFixture('event_run_accepted.json')),
      schema_version: '2.0',
    };
    expect(() => decodeProjectEvent(breaking)).toThrow('schema_version');
  });

  it('rejects a malformed event before reducer dispatch', () => {
    expect(() => decodeProjectEvent({ kind: 'text_delta' })).toThrow(
      'event_id'
    );
  });
});
