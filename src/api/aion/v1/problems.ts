// RFC 9457 problem details as the aion edge emits them (contract
// components.schemas.Problem). Pure decode — no I/O, no rendering policy.

import type { components } from './gen/edge-api';

export type EdgeProblem = components['schemas']['Problem'];

export interface CursorExpiredProblem extends EdgeProblem {
  code: 'cursor_expired';
  minimum_sequence: string;
  high_water_sequence: string;
}

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

/**
 * Decodes a problem document while retaining every additive field. Required
 * fields follow the contract: type, title, status, code, trace_id.
 */
export function decodeProblem(value: unknown): EdgeProblem {
  const object = asRecord(value, 'Problem');
  for (const field of ['type', 'title', 'code', 'trace_id'] as const) {
    if (typeof object[field] !== 'string' || object[field].length === 0) {
      throw new TypeError(`Problem.${field} must be a non-empty string`);
    }
  }
  if (typeof object.status !== 'number') {
    throw new TypeError('Problem.status must be a number');
  }
  return { ...object } as EdgeProblem;
}

export function parseProblemJSON(raw: string): EdgeProblem {
  return decodeProblem(JSON.parse(raw) as unknown);
}

/**
 * A typed cursor-expiry refusal (410): the cursor is below the retention
 * floor. Recovery is a snapshot rehydrate, then resume strictly after the
 * snapshot's sequence — never a guessed cursor.
 */
export function isCursorExpiredProblem(
  problem: EdgeProblem
): problem is CursorExpiredProblem {
  return (
    problem.code === 'cursor_expired' &&
    typeof problem.minimum_sequence === 'string' &&
    typeof problem.high_water_sequence === 'string'
  );
}

/** A non-2xx edge response, carrying the decoded problem document. */
export class EdgeProblemError extends Error {
  readonly problem: EdgeProblem;

  constructor(problem: EdgeProblem) {
    super(`${problem.status} ${problem.code}: ${problem.title}`);
    this.name = 'EdgeProblemError';
    this.problem = problem;
  }
}
