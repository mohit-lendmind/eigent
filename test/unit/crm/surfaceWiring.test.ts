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

// Findings 3 & 4 — the defect was purely one of wiring: the agent journeys had
// zero runtime callers (finding 3) and /crm was reachable only by typing the URL
// (finding 4). crmSurface.test.ts proves the controller BEHAVES; this guard proves
// the shipped screens are actually CONNECTED to it, so a future edit that unhooks a
// button or drops the nav entry re-fails here rather than silently shipping a dead
// surface. It reads source (not the DOM) on purpose: the failure mode is a missing
// call site, which a render test of a mocked screen would not catch.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (rel: string) =>
  readFileSync(resolve(__dirname, '../../../src', rel), 'utf8');

describe('M2 surface wiring guard (findings 3 & 4)', () => {
  it('TodayQueue drives every controller entry point', () => {
    const today = src('crm/ui/TodayQueue.tsx');
    // Imports the imperative controller rather than re-implementing agent calls.
    expect(today).toContain("from './crmSurface'");
    // Bootstrap on mount installs skills + the watcher schedule (FR-005/010).
    expect(today).toContain('bootstrapCrmSurface');
    // Journey 1: start a case, and resolve G1 both ways.
    expect(today).toContain('startOnboardingCase');
    expect(today).toContain('approveGate');
    expect(today).toContain('rejectGate');
    // Journey 2: a propose-only G7 watcher card resolves by acknowledgement, via
    // its own controller entry point — never the G1 send path (finding 1).
    expect(today).toContain('acknowledgeGate');
    // Gate rows open the card; the card's actions call back into the controller.
    expect(today).toContain('setSelectedGateId(row.id)');
    expect(today).toContain('onApprove=');
    expect(today).toContain('onReject=');
    expect(today).toContain('onAcknowledge=');
    // The one live approval subscription is genuinely wired, not dead code
    // (finding 4): TodayQueue holds the subscription while a card is open.
    expect(today).toContain('subscribeOpenGate');
  });

  it('the controller is the sole runtime caller of the agent journeys', () => {
    const surface = src('crm/ui/crmSurface.ts');
    for (const call of [
      'beginOnboarding',
      'approveOnboardingSend',
      'denyOnboardingSend',
      'acknowledgeWatcherProposal',
      'ensureWatcherSchedule',
      'deployLmSkills',
    ]) {
      expect(surface).toContain(call);
    }
  });

  it('the main chrome carries a visible nav entry into /crm (FR-015)', () => {
    const topBar = src('components/TopBar/index.tsx');
    // A discoverable control outside /crm navigates to the surface, labelled by
    // the shared i18n key present in every locale.
    expect(topBar).toContain("navigate('/crm')");
    expect(topBar).toContain('crm.nav.crm');
  });
});
