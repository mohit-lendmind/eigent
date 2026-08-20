// Feel desktop E2E: the REAL desktop app in remote-backend mode against the
// eigent-local Compose edge, asserting that a turn's work log tells the truth
// about a finished run — every tool row the trajectory records settles out of
// its running shimmer, the row's Response fold carries the tool's actual
// result, and the header clock reports real elapsed time instead of 0s.
//
// The `aion-default` fixture scripts write_file → bash → answer, so the run's
// trajectory carries exactly two tool_call/tool_result pairs. The assertions
// compare the DOM against that record rather than against literals: one
// settled row per recorded call, the bash row's Response showing the result
// content the edge stored, and the final answer text present in the chat.
// Before this train the bridge never emitted a deactivation, so every row
// shimmered "running" forever over an empty Response block, and the clock
// stayed at 0s because nothing started it on the aion path.
//
// Needs the stack in fixture-picker mode (same requirement as workforce):
//   EIGENT_LOCAL_FIXTURE_PICKER=1 bazel run //dev/eigent_local:up   (in aion-v1)
//   EIGENT_E2E_FIXTURE_PICKER=1 npx playwright test --config e2e/playwright.config.ts feel
//
// Preconditions otherwise match aion-lab.e2e.ts (skipped cleanly when absent).
// The desktop API key comes from the gitignored run manifest and rides ONLY the
// env of the launched app — never a committed file or evidence output.

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

/** internal/inference/fakeroute's `tool-sequence`: write_file, then bash. */
const TOOL_ALIAS = 'aion-default';

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
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-feel-'));
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

const byId = (page: Page, id: string) => page.getByTestId(id);

async function screenshot(page: Page, name: string): Promise<void> {
  if (!EVIDENCE_DIR) return;
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `eigent-feel-${name}.png`),
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

function auditEdgeOnly(urls: string[], origin: string): string[] {
  return urls
    .filter((u) => /^https?:/.test(u))
    .filter((u) => !u.startsWith(origin));
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

/** The composer is not editable while the turn is busy. */
async function awaitTurnSettled(page: Page): Promise<void> {
  const busy = page.locator('[role="textbox"][contenteditable="false"]');
  await busy
    .first()
    .waitFor({ state: 'attached', timeout: 60_000 })
    .catch(() => {});
  await expect(busy).toHaveCount(0, { timeout: TURN_TIMEOUT_MS });
}

/**
 * The work log collapses itself when the task finishes, and its body unmounts
 * while collapsed — so what a settled turn did is only readable after reopening
 * it. Idempotent: an already-open log is left alone.
 */
async function openWorkLog(page: Page): Promise<void> {
  const toggle = byId(page, 'work-log-toggle').last();
  await toggle.waitFor({ state: 'visible', timeout: 60_000 });
  await expect(async () => {
    if ((await toggle.getAttribute('data-open')) !== 'true') {
      await toggle.click();
    }
    await expect(toggle).toHaveAttribute('data-open', 'true', {
      timeout: 2_000,
    });
  }).toPass({ timeout: 30_000 });
}

/**
 * A settled turn's agent groups auto-collapse ("closed for preparation and
 * done"), and a collapsed group unmounts its tool rows — so the rows are only
 * countable after expanding every group.
 */
async function expandAgentGroups(page: Page): Promise<void> {
  const groups = byId(page, 'work-log-agent-group');
  await groups.first().waitFor({ state: 'visible', timeout: 30_000 });
  for (let i = 0; i < (await groups.count()); i++) {
    const group = groups.nth(i);
    if ((await group.getAttribute('aria-expanded')) !== 'true') {
      await group.click();
      await expect(group).toHaveAttribute('aria-expanded', 'true');
    }
  }
}

const toolRows = (page: Page) => page.locator('[data-tool-status]');

test('tool rows settle with their results and the clock counts real time', async () => {
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
    tool_alias: TOOL_ALIAS,
  };
  const { app, page } = await launchApp();
  const networkUrls: string[] = [];
  page.on('request', (request) => networkUrls.push(request.url()));
  // The project id is taken off the renderer's own POST so the trajectory read
  // back is the trajectory the UI drew from.
  const projectIds: string[] = [];
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

  try {
    await page
      .locator('[role="textbox"]')
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 });

    await pinAlias(page, TOOL_ALIAS);
    const composer = await newSpace(page);
    await composer.click();
    await page.keyboard.insertText('run the tool fixture');
    await composer.press('Enter');
    await awaitTurnSettled(page);
    await openWorkLog(page);
    await expandAgentGroups(page);

    await expect(async () => {
      expect(projectIds.length).toBeGreaterThan(0);
    }).toPass({ timeout: 30_000 });
    const projectId = projectIds[0];
    const events = await readTrajectory(projectId);
    const toolCalls = events.filter((e) => e.kind === 'tool_call');
    const toolResults = events.filter((e) => e.kind === 'tool_result');
    summary.project_id = projectId;
    summary.terminal = events.at(-1)?.kind;
    summary.tool_calls = toolCalls.map((e) => e.data?.tool_name);
    summary.tool_results = toolResults.length;
    expect(summary.terminal).toBe('run_completed');
    // The scripted sequence is what makes any tool row reachable; without the
    // recorded calls the settled-row assertions below would be vacuous.
    expect(toolCalls.length).toBeGreaterThanOrEqual(2);
    expect(toolResults).toHaveLength(toolCalls.length);
    expect(toolResults.some((e) => e.data?.is_error === true)).toBe(false);

    // One settled row per recorded call — nothing left shimmering, nothing
    // rendered as failed on a run whose results all came back clean.
    const rows = toolRows(page);
    await expect(rows).toHaveCount(toolCalls.length);
    await expect(
      page.locator('[data-tool-status="running"]')
    ).toHaveCount(0);
    await expect(page.locator('[data-tool-status="error"]')).toHaveCount(0);
    // Each row is named for the tool the edge recorded, so the rows are the
    // run's actual calls rather than N copies of one placeholder.
    const rowLabels = (await rows.allInnerTexts()).map((t) =>
      t.replace(/\s+/g, ' ').trim()
    );
    summary.row_labels = rowLabels;
    for (const call of toolCalls) {
      const name = String(call.data?.tool_name ?? '');
      expect(
        rowLabels.some((label) => label.includes(name)),
        `no settled row for tool ${name} among ${rowLabels.join(' | ')}`
      ).toBe(true);
    }

    // Open the bash row: its fold must carry the result content the edge stored
    // for that call — the fold that used to render permanently empty because no
    // deactivation ever delivered the output. An aion row carries
    // argumentsJson, so the fold is the typed bash card, not the legacy
    // Request/Response markdown.
    const bashResult = toolResults
      .map((e) => String(e.data?.content ?? ''))
      .find((content) => content.startsWith('exit='));
    expect(bashResult).toBeTruthy();
    const bashRow = rows.filter({ hasText: 'bash' }).first();
    await bashRow.locator('button').first().click();
    const bashCard = bashRow.locator('[data-testid="tool-card-bash"]');
    await expect(bashCard).toHaveCount(1);
    await expect(bashCard).toHaveAttribute('data-tool-card-status', 'done');
    await expect(bashRow).toContainText(bashResult!.split('\n')[0]);

    // The final answer is in the chat in full — no typewriter holding it back.
    await expect(page.locator('body')).toContainText('sequence complete:');

    // The clock: a run that provisioned a sandbox and ran two tools took real
    // time, and the settled header must say so. Before the fix nothing set
    // taskTime on the aion path and this label read "Worked for 0s" forever.
    const toggleText = (
      await byId(page, 'work-log-toggle').last().innerText()
    ).replace(/\s+/g, ' ');
    summary.settled_clock_label = toggleText;
    expect(toggleText).toMatch(/Worked for /);
    expect(toggleText).not.toContain('Worked for 0s');
    await screenshot(page, 'settled-rows-and-clock');

    const offEdge = auditEdgeOnly(networkUrls, new URL(edgeBaseUrl!).origin);
    expect(offEdge).toEqual([]);
    // An empty off-edge set is vacuous unless the renderer made requests.
    expect(
      networkUrls.filter((u) => /^https?:/.test(u)).length
    ).toBeGreaterThan(0);
    summary.off_edge_requests = offEdge;
    writeEvidence('eigent-feel-summary.json', summary);
  } finally {
    await app.close();
  }
});
