// Safe version negotiation for the remote-backend product path (doc 10 §12
// diagnostics/updates row). The verdict is computed from the edge's status
// handshake BEFORE any project traffic; an incompatible pairing must fail
// visibly with an actionable message — never degrade into undefined behavior
// or fall back to the local brain. Within one major version the contract is
// additive in both directions (the N/N-1 matrix), so only a major mismatch
// or a desktop below the backend's floor is a hard incompatibility; a
// version string this build cannot parse fails closed.

import {
  DESKTOP_CLIENT_VERSION,
  EDGE_API_VERSION,
  EVENT_SCHEMA_VERSION,
} from './gen/meta';
import type { IntegrationStatus } from './transport';

export type CompatibilityVerdict =
  | { compatible: true }
  | { compatible: false; reason: string };

export class IncompatibleBackendError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'IncompatibleBackendError';
  }
}

// Numeric core of a dotted version ("1.0.2-rc.1" → [1,0,2]); null when any
// core segment is non-numeric.
function versionCore(version: string): number[] | null {
  const parts = version.split('-', 1)[0].split('.');
  const core: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return null;
    }
    core.push(Number(part));
  }
  return core.length > 0 ? core : null;
}

function lessThan(a: number[], b: number[]): boolean {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) {
      return x < y;
    }
  }
  return false;
}

export function negotiateCompatibility(
  status: IntegrationStatus
): CompatibilityVerdict {
  const serverEdge = versionCore(status.edge_api_version);
  const serverSchema = versionCore(status.event_schema_version);
  const minimumDesktop = versionCore(status.minimum_desktop_version);
  const client = versionCore(DESKTOP_CLIENT_VERSION);
  const clientEdge = versionCore(EDGE_API_VERSION);
  const clientSchema = versionCore(EVENT_SCHEMA_VERSION);
  if (
    !serverEdge ||
    !serverSchema ||
    !minimumDesktop ||
    !client ||
    !clientEdge ||
    !clientSchema
  ) {
    return {
      compatible: false,
      reason:
        `The backend reported a version this build cannot parse ` +
        `(edge API "${status.edge_api_version}", event schema ` +
        `"${status.event_schema_version}", minimum desktop ` +
        `"${status.minimum_desktop_version}"). Refusing to run against an ` +
        `unrecognized backend.`,
    };
  }
  if (lessThan(client, minimumDesktop)) {
    return {
      compatible: false,
      reason:
        `This Eigent build (v${DESKTOP_CLIENT_VERSION}) is older than the ` +
        `backend supports (minimum v${status.minimum_desktop_version}). ` +
        `Update Eigent to reconnect.`,
    };
  }
  if (serverEdge[0] !== clientEdge[0]) {
    return {
      compatible: false,
      reason:
        `The backend speaks edge API ${status.edge_api_version} but this ` +
        `Eigent build understands ${EDGE_API_VERSION}; the major versions ` +
        `differ, so update the older side to continue.`,
    };
  }
  if (serverSchema[0] !== clientSchema[0]) {
    return {
      compatible: false,
      reason:
        `The backend emits event schema ${status.event_schema_version} but ` +
        `this Eigent build reads schema ${EVENT_SCHEMA_VERSION}. Update ` +
        `Eigent to continue.`,
    };
  }
  return { compatible: true };
}

// The skills routes shipped in edge API 1.4.0. Within the shared major the
// contract is additive, so a minor-version floor is the per-feature gate: an
// older (still compatible) edge simply lacks the surface and the Skills
// screen renders a visible read-only "backend too old" state — never a
// guessed 404 loop. The minor floor only means anything inside a compatible
// pairing: a major-mismatched edge (say 2.1) clears [1,4] numerically while
// speaking a contract this build cannot, so the full verdict gates first.
const SKILLS_MINIMUM_EDGE = [1, 4];

// Readable usage counters shipped in 1.5.0. This floor is what stops the Skills
// screen from reading "no counters came back" as "never used": a 1.4 edge
// ignores the unknown `usage` query param and answers rows without counters
// either way, so absence only carries meaning above the floor.
const SKILL_USAGE_MINIMUM_EDGE = [1, 5];

// The project list shipped in edge API 1.6.0. Below the floor the desktop has
// no way to enumerate a tenant's Projects, so the Home list must say so rather
// than render an empty list — "you have no projects" and "this backend cannot
// tell me your projects" are opposite facts.
const PROJECT_LIST_MINIMUM_EDGE = [1, 6];

// The usage route shipped in edge API 1.7.0. Below the floor the desktop has
// no bill to read at all, which is not the same fact as a bill of zero — so
// the cost surface must say the backend cannot report spend rather than show
// a confident $0.00.
const USAGE_MINIMUM_EDGE = [1, 7];

// Typed subagent lifecycle shipped in edge API 1.8.0. Below the floor the
// worker events exist but are retained at internal visibility, which the
// reducer drops — so a run really did fan out and this backend cannot say so.
// The distinction the UI owes the user is "no workers" versus "this backend
// cannot report workers", and only the floor tells them apart.
const WORKFORCE_MINIMUM_EDGE = [1, 8];

// The connector routes shipped in edge API 1.9.0. Below the floor there is no
// catalog to read, which the Connections screen must state — an empty list
// would claim this tenant has no integrations, and a 404 from the auth route
// would be indistinguishable from an unknown connector.
const CONNECTORS_MINIMUM_EDGE = [1, 9];

// The schedule routes shipped in edge API 1.10.0. Below the floor the triggers
// exist in the store and fire, and this desktop simply cannot see them — so the
// screen must say the backend cannot report triggers. An empty list would claim
// nothing is scheduled, which for a trigger surface is the one wrong answer:
// the failure this screen exists to catch is a trigger that stopped firing.
const SCHEDULES_MINIMUM_EDGE = [1, 10];

// The account and key routes shipped in edge API 1.11.0. Below the floor a
// key can still be pasted and used — every other route works — so this floor
// gates only the Account panel: the desktop cannot show which key it is
// holding, cannot list the tenant's other keys, and must say so rather than
// render a key manager whose every action 404s.
const ACCOUNT_MINIMUM_EDGE = [1, 11];

// The memory routes shipped in edge API 1.12.0. Below the floor the agent still
// remembers across sessions — the cell has served these RPCs all along — and
// nothing above it can read or forget any of it. An empty list would claim the
// agent remembers nothing about you, which is the one answer a memory screen
// must never give when it simply cannot see.
const MEMORY_MINIMUM_EDGE = [1, 12];

// The artifact listing shipped in edge API 1.13.0. Below the floor an artifact
// is reachable only by the client that watched its artifact_created event go
// by, so a session reopened later can download nothing it produced earlier.
// The single-artifact fetch predates this floor and stays available, which is
// why this gates the listing rather than the whole artifact surface.
const ARTIFACT_LIST_MINIMUM_EDGE = [1, 13];

function meetsEdgeFloor(status: IntegrationStatus, floor: number[]): boolean {
  if (!negotiateCompatibility(status).compatible) {
    return false;
  }
  const serverEdge = versionCore(status.edge_api_version);
  return serverEdge !== null && !lessThan(serverEdge, floor);
}

export function supportsSkills(status: IntegrationStatus): boolean {
  return meetsEdgeFloor(status, SKILLS_MINIMUM_EDGE);
}

export function supportsSkillUsage(status: IntegrationStatus): boolean {
  return meetsEdgeFloor(status, SKILL_USAGE_MINIMUM_EDGE);
}

export function supportsProjectList(status: IntegrationStatus): boolean {
  return meetsEdgeFloor(status, PROJECT_LIST_MINIMUM_EDGE);
}

export function supportsUsage(status: IntegrationStatus): boolean {
  return meetsEdgeFloor(status, USAGE_MINIMUM_EDGE);
}

export function supportsWorkforceEvents(status: IntegrationStatus): boolean {
  return meetsEdgeFloor(status, WORKFORCE_MINIMUM_EDGE);
}

export function supportsConnectors(status: IntegrationStatus): boolean {
  return meetsEdgeFloor(status, CONNECTORS_MINIMUM_EDGE);
}

export function supportsSchedules(status: IntegrationStatus): boolean {
  return meetsEdgeFloor(status, SCHEDULES_MINIMUM_EDGE);
}

export function supportsAccount(status: IntegrationStatus): boolean {
  return meetsEdgeFloor(status, ACCOUNT_MINIMUM_EDGE);
}

export function supportsMemory(status: IntegrationStatus): boolean {
  return meetsEdgeFloor(status, MEMORY_MINIMUM_EDGE);
}

export function supportsArtifactList(status: IntegrationStatus): boolean {
  return meetsEdgeFloor(status, ARTIFACT_LIST_MINIMUM_EDGE);
}
