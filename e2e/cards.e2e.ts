// Cards desktop E2E: the REAL desktop app in remote-backend mode against the
// eigent-local Compose edge, asserting the L4 claim — tool activity renders as
// TYPED cards on both surfaces. A bash call is a command card (`$ command`
// prominent), a written file is a code card backed by a real Monaco editor,
// a browser action is an action/target card; and the same cards appear in the
// chat timeline (interleaved where the call happened) and inside the work-log
// row's fold.
//
// The deterministic drivers are existing fixtures: `aion-default`
// (tool-sequence: write_file vertical.txt → bash `cat vertical.txt` → answer)
// covers the code and bash lanes; `aion-browser` (browser-sequence:
// write_file test.html → visit → snapshot → click → screenshot) covers the
// browser lane but needs the stack's browser workspace template; `aion-fast`
// (echo, no tools) is the negative control — zero cards.
//
// Needs the stack in fixture-picker mode:
//   EIGENT_LOCAL_FIXTURE_PICKER=1 bazel run //dev/eigent_local:up   (in aion-v1)
//   EIGENT_E2E_FIXTURE_PICKER=1 npx playwright test --config e2e/playwright.config.ts cards
// The browser-lane test additionally needs browser mode on the same stack:
//   AION_BROWSER_TEMPLATE=browser-workspace EIGENT_LOCAL_FIXTURE_PICKER=1 … up
//   EIGENT_E2E_BROWSER_MODE=1 EIGENT_E2E_FIXTURE_PICKER=1 npx playwright test … cards
//
// The desktop API key comes from the gitignored run manifest and rides ONLY
// the env of the launched app — never a committed file or evidence output.

import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installPackagedApp, type PackagedInstall } from './packaged';

const REPO_ROOT =
  process.env.EIGENT_E2E_APP_DIR ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_BUILT = fs.existsSync(
  path.join(REPO_ROOT, 'dist-electron', 'main', 'index.js')
);
const BOOTSTRAP_PATH =
  process.env.EIGENT_E2E_BOOTSTRAP ??
  path.resolve(REPO_ROOT, '../aion-v1/deploy/eigent-local/run/bootstrap.json');
const EVIDENCE_DIR = process.env.EIGENT_E2E_EVIDENCE_DIR;
const PACKAGED_SOURCE = process.env.EIGENT_E2E_PACKAGED_APP;
let packaged: PackagedInstall | null = null;

/** fakeroute tool-sequence: write_file vertical.txt → bash cat → answer. */
const TOOLS_ALIAS = 'aion-default';
/** fakeroute browser-sequence: write_file test.html → 4 browser_* calls. */
const BROWSER_ALIAS = 'aion-browser';
/** fakeroute echo: answers directly, no tools — the zero-cards control. */
const CONTROL_ALIAS = 'aion-fast';

const TERMINAL_KINDS = ['run_completed', 'run_failed', 'run_cancelled'];
const TURN_TIMEOUT_MS = 180_000;

interface Bootstrap {
  api_key: string;
  edge_url: string;
  tenant_id: string;
}

interface EdgeEvent {
  kind: string;
  run_id?: string;
  data?: Record<string, unknown>;
}

function readBootstrap(): Bootstrap | null {
  try {
    const raw = JSON.parse(fs.readFileSync(BOOTSTRAP_PATH, 'utf-8'));
    if (typeof raw.api_key !== 'string' || typeof raw.edge_url !== 'string') {
      return null;
    }
    return raw as Bootstrap;
  } catch {
    return null;
  }
}

const bootstrap = readBootstrap();
const edgeBaseUrl = bootstrap
  ? `${bootstrap.edge_url.replace(/\/+$/, '')}/eigent/v1`
  : null;
let edgeReady = false;
let workDir: string;
let keyFile: string;

test.beforeAll(async () => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-cards-'));
  if (bootstrap && edgeBaseUrl) {
    try {
      const response = await fetch(`${edgeBaseUrl}/status`, {
        signal: AbortSignal.timeout(3_000),
      });
      edgeReady = response.ok;
    } catch {
      edgeReady = false;
    }
    keyFile = path.join(workDir, 'edge-api-key');
    fs.writeFileSync(keyFile, bootstrap.api_key, { mode: 0o600 });
  }
  if (PACKAGED_SOURCE) {
    packaged = installPackagedApp(PACKAGED_SOURCE);
  }
});

test.afterAll(() => {
  if (workDir) {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
  if (packaged) {
    fs.rmSync(packaged.installDir, { recursive: true, force: true });
  }
});

function launchEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value;
  }
  delete env.VITE_DEV_SERVER_URL;
  env.EIGENT_E2E_USER_DATA = fs.mkdtempSync(path.join(workDir, 'user-data-'));
  return { ...env, ...extra };
}

async function findMainWindow(app: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const main = app
      .windows()
      .find((w) => w.url().includes('/dist/index.html'));
    if (main) return main;
    if (Date.now() > deadline) {
      const urls = app.windows().map((w) => w.url());
      throw new Error(
        `main renderer window not found among: ${urls.join(', ')}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const extra = {
    EIGENT_REMOTE_BACKEND_URL: edgeBaseUrl!,
    EIGENT_REMOTE_BACKEND_API_KEY_FILE: keyFile,
    EIGENT_REMOTE_BACKEND_API_KEY: '',
  };
  const app = await electron.launch(
    packaged
      ? {
          executablePath: packaged.executablePath,
          args: [],
          env: launchEnv(extra),
        }
      : { args: [REPO_ROOT], cwd: REPO_ROOT, env: launchEnv(extra) }
  );
  const page = await findMainWindow(app);
  return { app, page };
}

async function screenshot(page: Page, name: string): Promise<void> {
  if (!EVIDENCE_DIR) return;
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `eigent-cards-${name}.png`),
    fullPage: true,
  });
}

function writeEvidence(name: string, summary: Record<string, unknown>): void {
  if (!EVIDENCE_DIR) return;
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const payload = JSON.stringify(summary, null, 2);
  if (bootstrap && payload.includes(bootstrap.api_key)) {
    throw new Error('evidence summary would leak the API key');
  }
  fs.writeFileSync(path.join(EVIDENCE_DIR, name), payload);
}

/**
 * A browser run publishes viewfinder frames the UI fetches under presigned
 * grants (the edge mints a signed GET on the object store instead of proxying
 * the bytes) — that is the one legitimate off-edge shape, recognizable by the
 * signature on the query.
 */
function isPresignedFetch(raw: string): boolean {
  try {
    const url = new URL(raw);
    return [...url.searchParams.keys()].some((key) =>
      /^x-(amz|goog)-signature$/i.test(key)
    );
  } catch {
    return false;
  }
}

function auditEdgeOnly(urls: string[], origin: string): string[] {
  return urls
    .filter((u) => /^https?:/.test(u))
    .filter((u) => !u.startsWith(origin))
    .filter((u) => !isPresignedFetch(u));
}

/**
 * Replays a finished project's trajectory from the edge — the product's own
 * record of the run, independent of anything the renderer drew.
 */
async function readTrajectory(projectId: string): Promise<EdgeEvent[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  const events: EdgeEvent[] = [];
  try {
    const response = await fetch(
      `${edgeBaseUrl}/projects/${encodeURIComponent(projectId)}/events?after=0`,
      {
        headers: { Authorization: `Bearer ${bootstrap!.api_key}` },
        signal: controller.signal,
      }
    );
    if (!response.ok || !response.body) {
      throw new Error(`event stream failed: ${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return events;
      buffer += decoder.decode(value, { stream: true });
      let frameEnd: number;
      while ((frameEnd = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data: '))
          .map((line) => line.slice(6))
          .join('\n');
        if (!data) continue; // retry hint or keep-alive comment
        const event = JSON.parse(data) as EdgeEvent;
        events.push(event);
        if (TERMINAL_KINDS.includes(event.kind)) return events;
      }
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/** Pins one alias for new conversations, the way the model picker persists it. */
async function pinAlias(page: Page, alias: string): Promise<void> {
  await page.evaluate((selectedAlias) => {
    localStorage.setItem(
      'aion-model-store',
      JSON.stringify({ state: { selectedAlias }, version: 0 })
    );
  }, alias);
  await page.reload();
}

/** A fresh Space, so the turn is its own project and its own trajectory. */
async function newSpace(page: Page): Promise<ReturnType<Page['locator']>> {
  await page.evaluate(() => {
    window.location.hash = '#/';
  });
  await page.reload();
  await page.locator('#active-space-title-btn').click();
  await page.getByText('Create a new space', { exact: true }).first().click();
  const composer = page
    .locator('[role="textbox"][contenteditable="true"]')
    .first();
  await composer.waitFor({ state: 'visible', timeout: 30_000 });
  await page
    .getByText('Create a new space', { exact: true })
    .waitFor({ state: 'hidden', timeout: 10_000 })
    .catch(() => {});
  return composer;
}

/** Runs one composer turn to settlement (no editable→locked composer left). */
async function runTurn(page: Page, prompt: string): Promise<void> {
  const composer = await newSpace(page);
  await composer.click();
  await page.keyboard.insertText(prompt);
  await composer.press('Enter');
  const busy = page.locator('[role="textbox"][contenteditable="false"]');
  await busy
    .first()
    .waitFor({ state: 'attached', timeout: 120_000 })
    .catch(() => {});
  await expect(busy).toHaveCount(0, { timeout: TURN_TIMEOUT_MS });
}

/** Opens the work log and expands every agent group (collapsed = unmounted). */
async function openWorkLog(page: Page): Promise<void> {
  const toggle = page.getByTestId('work-log-toggle').last();
  await toggle.waitFor({ state: 'visible', timeout: 60_000 });
  await expect(async () => {
    if ((await toggle.getAttribute('data-open')) !== 'true') {
      await toggle.click();
    }
    await expect(toggle).toHaveAttribute('data-open', 'true', {
      timeout: 2_000,
    });
  }).toPass({ timeout: 30_000 });
  const groups = page.getByTestId('work-log-agent-group');
  for (let i = 0; i < (await groups.count()); i++) {
    const group = groups.nth(i);
    if ((await group.getAttribute('aria-expanded')) !== 'true') {
      await group.click().catch(() => {});
    }
  }
}

function watchProjects(page: Page, projectIds: string[]): void {
  page.on('response', (response) => {
    const request = response.request();
    if (
      request.method() !== 'POST' ||
      !response.url().endsWith('/projects') ||
      response.status() !== 201
    ) {
      return;
    }
    void response
      .json()
      .then((body: { project_id?: string }) => {
        if (body.project_id) projectIds.push(body.project_id);
      })
      .catch(() => {});
  });
}

function toolCalls(events: EdgeEvent[]): EdgeEvent[] {
  return events.filter((e) => e.kind === 'tool_call');
}

test('bash and code cards render inline and in the work-log fold; text-only runs render none', async () => {
  test.skip(
    process.env.EIGENT_E2E_FIXTURE_PICKER !== '1',
    'needs the fixture-picker stack (EIGENT_LOCAL_FIXTURE_PICKER=1 up + EIGENT_E2E_FIXTURE_PICKER=1)'
  );
  test.skip(
    !bootstrap || !edgeReady || !APP_BUILT,
    'eigent-local stack not running or app not built'
  );
  test.setTimeout(600_000);

  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
    tools_alias: TOOLS_ALIAS,
    control_alias: CONTROL_ALIAS,
  };
  const { app, page } = await launchApp();
  const networkUrls: string[] = [];
  page.on('request', (request) => networkUrls.push(request.url()));
  const projectIds: string[] = [];
  watchProjects(page, projectIds);

  try {
    await page
      .locator('[role="textbox"]')
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 });

    // ---- Pass 1: tool-sequence — one code card, one bash card, in order. --
    await pinAlias(page, TOOLS_ALIAS);
    await runTurn(page, 'cards fixture payload');

    // The work log is closed, so every card on screen is a chat-timeline
    // card: the write_file code card and the bash card, in call order.
    const chatCards = page.locator('[data-testid^="tool-card-"]');
    await expect(page.getByTestId('tool-card-code')).toHaveCount(1, {
      timeout: 30_000,
    });
    await expect(page.getByTestId('tool-card-bash')).toHaveCount(1);
    const lanes = await chatCards.evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute('data-testid'))
    );
    summary.chat_card_order = lanes;
    expect(lanes).toEqual(['tool-card-code', 'tool-card-bash']);

    const codeCard = page.getByTestId('tool-card-code');
    await expect(codeCard).toContainText('vertical.txt');
    await expect(codeCard).toHaveAttribute('data-tool-card-status', 'done');
    const bashCard = page.getByTestId('tool-card-bash');
    await expect(bashCard).toContainText('cat vertical.txt');
    await expect(bashCard).toHaveAttribute('data-tool-card-status', 'done');

    // The code viewer is a REAL Monaco editor: the card reports the editor's
    // own onMount, and monaco's DOM is present showing the written body.
    await expect(
      page
        .locator('[data-testid="tool-card-code"] [data-monaco-ready="1"]')
        .first()
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.monaco-editor').first()).toBeVisible();
    await expect(codeCard).toContainText('cards fixture payload');
    summary.monaco_mounted = true;
    await screenshot(page, 'chat-code-bash');

    // ---- The SAME cards inside the work-log fold. -------------------------
    await openWorkLog(page);
    const rows = page.locator('[data-tool-status]');
    const rowCount = await rows.count();
    summary.work_log_rows = rowCount;
    expect(rowCount).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < rowCount; i++) {
      await rows.nth(i).locator('button').first().click();
    }
    // One extra card of each lane materializes inside the opened folds.
    await expect(page.getByTestId('tool-card-bash')).toHaveCount(2, {
      timeout: 30_000,
    });
    await expect(page.getByTestId('tool-card-code')).toHaveCount(2);
    await screenshot(page, 'work-log-fold');

    // ---- The durable record matches the cards drawn. ----------------------
    await expect(async () => {
      expect(projectIds.length).toBeGreaterThan(0);
    }).toPass({ timeout: 30_000 });
    const projectId = projectIds[0];
    const events = await readTrajectory(projectId);
    summary.project_id = projectId;
    summary.terminal = events.at(-1)?.kind;
    expect(summary.terminal).toBe('run_completed');
    const calls = toolCalls(events);
    summary.tool_calls = calls.map((e) => e.data?.tool_name);
    expect(summary.tool_calls).toEqual(['write_file', 'bash']);

    // ---- Pass 2: the negative control — text only, zero cards. ------------
    await pinAlias(page, CONTROL_ALIAS);
    await runTurn(page, 'control probe');
    await expect(page.locator('[data-testid^="tool-card-"]')).toHaveCount(0);
    await screenshot(page, 'control');

    await expect(async () => {
      expect(projectIds.length).toBeGreaterThan(1);
    }).toPass({ timeout: 30_000 });
    const controlProjectId = projectIds.find((id) => id !== projectId)!;
    const controlEvents = await readTrajectory(controlProjectId);
    summary.control_project_id = controlProjectId;
    summary.control_terminal = controlEvents.at(-1)?.kind;
    expect(summary.control_terminal).toBe('run_completed');
    expect(toolCalls(controlEvents)).toHaveLength(0);

    const offEdge = auditEdgeOnly(networkUrls, new URL(edgeBaseUrl!).origin);
    expect(offEdge).toEqual([]);
    // An empty off-edge set is vacuous unless the renderer made requests.
    expect(
      networkUrls.filter((u) => /^https?:/.test(u)).length
    ).toBeGreaterThan(0);
    summary.off_edge_requests = offEdge;
    writeEvidence('eigent-cards-summary.json', summary);
  } finally {
    await app.close();
  }
});

test('browser actions render as browser cards on both surfaces', async () => {
  test.skip(
    process.env.EIGENT_E2E_FIXTURE_PICKER !== '1',
    'needs the fixture-picker stack (EIGENT_LOCAL_FIXTURE_PICKER=1 up + EIGENT_E2E_FIXTURE_PICKER=1)'
  );
  test.skip(
    process.env.EIGENT_E2E_BROWSER_MODE !== '1',
    'stack not in browser mode (set AION_BROWSER_TEMPLATE on the stack and EIGENT_E2E_BROWSER_MODE=1 here)'
  );
  test.skip(
    !bootstrap || !edgeReady || !APP_BUILT,
    'eigent-local stack not running or app not built'
  );
  test.setTimeout(600_000);

  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
    browser_alias: BROWSER_ALIAS,
  };
  const { app, page } = await launchApp();
  const networkUrls: string[] = [];
  page.on('request', (request) => networkUrls.push(request.url()));
  const projectIds: string[] = [];
  watchProjects(page, projectIds);

  try {
    await page
      .locator('[role="textbox"]')
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 });

    await pinAlias(page, BROWSER_ALIAS);
    // Pod provisioning + Chrome startup ride the first browser call: the
    // fixture turn gets the browser-train leash, not the text-turn one.
    const composer = await newSpace(page);
    await composer.click();
    await page.keyboard.insertText('drive the browser fixture');
    await composer.press('Enter');
    const busy = page.locator('[role="textbox"][contenteditable="false"]');
    await busy
      .first()
      .waitFor({ state: 'attached', timeout: 120_000 })
      .catch(() => {});
    await expect(busy).toHaveCount(0, { timeout: 420_000 });

    // Chat timeline: the page write is a code card, then four browser-action
    // cards — visit, snapshot, click, screenshot — each settled.
    await expect(page.getByTestId('tool-card-browser')).toHaveCount(4, {
      timeout: 30_000,
    });
    await expect(page.getByTestId('tool-card-code')).toHaveCount(1);
    const visitCard = page.getByTestId('tool-card-browser').first();
    await expect(visitCard).toContainText('visit page');
    await expect(visitCard).toContainText('test.html');
    for (let i = 0; i < 4; i++) {
      await expect(
        page.getByTestId('tool-card-browser').nth(i)
      ).toHaveAttribute('data-tool-card-status', 'done');
    }
    await screenshot(page, 'chat-browser');

    // Work-log folds carry the same browser cards.
    await openWorkLog(page);
    const rows = page.locator('[data-tool-status]');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThanOrEqual(5);
    for (let i = 0; i < rowCount; i++) {
      await rows.nth(i).locator('button').first().click();
    }
    await expect(page.getByTestId('tool-card-browser')).toHaveCount(8, {
      timeout: 30_000,
    });
    await screenshot(page, 'work-log-browser');

    // Durable record: the five calls the cards drew, in order, run completed.
    await expect(async () => {
      expect(projectIds.length).toBeGreaterThan(0);
    }).toPass({ timeout: 30_000 });
    const projectId = projectIds[0];
    const events = await readTrajectory(projectId);
    summary.project_id = projectId;
    summary.terminal = events.at(-1)?.kind;
    expect(summary.terminal).toBe('run_completed');
    const calls = toolCalls(events).map((e) => e.data?.tool_name);
    summary.tool_calls = calls;
    expect(calls).toEqual([
      'write_file',
      'browser_visit_page',
      'browser_get_page_snapshot',
      'browser_click',
      'browser_get_screenshot',
    ]);

    const offEdge = auditEdgeOnly(networkUrls, new URL(edgeBaseUrl!).origin);
    expect(offEdge).toEqual([]);
    expect(
      networkUrls.filter((u) => /^https?:/.test(u)).length
    ).toBeGreaterThan(0);
    summary.off_edge_requests = offEdge;
    writeEvidence('eigent-cards-browser-summary.json', summary);
  } finally {
    await app.close();
  }
});
