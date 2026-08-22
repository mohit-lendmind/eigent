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

// FR-020 — a small completeness ring. The arc colour is `currentColor`, so the
// tone comes from a ds text token class (never a raw colour): a full ring reads
// success, a partial one warning, an empty one neutral.

import { toneClasses, type CrmTone } from '../tones';

export interface CompletenessRingProps {
  /** 0..1 fraction complete. */
  value: number;
  size?: number;
}

function toneFor(fraction: number): CrmTone {
  if (fraction >= 1) return 'success';
  if (fraction > 0) return 'warning';
  return 'neutral';
}

export function CompletenessRing({ value, size = 32 }: CompletenessRingProps) {
  const clamped = Math.max(0, Math.min(1, value));
  const stroke = 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped);
  const tone = toneClasses(toneFor(clamped));
  const pct = Math.round(clamped * 100);
  return (
    <span
      className={`inline-flex items-center justify-center ${tone.text}`}
      role="img"
      aria-label={`${pct}% complete`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          opacity={0.2}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
    </span>
  );
}
