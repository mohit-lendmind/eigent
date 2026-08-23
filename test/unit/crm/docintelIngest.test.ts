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

// T009 — the ingest seam round-trips through the SAME command plane every other
// agent uses (FR-001), is idempotent on document bytes (FR-003), and refuses
// oversize media as a typed error (spec §36). Also pins the trust spine
// (classifySrc det/syn) that the whole write path depends on. Synthetic bytes
// only — no real document is ever committed.

import { decodeDirectiveEnvelope } from '@/crm/agentContracts';
import { resetCaseProjectCaches } from '@/crm/agents/caseProject';
import {
  decodedByteLength,
  ingestDocument,
  IngestMediaTooLargeError,
} from '@/crm/agents/docIngest';
import {
  classifySrc,
  INGEST_MEDIA_MAX_BYTES,
} from '@/crm/agents/docintelContract';
import { configureAgentEdge } from '@/crm/agents/edge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeEdge } from './fakeEdge';

function base64Of(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

function input(over: Partial<Parameters<typeof ingestDocument>[0]> = {}) {
  return {
    caseId: 'c417',
    firmId: 'firm-alpha',
    document: {
      name: 'payslip.pdf',
      mediaType: 'application/pdf',
      dataBase64: base64Of('Basic pay £3,200 — synthetic fixture'),
    },
    issuedBy: { kind: 'adviser' as const, id: 'adviser-1' },
    ...over,
  };
}

describe('ingestDocument — document → docintel run', () => {
  beforeEach(() => {
    resetCaseProjectCaches();
  });
  afterEach(() => {
    configureAgentEdge(null);
  });

  it('uploads the bytes and dispatches a directive that references the artifact', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);

    const result = await ingestDocument(input());

    // The document artifact landed in the case project under the inbox path.
    const projectId = [...edge.projects.keys()].find((p) =>
      (edge.projects.get(p) ?? []).some(
        (a) => a.artifact_id === result.documentArtifactId
      )
    );
    expect(projectId).toBeDefined();
    const stored = edge.projects
      .get(projectId!)!
      .find((a) => a.artifact_id === result.documentArtifactId)!;
    expect(stored.name.startsWith('lm/docintel/c417/inbox/')).toBe(true);
    expect(stored.name.endsWith('-payslip.pdf')).toBe(true);
    expect(stored.media_type).toBe('application/pdf');

    // A directive was dispatched that references the uploaded document.
    expect(edge.commands).toHaveLength(1);
    const command = edge.commands[0].request;
    expect(command.attachment_ids).toContain(
      result.dispatch.directiveArtifactId
    );

    // The directive envelope names the docintel agent, carries noSend, and
    // references the document as an INPUT artifact — never as an instruction.
    const directiveArtifact = edge.projects
      .get(projectId!)!
      .find((a) => a.artifact_id === result.dispatch.directiveArtifactId)!;
    const env = decodeDirectiveEnvelope(
      JSON.parse(directiveArtifact.contentText)
    );
    expect(env.agent).toBe('lm-docintel');
    expect(env.inputs.artifacts).toContain(result.documentArtifactId);
    expect(env.constraints.noSend).toBe(true);
    expect(env.attemptNonce).toBe(result.contentHash);
  });

  it('is idempotent: re-ingesting identical bytes admits a single command', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);

    const first = await ingestDocument(input());
    const second = await ingestDocument(input());

    expect(second.contentHash).toBe(first.contentHash);
    expect(second.dispatch.commandId).toBe(first.dispatch.commandId);
  });

  it('different bytes mint a different content hash and command', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);

    const a = await ingestDocument(input());
    const b = await ingestDocument(
      input({
        document: {
          name: 'payslip.pdf',
          mediaType: 'application/pdf',
          dataBase64: base64Of(
            'Basic pay £4,500 — different synthetic fixture'
          ),
        },
      })
    );
    expect(b.contentHash).not.toBe(a.contentHash);
    expect(b.dispatch.commandId).not.toBe(a.dispatch.commandId);
  });

  it('refuses oversize media as a typed error, never a partial run', async () => {
    const edge = new FakeEdge();
    configureAgentEdge(edge);

    // One base64 char over the ceiling — no upload, no command.
    const overBytes = INGEST_MEDIA_MAX_BYTES + 1;
    const oversize = 'A'.repeat(Math.ceil((overBytes * 4) / 3) + 4);

    await expect(
      ingestDocument(
        input({
          document: {
            name: 'huge.pdf',
            mediaType: 'application/pdf',
            dataBase64: oversize,
          },
        })
      )
    ).rejects.toBeInstanceOf(IngestMediaTooLargeError);
    expect(edge.commands).toHaveLength(0);
  });
});

describe('decodedByteLength', () => {
  it('computes decoded size from padded base64 without decoding', () => {
    expect(decodedByteLength('')).toBe(0);
    expect(decodedByteLength(base64Of('a'))).toBe(1);
    expect(decodedByteLength(base64Of('ab'))).toBe(2);
    expect(decodedByteLength(base64Of('abc'))).toBe(3);
    expect(decodedByteLength(base64Of('abcd'))).toBe(4);
  });
});

describe('classifySrc — the trust spine', () => {
  it('is det only when the quote substring-matches an independent text layer', () => {
    expect(
      classifySrc('Basic pay £3,200', 'Employer\nBasic pay £3,200\nTax')
    ).toBe('det');
  });

  it('tolerates whitespace re-flow but nothing looser', () => {
    expect(classifySrc('Basic  pay   £3,200', 'Basic pay £3,200')).toBe('det');
    // A near-miss value must never forge a det.
    expect(classifySrc('Basic pay £3,201', 'Basic pay £3,200')).toBe('syn');
  });

  it('is syn for a vision-only document (no text layer)', () => {
    expect(classifySrc('Basic pay £3,200', null)).toBe('syn');
  });

  it('is syn for an empty or missing quote', () => {
    expect(classifySrc(undefined, 'anything')).toBe('syn');
    expect(classifySrc('', 'anything')).toBe('syn');
  });
});
