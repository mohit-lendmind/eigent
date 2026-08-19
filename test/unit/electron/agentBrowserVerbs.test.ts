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

import { describe, expect, it } from 'vitest';

import {
  actionForTool,
  buildTabs,
  checkUrlAllowed,
  enterKeyEvents,
  firstLine,
  formatSnapshot,
  FRAME_JPEG_QUALITY,
  frameName,
  historyPlan,
  marshalOut,
  mouseClickEvents,
  parseActionArgs,
  SCROLL_ANCHOR,
  screenshotName,
  scrollPlan,
  TOOL_ACTIONS,
  typeFields,
  visitPlan,
} from '../../../electron/main/agentBrowserVerbs';

describe('TOOL_ACTIONS', () => {
  it('maps exactly the 14 delegated browser tools', () => {
    expect(TOOL_ACTIONS).toEqual({
      browser_open: 'open',
      browser_visit_page: 'visit',
      browser_click: 'click',
      browser_type: 'type',
      browser_enter: 'enter',
      browser_select: 'select',
      browser_scroll: 'scroll',
      browser_back: 'back',
      browser_forward: 'forward',
      browser_get_page_snapshot: 'snapshot',
      browser_switch_tab: 'switch_tab',
      browser_console_exec: 'console_exec',
      browser_console_view: 'console_view',
      browser_get_screenshot: 'screenshot',
    });
  });

  it('answers null for a tool that is not a browser action', () => {
    expect(actionForTool('bash')).toBeNull();
    expect(actionForTool('tabs')).toBeNull();
    expect(actionForTool('')).toBeNull();
  });
});

describe('parseActionArgs', () => {
  it('treats an empty or blank body as an empty object', () => {
    expect(parseActionArgs('')).toEqual({ args: {} });
    expect(parseActionArgs('  \n ')).toEqual({ args: {} });
  });

  it('accepts a JSON object', () => {
    expect(parseActionArgs('{"url":"https://x.test"}')).toEqual({
      args: { url: 'https://x.test' },
    });
  });

  it('rejects non-object JSON', () => {
    expect(parseActionArgs('null')).toEqual({
      error: 'arguments must be a JSON object',
    });
    expect(parseActionArgs('[1]')).toEqual({
      error: 'arguments must be a JSON object',
    });
    expect(parseActionArgs('"x"')).toEqual({
      error: 'arguments must be a JSON object',
    });
  });

  it('rejects malformed JSON', () => {
    expect(parseActionArgs('{oops')).toEqual({
      error: 'arguments are not valid JSON',
    });
  });
});

describe('checkUrlAllowed', () => {
  it('allows http, https and about:blank', () => {
    expect(checkUrlAllowed('http://example.test/a')).toBeNull();
    expect(checkUrlAllowed('https://example.test')).toBeNull();
    expect(checkUrlAllowed('about:blank')).toBeNull();
  });

  it('refuses local-reach and internal schemes', () => {
    expect(checkUrlAllowed('file:///etc/passwd')).toBe(
      'unsupported url scheme "file:" (http, https or about:blank)'
    );
    expect(checkUrlAllowed('chrome://settings')).toBe(
      'unsupported url scheme "chrome:" (http, https or about:blank)'
    );
    expect(checkUrlAllowed('about:config')).toBe(
      'unsupported url scheme "about:" (http, https or about:blank)'
    );
  });

  it('refuses an unparseable url', () => {
    expect(checkUrlAllowed('not a url')).toBe('invalid url "not a url"');
  });
});

describe('visitPlan', () => {
  it('reuses a blank current tab', () => {
    expect(visitPlan('https://x.test', 'about:blank')).toEqual({
      newTab: false,
      result: 'visited https://x.test',
    });
  });

  it('opens a new tab when the current tab holds a page', () => {
    expect(visitPlan('https://y.test', 'https://x.test')).toEqual({
      newTab: true,
      result: 'visited https://y.test in a new tab',
    });
  });
});

describe('typeFields', () => {
  it('requires a target', () => {
    expect(typeFields({ text: 'hello' })).toEqual({
      error: 'ref (or x/y), text — or inputs[] — required',
    });
  });

  it('accepts a single ref field', () => {
    expect(typeFields({ ref: 'e2', text: 'hi' })).toEqual({
      fields: [{ ref: 'e2', text: 'hi' }],
    });
  });

  it('accepts an x/y-only field with no ref', () => {
    expect(typeFields({ x: 10, y: 20, text: 'hi' })).toEqual({
      fields: [{ ref: '', text: 'hi' }],
    });
  });

  it('maps inputs[] and fills missing members', () => {
    expect(
      typeFields({ inputs: [{ ref: 'e1', text: 'a' }, { text: 'b' }] })
    ).toEqual({
      fields: [
        { ref: 'e1', text: 'a' },
        { ref: '', text: 'b' },
      ],
    });
  });
});

describe('scrollPlan', () => {
  it('defaults to down 500', () => {
    expect(scrollPlan({})).toEqual({ dx: 0, dy: 500, result: 'scrolled down 500' });
  });

  it('treats amount 0 as the default 500', () => {
    expect(scrollPlan({ direction: 'up', amount: 0 })).toEqual({
      dx: 0,
      dy: -500,
      result: 'scrolled up 500',
    });
  });

  it('computes each direction', () => {
    expect(scrollPlan({ direction: 'down', amount: 100 })).toEqual({
      dx: 0,
      dy: 100,
      result: 'scrolled down 100',
    });
    expect(scrollPlan({ direction: 'right', amount: 30 })).toEqual({
      dx: 30,
      dy: 0,
      result: 'scrolled right 30',
    });
    expect(scrollPlan({ direction: 'left', amount: 30 })).toEqual({
      dx: -30,
      dy: 0,
      result: 'scrolled left 30',
    });
  });

  it('refuses an unknown direction with the pod-mode error string', () => {
    expect(scrollPlan({ direction: 'diag' })).toEqual({
      error: 'unknown direction "diag" (up|down|left|right)',
    });
  });
});

describe('historyPlan', () => {
  const hist = {
    currentIndex: 1,
    entries: [
      { id: 11, url: 'https://a.test' },
      { id: 12, url: 'https://b.test' },
      { id: 13, url: 'https://c.test' },
    ],
  };

  it('navigates back and forward to the neighboring entry', () => {
    expect(historyPlan(hist, -1)).toEqual({
      kind: 'navigate',
      entryId: 11,
      result: 'went back to https://a.test',
    });
    expect(historyPlan(hist, 1)).toEqual({
      kind: 'navigate',
      entryId: 13,
      result: 'went forward to https://c.test',
    });
  });

  it('reports both edges with the pod-mode wording', () => {
    expect(historyPlan({ ...hist, currentIndex: 0 }, -1)).toEqual({
      kind: 'edge',
      result: 'already at the oldest history entry',
    });
    expect(historyPlan({ ...hist, currentIndex: 2 }, 1)).toEqual({
      kind: 'edge',
      result: 'already at the newest history entry',
    });
  });
});

describe('formatSnapshot', () => {
  it('reports an empty page', () => {
    expect(
      formatSnapshot({ url: '', title: '', elements: [], truncated: false })
    ).toBe('(no interactive elements)');
  });

  it('joins element lines and appends the truncation marker', () => {
    expect(
      formatSnapshot({
        url: '',
        title: '',
        elements: ['- [e1] <a> "x"', '- [e2] <button> "y"'],
        truncated: true,
      })
    ).toBe('- [e1] <a> "x"\n- [e2] <button> "y"\n(truncated at 150 elements)');
  });
});

describe('marshalOut', () => {
  it('omits empty fields the way Go omitempty does', () => {
    expect(
      marshalOut({
        result: 'visited https://x.test',
        url: '',
        title: '',
        snapshot: '',
        tabs: [],
        size_bytes: 0,
      })
    ).toBe('{"result":"visited https://x.test"}');
  });

  it('keeps a present raw value even when it is falsy', () => {
    expect(marshalOut({ result: 'evaluated', value: 0 })).toBe(
      '{"result":"evaluated","value":0}'
    );
    expect(marshalOut({ result: 'evaluated', value: '' })).toBe(
      '{"result":"evaluated","value":""}'
    );
    expect(marshalOut({ result: 'evaluated', value: false })).toBe(
      '{"result":"evaluated","value":false}'
    );
  });

  it('omits value only on absence', () => {
    expect(marshalOut({ result: 'evaluated', value: undefined })).toBe(
      '{"result":"evaluated"}'
    );
  });
});

describe('buildTabs', () => {
  it('stamps current only on the current tab, never current:false', () => {
    const tabs = buildTabs(
      [
        { tabId: 't1', url: 'https://a.test', title: 'A' },
        { tabId: 't2', url: 'https://b.test', title: 'B' },
      ],
      't2'
    );
    expect(tabs).toEqual([
      { tab_id: 't1', url: 'https://a.test', title: 'A' },
      { tab_id: 't2', url: 'https://b.test', title: 'B', current: true },
    ]);
    expect('current' in tabs[0]).toBe(false);
  });
});

describe('CDP event builders', () => {
  it('builds the move/press/release click triple', () => {
    expect(mouseClickEvents(12, 34)).toEqual([
      { type: 'mouseMoved', x: 12, y: 34 },
      { type: 'mousePressed', x: 12, y: 34, button: 'left', clickCount: 1 },
      { type: 'mouseReleased', x: 12, y: 34, button: 'left', clickCount: 1 },
    ]);
  });

  it('builds the Enter keyDown/keyUp pair with the CR text on keyDown only', () => {
    const [down, up] = enterKeyEvents();
    expect(down).toEqual({
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
      text: '\r',
      unmodifiedText: '\r',
    });
    expect(up).toEqual({
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
  });
});

describe('constants and naming', () => {
  it('anchors the scroll wheel at the pod-mode viewport center', () => {
    expect(SCROLL_ANCHOR).toEqual({ x: 640, y: 400 });
  });

  it('names frames with the reserved artifact prefix and screenshots without it', () => {
    expect(frameName(3)).toBe('aion-browser-frame-3.jpg');
    expect(screenshotName(3)).toBe('screenshot-3.png');
    expect(screenshotName(3).startsWith('aion-')).toBe(false);
  });

  it('captures viewfinder frames at the pod-mode JPEG quality', () => {
    expect(FRAME_JPEG_QUALITY).toBe(55);
  });

  it('firstLine trims at the first newline', () => {
    expect(firstLine('a\nb')).toBe('a');
    expect(firstLine('a')).toBe('a');
  });
});
