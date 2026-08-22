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

// Gate registry G1–G10 as pure data (spec v2 §5). This is the only export the
// M2 approval cards need (SC-005). Invariant: a regulated gate is never
// delegable and never batchable — only G4b (operational comms) is delegable.
// Tier (triage) and slaMinutes encode the §5 "ergonomics (binding)" line;
// tier 1 = veto-grade/regulated-critical, 2 = regulated-routine, 3 = operational.

export type GateId =
  'G1' | 'G2' | 'G3' | 'G4a' | 'G4b' | 'G5' | 'G6' | 'G7' | 'G8' | 'G9' | 'G10';
export type GateApprover = 'adviser' | 'delegate-ok' | 'network-supervisor';

export interface GateDescriptor {
  id: GateId;
  name: string;
  approver: GateApprover;
  regulated: boolean;
  batchable: boolean;
  autoDisarmFlags: readonly string[];
  basis: string;
  tier: 1 | 2 | 3;
  slaMinutes: number;
}

const KILL_SWITCH_FLAGS = [
  'vulnerability',
  'arrears',
  'complaint',
  'decline',
] as const;

export const GATE_REGISTRY: readonly GateDescriptor[] = [
  {
    id: 'G1',
    name: 'Outbound onboarding / doc-request send',
    approver: 'adviser',
    regulated: true,
    batchable: false,
    autoDisarmFlags: [],
    basis: 'MCOB 4.4A',
    tier: 2,
    slaMinutes: 240,
  },
  {
    id: 'G2',
    name: 'Doc attribution < 0.85 / joint',
    approver: 'adviser',
    regulated: true,
    batchable: false,
    autoDisarmFlags: [],
    basis: 'data accuracy; audit',
    tier: 2,
    slaMinutes: 480,
  },
  {
    id: 'G3',
    name: 'Conflict resolution',
    approver: 'adviser',
    regulated: true,
    batchable: false,
    autoDisarmFlags: [],
    basis: 'suitability evidence integrity',
    tier: 2,
    slaMinutes: 240,
  },
  {
    id: 'G4a',
    name: 'Regulated client comms (products/rates/advice)',
    approver: 'adviser',
    regulated: true,
    batchable: false,
    autoDisarmFlags: [],
    basis: 'MCOB 3A; Consumer Duty',
    tier: 1,
    slaMinutes: 120,
  },
  {
    id: 'G4b',
    name: 'Operational comms from armed template packs',
    approver: 'delegate-ok',
    regulated: false,
    batchable: true,
    autoDisarmFlags: KILL_SWITCH_FLAGS,
    basis: 'Consumer Duty; firm supervision',
    tier: 3,
    slaMinutes: 480,
  },
  {
    id: 'G5',
    name: 'Recommendation + suitability',
    approver: 'adviser',
    regulated: true,
    batchable: false,
    autoDisarmFlags: [],
    basis: 'MCOB 4.7A.2R/5R',
    tier: 1,
    slaMinutes: 240,
  },
  {
    id: 'G6',
    name: 'Criteria override',
    approver: 'adviser',
    regulated: true,
    batchable: false,
    autoDisarmFlags: [],
    basis: 'audit; network supervision',
    tier: 2,
    slaMinutes: 480,
  },
  {
    id: 'G7',
    name: 'Regulatory-meaning stage transitions',
    approver: 'adviser',
    regulated: true,
    batchable: false,
    autoDisarmFlags: [],
    basis: 'journey control',
    tier: 2,
    slaMinutes: 240,
  },
  {
    id: 'G8',
    name: 'DIP / application submission',
    approver: 'adviser',
    regulated: true,
    batchable: false,
    autoDisarmFlags: [],
    basis: 'agent-as-agent-of-adviser',
    tier: 1,
    slaMinutes: 240,
  },
  {
    id: 'G9',
    name: 'Income verification before any recommendation',
    approver: 'adviser',
    regulated: true,
    batchable: false,
    autoDisarmFlags: [],
    basis: 'MCOB 11.6.8R',
    tier: 1,
    slaMinutes: 240,
  },
  {
    id: 'G10',
    name: 'Network / principal pre-submission sign-off',
    approver: 'network-supervisor',
    regulated: true,
    batchable: false,
    autoDisarmFlags: [],
    basis: 'AR supervision; SUP',
    tier: 1,
    slaMinutes: 480,
  },
];

const byId = new Map<GateId, GateDescriptor>(
  GATE_REGISTRY.map((gate) => [gate.id, gate])
);

export function gateById(id: GateId): GateDescriptor {
  const gate = byId.get(id);
  if (!gate) throw new Error(`[gates] unknown gate id: ${id}`);
  return gate;
}

/** Only non-regulated gates approved by a named delegate are delegable (§5). */
export function delegableGates(): readonly GateDescriptor[] {
  return GATE_REGISTRY.filter(
    (gate) => !gate.regulated && gate.approver === 'delegate-ok'
  );
}
