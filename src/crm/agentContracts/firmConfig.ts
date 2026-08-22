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

// Per-firm config (lm/config.json). Decode requires only firmId; every other
// field falls back to a documented default so a partial config is usable and a
// missing breaker/budget can never mean "unbounded".

import { asRecord, requireString } from './errors';

export interface FirmConfig extends Record<string, unknown> {
  firmId: string;
  adapters: {
    sourcing: 'mse' | 'mortgage-brain' | (string & {});
    [k: string]: unknown;
  };
  lenderPanel: readonly string[];
  feeModel: Record<string, unknown>;
  disclosureTextRefs: readonly string[];
  chaseCadences: Record<string, unknown>;
  delegationRoster: readonly {
    id: string;
    name: string;
    gates: readonly string[];
  }[];
  quietHours: { start: string; end: string; timezone: string } | null;
  breaker: { maxInvocationsPerCaseHour: number };
  budgets: { watcherPassMicroGbp: number; caseMicroGbp: number };
  // M2 additive (all optional — a config predating M2 keeps decoding). The FX
  // rate is a static firm-config number, not a live feed: watcher spend is
  // reported in USD by the edge and converted to GBP against THIS rate, stamped
  // with its effective date on every SpendRecord so a later rate change never
  // silently rewrites past spend.
  fxUsdPerGbpMicro?: number;
  fxEffectiveDate?: string;
  // The firm's watcher coordinator Project, if a firm pins it in config. When
  // absent, firmCoordinatorProject mints one on true first use and records the
  // id in the durable firm store (src/crm/firmStore.ts) so later sessions reuse
  // it — the running id lives there, not written back into this config artifact.
  coordinatorProjectId?: string;
}

// USD-per-GBP in micro units (1 GBP = 1.27 USD → 1_270_000). Static default;
// a firm overrides it in lm/config.json. Never zero — a zero rate would make
// every GBP conversion divide by zero.
export const FX_USD_PER_GBP_MICRO_DEFAULT = 1_270_000;
export const FX_EFFECTIVE_DATE_DEFAULT = '2026-01-01';

export const FIRM_CONFIG_DEFAULTS: Readonly<Partial<FirmConfig>> = {
  adapters: { sourcing: 'mse' },
  lenderPanel: [],
  feeModel: {},
  disclosureTextRefs: [],
  chaseCadences: {},
  delegationRoster: [],
  quietHours: null,
  breaker: { maxInvocationsPerCaseHour: 12 },
  budgets: { watcherPassMicroGbp: 2_000_000, caseMicroGbp: 15_000_000 },
  fxUsdPerGbpMicro: FX_USD_PER_GBP_MICRO_DEFAULT,
  fxEffectiveDate: FX_EFFECTIVE_DATE_DEFAULT,
};

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

function decodeRoster(
  value: unknown
): { id: string; name: string; gates: string[] }[] {
  if (!Array.isArray(value)) return [];
  const out: { id: string; name: string; gates: string[] }[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== 'string' || typeof row.name !== 'string') continue;
    out.push({ id: row.id, name: row.name, gates: stringArray(row.gates) });
  }
  return out;
}

function decodeQuietHours(
  value: unknown
): { start: string; end: string; timezone: string } | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.start !== 'string' ||
    typeof row.end !== 'string' ||
    typeof row.timezone !== 'string'
  ) {
    return null;
  }
  return { start: row.start, end: row.end, timezone: row.timezone };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function decodeFirmConfig(value: unknown): FirmConfig {
  const object = asRecord(value, 'FirmConfig');
  const firmId = requireString(object, 'FirmConfig', 'firmId');

  const adaptersRaw =
    object.adapters && typeof object.adapters === 'object'
      ? (object.adapters as Record<string, unknown>)
      : {};
  const adapters: FirmConfig['adapters'] = {
    ...adaptersRaw,
    sourcing:
      typeof adaptersRaw.sourcing === 'string' ? adaptersRaw.sourcing : 'mse',
  };

  const breakerRaw =
    object.breaker && typeof object.breaker === 'object'
      ? (object.breaker as Record<string, unknown>)
      : {};
  const budgetsRaw =
    object.budgets && typeof object.budgets === 'object'
      ? (object.budgets as Record<string, unknown>)
      : {};

  return {
    ...object,
    firmId,
    adapters,
    lenderPanel: stringArray(object.lenderPanel),
    feeModel:
      object.feeModel && typeof object.feeModel === 'object'
        ? (object.feeModel as Record<string, unknown>)
        : {},
    disclosureTextRefs: stringArray(object.disclosureTextRefs),
    chaseCadences:
      object.chaseCadences && typeof object.chaseCadences === 'object'
        ? (object.chaseCadences as Record<string, unknown>)
        : {},
    delegationRoster: decodeRoster(object.delegationRoster),
    quietHours: decodeQuietHours(object.quietHours),
    breaker: {
      maxInvocationsPerCaseHour: numberOr(
        breakerRaw.maxInvocationsPerCaseHour,
        12
      ),
    },
    budgets: {
      watcherPassMicroGbp: numberOr(budgetsRaw.watcherPassMicroGbp, 2_000_000),
      caseMicroGbp: numberOr(budgetsRaw.caseMicroGbp, 15_000_000),
    },
    // A non-positive rate is treated as absent: it would divide GBP by zero.
    fxUsdPerGbpMicro:
      typeof object.fxUsdPerGbpMicro === 'number' &&
      Number.isFinite(object.fxUsdPerGbpMicro) &&
      object.fxUsdPerGbpMicro > 0
        ? object.fxUsdPerGbpMicro
        : FX_USD_PER_GBP_MICRO_DEFAULT,
    fxEffectiveDate:
      typeof object.fxEffectiveDate === 'string'
        ? object.fxEffectiveDate
        : FX_EFFECTIVE_DATE_DEFAULT,
    coordinatorProjectId:
      typeof object.coordinatorProjectId === 'string'
        ? object.coordinatorProjectId
        : undefined,
  } as FirmConfig;
}
