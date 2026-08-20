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

export type Stage =
  | 'LEAD'
  | 'FACT_FIND'
  | 'SOURCING'
  | 'DIP'
  | 'APPLICATION'
  | 'VALUATION'
  | 'OFFER'
  | 'COMPLETION';

export interface StageDescriptor {
  key: Stage;
  label: string;
  short: string;
  // Semantic tone key — never hex, rgb(), hsl(), or Tailwind color class.
  // Actual color mapping happens in the UI layer (F02+).
  tone: string;
}

export const STAGES: readonly StageDescriptor[] = [
  { key: 'LEAD', label: 'Lead', short: 'Lead', tone: 'status-info' },
  {
    key: 'FACT_FIND',
    label: 'Fact Find',
    short: 'Fact',
    tone: 'status-pending',
  },
  {
    key: 'SOURCING',
    label: 'Sourcing',
    short: 'Source',
    tone: 'status-pending',
  },
  { key: 'DIP', label: 'Decision in Principle', short: 'DIP', tone: 'brand' },
  {
    key: 'APPLICATION',
    label: 'Application',
    short: 'App',
    tone: 'brand',
  },
  {
    key: 'VALUATION',
    label: 'Valuation',
    short: 'Val',
    tone: 'status-warning',
  },
  { key: 'OFFER', label: 'Offer', short: 'Offer', tone: 'status-success' },
  {
    key: 'COMPLETION',
    label: 'Completion',
    short: 'Done',
    tone: 'status-success',
  },
] as const;

export const STAGE_MAP: Readonly<Record<Stage, StageDescriptor>> =
  Object.fromEntries(STAGES.map((s) => [s.key, s])) as Record<
    Stage,
    StageDescriptor
  >;

export function stageIndex(stage: Stage): number {
  return STAGES.findIndex((s) => s.key === stage);
}

export function nextStage(stage: Stage): Stage | null {
  const idx = stageIndex(stage);
  if (idx < 0 || idx >= STAGES.length - 1) return null;
  return STAGES[idx + 1].key;
}
