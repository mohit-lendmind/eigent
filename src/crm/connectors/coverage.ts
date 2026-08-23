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

// M4 (FR-008) — coverage as a typed enum + a machine-checkable wholeOfMarket
// flag. The runtime factory is the first belt: it refuses to build a coverage
// whose statement claims the market it does not cover. The check-coverage-claim
// lint gate is the second belt, scanning ALL source for the literal phrase.
// MSE's coverage is fixed by MCOB 4.4A.4R(3): "MSE Best Buys (Podium)", never
// "whole of market".

import type { Coverage, CoverageKind } from '../agentContracts';
import { SOURCING_SURFACE_CLASS } from '../agentContracts';

export { SOURCING_SURFACE_CLASS } from '../agentContracts';
export type { Coverage, CoverageKind } from '../agentContracts';

/** The surface class every sourcing snapshot carries (FR-007). Re-exported here
 * so an adapter/coverage author reaches for the one constant. */
export const ADVISER_ONLY_SURFACE = SOURCING_SURFACE_CLASS;

// The forbidden phrase, normalized (lowercased, whitespace-collapsed) so
// "Whole  of\tMarket" cannot slip past. The lint gate uses the same shape.
export const WHOLE_OF_MARKET_PHRASE = 'whole of market';

function statementClaimsWholeOfMarket(statement: string): boolean {
  const normalized = statement.toLowerCase().replace(/\s+/g, ' ');
  // The negation "not whole of market" is a DISCLAIMER, not a claim — it is the
  // exact form the MSE statement uses. The check-coverage-claim lint gate makes
  // the same exception, so the two belts agree byte-for-byte.
  if (normalized.includes(`not ${WHOLE_OF_MARKET_PHRASE}`)) return false;
  return normalized.includes(WHOLE_OF_MARKET_PHRASE);
}

/**
 * Build a Coverage, refusing an overclaim at construction: a statement that says
 * "whole of market" is only allowed when the flag is genuinely true, and a
 * true flag with a kind that is not whole-of-market is likewise refused.
 */
export function makeCoverage(
  kind: CoverageKind,
  statement: string,
  wholeOfMarket: boolean
): Coverage {
  if (statementClaimsWholeOfMarket(statement) && !wholeOfMarket) {
    throw new Error(
      `coverage overclaim: statement says "${WHOLE_OF_MARKET_PHRASE}" but wholeOfMarket is false — ${statement}`
    );
  }
  if (wholeOfMarket && kind !== 'whole-of-market') {
    throw new Error(
      `coverage mismatch: wholeOfMarket:true requires kind 'whole-of-market', got '${kind}'`
    );
  }
  return { kind, statement, wholeOfMarket };
}

// MSE Best Buys (Podium) is a curated best-buy table, not the whole market. The
// exact statement is copied verbatim into every snapshot and artifact.
export const MSE_COVERAGE_STATEMENT =
  'MSE Best Buys (Podium) — not whole of market';

export function mseCoverage(): Coverage {
  return makeCoverage('mse-best-buys', MSE_COVERAGE_STATEMENT, false);
}

export function firmPanelCoverage(statement: string): Coverage {
  return makeCoverage('firm-panel', statement, false);
}
