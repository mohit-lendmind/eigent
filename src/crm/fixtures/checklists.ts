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

import type { DocChecklistItem } from '../domain/types';

const at = Date.UTC(2026, 5, 3, 9, 0);

export const goldenPathChecklist: DocChecklistItem[] = [
  {
    owner: 'aisha',
    itemKey: 'photo_id',
    label: 'Photo ID (passport)',
    status: 'received',
    updatedAt: at,
  },
  {
    owner: 'aisha',
    itemKey: 'payslips',
    label: 'Latest 3 payslips',
    status: 'received',
    updatedAt: at,
  },
  {
    owner: 'aisha',
    itemKey: 'p60',
    label: 'P60',
    status: 'received',
    updatedAt: at,
  },
  {
    owner: 'aisha',
    itemKey: 'proof_of_address',
    label: 'Proof of address (≤3 mo)',
    status: 'pending',
    updatedAt: at,
  },
  {
    owner: 'daniel',
    itemKey: 'photo_id',
    label: 'Photo ID (driving licence)',
    status: 'received',
    updatedAt: at,
  },
  {
    owner: 'daniel',
    itemKey: 'employment_contract',
    label: 'Employment contract',
    status: 'received',
    updatedAt: at,
  },
  {
    owner: 'daniel',
    itemKey: 'payslips',
    label: 'Latest 3 payslips',
    status: 'partial',
    note: '1 of 3 received',
    updatedAt: at,
  },
  {
    owner: 'joint',
    itemKey: 'bank_statements',
    label: '3 months bank statements',
    status: 'received',
    updatedAt: at,
  },
  {
    owner: 'joint',
    itemKey: 'proof_of_deposit',
    label: 'Proof of deposit',
    status: 'received',
    updatedAt: at,
  },
  {
    owner: 'joint',
    itemKey: 'gifted_deposit_letter',
    label: 'Gifted deposit letter (mother)',
    status: 'requested',
    note: 'Auto-requested today',
    updatedAt: at,
  },
];
