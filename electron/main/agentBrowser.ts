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

// The local browser executor: runs delegated browser_* actions in a visible
// window on the user's machine and returns the same browserCtlOut JSON the
// pod-side aion-browserctl prints, so the server renders both through one
// formatter and the model cannot tell where an action ran. Action semantics
// mirror cmd/aion-browserctl/actions.go 1:1 (the pure half lives in
// agentBrowserVerbs.ts; the page scripts in agentBrowserScripts.ts).
//
// The agent's views live OUTSIDE WebViewManager on purpose: its re-parking,
// auto-creation and inactivity sweeps assume product webviews, and any of
// them touching an agent tab mid-delegation would corrupt the run.

import { BrowserWindow, WebContentsView, session } from 'electron';
import log from 'electron-log';
import {
  consoleHookScript,
  snapshotScript,
  refRectScript,
  focusAndClearScript,
  selectScript,
  consoleReadScript,
} from './agentBrowserScripts';
import {
  type ActionArgs,
  type BrowserCtlOut,
  type SnapshotResult,
  type NavigationHistory,
  type ConsoleEntry,
  actionForTool,
  parseActionArgs,
  checkUrlAllowed,
  visitPlan,
  typeFields,
  scrollPlan,
  historyPlan,
  formatSnapshot,
  mouseClickEvents,
  enterKeyEvents,
  SCROLL_ANCHOR,
  FRAME_JPEG_QUALITY,
  frameName,
  screenshotName,
  buildTabs,
  marshalOut,
  firstLine,
} from './agentBrowserVerbs';

export interface AgentBrowserRequest {
  delegationId: string;
  runId: string;
  toolName: string;
  argumentsJson: string;
  /** '' | 'isolated' | 'logged_in' — empty means isolated. */
  sessionMode: string;
}

/** What the renderer POSTs back as the delegation result. */
export interface AgentBrowserResult {
  resultJson: string;
  frameBase64?: string;
  frameName?: string;
  screenshotBase64?: string;
  screenshotName?: string;
}

export interface AgentBrowserStatus {
  windowOpen: boolean;
  takenOver: boolean;
  runId: string | null;
}

// The viewport is part of the contract: click/type x,y coordinates and the
// scroll anchor (640,400) are resolved against this exact size on the pod.
const VIEW_WIDTH = 1280;
const VIEW_HEIGHT = 800;

const ISOLATED_PARTITION = 'persist:agent-browse';
const LOGGED_IN_PARTITION = 'persist:user_login';

// Everything the executor may say over CDP. A verb needing a method outside
// this set is a code change, never data-driven — the debugger of a view
// showing arbitrary web content must not be a general control surface.
const CDP_ALLOWED = new Set([
  'Page.enable',
  'Page.navigate',
  'Page.getNavigationHistory',
  'Page.navigateToHistoryEntry',
  'Page.captureScreenshot',
  'Page.addScriptToEvaluateOnNewDocument',
  'Runtime.evaluate',
  'Input.dispatchMouseEvent',
  'Input.insertText',
  'Input.dispatchKeyEvent',
]);

// A wedged renderer holds a CDP reply forever (the capture-preview-guest
// lesson); time-boxing turns that into a legible in-band error instead of a
// delegation that silently rides out its server-side deadline.
const CDP_TIMEOUT_MS = 10_000;
const READY_TIMEOUT_MS = 8_000;

const TAKE_CONTROL_ERROR =
  'the user took control of the browser; wait, then re-observe the page before continuing';
const WINDOW_CLOSED_ERROR =
  'the user closed the agent browser window; wait, then re-observe the page before continuing';

// The webview.ts stealth script minus its capture-phase mousedown
// preventDefault: that listener suppresses focus for anything that is not a
// <button>/<input>, which breaks agent clicking on links and custom widgets.
const FINGERPRINT_SCRIPT = `
  const originalLanguages = navigator.languages ? [...navigator.languages] : ['en-US', 'en'];
  const originalHardwareConcurrency = navigator.hardwareConcurrency || 8;
  const originalDeviceMemory = navigator.deviceMemory || 8;

  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
    configurable: true
  });

  Object.defineProperty(navigator, 'plugins', {
    get: () => {
      const plugins = {
        length: 3,
        0: { name: 'Chrome PDF Plugin', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
        1: { name: 'Chrome PDF Viewer', description: '', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
        2: { name: 'Native Client', description: '', filename: 'internal-nacl-plugin' },
        item: function(index) { return this[index] || null; },
        namedItem: function(name) {
          for (let i = 0; i < this.length; i++) {
            if (this[i].name === name) return this[i];
          }
          return null;
        },
        refresh: function() {},
        [Symbol.iterator]: function* () {
          for (let i = 0; i < this.length; i++) {
            yield this[i];
          }
        }
      };
      return plugins;
    },
    configurable: true
  });

  Object.defineProperty(navigator, 'languages', {
    get: () => originalLanguages,
    configurable: true
  });

  Object.defineProperty(navigator, 'hardwareConcurrency', {
    get: () => Math.min(Math.max(originalHardwareConcurrency, 4), 16),
    configurable: true
  });

  Object.defineProperty(navigator, 'deviceMemory', {
    get: () => Math.min(Math.max(originalDeviceMemory, 4), 16),
    configurable: true
  });

  const getParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(parameter) {
    if (parameter === 37445) return 'Intel Inc.';
    if (parameter === 37446) return 'Intel(R) Iris(TM) Graphics 6100';
    return getParameter.call(this, parameter);
  };

  if (typeof WebGL2RenderingContext !== 'undefined') {
    const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function(parameter) {
      if (parameter === 37445) return 'Intel Inc.';
      if (parameter === 37446) return 'Intel(R) Iris(TM) Graphics 6100';
      return getParameter2.call(this, parameter);
    };
  }

  if (!window.chrome) {
    window.chrome = {};
  }

  const automationVars = ['__webdriver_evaluate', '__selenium_evaluate', '__webdriver_script_fn',
    '__driver_evaluate', '__fxdriver_evaluate', '__driver_unwrapped', 'domAutomation', 'domAutomationController'];
  automationVars.forEach(v => {
    Object.defineProperty(window, v, {
      get: () => undefined,
      set: () => {},
      configurable: true,
      enumerable: false
    });
  });
`;

interface AgentTab {
  tabId: string;
  view: WebContentsView;
}

interface VerbOutcome {
  out: BrowserCtlOut;
  frame?: { base64: string; name: string };
  screenshot?: { base64: string; name: string };
}

function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    }),
  ]);
}

export class AgentBrowser {
  private win: BrowserWindow | null = null;
  private tabs = new Map<string, AgentTab>();
  private currentTabId = '';
  private tabCounter = 0;
  private frames = 0;
  private shots = 0;
  private runId: string | null = null;
  private sessionMode: 'isolated' | 'logged_in' = 'isolated';
  private takenOver = false;
  /** The run whose window the user closed — its delegations NACK until a new run. */
  private closedRunId: string | null = null;
  /** Actions serialize: one window, one input stream, one CDP conversation. */
  private chain: Promise<unknown> = Promise.resolve();

  execute(request: AgentBrowserRequest): Promise<AgentBrowserResult> {
    const next = this.chain.then(
      () => this.executeInner(request),
      () => this.executeInner(request)
    );
    this.chain = next.catch(() => undefined);
    return next;
  }

  status(): AgentBrowserStatus {
    return {
      windowOpen: this.win !== null && !this.win.isDestroyed(),
      takenOver: this.takenOver,
      runId: this.runId,
    };
  }

  takeControl(taken: boolean): void {
    this.takenOver = taken;
  }

  private async executeInner(
    request: AgentBrowserRequest
  ): Promise<AgentBrowserResult> {
    const action = actionForTool(request.toolName);
    if (!action) {
      return this.errResult(
        `unknown tool ${JSON.stringify(request.toolName)} (this desktop executes browser tools only)`
      );
    }
    const parsed = parseActionArgs(request.argumentsJson);
    if ('error' in parsed) {
      return this.errResult(parsed.error);
    }
    if (this.takenOver) {
      return this.errResult(TAKE_CONTROL_ERROR);
    }
    if (this.closedRunId !== null && this.closedRunId === request.runId) {
      return this.errResult(WINDOW_CLOSED_ERROR);
    }
    try {
      if (request.runId !== this.runId) {
        await this.beginRun(request);
      }
      this.ensureWindow();
      const outcome = await this.dispatch(action, parsed.args);
      return {
        resultJson: marshalOut(outcome.out),
        ...(outcome.frame
          ? { frameBase64: outcome.frame.base64, frameName: outcome.frame.name }
          : {}),
        ...(outcome.screenshot
          ? {
              screenshotBase64: outcome.screenshot.base64,
              screenshotName: outcome.screenshot.name,
            }
          : {}),
      };
    } catch (e) {
      return this.errResult(firstLine(errText(e)));
    }
  }

  private errResult(message: string): AgentBrowserResult {
    return { resultJson: marshalOut({ error: message }) };
  }

  /**
   * A run boundary resets the tab set and counters; isolated mode also wipes
   * the agent partition so no state leaks between runs. The logged-in
   * partition is the user's own and is never cleared.
   */
  private async beginRun(request: AgentBrowserRequest): Promise<void> {
    this.runId = request.runId;
    this.sessionMode =
      request.sessionMode === 'logged_in' ? 'logged_in' : 'isolated';
    this.frames = 0;
    this.shots = 0;
    this.closedRunId = null;
    this.closeAllTabs();
    if (this.sessionMode === 'isolated') {
      await session.fromPartition(ISOLATED_PARTITION).clearStorageData();
    }
  }

  private partition(): string {
    return this.sessionMode === 'logged_in'
      ? LOGGED_IN_PARTITION
      : ISOLATED_PARTITION;
  }

  private ensureWindow(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) {
      return this.win;
    }
    const win = new BrowserWindow({
      width: VIEW_WIDTH,
      height: VIEW_HEIGHT,
      useContentSize: true,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      autoHideMenuBar: true,
      title: 'Eternyl agent browser',
    });
    win.on('closed', () => {
      // Mid-run this is the kill switch: remaining delegations NACK fast
      // instead of clicking through an invisible page.
      if (this.runId !== null) {
        this.closedRunId = this.runId;
      }
      this.win = null;
      this.tabs.clear();
      this.currentTabId = '';
    });
    this.win = win;
    this.tabs.clear();
    this.currentTabId = '';
    return win;
  }

  private closeAllTabs(): void {
    for (const tab of this.tabs.values()) {
      try {
        if (this.win && !this.win.isDestroyed()) {
          this.win.contentView.removeChildView(tab.view);
        }
        if (!tab.view.webContents.isDestroyed()) {
          tab.view.webContents.close();
        }
      } catch (e) {
        log.warn('agent-browser: tab close failed:', e);
      }
    }
    this.tabs.clear();
    this.currentTabId = '';
  }

  private async createTab(): Promise<AgentTab> {
    const win = this.ensureWindow();
    const view = new WebContentsView({
      webPreferences: {
        partition: this.partition(),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        // The window is the live picture; a background window skipping
        // rAF/timers would stall pages mid-delegation.
        backgroundThrottling: false,
        offscreen: false,
        disableBlinkFeatures: 'Accelerated2dCanvas,AutomationControlled',
        enableBlinkFeatures: 'IdleDetection',
        autoplayPolicy: 'document-user-activation-required',
      },
    });
    const wc = view.webContents;
    // Popups stay closed: the agent navigates with browser_visit_page, and a
    // page-opened window would live outside the delegated tab set.
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('did-finish-load', () => {
      wc.executeJavaScript(FINGERPRINT_SCRIPT).catch(() => {});
    });
    // Persistent attach for the tab's whole life — per-action attach/detach
    // would race page teardown and re-arm banner UI on some sites.
    wc.debugger.attach('1.3');
    const tabId = `tab-${++this.tabCounter}`;
    const tab: AgentTab = { tabId, view };
    this.tabs.set(tabId, tab);
    this.currentTabId = tabId;
    view.setBounds({ x: 0, y: 0, width: VIEW_WIDTH, height: VIEW_HEIGHT });
    win.contentView.addChildView(view);
    await this.cdp(tab, 'Page.enable');
    // The console hook rides every future document; the eval covers the
    // current one (about:blank) so history never has a gap.
    await this.cdp(tab, 'Page.addScriptToEvaluateOnNewDocument', {
      source: consoleHookScript,
    });
    await wc.loadURL('about:blank');
    await this.evalRaw(tab, consoleHookScript);
    return tab;
  }

  private async ensureTab(): Promise<AgentTab> {
    const current = this.tabs.get(this.currentTabId);
    if (current && !current.view.webContents.isDestroyed()) {
      return current;
    }
    return this.createTab();
  }

  private async cdp<T = Record<string, unknown>>(
    tab: AgentTab,
    method: string,
    params?: Record<string, unknown>
  ): Promise<T> {
    if (!CDP_ALLOWED.has(method)) {
      throw new Error(`CDP method ${method} is not allowlisted`);
    }
    const wc = tab.view.webContents;
    if (wc.isDestroyed() || !wc.debugger.isAttached()) {
      throw new Error('the agent browser tab is gone');
    }
    return (await withTimeout(
      wc.debugger.sendCommand(method, params),
      CDP_TIMEOUT_MS,
      method
    )) as T;
  }

  /** Evaluates a script that returns a JSON string and parses it. */
  private async evalStringJSON<T>(tab: AgentTab, expression: string): Promise<T> {
    const res = await this.cdp<{
      result?: { type?: string; value?: unknown };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    }>(tab, 'Runtime.evaluate', { expression, returnByValue: true });
    if (res.exceptionDetails) {
      throw new Error(
        res.exceptionDetails.exception?.description ??
          res.exceptionDetails.text ??
          'script failed'
      );
    }
    if (typeof res.result?.value !== 'string') {
      throw new Error('script returned no result');
    }
    return JSON.parse(res.result.value) as T;
  }

  /** console_exec's evaluate: the page value verbatim, undefined as "undefined". */
  private async evalRaw(
    tab: AgentTab,
    expression: string
  ): Promise<{ value: unknown } | { error: string }> {
    const res = await this.cdp<{
      result?: { type?: string; value?: unknown };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    }>(tab, 'Runtime.evaluate', { expression, returnByValue: true });
    if (res.exceptionDetails) {
      return {
        error:
          res.exceptionDetails.exception?.description ??
          res.exceptionDetails.text ??
          'script failed',
      };
    }
    if (!res.result || res.result.type === 'undefined') {
      return { value: 'undefined' };
    }
    return { value: res.result.value === undefined ? null : res.result.value };
  }

  private async waitReady(tab: AgentTab): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const res = await this.cdp<{ result?: { value?: unknown } }>(
          tab,
          'Runtime.evaluate',
          { expression: 'document.readyState', returnByValue: true }
        );
        if (res.result?.value === 'complete') return;
      } catch {
        // A navigating document drops evaluations; keep polling.
      }
      await sleep(100);
    }
  }

  private async waitURLChange(tab: AgentTab, preURL: string): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const res = await this.cdp<{ result?: { value?: unknown } }>(
          tab,
          'Runtime.evaluate',
          { expression: 'location.href', returnByValue: true }
        );
        if (typeof res.result?.value === 'string' && res.result.value !== preURL) {
          return;
        }
      } catch {
        // Navigation in flight; keep polling.
      }
      await sleep(100);
    }
  }

  /**
   * Viewfinder frame of the current page. Every failure is silent, exactly
   * like the pod: the frame is for a human watching, and failing the action
   * over it would cost the work the action just did.
   */
  private async captureFrame(
    tab: AgentTab
  ): Promise<{ base64: string; name: string } | undefined> {
    try {
      const res = await this.cdp<{ data?: string }>(tab, 'Page.captureScreenshot', {
        format: 'jpeg',
        quality: FRAME_JPEG_QUALITY,
      });
      if (!res.data) return undefined;
      this.frames++;
      return { base64: res.data, name: frameName(this.frames) };
    } catch {
      return undefined;
    }
  }

  /** actions.go's finish(): settle, photograph, snapshot — in that order. */
  private async finish(tab: AgentTab, out: BrowserCtlOut): Promise<VerbOutcome> {
    await this.waitReady(tab);
    const frame = await this.captureFrame(tab);
    try {
      const snap = await this.evalStringJSON<SnapshotResult>(tab, snapshotScript);
      out.url = snap.url;
      out.title = snap.title;
      out.snapshot = formatSnapshot(snap);
    } catch (e) {
      out.note = `${out.note ?? ''} snapshot unavailable: ${firstLine(errText(e))}`.trim();
    }
    return { out, frame };
  }

  private tabRows(): { tabId: string; url: string; title: string }[] {
    const rows: { tabId: string; url: string; title: string }[] = [];
    for (const tab of this.tabs.values()) {
      const wc = tab.view.webContents;
      if (wc.isDestroyed()) continue;
      rows.push({ tabId: tab.tabId, url: wc.getURL(), title: wc.getTitle() });
    }
    return rows;
  }

  private addTabs(outcome: VerbOutcome): VerbOutcome {
    outcome.out.tabs = buildTabs(this.tabRows(), this.currentTabId);
    outcome.out.current_tab = this.currentTabId;
    return outcome;
  }

  private async mouseClick(tab: AgentTab, x: number, y: number): Promise<void> {
    for (const ev of mouseClickEvents(x, y)) {
      await this.cdp(tab, 'Input.dispatchMouseEvent', ev);
    }
  }

  /** refRectJS resolution or literal coordinates — resolvePoint in actions.go. */
  private async resolvePoint(
    tab: AgentTab,
    args: ActionArgs
  ): Promise<{ x: number; y: number } | { error: string }> {
    if (args.ref) {
      const res = await this.evalStringJSON<{
        error?: string;
        x?: number;
        y?: number;
      }>(tab, refRectScript(args.ref));
      if (res.error) return { error: res.error };
      return { x: res.x ?? 0, y: res.y ?? 0 };
    }
    if (args.x !== undefined && args.y !== undefined) {
      return { x: args.x, y: args.y };
    }
    return { error: 'ref or x/y coordinates required' };
  }

  private async dispatch(action: string, args: ActionArgs): Promise<VerbOutcome> {
    switch (action) {
      case 'open':
        return this.doOpen();
      case 'visit':
        return this.doVisit(args);
      case 'click':
        return this.doClick(args);
      case 'type':
        return this.doType(args);
      case 'enter':
        return this.doEnter();
      case 'select':
        return this.doSelect(args);
      case 'scroll':
        return this.doScroll(args);
      case 'back':
        return this.doHistory(-1);
      case 'forward':
        return this.doHistory(1);
      case 'snapshot':
        return this.doSnapshot();
      case 'switch_tab':
        return this.doSwitchTab(args);
      case 'console_exec':
        return this.doConsoleExec(args);
      case 'console_view':
        return this.doConsoleView();
      case 'screenshot':
        return this.doScreenshot();
      default:
        return { out: { error: `unknown action ${JSON.stringify(action)}` } };
    }
  }

  private async doOpen(): Promise<VerbOutcome> {
    const tab = await this.ensureTab();
    const outcome = await this.finish(tab, { result: 'browser session ready' });
    return this.addTabs(outcome);
  }

  private async doVisit(args: ActionArgs): Promise<VerbOutcome> {
    if (!args.url) {
      return { out: { error: 'url is required' } };
    }
    const denied = checkUrlAllowed(args.url);
    if (denied) {
      return { out: { error: denied } };
    }
    let tab = await this.ensureTab();
    const plan = visitPlan(args.url, tab.view.webContents.getURL());
    if (plan.newTab) {
      tab = await this.createTab();
    }
    const preURL = tab.view.webContents.getURL();
    await this.cdp(tab, 'Page.navigate', { url: args.url });
    if (preURL !== args.url) {
      await this.waitURLChange(tab, preURL);
    }
    const outcome = await this.finish(tab, { result: plan.result });
    return this.addTabs(outcome);
  }

  private async doClick(args: ActionArgs): Promise<VerbOutcome> {
    const tab = await this.ensureTab();
    const point = await this.resolvePoint(tab, args);
    if ('error' in point) {
      return { out: { error: point.error } };
    }
    await this.mouseClick(tab, point.x, point.y);
    return this.finish(tab, { result: 'clicked' });
  }

  private async doType(args: ActionArgs): Promise<VerbOutcome> {
    const resolved = typeFields(args);
    if ('error' in resolved) {
      return { out: { error: resolved.error } };
    }
    const tab = await this.ensureTab();
    for (let i = 0; i < resolved.fields.length; i++) {
      const field = resolved.fields[i];
      if (field.ref) {
        const res = await this.evalStringJSON<{ error?: string }>(
          tab,
          focusAndClearScript(field.ref)
        );
        if (res.error) {
          return { out: { error: res.error } };
        }
      } else if (i === 0 && args.x !== undefined && args.y !== undefined) {
        await this.mouseClick(tab, args.x, args.y);
      }
      await this.cdp(tab, 'Input.insertText', { text: field.text });
    }
    const noun =
      resolved.fields.length > 1 ? `${resolved.fields.length} fields` : 'field';
    return this.finish(tab, { result: `typed into ${noun}` });
  }

  private async doEnter(): Promise<VerbOutcome> {
    const tab = await this.ensureTab();
    for (const ev of enterKeyEvents()) {
      await this.cdp(tab, 'Input.dispatchKeyEvent', ev);
    }
    return this.finish(tab, { result: 'pressed Enter' });
  }

  private async doSelect(args: ActionArgs): Promise<VerbOutcome> {
    if (!args.ref || !args.value) {
      return { out: { error: 'ref and value are required' } };
    }
    const tab = await this.ensureTab();
    const res = await this.evalStringJSON<{ error?: string; selected?: string }>(
      tab,
      selectScript(args.ref, args.value)
    );
    if (res.error) {
      return { out: { error: res.error } };
    }
    return this.finish(tab, { result: `selected ${res.selected ?? ''}` });
  }

  private async doScroll(args: ActionArgs): Promise<VerbOutcome> {
    const plan = scrollPlan(args);
    if ('error' in plan) {
      return { out: { error: plan.error } };
    }
    const tab = await this.ensureTab();
    await this.cdp(tab, 'Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: SCROLL_ANCHOR.x,
      y: SCROLL_ANCHOR.y,
      deltaX: plan.dx,
      deltaY: plan.dy,
    });
    return this.finish(tab, { result: plan.result });
  }

  private async doHistory(delta: -1 | 1): Promise<VerbOutcome> {
    const tab = await this.ensureTab();
    const hist = await this.cdp<NavigationHistory>(tab, 'Page.getNavigationHistory');
    const plan = historyPlan(hist, delta);
    if (plan.kind === 'edge') {
      return this.finish(tab, { result: plan.result });
    }
    await this.cdp(tab, 'Page.navigateToHistoryEntry', { entryId: plan.entryId });
    return this.finish(tab, { result: plan.result });
  }

  private async doSnapshot(): Promise<VerbOutcome> {
    const tab = await this.ensureTab();
    return this.finish(tab, {});
  }

  private async doSwitchTab(args: ActionArgs): Promise<VerbOutcome> {
    if (!args.tab_id) {
      return { out: { error: 'tab_id is required' } };
    }
    const tab = this.tabs.get(args.tab_id);
    if (!tab || tab.view.webContents.isDestroyed()) {
      return {
        out: {
          error: `unknown tab_id ${JSON.stringify(args.tab_id)} (see the tabs list)`,
        },
      };
    }
    const win = this.ensureWindow();
    // Re-adding an attached view raises it to the top of the stack.
    win.contentView.addChildView(tab.view);
    this.currentTabId = tab.tabId;
    const outcome = await this.finish(tab, { result: 'switched tab' });
    return this.addTabs(outcome);
  }

  private async doConsoleExec(args: ActionArgs): Promise<VerbOutcome> {
    if (!args.code) {
      return { out: { error: 'code is required' } };
    }
    if (this.sessionMode === 'logged_in') {
      // Arbitrary JS inside the user's authenticated origins is the sharpest
      // injection primitive a hostile page could ask for; isolated mode keeps
      // the verb, logged-in mode refuses it.
      return {
        out: {
          error:
            'browser_console_exec is not available when using your logged-in browser sessions',
        },
      };
    }
    const tab = await this.ensureTab();
    const res = await this.evalRaw(tab, args.code);
    if ('error' in res) {
      return { out: { error: res.error } };
    }
    const out: BrowserCtlOut = { result: 'evaluated', value: res.value };
    // console_exec skips finish() — the model asked for a value, not a
    // snapshot — but still frames the page: a run navigating by script would
    // otherwise go invisible on the viewfinder.
    const frame = await this.captureFrame(tab);
    return { out, frame };
  }

  private async doConsoleView(): Promise<VerbOutcome> {
    const tab = await this.ensureTab();
    const res = await this.evalStringJSON<{
      entries?: ConsoleEntry[];
      note?: string;
    }>(tab, consoleReadScript);
    const entries = res.entries ?? [];
    return {
      out: {
        result: `${entries.length} console entries`,
        console: entries,
        note: res.note,
      },
    };
  }

  private async doScreenshot(): Promise<VerbOutcome> {
    const tab = await this.ensureTab();
    const res = await this.cdp<{ data?: string }>(tab, 'Page.captureScreenshot', {
      format: 'png',
    });
    if (!res.data) {
      return { out: { error: 'screenshot capture returned no data' } };
    }
    this.shots++;
    const name = screenshotName(this.shots);
    const out: BrowserCtlOut = {
      result: 'captured screenshot',
      path: name,
      size_bytes: Buffer.from(res.data, 'base64').length,
    };
    try {
      const id = await this.evalRaw(
        tab,
        'JSON.stringify({url: location.href, title: document.title})'
      );
      if ('value' in id && typeof id.value === 'string') {
        const parsed = JSON.parse(id.value) as { url?: string; title?: string };
        out.url = parsed.url;
        out.title = parsed.title;
      }
    } catch {
      // Page identity on a screenshot is best-effort, exactly like the pod.
    }
    return { out, screenshot: { base64: res.data, name } };
  }
}

export const agentBrowser = new AgentBrowser();
