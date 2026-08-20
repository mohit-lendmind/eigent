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

// Referentially-stable singletons so React consumers in F02+ don't re-render
// on empty-to-empty transitions.
export const EMPTY_ARRAY: readonly never[] = Object.freeze([]);
export const EMPTY_MAP: ReadonlyMap<never, never> = Object.freeze(
  new Map<never, never>()
) as unknown as ReadonlyMap<never, never>;
export const EMPTY_OBJECT: Readonly<Record<string, never>> = Object.freeze({});
