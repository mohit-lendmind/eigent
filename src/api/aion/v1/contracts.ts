// Public edge contract owned by api/eigent/v1 in aion-v1. This module is
// provider-neutral by construction: the desktop selects only a model alias and
// never accepts provider credentials, routes, grants, or internal endpoints.
//
// The known-value sets and version tuple come from the generated contract
// metadata (gen/meta.ts, produced by `pnpm gen:aion-edge` from the mirrored
// openapi.yaml) so this module cannot drift from the synced contract version.

import {
  EVENT_SCHEMA_VERSION,
  KNOWN_EVENT_VISIBILITIES,
  KNOWN_PROJECT_EVENT_KINDS,
  type KnownEventVisibility,
  type KnownProjectEventKind,
} from './gen/meta';

export const PROJECT_EVENT_SCHEMA_VERSION = EVENT_SCHEMA_VERSION;

// Re-exported for rendering policy; decode itself never gates on either set
// (both are open).
export { KNOWN_EVENT_VISIBILITIES, KNOWN_PROJECT_EVENT_KINDS };

export type ProjectEventKindValue = KnownProjectEventKind;

// kind and visibility are OPEN sets: the event schema is additive-only, so a
// server newer than this client may emit values outside the known unions.
// Decode passes them through; rendering must treat an unknown kind as opaque
// and an unknown visibility as 'internal' (never show it to the user).
export type ProjectEventKindWire = ProjectEventKindValue | (string & {});
export type ProjectEventVisibility = KnownEventVisibility | (string & {});

export interface ProjectEvent extends Record<string, unknown> {
  event_id: string;
  schema_version: string;
  project_id: string;
  run_id: string;
  sequence: string;
  kind: ProjectEventKindWire;
  visibility: ProjectEventVisibility;
  occurred_at: string;
  correlation?: Record<string, unknown>;
  data: Record<string, unknown>;
}

export function isKnownProjectEventKind(
  kind: string
): kind is ProjectEventKindValue {
  return eventKinds.has(kind);
}

const requiredStringFields = [
  'event_id',
  'schema_version',
  'project_id',
  'sequence',
  'kind',
  'visibility',
  'occurred_at',
] as const;

const eventKinds = new Set<string>(KNOWN_PROJECT_EVENT_KINDS);
const supportedMajor = PROJECT_EVENT_SCHEMA_VERSION.split('.')[0] + '.';

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

/**
 * Decodes the stable event spine while retaining every additive field. The
 * returned object is the original JSON shape with validated known fields, so a
 * queue/replay/re-encode operation cannot silently discard future data.
 */
export function decodeProjectEvent(value: unknown): ProjectEvent {
  const object = asRecord(value, 'ProjectEvent');
  for (const field of requiredStringFields) {
    if (typeof object[field] !== 'string' || object[field].length === 0) {
      throw new TypeError(`ProjectEvent.${field} must be a non-empty string`);
    }
  }
  // run_id must be present but may be EMPTY: an event recorded before any
  // run exists (an attachment uploaded into a project) is project-scoped.
  if (typeof object.run_id !== 'string') {
    throw new TypeError('ProjectEvent.run_id must be a string');
  }
  // Only the schema MAJOR version is a compatibility boundary; unknown kind
  // and visibility values decode fine (see the open-set types above).
  if (!(object.schema_version as string).startsWith(supportedMajor)) {
    throw new TypeError(
      `ProjectEvent.schema_version ${object.schema_version} is not supported (want ${supportedMajor}x)`
    );
  }
  asRecord(object.data, 'ProjectEvent.data');
  if (object.correlation !== undefined) {
    asRecord(object.correlation, 'ProjectEvent.correlation');
  }
  return { ...object } as ProjectEvent;
}

export function parseProjectEventJSON(raw: string): ProjectEvent {
  return decodeProjectEvent(JSON.parse(raw) as unknown);
}

export function encodeProjectEvent(event: ProjectEvent): string {
  return JSON.stringify(event);
}
