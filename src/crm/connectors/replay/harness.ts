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

// M4 (FR-003) — the record/replay eval harness. A live run's tool_result SSE
// frames are captured verbatim ({tool_name, arguments_json, result_json}), then
// in CI the SAME frames are fed to an adapter's PURE extract() with no browser,
// login, or model in the loop. Because extract is pure, replaying a recorded
// frame is a REAL verification of the extractor, and the fixture's content hash
// is the fixtureHash a VerificationRef stands on: change the recorded bytes and
// the hash changes, so a stale or doctored fixture cannot masquerade as the one
// a canary passed against.

import {
  asRecord,
  ContractDecodeError,
  requireString,
} from '../../agentContracts';
import type { Product } from '../SourcingAdapter';

// One captured tool_result SSE frame. Field names mirror the wire event so a
// capture is a faithful copy, not a reshaped one. `result_json` is the tool's
// raw output the extractor reads; `arguments_json` records what was asked.
export interface RecordedToolResult {
  tool_name: string;
  arguments_json: string;
  result_json: string;
}

// A replay fixture: the frames one sourcing run produced, plus the rates-as-at
// the run captured. Deliberately no products inside — the whole point is to
// DERIVE them by replaying extract(), so a fixture cannot pre-bake an answer.
export interface ReplayFixture {
  adapterId: string;
  ratesAsAt: string;
  capturedAt: string;
  results: RecordedToolResult[];
}

function decodeRecordedToolResult(
  value: unknown,
  label: string
): RecordedToolResult {
  const object = asRecord(value, label);
  return {
    tool_name: requireString(object, label, 'tool_name'),
    arguments_json: requireString(object, label, 'arguments_json'),
    result_json: requireString(object, label, 'result_json'),
  };
}

/** Decode a fixture read from disk, rejecting a partial or reshaped capture. */
export function decodeReplayFixture(value: unknown): ReplayFixture {
  const object = asRecord(value, 'ReplayFixture');
  const rawResults = object.results;
  if (!Array.isArray(rawResults)) {
    throw new ContractDecodeError(
      'ReplayFixture.results',
      'must be an array of captured tool_result frames',
      rawResults
    );
  }
  return {
    adapterId: requireString(object, 'ReplayFixture', 'adapterId'),
    ratesAsAt: requireString(object, 'ReplayFixture', 'ratesAsAt'),
    capturedAt: requireString(object, 'ReplayFixture', 'capturedAt'),
    results: rawResults.map((r, i) =>
      decodeRecordedToolResult(r, `ReplayFixture.results[${i}]`)
    ),
  };
}

/** Normalize a live SSE tool_result event into a capturable frame. */
export function captureToolResult(event: {
  tool_name: string;
  arguments_json: string;
  result_json: string;
}): RecordedToolResult {
  return {
    tool_name: event.tool_name,
    arguments_json: event.arguments_json,
    result_json: event.result_json,
  };
}

// A dependency-free, deterministic 64-bit FNV-1a over the canonical JSON of the
// fixture. A content hash is all a fixtureHash needs to be: identical bytes →
// identical hash, one byte different → different hash. (Not a security digest;
// tamper-EVIDENCE for a checked-in fixture, not tamper-PROOFING.)
export function hashFixture(fixture: ReplayFixture): string {
  const canonical = JSON.stringify({
    adapterId: fixture.adapterId,
    ratesAsAt: fixture.ratesAsAt,
    capturedAt: fixture.capturedAt,
    results: fixture.results.map((r) => ({
      tool_name: r.tool_name,
      arguments_json: r.arguments_json,
      result_json: r.result_json,
    })),
  });
  let hi = 0x811c9dc5;
  let lo = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    const c = canonical.charCodeAt(i);
    hi ^= c;
    lo ^= c;
    hi = Math.imul(hi, 0x01000193) >>> 0;
    lo = Math.imul(lo, 0x01000201) >>> 0;
  }
  return (
    'fnv1a64:' +
    hi.toString(16).padStart(8, '0') +
    lo.toString(16).padStart(8, '0')
  );
}

// The minimal extractor shape the harness drives — an adapter's pure extract.
export type PureExtractor = (recordedResult: unknown) => Product[];

/**
 * Replay a fixture through a pure extractor: parse each frame's `result_json`
 * and run extract on it, concatenating the products. No browser, login, or model
 * — deterministic, so CI can assert the extractor's output frame-for-frame.
 */
export function replayExtract(
  extract: PureExtractor,
  fixture: ReplayFixture
): Product[] {
  const products: Product[] = [];
  for (let i = 0; i < fixture.results.length; i += 1) {
    const frame = fixture.results[i];
    let parsed: unknown;
    try {
      parsed = JSON.parse(frame.result_json);
    } catch {
      throw new ContractDecodeError(
        `ReplayFixture.results[${i}].result_json`,
        'must be valid JSON to replay through extract()',
        frame.result_json
      );
    }
    products.push(...extract(parsed));
  }
  return products;
}
