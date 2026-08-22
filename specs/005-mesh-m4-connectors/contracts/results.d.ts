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

// Frozen M4 — adviser-only sourcing results surface + G5.
import type { Coverage, Product, SourcingSnapshotPayload } from './sourcing';
export interface ShortlistProps {
  snapshot: SourcingSnapshotPayload;
  products: Product[];
  coverage: Coverage; // pinned to header, info tone, never exceeded
  scaffold: boolean; // verified:false → watermark band + export/add-to-suitability disabled
}
export interface RunRibbonProps {
  currentAction: string;
  runningAsAdviser: string;
  onTakeControl: () => void;
} // always-hot, non-modal
export interface G5Props {
  snapshot: SourcingSnapshotPayload;
  onRecommend: (productId: string, rationale: string) => void; // disabled until product picked AND rationale typed
  ratesStale: boolean; // → staleness warning
}
export declare function exportEvidenceOfResearch(
  s: SourcingSnapshotPayload
): { ok: true; bundleId: string } | { ok: false; reason: string }; // calls assertClaimable
