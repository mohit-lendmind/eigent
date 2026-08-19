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

// The executor's refusal surface — everything it answers in-band BEFORE (or
// instead of) driving a page: unknown tools, malformed arguments, the user
// holding control, a closed window, and console_exec against the user's
// logged-in sessions. Electron is mocked down to a window shell; anything
// that would reach a real tab throws, which proves these paths never do.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => {
  class FakeWindow {
    static instances: FakeWindow[] = [];
    handlers = new Map<string, () => void>();
    title = '';
    focusCount = 0;
    destroyed = false;
    contentView = { addChildView: () => {}, removeChildView: () => {} };
    constructor(opts: { title?: string }) {
      this.title = opts?.title ?? '';
      FakeWindow.instances.push(this);
    }
    on(event: string, handler: () => void): void {
      this.handlers.set(event, handler);
    }
    isDestroyed(): boolean {
      return this.destroyed;
    }
    setTitle(title: string): void {
      this.title = title;
    }
    focus(): void {
      this.focusCount += 1;
    }
    close(): void {
      this.destroyed = true;
      this.handlers.get('closed')?.();
    }
  }
  const clearStorageData = vi.fn(async () => undefined);
  const setUserAgent = vi.fn();
  return { FakeWindow, clearStorageData, setUserAgent };
});

vi.mock('electron', () => ({
  // A run boundary presents the scrubbed user agent on its partition before
  // anything is dispatched, so the shell has to answer both.
  app: {
    getName: () => 'Eternyl',
    userAgentFallback:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Eternyl/1.0.2 Chrome/140.0.0.0 Electron/38.1.0 Safari/537.36',
  },
  BrowserWindow: fakes.FakeWindow,
  WebContentsView: class {
    constructor() {
      throw new Error('no tabs in these tests');
    }
  },
  session: {
    fromPartition: () => ({
      clearStorageData: fakes.clearStorageData,
      setUserAgent: fakes.setUserAgent,
    }),
  },
}));
vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { AgentBrowser } from '../../../electron/main/agentBrowser';
import {
  TAKE_CONTROL_ERROR,
  WINDOW_CLOSED_ERROR,
  windowTitle,
} from '../../../electron/main/agentBrowserVerbs';

const CONSOLE_EXEC_LOGGED_IN_ERROR =
  'browser_console_exec is not available when using your logged-in browser sessions';

function request(overrides: Partial<Record<string, string>> = {}) {
  return {
    delegationId: 'd1',
    runId: 'r1',
    toolName: 'browser_console_exec',
    argumentsJson: '{"code":"1+1"}',
    sessionMode: 'logged_in',
    ...overrides,
  };
}

function errOf(result: { resultJson: string }): string | undefined {
  return (JSON.parse(result.resultJson) as { error?: string }).error;
}

beforeEach(() => {
  fakes.FakeWindow.instances.length = 0;
  fakes.clearStorageData.mockClear();
});

describe('AgentBrowser refusal surface', () => {
  it('rejects a non-browser tool in-band without opening a window', async () => {
    const ab = new AgentBrowser();
    const res = await ab.execute(request({ toolName: 'read_file' }));
    expect(errOf(res)).toBe(
      'unknown tool "read_file" (this desktop executes browser tools only)'
    );
    expect(fakes.FakeWindow.instances).toHaveLength(0);
  });

  it('rejects malformed arguments in-band without opening a window', async () => {
    const ab = new AgentBrowser();
    expect(errOf(await ab.execute(request({ argumentsJson: 'nope' })))).toBe(
      'arguments are not valid JSON'
    );
    expect(errOf(await ab.execute(request({ argumentsJson: '[1]' })))).toBe(
      'arguments must be a JSON object'
    );
    expect(fakes.FakeWindow.instances).toHaveLength(0);
  });

  it('refuses console_exec on logged-in sessions and titles the window for the mode', async () => {
    const ab = new AgentBrowser();
    const res = await ab.execute(request());
    expect(errOf(res)).toBe(CONSOLE_EXEC_LOGGED_IN_ERROR);
    // The refusal is the verb's, not the executor's: the window exists and
    // its title (the URL strip) already declares the logged-in mode.
    expect(fakes.FakeWindow.instances).toHaveLength(1);
    expect(fakes.FakeWindow.instances[0]!.title).toBe(windowTitle('', true));
    // The user's own partition is never wiped.
    expect(fakes.clearStorageData).not.toHaveBeenCalled();
  });

  it('NACKs while the user holds control, and give-back restores the agent', async () => {
    const ab = new AgentBrowser();
    await ab.execute(request());
    ab.takeControl(true);
    // Taking control raises the window the user asked to look at.
    expect(fakes.FakeWindow.instances[0]!.focusCount).toBe(1);
    expect(ab.status().takenOver).toBe(true);
    const nacked = await ab.execute(request({ delegationId: 'd2' }));
    expect(errOf(nacked)).toBe(TAKE_CONTROL_ERROR);
    ab.takeControl(false);
    const resumed = await ab.execute(request({ delegationId: 'd3' }));
    expect(errOf(resumed)).toBe(CONSOLE_EXEC_LOGGED_IN_ERROR);
  });

  it('a closed window NACKs the rest of the run; a new run gets a new window', async () => {
    const ab = new AgentBrowser();
    await ab.execute(request());
    fakes.FakeWindow.instances[0]!.close();
    expect(ab.status().windowOpen).toBe(false);
    const nacked = await ab.execute(request({ delegationId: 'd2' }));
    expect(errOf(nacked)).toBe(WINDOW_CLOSED_ERROR);
    expect(fakes.FakeWindow.instances).toHaveLength(1);
    const nextRun = await ab.execute(request({ delegationId: 'd3', runId: 'r2' }));
    expect(errOf(nextRun)).toBe(CONSOLE_EXEC_LOGGED_IN_ERROR);
    expect(fakes.FakeWindow.instances).toHaveLength(2);
  });

  it('reports its surface through status()', async () => {
    const ab = new AgentBrowser();
    expect(ab.status()).toEqual({
      windowOpen: false,
      takenOver: false,
      runId: null,
    });
    await ab.execute(request());
    expect(ab.status()).toEqual({
      windowOpen: true,
      takenOver: false,
      runId: 'r1',
    });
  });

  it('wipes the isolated partition once per run boundary', async () => {
    const ab = new AgentBrowser();
    // The mocked WebContentsView throws before any page is driven; the
    // in-band error is incidental — the run boundary already happened.
    await ab.execute(request({ runId: 'r-iso', sessionMode: '' }));
    await ab.execute(
      request({ delegationId: 'd2', runId: 'r-iso', sessionMode: '' })
    );
    expect(fakes.clearStorageData).toHaveBeenCalledTimes(1);
  });
});

describe('windowTitle', () => {
  it('states the origin and the session mode', () => {
    expect(windowTitle('', false)).toBe('Eternyl agent browser');
    expect(windowTitle('about:blank', true)).toBe(
      'Eternyl agent browser — your logged-in sessions'
    );
    expect(windowTitle('https://x.test/p', false)).toBe(
      'https://x.test/p — Eternyl agent browser'
    );
    expect(windowTitle('https://x.test/p', true)).toBe(
      'https://x.test/p — Eternyl agent browser — your logged-in sessions'
    );
  });
});
