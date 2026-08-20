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

// Money is integer pence. Never bigint (JSON.stringify throws), never a
// display string (parse at the boundary via parseGbp).
export type Pence = number & { readonly __brand: 'Pence' };

export const toPence = (n: number): Pence => n as Pence;

export interface FormatGbpOptions {
  compact?: boolean;
}

const gbpFullFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatGbp(pence: Pence, opts: FormatGbpOptions = {}): string {
  const pounds = Number(pence) / 100;
  if (opts.compact) {
    const abs = Math.abs(pounds);
    if (abs >= 1_000_000) {
      return `£${(pounds / 1_000_000).toFixed(1)}m`;
    }
    if (abs >= 1_000) {
      return `£${(pounds / 1_000).toFixed(1)}k`;
    }
    return `£${pounds.toFixed(0)}`;
  }
  return gbpFullFormatter.format(pounds);
}

const NUMERIC_RE = /^-?\d+(?:\.\d+)?$/;

export function parseGbp(input: string): Pence | null {
  if (typeof input !== 'string') return null;
  const cleaned = input.trim().replace(/^£/, '').replace(/,/g, '').trim();
  if (!cleaned) return null;
  if (!NUMERIC_RE.test(cleaned)) return null;
  const pounds = Number(cleaned);
  if (!Number.isFinite(pounds)) return null;
  return Math.round(pounds * 100) as Pence;
}
