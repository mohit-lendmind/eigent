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

// T009 — THE PROOF GATE for the watcher. The watcher runs server-side, where the
// only tools are the same listArtifacts + inline getArtifact a skill can call —
// there is no readAionArtifact wrapper, no zustand store, no window. This test
// proves both reads the watcher depends on (the firm index, and a case log head)
// are expressible with ONLY those two run-available primitives. A `RunEdge`
// deliberately throws on every write, so a read that secretly needed a
// desktop-only path would fail here rather than at 3am on a schedule.

import type { CaseLogEntry } from '@/crm/agentContracts';
import { readCaseLogHead } from '@/crm/agents/caseLogHead';
import { resetCaseProjectCaches } from '@/crm/agents/caseProject';
import { configureAgentEdge, type AgentEdge } from '@/crm/agents/edge';
import { publishCasePointer, readFirmIndex } from '@/crm/agents/firmIndex';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeEdge } from './fakeEdge';

// Exactly the two primitives a scheduled run has. Everything else throws, so a
// read that leans on a write path is caught.
function runEdge(backing: FakeEdge): AgentEdge {
  const deny = (name: string) => () => {
    throw new Error(`${name} is not available to a server-side run`);
  };
  return {
    listArtifacts: backing.listArtifacts.bind(backing),
    getArtifact: backing.getArtifact.bind(backing),
    createProject: deny('createProject'),
    uploadAttachment: deny('uploadAttachment'),
    submitCommand: deny('submitCommand'),
    createSchedule: deny('createSchedule'),
    listSchedules: deny('listSchedules'),
    putSkill: deny('putSkill'),
    getUsage: deny('getUsage'),
    respondToApproval: deny('respondToApproval'),
  } as AgentEdge;
}

function caseLogEntry(
  caseId: string,
  firmId: string,
  seq: string
): CaseLogEntry {
  return {
    kind: 'lm.caselog/1',
    caseId,
    firmId,
    seq,
    at: 1_700_000_000_000 + Number(seq),
    actor: { kind: 'agent', id: 'lm-onboarding' },
    event: { type: 'activity', payload: { note: `entry ${seq}` } },
    origin: { artifactId: `art-${seq}`, runId: `run-${seq}` },
    versions: {
      model: 'test',
      promptSha: 'p',
      skillSemver: '1.0.0',
      skillSha: 's',
    },
    prevHash: seq === '1' ? '' : `hash-${Number(seq) - 1}`,
    hash: `hash-${seq}`,
  };
}

function base64Json(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

describe('T009 proof: the watcher reads are run-portable', () => {
  beforeEach(() => {
    resetCaseProjectCaches();
  });

  it('reads the firm index and a case log head with list+get only', async () => {
    const backing = new FakeEdge();
    configureAgentEdge(backing);

    const firmId = 'firm-alpha';
    // Desktop publishes two case pointers into the firm coordinator project.
    await publishCasePointer({
      caseId: 'c417',
      firmId,
      aionProjectId: 'proj-c417',
      stage: 'application',
      logHeadSeq: '12',
      updatedAt: 1_700_000_000_000,
    });
    await publishCasePointer({
      caseId: 'c392',
      firmId,
      aionProjectId: 'proj-c392',
      stage: 'offer',
      logHeadSeq: '5',
      updatedAt: 1_700_000_000_100,
    });

    // The case log lives in the case project; seed three entries out of order.
    backing.seedProject('proj-c417');
    for (const seq of ['1', '2', '3']) {
      await backing.uploadAttachment('proj-c417', {
        name: `lm/case/c417/${seq}`,
        media_type: 'application/json',
        data_base64: base64Json(caseLogEntry('c417', firmId, seq)),
      });
    }

    // Now read using ONLY the run primitives.
    const run = runEdge(backing);
    configureAgentEdge(run);

    const index = await readFirmIndex(firmId);
    expect(index.map((p) => p.caseId).sort()).toEqual(['c392', 'c417']);
    const c417 = index.find((p) => p.caseId === 'c417');
    expect(c417?.aionProjectId).toBe('proj-c417');
    expect(c417?.logHeadSeq).toBe('12');

    const head = await readCaseLogHead(run, 'proj-c417', 'c417');
    expect(head?.seq).toBe('3');
    expect(head?.entry.event.payload.note).toBe('entry 3');

    // Documented: a run cannot write. Proves the reads above needed no write.
    expect(() => run.uploadAttachment('x', {} as never)).toThrow();
    expect(() => run.createProject({} as never)).toThrow();

    configureAgentEdge(null);
  });

  it('latest pointer version supersedes an earlier one', async () => {
    const backing = new FakeEdge();
    configureAgentEdge(backing);
    const firmId = 'firm-beta';

    await publishCasePointer({
      caseId: 'c500',
      firmId,
      aionProjectId: 'proj-c500',
      stage: 'fact-find',
      logHeadSeq: '1',
      updatedAt: 1,
    });
    await publishCasePointer({
      caseId: 'c500',
      firmId,
      aionProjectId: 'proj-c500',
      stage: 'application',
      logHeadSeq: '9',
      updatedAt: 2,
    });

    configureAgentEdge(runEdge(backing));
    const index = await readFirmIndex(firmId);
    expect(index).toHaveLength(1);
    expect(index[0].stage).toBe('application');
    expect(index[0].logHeadSeq).toBe('9');

    configureAgentEdge(null);
  });
});
