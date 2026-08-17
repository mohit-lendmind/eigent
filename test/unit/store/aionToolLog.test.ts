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

// A tool row must settle when its result lands — the work log builds its
// done/error state and the Response fold exclusively from DEACTIVATE_TOOLKIT
// entries, so a log that only ever activates leaves every row shimmering
// forever over an empty Response block.
import type { TimelineEntry } from '@/api/aion/v1/reducer';
import { projectToolLog } from '@/store/aionChatBridge';
import { AgentMessageStatus, AgentStep } from '@/types/constants';
import { describe, expect, it } from 'vitest';

type ToolEntry = Extract<TimelineEntry, { type: 'tool' }>;

function toolEntry(overrides: Partial<ToolEntry> = {}): ToolEntry {
  return {
    type: 'tool',
    runId: 'run-1',
    sequence: '7',
    toolCallId: 'call-1',
    toolName: 'bash',
    argumentsJson: '{"command":"ls"}',
    ...overrides,
  };
}

describe('projectToolLog', () => {
  it('leaves an unresolved call as a single running activation', () => {
    const log = projectToolLog('run-1', [toolEntry()]);
    expect(log).toHaveLength(1);
    expect(log[0]!.step).toBe(AgentStep.ACTIVATE_TOOLKIT);
    expect(log[0]!.status).toBe(AgentMessageStatus.RUNNING);
  });

  it('carries the raw arguments for the typed card, uncapped', () => {
    const args = JSON.stringify({ command: 'x'.repeat(1_000) });
    const log = projectToolLog('run-1', [toolEntry({ argumentsJson: args })]);
    // `message` stays the capped preview for the legacy fold; the card gets
    // the full arguments so a long file body renders whole.
    expect(log[0]!.data.arguments_json).toBe(args);
    expect((log[0]!.data.message as string).length).toBeLessThan(args.length);
  });

  it('closes a resolved call with a deactivation carrying the result', () => {
    const log = projectToolLog('run-1', [
      toolEntry({
        result: { sequence: '8', content: 'total 4\nREADME.md', isError: false },
      }),
    ]);
    expect(log.map((e) => e.step)).toEqual([
      AgentStep.ACTIVATE_TOOLKIT,
      AgentStep.DEACTIVATE_TOOLKIT,
    ]);
    expect(log[1]!.data.toolkit_name).toBe('bash');
    expect(log[1]!.data.message).toContain('README.md');
    expect(log[1]!.status).toBe(AgentMessageStatus.COMPLETED);
  });

  it('marks an error result as failed, still carrying its message', () => {
    const log = projectToolLog('run-1', [
      toolEntry({
        result: { sequence: '8', content: 'command not found', isError: true },
      }),
    ]);
    expect(log[1]!.status).toBe(AgentMessageStatus.FAILED);
    expect(log[1]!.data.message).toBe('command not found');
  });

  it('interleaves settled and in-flight calls in order', () => {
    const log = projectToolLog('run-1', [
      toolEntry({
        toolCallId: 'call-1',
        result: { sequence: '8', content: 'done', isError: false },
      }),
      toolEntry({ toolCallId: 'call-2', sequence: '9' }),
    ]);
    expect(log.map((e) => e.step)).toEqual([
      AgentStep.ACTIVATE_TOOLKIT,
      AgentStep.DEACTIVATE_TOOLKIT,
      AgentStep.ACTIVATE_TOOLKIT,
    ]);
    expect(log[2]!.status).toBe(AgentMessageStatus.RUNNING);
  });

  it('caps a huge result so the store never holds the full payload', () => {
    const log = projectToolLog('run-1', [
      toolEntry({
        result: { sequence: '8', content: 'x'.repeat(100_000), isError: false },
      }),
    ]);
    const message = log[1]!.data.message as string;
    expect(message.length).toBeLessThan(5_000);
    expect(message.endsWith('…')).toBe(true);
  });

  it('carries the live output on the running activation only', () => {
    const running = projectToolLog('run-1', [
      toolEntry({ liveOutput: 'compiling core\nlinking\n' }),
    ]);
    expect(running[0]!.data.live_output).toBe('compiling core\nlinking\n');

    // Once the result lands it is authoritative — the deactivation carries
    // the response and the live tail stops being projected.
    const settled = projectToolLog('run-1', [
      toolEntry({
        liveOutput: 'compiling core\nlinking\n',
        result: { sequence: '8', content: 'build ok', isError: false },
      }),
    ]);
    expect(settled[0]!.data.live_output).toBeUndefined();
    expect(settled[1]!.data.message).toBe('build ok');
  });

  it('keeps the TAIL of a huge live buffer, marked as clipped', () => {
    const log = projectToolLog('run-1', [
      toolEntry({ liveOutput: `${'x'.repeat(100_000)}END` }),
    ]);
    const live = log[0]!.data.live_output as string;
    expect(live.length).toBeLessThan(5_000);
    expect(live.startsWith('…')).toBe(true);
    expect(live.endsWith('END')).toBe(true);
  });

  it('marks a backend-truncated buffer clipped even when short', () => {
    const log = projectToolLog('run-1', [
      toolEntry({ liveOutput: 'recent output\n', liveOutputTruncated: true }),
    ]);
    expect(log[0]!.data.live_output).toBe('…recent output\n');
  });
});
