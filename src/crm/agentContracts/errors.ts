// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

// Typed decode refusal for the agent-contract layer. Mirrors the house
// `problems.ts` error style (named class, message assembled from fields), but
// carries the field path and a bounded snippet of the offending value so a
// decode failure is diagnosable in an audit trail without dumping the whole
// (possibly large, possibly sensitive) document into the message.

const MAX_SNIPPET = 200;

function snippet(value: unknown): string {
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (text === undefined) text = String(value);
  return text.length > MAX_SNIPPET ? `${text.slice(0, MAX_SNIPPET)}…` : text;
}

/** A decode-time contract violation naming the field, reason, and a value snippet. */
export class ContractDecodeError extends Error {
  readonly field: string;
  readonly reason: string;
  readonly valueSnippet: string;

  constructor(field: string, reason: string, value: unknown) {
    const valueSnippet = snippet(value);
    super(`${field}: ${reason} (got: ${valueSnippet})`);
    this.name = 'ContractDecodeError';
    this.field = field;
    this.reason = reason;
    this.valueSnippet = valueSnippet;
  }
}

export function asRecord(
  value: unknown,
  label: string
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ContractDecodeError(label, 'must be a JSON object', value);
  }
  return value as Record<string, unknown>;
}

export function requireString(
  object: Record<string, unknown>,
  label: string,
  field: string
): string {
  const value = object[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ContractDecodeError(
      `${label}.${field}`,
      'must be a non-empty string',
      value
    );
  }
  return value;
}

export function requireNumber(
  object: Record<string, unknown>,
  label: string,
  field: string
): number {
  const value = object[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ContractDecodeError(
      `${label}.${field}`,
      'must be a finite number',
      value
    );
  }
  return value;
}
