// Public edge contract owned by api/eigent/v1 in aion-v1. This module is
// provider-neutral by construction: the desktop selects only a model alias and
// never accepts provider credentials, routes, grants, or internal endpoints.

export const PROJECT_EVENT_SCHEMA_VERSION = '1.0' as const;

export const ProjectEventKind = {
  RUN_ACCEPTED: 'run_accepted',
  TEXT_DELTA: 'text_delta',
  TOOL_CALL: 'tool_call',
  TOOL_RESULT: 'tool_result',
  APPROVAL_REQUIRED: 'approval_required',
  APPROVAL_RESOLVED: 'approval_resolved',
  ARTIFACT_CREATED: 'artifact_created',
  RUN_COMPLETED: 'run_completed',
  RUN_FAILED: 'run_failed',
} as const;

export type ProjectEventKindValue =
  (typeof ProjectEventKind)[keyof typeof ProjectEventKind];

// kind and visibility are OPEN sets: the event schema is additive-only, so a
// server newer than this client may emit values outside the known unions.
// Decode passes them through; rendering must treat an unknown kind as opaque
// and an unknown visibility as 'internal' (never show it to the user).
export type ProjectEventKindWire = ProjectEventKindValue | (string & {});
export type ProjectEventVisibility =
  | 'user'
  | 'internal'
  | 'audit'
  | (string & {});

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
  'run_id',
  'sequence',
  'kind',
  'visibility',
  'occurred_at',
] as const;

const eventKinds = new Set<string>(Object.values(ProjectEventKind));
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
