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

// FR-004 — spend accounting and the two limits that bound an agent. The edge
// reports a run's cost in micro-USD; the firm budgets in micro-GBP, so every
// SpendRecord carries the STATIC firm-config FX rate and its effective date and
// derives the GBP figure from them. A later rate change never rewrites past
// spend because the rate that produced each figure is stamped on it.
//
// All money is bigint: a micro-USD 64-bit figure divided by a rate must not
// round through a float. The rate itself is a small integer (USD-per-GBP × 1e6)
// and is the only place a Number appears.
//
// Two limits guard a pass: the per-case breaker (max invocations per rolling
// hour, default 12) refuses a case that has already been touched too often;
// the per-pass budget (default £0.02) stops a pass that has spent its envelope.

import {
  FX_EFFECTIVE_DATE_DEFAULT,
  FX_USD_PER_GBP_MICRO_DEFAULT,
} from '../agentContracts';
import type { SpendRecord } from './types';

const HOUR_MS = 60 * 60 * 1000;

/**
 * micro-USD → micro-GBP against a static rate. `fxUsdPerGbpMicro` is USD per
 * GBP in millionths, so GBP = USD ÷ (rate ÷ 1e6) = USD × 1e6 ÷ rate. Integer
 * division truncates toward zero — a sub-micro-penny is dropped, never rounded
 * up into spend that was not incurred. A non-positive rate is treated as the
 * default rather than dividing by zero.
 */
export function usdMicroToGbpMicro(
  costMicroUsd: bigint,
  fxUsdPerGbpMicro: number
): bigint {
  const rate =
    Number.isFinite(fxUsdPerGbpMicro) && fxUsdPerGbpMicro > 0
      ? fxUsdPerGbpMicro
      : FX_USD_PER_GBP_MICRO_DEFAULT;
  return (costMicroUsd * 1_000_000n) / BigInt(rate);
}

export interface SpendInput {
  passId: string;
  runId: string;
  caseId?: string;
  costMicroUsd: bigint;
  providerCalls: number;
  fxUsdPerGbpMicro?: number;
  fxEffectiveDate?: string;
  at?: number;
}

/** Stamps the rate + effective date and derives the GBP figure. */
export function buildSpendRecord(input: SpendInput): SpendRecord {
  const fxUsdPerGbpMicro =
    input.fxUsdPerGbpMicro ?? FX_USD_PER_GBP_MICRO_DEFAULT;
  const fxEffectiveDate = input.fxEffectiveDate ?? FX_EFFECTIVE_DATE_DEFAULT;
  return {
    passId: input.passId,
    ...(input.caseId !== undefined ? { caseId: input.caseId } : {}),
    runId: input.runId,
    costMicroUsd: input.costMicroUsd.toString(),
    fxUsdPerGbpMicro,
    fxEffectiveDate,
    costMicroGbp: usdMicroToGbpMicro(
      input.costMicroUsd,
      fxUsdPerGbpMicro
    ).toString(),
    providerCalls: input.providerCalls,
    at: input.at ?? Date.now(),
  };
}

/**
 * A rolling-hour invocation breaker, per case. `tryConsume` records an
 * invocation and returns whether it was ADMITTED — false once a case has hit
 * its ceiling within the last hour, which is a trip, not an error. Timestamps
 * older than an hour are pruned on each read so the window slides.
 */
export class CaseBreaker {
  private readonly maxPerHour: number;
  private readonly hits = new Map<string, number[]>();

  constructor(maxPerHour: number) {
    this.maxPerHour = maxPerHour > 0 ? maxPerHour : 1;
  }

  private live(caseId: string, now: number): number[] {
    const cutoff = now - HOUR_MS;
    const kept = (this.hits.get(caseId) ?? []).filter((t) => t > cutoff);
    this.hits.set(caseId, kept);
    return kept;
  }

  /** How many invocations this case has had in the last hour. */
  countInHour(caseId: string, now: number = Date.now()): number {
    return this.live(caseId, now).length;
  }

  /** True if a further invocation would exceed the ceiling (a trip). */
  wouldTrip(caseId: string, now: number = Date.now()): boolean {
    return this.live(caseId, now).length >= this.maxPerHour;
  }

  /** Records an invocation; returns false (a trip) if the case is at its cap. */
  tryConsume(caseId: string, now: number = Date.now()): boolean {
    const kept = this.live(caseId, now);
    if (kept.length >= this.maxPerHour) return false;
    kept.push(now);
    this.hits.set(caseId, kept);
    return true;
  }
}

/**
 * A single pass's micro-GBP envelope. `tryDebit` adds a cost and returns
 * whether it fit; once the running total would exceed the limit the debit is
 * refused (the pass stops) and the total is left untouched.
 */
export class PassBudget {
  private readonly limitMicroGbp: bigint;
  private spentMicroGbp = 0n;

  constructor(limitMicroGbp: bigint) {
    this.limitMicroGbp = limitMicroGbp;
  }

  get spent(): bigint {
    return this.spentMicroGbp;
  }

  get remaining(): bigint {
    const left = this.limitMicroGbp - this.spentMicroGbp;
    return left > 0n ? left : 0n;
  }

  tryDebit(costMicroGbp: bigint): boolean {
    if (this.spentMicroGbp + costMicroGbp > this.limitMicroGbp) return false;
    this.spentMicroGbp += costMicroGbp;
    return true;
  }
}
