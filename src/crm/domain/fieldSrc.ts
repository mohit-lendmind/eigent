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

// FR-004 trust-spine floor, in one dependency-free place so the fold replay path
// and the live desktop write path agree byte-for-byte.
import type { Src } from './types';

/**
 * The `src` a field-change takes when it OMITS one. Only a human/manual adviser
 * edit legitimately defaults to `det` (the pre-M3 behaviour, preserved so a
 * historic refold stays byte-identical — every M1/M2 fixture sets `src`
 * explicitly, so this default is a pure safety floor). Any agent / watcher /
 * schedule / unknown writer floors to `syn`, so a crafted or careless income
 * entry can never round UP to `det` and satisfy G9 without a deterministic quote
 * match.
 */
export function defaultFieldSrc(actorKind: string | undefined): Src {
  return actorKind === 'adviser' ? 'det' : 'syn';
}
