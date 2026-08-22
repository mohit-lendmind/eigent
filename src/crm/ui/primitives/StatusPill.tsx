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

// FR-020 — a semantic status pill. Given a tone role it paints the ds trio; a
// queue row uses it for its freshness/urgency chip.

import { toneClasses, type CrmTone } from '../tones';

export interface StatusPillProps {
  tone: CrmTone;
  label: string;
}

export function StatusPill({ tone, label }: StatusPillProps) {
  const cls = toneClasses(tone);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${cls.bg} ${cls.text}`}
    >
      {label}
    </span>
  );
}
