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

// The pure half of the local browser executor: tool→action mapping, argument
// validation, CDP payload construction and result shaping, each mirroring
// cmd/aion-browserctl/actions.go 1:1 — down to the literal error strings,
// because the server renders a delegated result through the same formatter as
// a pod result and the model must not be able to tell the two apart. No
// Electron imports, so vitest exercises every decision here directly.

/** The union of every action's JSON arguments (actionArgs in actions.go). */
export interface ActionArgs {
  url?: string;
  ref?: string;
  text?: string;
  inputs?: { ref?: string; text?: string }[];
  value?: string;
  direction?: string;
  amount?: number;
  tab_id?: string;
  code?: string;
  x?: number;
  y?: number;
}

export interface TabOut {
  tab_id: string;
  url: string;
  title: string;
  current?: boolean;
}

export interface ConsoleEntry {
  level: string;
  text: string;
  ts: number;
}

/**
 * The single JSON object every action produces — aion-browserctl's actionOut,
 * minus frame_path/frame_size_bytes: on the pod those name a workspace file
 * for the product to publish, while a delegated frame rides the result POST
 * as its own field and the server never renders either into the model's
 * tool result.
 */
export interface BrowserCtlOut {
  result?: string;
  url?: string;
  title?: string;
  snapshot?: string;
  tabs?: TabOut[];
  current_tab?: string;
  value?: unknown;
  console?: ConsoleEntry[];
  note?: string;
  path?: string;
  size_bytes?: number;
  error?: string;
}

/** Serializes with Go's omitempty semantics so empty fields never appear. */
export function marshalOut(out: BrowserCtlOut): string {
  const clean: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(out)) {
    if (val === undefined || val === null) continue;
    // `value` is Go-side json.RawMessage: a present raw `0`/`""`/`false` from
    // console_exec is data, not emptiness — only absence omits it.
    if (key !== 'value') {
      if (val === '' || val === 0) continue;
      if (Array.isArray(val) && val.length === 0) continue;
    }
    clean[key] = val;
  }
  return JSON.stringify(clean);
}

/**
 * addTabs' row shaping: `current` rides only the current tab (Go omitempty
 * drops the false), keeping delegated bodies field-identical to pod bodies.
 */
export function buildTabs(
  rows: { tabId: string; url: string; title: string }[],
  currentTabId: string
): TabOut[] {
  return rows.map((row) => ({
    tab_id: row.tabId,
    url: row.url,
    title: row.title,
    ...(row.tabId === currentTabId ? { current: true } : {}),
  }));
}

/** The 14 delegated tools, pinned to grpc_browser.go's browserToolSpecs. */
export const TOOL_ACTIONS: Readonly<Record<string, string>> = {
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
};

export function actionForTool(toolName: string): string | null {
  return TOOL_ACTIONS[toolName] ?? null;
}

export function parseActionArgs(
  argumentsJson: string
): { args: ActionArgs } | { error: string } {
  const raw = argumentsJson.trim() === '' ? '{}' : argumentsJson;
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: 'arguments must be a JSON object' };
    }
    return { args: parsed as ActionArgs };
  } catch {
    return { error: 'arguments are not valid JSON' };
  }
}

/**
 * The delegated executor drives a window on the user's machine, so a page
 * scheme that could reach local files or browser internals is refused before
 * navigation regardless of session mode.
 */
export function checkUrlAllowed(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `invalid url ${JSON.stringify(url)}`;
  }
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return null;
  if (parsed.protocol === 'about:' && parsed.pathname === 'blank') return null;
  return `unsupported url scheme ${JSON.stringify(parsed.protocol)} (http, https or about:blank)`;
}

/** doVisit's tab decision: reuse a blank current tab, else open a new one. */
export function visitPlan(
  url: string,
  currentTabUrl: string
): { newTab: boolean; result: string } {
  if (currentTabUrl !== 'about:blank') {
    return { newTab: true, result: `visited ${url} in a new tab` };
  }
  return { newTab: false, result: `visited ${url}` };
}

/** doType's field resolution, including its exact missing-args error. */
export function typeFields(
  args: ActionArgs
): { fields: { ref: string; text: string }[] } | { error: string } {
  const inputs = args.inputs ?? [];
  if (inputs.length === 0) {
    if (!args.ref && args.x === undefined) {
      return { error: 'ref (or x/y), text — or inputs[] — required' };
    }
    return { fields: [{ ref: args.ref ?? '', text: args.text ?? '' }] };
  }
  return {
    fields: inputs.map((f) => ({ ref: f.ref ?? '', text: f.text ?? '' })),
  };
}

/** doScroll's delta computation, including its exact unknown-direction error. */
export function scrollPlan(
  args: ActionArgs
): { dx: number; dy: number; result: string } | { error: string } {
  let amount = args.amount ?? 0;
  if (amount === 0) amount = 500;
  let dx = 0;
  let dy = 0;
  switch (args.direction ?? '') {
    case 'down':
    case '':
      dy = amount;
      break;
    case 'up':
      dy = -amount;
      break;
    case 'right':
      dx = amount;
      break;
    case 'left':
      dx = -amount;
      break;
    default:
      return {
        error: `unknown direction ${JSON.stringify(args.direction)} (up|down|left|right)`,
      };
  }
  const direction = args.direction || 'down';
  return { dx, dy, result: `scrolled ${direction} ${amount}` };
}

export interface NavigationHistory {
  currentIndex: number;
  entries: { id: number; url: string }[];
}

/** doHistory's outcome: navigate to an entry, or report the reached edge. */
export function historyPlan(
  hist: NavigationHistory,
  delta: -1 | 1
):
  | { kind: 'edge'; result: string }
  | { kind: 'navigate'; entryId: number; result: string } {
  const idx = hist.currentIndex + delta;
  if (idx < 0 || idx >= hist.entries.length) {
    const edge = delta > 0 ? 'newest' : 'oldest';
    return { kind: 'edge', result: `already at the ${edge} history entry` };
  }
  const verb = delta > 0 ? 'went forward' : 'went back';
  return {
    kind: 'navigate',
    entryId: hist.entries[idx].id,
    result: `${verb} to ${hist.entries[idx].url}`,
  };
}

export interface SnapshotResult {
  url: string;
  title: string;
  elements: string[];
  truncated: boolean;
}

export function formatSnapshot(s: SnapshotResult): string {
  if (!s.elements || s.elements.length === 0) {
    return '(no interactive elements)';
  }
  let txt = s.elements.join('\n');
  if (s.truncated) {
    txt += '\n(truncated at 150 elements)';
  }
  return txt;
}

/** The mouseClick CDP sequence: move, press, release — left, single click. */
export function mouseClickEvents(
  x: number,
  y: number
): Record<string, unknown>[] {
  return [
    { type: 'mouseMoved', x, y },
    { type: 'mousePressed', x, y, button: 'left', clickCount: 1 },
    { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 },
  ];
}

/** doEnter's key events, byte-matched to actions.go's dispatchKeyEvent pair. */
export function enterKeyEvents(): Record<string, unknown>[] {
  return [
    {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
      text: '\r',
      unmodifiedText: '\r',
    },
    {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    },
  ];
}

/** The scroll wheel anchor — viewport-coupled to the locked 1280x800 window. */
export const SCROLL_ANCHOR = { x: 640, y: 400 } as const;

/**
 * Frame names carry the reserved artifact prefix the ops service validates
 * (`aion-browser-frame-<N>.jpg`); screenshots deliberately do not — a
 * screenshot is the model's evidence, not a viewfinder frame.
 */
export function frameName(n: number): string {
  return `aion-browser-frame-${n}.jpg`;
}

export function screenshotName(n: number): string {
  return `screenshot-${n}.png`;
}

/** The JPEG quality for viewfinder frames (frameQuality in actions.go). */
export const FRAME_JPEG_QUALITY = 55;

export function firstLine(s: string): string {
  const idx = s.indexOf('\n');
  return idx >= 0 ? s.slice(0, idx) : s;
}

/**
 * In-band NACK bodies the executor answers with instead of driving the page.
 * The renderer keeps its own copy of the window-closed string to recognize the
 * kill switch (it cannot import a main-process module), pinned to these by a
 * parity test.
 */
export const TAKE_CONTROL_ERROR =
  'the user took control of the browser; wait, then re-observe the page before continuing';
export const WINDOW_CLOSED_ERROR =
  'the user closed the agent browser window; wait, then re-observe the page before continuing';

/**
 * The agent window's title doubles as its URL strip: the page renders in a
 * child WebContentsView, so nothing a page does can overwrite what setTitle
 * put here — which is what makes it trustworthy enough to state the origin
 * and, when the run borrows the user's logged-in sessions, say so.
 */
export function windowTitle(url: string, loggedIn: boolean): string {
  const suffix = loggedIn
    ? 'Eternyl agent browser — your logged-in sessions'
    : 'Eternyl agent browser';
  return url && url !== 'about:blank' ? `${url} — ${suffix}` : suffix;
}

/**
 * Strips the app and Electron tokens out of a default Electron user agent,
 * leaving the Chrome one. Google's sign-in rejects "embedded framework"
 * browsers on that signal alone (accounts.google.com/v3/signin/rejected —
 * "this browser or app may not be secure"), and the view IS a real Chromium,
 * so presenting only the Chrome part is accurate rather than a disguise.
 *
 * Pure and separate from the caller that reads Electron's `app` because it is
 * the whole difference between reaching a sign-in page and being turned away,
 * and an app name is arbitrary text that lands inside a regex.
 */
export function scrubAgentUserAgent(
  userAgent: string,
  appName: string
): string {
  const escaped = appName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return userAgent
    .replace(new RegExp(`\\s${escaped}/\\S+`, 'i'), '')
    .replace(/\sElectron\/\S+/i, '');
}
