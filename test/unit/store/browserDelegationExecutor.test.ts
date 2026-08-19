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

import { describe, expect, it, vi } from 'vitest';

import { EdgeProblemError } from '@/api/aion/v1/problems';
import type { PendingBrowserDelegation } from '@/api/aion/v1/reducer';
import {
  BrowserDelegationExecutor,
  LOCAL_BROWSER_WINDOW_CLOSED,
} from '@/store/browserDelegationExecutor';
import { WINDOW_CLOSED_ERROR } from '../../../electron/main/agentBrowserVerbs';

const FAR_DEADLINE = '2099-01-01T00:00:00Z';

function pendingRow(
  id: string,
  overrides: Partial<PendingBrowserDelegation> = {}
): PendingBrowserDelegation {
  return {
    delegationId: id,
    runId: 'run-1',
    sequence: '10',
    toolCallId: `call-${id}`,
    toolName: 'browser_visit_page',
    argumentsJson: '{"url":"https://x.test"}',
    sessionMode: 'isolated',
    deadlineAt: FAR_DEADLINE,
    ...overrides,
  };
}

function asMap(
  ...rows: PendingBrowserDelegation[]
): Record<string, PendingBrowserDelegation> {
  const map: Record<string, PendingBrowserDelegation> = {};
  for (const row of rows) map[row.delegationId] = row;
  return map;
}

function problem(status: number, code: string): EdgeProblemError {
  return new EdgeProblemError({
    type: 'about:blank',
    title: code,
    status,
    code,
    trace_id: 't-1',
  });
}

function harness(options?: {
  execute?: ReturnType<typeof vi.fn>;
  respond?: ReturnType<typeof vi.fn>;
  list?: ReturnType<typeof vi.fn>;
  now?: () => number;
  onWindowClosed?: ReturnType<typeof vi.fn>;
}) {
  const execute =
    options?.execute ??
    vi.fn(async (request: { delegationId: string }) => ({
      success: true,
      result: { resultJson: `{"result":"ok ${request.delegationId}"}` },
    }));
  const respond = options?.respond ?? vi.fn(async () => undefined);
  const list =
    options?.list ?? vi.fn(async () => ({ delegations: [] }));
  const executor = new BrowserDelegationExecutor({
    execute: execute as any,
    delay: async () => undefined,
    now: options?.now ?? (() => Date.parse('2026-08-19T00:00:00Z')),
    onWindowClosed: options?.onWindowClosed,
  });
  const transport = {
    respondToBrowserDelegation: respond,
    listPendingBrowserDelegations: list,
  };
  return { executor, transport, execute, respond, list };
}

async function settle(): Promise<void> {
  // The pump hops the microtask queue several times per item.
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe('BrowserDelegationExecutor', () => {
  it('executes delegations in arrival order and POSTs each result', async () => {
    const { executor, transport, execute, respond } = harness();
    executor.notePending('p1', transport, asMap(pendingRow('d1'), pendingRow('d2')));
    await settle();
    expect(execute.mock.calls.map((c) => c[0].delegationId)).toEqual(['d1', 'd2']);
    expect(respond.mock.calls.map((c) => c.slice(0, 2))).toEqual([
      ['p1', 'd1'],
      ['p1', 'd2'],
    ]);
    expect(respond.mock.calls[0][2]).toEqual({ result_json: '{"result":"ok d1"}' });
  });

  it('dedupes a delegation repeated across waves', async () => {
    const { executor, transport, execute, respond } = harness();
    const wave = asMap(pendingRow('d1'));
    executor.notePending('p1', transport, wave);
    executor.notePending('p1', transport, wave);
    await settle();
    executor.notePending('p1', transport, wave);
    await settle();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledTimes(1);
  });

  it('re-POSTs the recorded result on replay without re-executing', async () => {
    const respond = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockRejectedValueOnce(new Error('network down'))
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue(undefined);
    const { executor, transport, execute } = harness({ respond });
    executor.notePending('p1', transport, asMap(pendingRow('d1')));
    await settle();
    // All three attempts failed; the delegation stays un-posted.
    expect(respond).toHaveBeenCalledTimes(3);
    // The next wave still names it: recorded result re-POSTs, no re-drive.
    executor.notePending('p1', transport, asMap(pendingRow('d1')));
    await settle();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledTimes(4);
    expect(respond.mock.calls[3][2]).toEqual({ result_json: '{"result":"ok d1"}' });
  });

  it('treats a 409 delegation_not_pending as already-resolved, never a retry', async () => {
    const respond = vi.fn().mockRejectedValue(problem(409, 'delegation_not_pending'));
    const { executor, transport } = harness({ respond });
    executor.notePending('p1', transport, asMap(pendingRow('d1')));
    await settle();
    expect(respond).toHaveBeenCalledTimes(1);
    // A later wave must not re-POST a converged answer.
    executor.notePending('p1', transport, asMap(pendingRow('d1')));
    await settle();
    expect(respond).toHaveBeenCalledTimes(1);
  });

  it('retries a transient POST failure and then converges', async () => {
    const respond = vi
      .fn()
      .mockRejectedValueOnce(problem(503, 'unavailable'))
      .mockResolvedValue(undefined);
    const { executor, transport } = harness({ respond });
    executor.notePending('p1', transport, asMap(pendingRow('d1')));
    await settle();
    expect(respond).toHaveBeenCalledTimes(2);
  });

  it('skips an expired delegation without driving the window', async () => {
    const { executor, transport, execute, respond } = harness({
      now: () => Date.parse('2026-08-19T00:10:00Z'),
    });
    executor.notePending(
      'p1',
      transport,
      asMap(pendingRow('d1', { deadlineAt: '2026-08-19T00:00:00Z' }))
    );
    await settle();
    expect(execute).not.toHaveBeenCalled();
    expect(respond).not.toHaveBeenCalled();
  });

  it('POSTs an in-band error when the executor itself fails', async () => {
    const execute = vi.fn(async () => ({ success: false, error: 'no window' }));
    const { executor, transport, respond } = harness({ execute });
    executor.notePending('p1', transport, asMap(pendingRow('d1')));
    await settle();
    expect(respond.mock.calls[0][2]).toEqual({
      result_json: JSON.stringify({
        error: 'the local browser executor failed: no window',
      }),
    });
  });

  it('maps frame and screenshot fields onto the wire result', async () => {
    const execute = vi.fn(async () => ({
      success: true,
      result: {
        resultJson: '{"result":"captured screenshot"}',
        frameBase64: 'ZnJhbWU=',
        frameName: 'aion-browser-frame-1.jpg',
        screenshotBase64: 'c2hvdA==',
        screenshotName: 'screenshot-1.png',
      },
    }));
    const { executor, transport, respond } = harness({ execute });
    executor.notePending('p1', transport, asMap(pendingRow('d1')));
    await settle();
    expect(respond.mock.calls[0][2]).toEqual({
      result_json: '{"result":"captured screenshot"}',
      frame_base64: 'ZnJhbWU=',
      frame_name: 'aion-browser-frame-1.jpg',
      screenshot_base64: 'c2hvdA==',
      screenshot_name: 'screenshot-1.png',
    });
  });

  it('drops queued work the run stopped waiting for', async () => {
    // The first execute blocks so d2 stays queued while the second wave
    // arrives without it (its run settled).
    let releaseFirst: () => void = () => undefined;
    const execute = vi.fn(
      (request: { delegationId: string }) =>
        new Promise((resolve) => {
          if (request.delegationId === 'd1') {
            releaseFirst = () =>
              resolve({ success: true, result: { resultJson: '{"result":"ok"}' } });
          } else {
            resolve({ success: true, result: { resultJson: '{"result":"ok"}' } });
          }
        })
    );
    const { executor, transport, respond } = harness({ execute: execute as any });
    executor.notePending('p1', transport, asMap(pendingRow('d1'), pendingRow('d2')));
    await settle();
    executor.notePending('p1', transport, asMap(pendingRow('d1')));
    releaseFirst();
    await settle();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls.map((c) => c[1])).toEqual(['d1']);
  });

  it('rehydrates from the pending list on the first wave', async () => {
    const list = vi.fn(async () => ({
      delegations: [
        {
          delegation_id: 'd-listed',
          run_id: 'run-1',
          tool_call_id: 'call-listed',
          tool_name: 'browser_open',
          arguments_json: '{}',
          session_mode: 'isolated',
          deadline_at: FAR_DEADLINE,
          created_at: '2026-08-19T00:00:00Z',
        },
      ],
    }));
    const { executor, transport, execute, list: listMock } = harness({ list });
    executor.notePending('p1', transport, {});
    await settle();
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls.map((c) => c[0].delegationId)).toEqual(['d-listed']);
    // Later waves never re-read the list.
    executor.notePending('p1', transport, {});
    await settle();
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it('serializes per project but keeps projects independent', async () => {
    const order: string[] = [];
    const execute = vi.fn(async (request: { delegationId: string }) => {
      order.push(request.delegationId);
      return { success: true, result: { resultJson: '{"result":"ok"}' } };
    });
    const { executor, transport } = harness({ execute: execute as any });
    executor.notePending('p1', transport, asMap(pendingRow('a1'), pendingRow('a2')));
    executor.notePending('p2', transport, asMap(pendingRow('b1')));
    await settle();
    expect(order.filter((id) => id.startsWith('a'))).toEqual(['a1', 'a2']);
    expect(order).toContain('b1');
  });

  it('recognizes the window-closed kill switch byte-for-byte', () => {
    // The renderer cannot import the main-process executor, so it carries a
    // copy of the NACK body; drift here would silence the notice.
    expect(LOCAL_BROWSER_WINDOW_CLOSED).toBe(WINDOW_CLOSED_ERROR);
  });

  it('surfaces the window-closed kill switch once per run', async () => {
    const execute = vi.fn(async () => ({
      success: true,
      result: {
        resultJson: JSON.stringify({ error: LOCAL_BROWSER_WINDOW_CLOSED }),
      },
    }));
    const onWindowClosed = vi.fn();
    const { executor, transport, respond } = harness({
      execute: execute as any,
      onWindowClosed,
    });
    executor.notePending('p1', transport, asMap(pendingRow('d1'), pendingRow('d2')));
    await settle();
    // Every remaining action of the run NACKs, but the user hears it once —
    // and the NACKs still POST back so the model sees why it is failing.
    expect(onWindowClosed).toHaveBeenCalledTimes(1);
    expect(onWindowClosed).toHaveBeenCalledWith('run-1');
    expect(respond).toHaveBeenCalledTimes(2);
    // A later run tripping the switch again is its own notice.
    executor.notePending(
      'p1',
      transport,
      asMap(pendingRow('d3', { runId: 'run-2' }))
    );
    await settle();
    expect(onWindowClosed).toHaveBeenCalledTimes(2);
    expect(onWindowClosed).toHaveBeenLastCalledWith('run-2');
  });
});
