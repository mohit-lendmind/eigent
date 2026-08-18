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

// Tool calls project into the chat pane as typed card messages interleaved in
// timeline order — say/do must read chronologically, and a card's identity
// (message id keyed by tool_call id) must be stable so the running card flips
// to done in place instead of re-appending.
import type { RunState, TimelineEntry } from '@/api/aion/v1/reducer';
import { buildTurnMessages } from '@/store/aionChatBridge';
import { AgentStep } from '@/types/constants';
import { describe, expect, it } from 'vitest';

function textEntry(text: string, sequence: string): TimelineEntry {
  return { type: 'text', runId: 'run-1', sequence, text };
}

type ToolEntry = Extract<TimelineEntry, { type: 'tool' }>;

function toolEntry(overrides: Partial<ToolEntry> = {}): ToolEntry {
  return {
    type: 'tool',
    runId: 'run-1',
    sequence: '5',
    toolCallId: 'call-1',
    toolName: 'bash',
    argumentsJson: '{"command":"ls"}',
    ...overrides,
  };
}

const SUCCEEDED: RunState = {
  runId: 'run-1',
  status: 'succeeded',
  outcomeDetail: 'done',
};

describe('buildTurnMessages', () => {
  it('interleaves tool cards between text in timeline order', () => {
    const messages = buildTurnMessages('proj-1', 'run-1', [
      textEntry('Setting up.', '2'),
      toolEntry({ toolCallId: 'call-1', sequence: '3' }),
      toolEntry({ toolCallId: 'call-2', sequence: '4', toolName: 'write_file' }),
      textEntry('All done.', '6'),
    ], undefined);

    expect(messages.map((m) => m.id)).toEqual([
      'aion:run-1:text:0',
      'aion:run-1:tool:call-1',
      'aion:run-1:tool:call-2',
      'aion:run-1:text:1',
    ]);
    expect(messages[1]!.toolCard?.toolName).toBe('bash');
    expect(messages[2]!.toolCard?.toolName).toBe('write_file');
    // The card owns the message; no prose double-render.
    expect(messages[1]!.content).toBe('');
  });

  it('carries running status with the live tail, then flips to done with the result', () => {
    const running = buildTurnMessages('proj-1', 'run-1', [
      toolEntry({ liveOutput: 'compiling\nlinking\n' }),
    ], undefined);
    expect(running[0]!.toolCard).toMatchObject({
      status: 'running',
      liveOutput: 'compiling\nlinking\n',
    });
    expect(running[0]!.toolCard?.resultContent).toBeUndefined();

    const settled = buildTurnMessages('proj-1', 'run-1', [
      toolEntry({
        liveOutput: 'compiling\nlinking\n',
        result: { sequence: '6', content: 'build ok', isError: false },
      }),
    ], undefined);
    expect(settled[0]!.id).toBe(running[0]!.id);
    expect(settled[0]!.toolCard).toMatchObject({
      status: 'done',
      resultContent: 'build ok',
    });
    expect(settled[0]!.toolCard?.liveOutput).toBeUndefined();
  });

  it('marks an error result as an error card', () => {
    const messages = buildTurnMessages('proj-1', 'run-1', [
      toolEntry({
        result: { sequence: '6', content: 'command not found', isError: true },
      }),
    ], undefined);
    expect(messages[0]!.toolCard?.status).toBe('error');
    expect(messages[0]!.toolCard?.resultContent).toBe('command not found');
  });

  it('caps a huge result so the pane never holds the full payload', () => {
    const messages = buildTurnMessages('proj-1', 'run-1', [
      toolEntry({
        result: { sequence: '6', content: 'x'.repeat(100_000), isError: false },
      }),
    ], undefined);
    const content = messages[0]!.toolCard?.resultContent ?? '';
    expect(content.length).toBeLessThan(5_000);
    expect(content.endsWith('…')).toBe(true);
  });

  it('puts the END step on the last text message, never on a trailing tool card', () => {
    const messages = buildTurnMessages('proj-1', 'run-1', [
      textEntry('Answer.', '2'),
      toolEntry({ sequence: '3', result: { sequence: '4', content: 'ok', isError: false } }),
    ], SUCCEEDED);
    expect(messages[0]!.step).toBe(AgentStep.END);
    expect(messages[1]!.step).toBeUndefined();
  });
});

// A published deliverable is announced in the conversation where the run
// produced it. What must NOT be announced is the instrumentation: a browsing
// run publishes a viewfinder frame per action, and the browser pane already
// owns those.
describe('buildTurnMessages artifact cards', () => {
  function artifactEntry(
    artifact: Record<string, unknown>,
    sequence = '7'
  ): TimelineEntry {
    return { type: 'artifact', runId: 'run-1', sequence, artifact };
  }

  it('announces a published document', () => {
    const messages = buildTurnMessages(
      'proj-1',
      'run-1',
      [
        artifactEntry({
          artifact_id: 'art-9',
          name: 'report.md',
          media_type: 'text/markdown',
          size_bytes: '2048',
          version: 2,
        }),
      ],
      undefined
    );

    expect(messages[0].id).toBe('aion:run-1:artifact:report.md');
    expect(messages[0].artifactCard).toEqual({
      artifactId: 'art-9',
      name: 'report.md',
      mediaType: 'text/markdown',
      sizeBytes: 2048,
      version: 2,
    });
    // The card owns the message; nothing double-renders it as prose.
    expect(messages[0].content).toBe('');
  });

  it('announces one card per name, where its newest version landed', () => {
    // A revised document publishes a version per edit. Announcing each would
    // leave earlier cards in the conversation claiming a version the viewer
    // no longer opens by default.
    const messages = buildTurnMessages(
      'proj-1',
      'run-1',
      [
        artifactEntry(
          {
            artifact_id: 'v1',
            name: 'report.md',
            media_type: 'text/markdown',
            size_bytes: '10',
            version: 1,
          },
          '7'
        ),
        textEntry('Revising.', '8'),
        artifactEntry(
          {
            artifact_id: 'v2',
            name: 'report.md',
            media_type: 'text/markdown',
            size_bytes: '20',
            version: 2,
          },
          '9'
        ),
      ],
      undefined
    );

    expect(messages.map((m) => m.id)).toEqual([
      'aion:run-1:text:0',
      'aion:run-1:artifact:report.md',
    ]);
    expect(messages[1].artifactCard?.version).toBe(2);
  });

  it('drops viewfinder frames and screenshots', () => {
    const messages = buildTurnMessages(
      'proj-1',
      'run-1',
      [
        artifactEntry({
          artifact_id: 'f1',
          name: 'aion-browser-frame-000004.png',
          media_type: 'image/png',
          size_bytes: '900',
          version: 1,
        }),
        artifactEntry(
          {
            artifact_id: 's1',
            name: 'checkout.png',
            media_type: 'image/png',
            size_bytes: '900',
            version: 1,
          },
          '8'
        ),
      ],
      undefined
    );

    expect(messages).toEqual([]);
  });

  it('skips a row with no id rather than rendering a dead affordance', () => {
    const messages = buildTurnMessages(
      'proj-1',
      'run-1',
      [artifactEntry({ name: 'report.md', media_type: 'text/markdown' })],
      undefined
    );

    expect(messages).toEqual([]);
  });

  it('reports an unparsable size as zero, never NaN', () => {
    const messages = buildTurnMessages(
      'proj-1',
      'run-1',
      [
        artifactEntry({
          artifact_id: 'art-1',
          name: 'notes.txt',
          media_type: 'text/plain',
        }),
      ],
      undefined
    );

    expect(messages[0].artifactCard?.sizeBytes).toBe(0);
    expect(messages[0].artifactCard?.version).toBe(0);
  });
});
