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

// Frozen M1 contract — gate registry G1-G10 as data (spec v2 §5). See data-model.md.
export type GateId =
  'G1' | 'G2' | 'G3' | 'G4a' | 'G4b' | 'G5' | 'G6' | 'G7' | 'G8' | 'G9' | 'G10';
export type GateApprover = 'adviser' | 'delegate-ok' | 'network-supervisor';

export interface GateDescriptor {
  id: GateId;
  name: string;
  approver: GateApprover;
  regulated: boolean; // regulated gates are never delegable, never batchable
  batchable: boolean;
  autoDisarmFlags: readonly string[]; // e.g. ['vulnerability','arrears','complaint','decline']
  basis: string; // regulatory citation
  tier: 1 | 2 | 3; // triage tier (UX dissent: binding per spec v2 §5 ergonomics)
  slaMinutes: number;
}

export declare const GATE_REGISTRY: readonly GateDescriptor[];
export declare function gateById(id: GateId): GateDescriptor;
export declare function delegableGates(): readonly GateDescriptor[];
