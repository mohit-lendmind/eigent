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

// Frozen M1 contract — per-firm config (lm/config.json). See data-model.md.
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
  breaker: { maxInvocationsPerCaseHour: number }; // default 12
  budgets: { watcherPassMicroGbp: number; caseMicroGbp: number }; // defaults 20_000 / 15_000_000
}
export declare function decodeFirmConfig(value: unknown): FirmConfig;
export declare const FIRM_CONFIG_DEFAULTS: Readonly<Partial<FirmConfig>>;
