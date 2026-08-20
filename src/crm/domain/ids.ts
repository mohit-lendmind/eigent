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

import { generateUniqueId } from '@/lib';

export type CrmIdPrefix =
  | 'client'
  | 'case'
  | 'doc'
  | 'insight'
  | 'wl'
  | 'stream'
  | 'event'
  | 'conflict'
  | 'stream_trunc'
  | 'activity';

// The repo's generateUniqueId() collides under rapid succession (10k rand
// values). We tack on a monotonically-increasing counter so a burst of ids —
// e.g. from the seed pass — is guaranteed unique.
let sequenceCounter = 0;

export function newCrmId(prefix: CrmIdPrefix): string {
  sequenceCounter += 1;
  return `${prefix}_${generateUniqueId()}_${sequenceCounter.toString(36)}`;
}
