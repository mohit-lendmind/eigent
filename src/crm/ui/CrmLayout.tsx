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

// FR-015 — the CRM surface shell. A sibling to the app's main Layout: the
// tactical rail on the left, the routed CRM screen on the right. The CRM owns
// its own child routing so snapshot-bearing screens (SourcingResults) stay
// inside src/crm and never leak into the app router (FR-007).

import { lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { TacticalRail } from './TacticalRail';

const TodayQueue = lazy(() =>
  import('./TodayQueue').then((m) => ({ default: m.TodayQueue }))
);
const SourcingResults = lazy(() =>
  import('./SourcingResults').then((m) => ({ default: m.SourcingResults }))
);

export function CrmLayout() {
  return (
    <div className="flex h-screen bg-ds-bg-neutral-default-default">
      <TacticalRail />
      <main className="flex-1 overflow-y-auto">
        <Routes>
          <Route index element={<TodayQueue />} />
          <Route path="results" element={<SourcingResults />} />
        </Routes>
      </main>
    </div>
  );
}

export default CrmLayout;
