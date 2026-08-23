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

// M5 (FR-005) — the PURE affordability + stress calculator. It is INDICATIVE
// (MCOB 11.6.2R — never a guaranteed max), adviser-only, and the whole working
// is retained so a suitability file / SAR can reproduce it. The number path is
// integer pence with NO float: all amortisation runs on BigInt fixed-point at a
// fixed SCALE, so the same inputs give byte-identical pence on every machine.
// Every output is clamped >= 0 and can never be NaN.

import type {
  AffordabilityAssessment,
  AffordabilityInput,
  InputProvenance,
  WorkingStep,
} from '../agentContracts/criteriaAffordability';
import { CRITERIA_SURFACE_CLASS } from '../agentContracts/criteriaAffordability';
import {
  asRecord,
  ContractDecodeError,
  requireNumber,
  requireString,
} from '../agentContracts/errors';

// Fixed-point scale for the amortisation (1e12). Chosen so a monthly rate and
// its (1+r)^n growth keep ample significant digits without BigInt overflow at
// realistic term lengths (n <= 480 months).
const SCALE = 1_000_000_000_000n;
const BPS_PER_UNIT = 10_000n; // basis points → ratio denominator
const MONTHS_PER_YEAR = 12n;

// Round-half-up integer division for non-negative numerator/denominator.
function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) return 0n;
  return (numerator + denominator / 2n) / denominator;
}

// The monthly interest rate as a SCALE-fixed integer: annualBps/10000/12.
function monthlyRateScaled(annualBps: number): bigint {
  const bps = BigInt(Math.max(0, Math.round(annualBps)));
  return (bps * SCALE) / (BPS_PER_UNIT * MONTHS_PER_YEAR);
}

// (1+r)^n as a SCALE-fixed integer, by repeated fixed-point multiply. Pure
// integer arithmetic ⇒ deterministic and cross-platform identical.
function growthScaled(rScaled: bigint, n: number): bigint {
  const onePlusR = SCALE + rScaled;
  let acc = SCALE; // 1.0
  for (let i = 0; i < n; i += 1) {
    acc = (acc * onePlusR) / SCALE;
  }
  return acc;
}

// Standard amortised monthly payment for a principal, in pence. rate=0 → P/n.
function monthlyPaymentPence(
  principalPence: bigint,
  annualBps: number,
  months: number
): bigint {
  if (principalPence <= 0n || months <= 0) return 0n;
  const r = monthlyRateScaled(annualBps);
  if (r === 0n) return divRoundHalfUp(principalPence, BigInt(months));
  const acc = growthScaled(r, months);
  // M = P * r * (1+r)^n / ((1+r)^n - 1); r and acc are SCALE-fixed.
  const numerator = principalPence * r * acc;
  const denominator = (acc - SCALE) * SCALE;
  return divRoundHalfUp(numerator, denominator);
}

// Invert the amortisation: the largest principal whose payment at annualBps over
// `months` does not exceed `paymentPence`. rate=0 → payment*n.
function maxPrincipalForPayment(
  paymentPence: bigint,
  annualBps: number,
  months: number
): bigint {
  if (paymentPence <= 0n || months <= 0) return 0n;
  const r = monthlyRateScaled(annualBps);
  if (r === 0n) return paymentPence * BigInt(months);
  const acc = growthScaled(r, months);
  // P = M * ((1+r)^n - 1) / (r * (1+r)^n).
  const numerator = paymentPence * (acc - SCALE) * SCALE;
  const denominator = r * acc;
  return divRoundHalfUp(numerator, denominator);
}

function pickPence(
  inputs: readonly AffordabilityInput[],
  key: string
): bigint | null {
  const found = inputs.find((i) => i.key === key);
  if (!found || typeof found.valuePence !== 'number') return null;
  if (!Number.isFinite(found.valuePence)) return null;
  return BigInt(Math.round(found.valuePence));
}

function pickNumber(
  inputs: readonly AffordabilityInput[],
  key: string
): number | null {
  const found = inputs.find((i) => i.key === key);
  const raw = found?.value;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (
    typeof raw === 'string' &&
    raw.trim() !== '' &&
    Number.isFinite(Number(raw))
  ) {
    return Number(raw);
  }
  return null;
}

const clampPence = (v: bigint): number => Number(v < 0n ? 0n : v);

/**
 * Compute an indicative affordability + stress assessment (FR-005). Reads named
 * inputs (annualIncomePence, monthlyCommitmentsPence, termYears, rateBps,
 * incomeMultiple); max borrow is the LOWER of the income-multiple cap and the
 * stressed-affordability figure; monthly is shown at both the product rate and
 * the stress rate. Pure, integer-pence, clamped >= 0, never NaN.
 */
export function computeAffordability(
  inputs: readonly AffordabilityInput[],
  stressRateBps: number
): AffordabilityAssessment {
  const annualIncome = pickPence(inputs, 'annualIncomePence') ?? 0n;
  const monthlyCommitments = pickPence(inputs, 'monthlyCommitmentsPence') ?? 0n;
  const termYears = Math.max(
    0,
    Math.round(pickNumber(inputs, 'termYears') ?? 0)
  );
  const rateBps = Math.max(0, Math.round(pickNumber(inputs, 'rateBps') ?? 0));
  const incomeMultiple = pickNumber(inputs, 'incomeMultiple') ?? 0;
  const months = termYears * 12;
  const safeStressBps = Math.max(0, Math.round(stressRateBps));

  // 1) income-multiple (LTI) cap: annual income × multiple, in pence.
  const lentByLti = BigInt(
    Math.round(Number(annualIncome) * Math.max(0, incomeMultiple))
  );

  // 2) stressed affordability: monthly disposable backs out a max principal at
  //    the STRESS rate (the conservative one).
  const monthlyDisposable = annualIncome / MONTHS_PER_YEAR - monthlyCommitments;
  const lentByAffordability =
    monthlyDisposable > 0n
      ? maxPrincipalForPayment(monthlyDisposable, safeStressBps, months)
      : 0n;

  // 3) the indicative max borrow is the lower of the two, clamped >= 0.
  const maxBorrow =
    lentByLti < lentByAffordability ? lentByLti : lentByAffordability;
  const maxBorrowClamped = maxBorrow < 0n ? 0n : maxBorrow;

  const monthlyAtRate = monthlyPaymentPence(maxBorrowClamped, rateBps, months);
  const monthlyAtStress = monthlyPaymentPence(
    maxBorrowClamped,
    safeStressBps,
    months
  );

  const working: WorkingStep[] = [
    {
      label: 'Annual income',
      expression: 'annualIncomePence',
      resultPence: clampPence(annualIncome),
      note: 'as-entered; provenance carried per-input',
    },
    {
      label: 'Monthly disposable',
      expression: 'annualIncomePence / 12 - monthlyCommitmentsPence',
      resultPence: clampPence(monthlyDisposable),
    },
    {
      label: 'Max borrow by income multiple (LTI)',
      expression: `annualIncomePence x ${incomeMultiple}`,
      resultPence: clampPence(lentByLti),
    },
    {
      label: 'Max borrow by stressed affordability',
      expression: `principal whose payment at stress ${safeStressBps}bps over ${months} months = monthly disposable`,
      resultPence: clampPence(lentByAffordability),
      note: 'BigInt fixed-point amortisation, round half-up',
    },
    {
      label: 'Indicative max borrow (lower of the two)',
      expression: 'min(LTI cap, stressed affordability)',
      resultPence: clampPence(maxBorrowClamped),
      note: 'indicative only — not a guaranteed lender decision',
    },
    {
      label: 'Monthly at product rate',
      expression: `payment(maxBorrow, ${rateBps}bps, ${months} months)`,
      resultPence: clampPence(monthlyAtRate),
    },
    {
      label: 'Monthly at stress rate',
      expression: `payment(maxBorrow, ${safeStressBps}bps, ${months} months)`,
      resultPence: clampPence(monthlyAtStress),
    },
  ];

  return {
    kind: 'lm.affordability.assessment/1',
    caseId: '',
    indicative: true,
    surfaceClass: CRITERIA_SURFACE_CLASS,
    inputs: inputs.map((i) => ({ ...i })),
    working,
    results: {
      maxBorrowPence: clampPence(maxBorrowClamped),
      monthlyAtRatePence: clampPence(monthlyAtRate),
      monthlyAtStressPence: clampPence(monthlyAtStress),
      stressRateBps: safeStressBps,
    },
  };
}

function decodeInput(value: unknown, label: string): AffordabilityInput {
  const object = asRecord(value, label);
  const key = requireString(object, label, 'key');
  const provenance = object.provenance;
  if (provenance !== 'det' && provenance !== 'syn') {
    throw new ContractDecodeError(
      `${label}.provenance`,
      "must be 'det' or 'syn'",
      provenance
    );
  }
  const input: AffordabilityInput = {
    key,
    provenance: provenance as InputProvenance,
  };
  if (object.valuePence !== undefined) {
    if (
      typeof object.valuePence !== 'number' ||
      !Number.isFinite(object.valuePence)
    ) {
      throw new ContractDecodeError(
        `${label}.valuePence`,
        'must be a finite number when present',
        object.valuePence
      );
    }
    input.valuePence = object.valuePence;
  }
  if (object.value !== undefined) {
    if (typeof object.value !== 'string' && typeof object.value !== 'number') {
      throw new ContractDecodeError(
        `${label}.value`,
        'must be a string or number when present',
        object.value
      );
    }
    input.value = object.value as string | number;
  }
  if (object.sourceRef !== undefined) {
    input.sourceRef = requireString(object, label, 'sourceRef');
  }
  return input;
}

function decodeWorkingStep(value: unknown, label: string): WorkingStep {
  const object = asRecord(value, label);
  const step: WorkingStep = {
    label: requireString(object, label, 'label'),
    expression: requireString(object, label, 'expression'),
  };
  if (object.resultPence !== undefined) {
    if (
      typeof object.resultPence !== 'number' ||
      !Number.isFinite(object.resultPence)
    ) {
      throw new ContractDecodeError(
        `${label}.resultPence`,
        'must be a finite number when present',
        object.resultPence
      );
    }
    step.resultPence = object.resultPence;
  }
  if (object.note !== undefined)
    step.note = requireString(object, label, 'note');
  return step;
}

/**
 * Decode + validate an lm.affordability.assessment/1 (FR-005). Enforces the
 * indicative + adviser-only spine structurally: indicative must be literally
 * true, surfaceClass must be adviser-only, and the four result figures must be
 * finite numbers (pence + bps).
 */
export function decodeAffordabilityAssessment(
  value: unknown
): AffordabilityAssessment {
  const object = asRecord(value, 'AffordabilityAssessment');
  if (object.kind !== 'lm.affordability.assessment/1') {
    throw new ContractDecodeError(
      'AffordabilityAssessment.kind',
      "must be 'lm.affordability.assessment/1'",
      object.kind
    );
  }
  const caseId = requireString(object, 'AffordabilityAssessment', 'caseId');
  if (object.indicative !== true) {
    throw new ContractDecodeError(
      'AffordabilityAssessment.indicative',
      'must be literally true (never a guaranteed max)',
      object.indicative
    );
  }
  if (object.surfaceClass !== CRITERIA_SURFACE_CLASS) {
    throw new ContractDecodeError(
      'AffordabilityAssessment.surfaceClass',
      `must be '${CRITERIA_SURFACE_CLASS}'`,
      object.surfaceClass
    );
  }
  if (!Array.isArray(object.inputs)) {
    throw new ContractDecodeError(
      'AffordabilityAssessment.inputs',
      'must be an array',
      object.inputs
    );
  }
  if (!Array.isArray(object.working)) {
    throw new ContractDecodeError(
      'AffordabilityAssessment.working',
      'must be an array',
      object.working
    );
  }
  const inputs = object.inputs.map((i, idx) =>
    decodeInput(i, `AffordabilityAssessment.inputs[${idx}]`)
  );
  const working = object.working.map((w, idx) =>
    decodeWorkingStep(w, `AffordabilityAssessment.working[${idx}]`)
  );
  const resultsObject = asRecord(
    object.results,
    'AffordabilityAssessment.results'
  );
  const results = {
    maxBorrowPence: requireNumber(resultsObject, 'results', 'maxBorrowPence'),
    monthlyAtRatePence: requireNumber(
      resultsObject,
      'results',
      'monthlyAtRatePence'
    ),
    monthlyAtStressPence: requireNumber(
      resultsObject,
      'results',
      'monthlyAtStressPence'
    ),
    stressRateBps: requireNumber(resultsObject, 'results', 'stressRateBps'),
  };
  const out: AffordabilityAssessment = {
    kind: 'lm.affordability.assessment/1',
    caseId,
    indicative: true,
    surfaceClass: CRITERIA_SURFACE_CLASS,
    inputs,
    working,
    results,
  };
  if (object.productSnapshotRef !== undefined) {
    out.productSnapshotRef = requireString(
      object,
      'AffordabilityAssessment',
      'productSnapshotRef'
    );
  }
  return out;
}
