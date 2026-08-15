// Workforce desktop E2E: the REAL desktop app in remote-backend mode against
// the eigent-local Compose edge, asserting that the fan-out the edge reports is
// the fan-out the work log draws.
//
// The count is the whole test. `aion-workforce` scripts two serial spawns, so
// the run's trajectory carries exactly two `subagent_started` events, and the
// turn's work log must carry exactly two worker lanes — read from the DOM,
// compared against the edge's own record rather than against a literal.
//
// The negative control runs in the SAME session on `aion-default`, which calls
// tools but spawns nothing: zero events, zero lanes, beside an orchestrator row
// that proves the log rendered at all. Without it, a surface that always drew
// fan-out would pass the first assertion and be wrong.
//
// Needs the stack in fixture-picker mode, because the fan-out alias has to be
// selectable from the desktop (a normal stack marks the fixture rows internal
// and alias resolution falls back to the default):
//   EIGENT_LOCAL_FIXTURE_PICKER=1 bazel run //dev/eigent_local:up   (in aion-v1)
//   EIGENT_E2E_FIXTURE_PICKER=1 npx playwright test --config e2e/playwright.config.ts workforce
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

/** internal/inference/fakeroute's `spawn-sequence`: two serial spawns. */
const FANOUT_ALIAS = 'aion-workforce';
const FANOUT_WORKERS = 2;
/**
 * The same stack's tool-calling script. It is the negative control rather than
 * the echo row because it still produces a work log with an agent group — a
 * turn whose log never renders would make "no worker lanes" vacuously true.
 */
const SOLO_ALIAS = 'aion-default';

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
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-workforce-'));
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
    path: path.join(EVIDENCE_DIR, `eigent-workforce-${name}.png`),
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

/** A fresh Space, so each turn is its own project and its own trajectory. */
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

const workerLanes = (page: Page) =>
  page.locator(
    '[data-testid="work-log-agent-group"][data-agent-type="worker_agent"]'
  );

/** The panel's own claim about what kind of session this is. */
const sidePanelMode = (page: Page) =>
  byId(page, 'session-side-panel-header').first();

/**
 * Worker rows in the agent pool. The pool sits in an accordion that starts
 * closed, so these are asserted against its collapsed state on purpose: a
 * fan-out the user has to expand a section to discover is not a visible one.
 */
const poolWorkerRows = (page: Page) =>
  page.locator('[data-testid="agent-pool-row"][data-agent-type="worker_agent"]');

test('the work log draws exactly the fan-out the edge reported', async () => {
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
    fanout_alias: FANOUT_ALIAS,
    solo_alias: SOLO_ALIAS,
  };
  const { app, page } = await launchApp();
  const networkUrls: string[] = [];
  page.on('request', (request) => networkUrls.push(request.url()));
  // Each turn admits its own project; the id is taken off the renderer's own
  // POST so the trajectory read back is the trajectory the UI drew from.
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

    // The fan-out turn.
    await pinAlias(page, FANOUT_ALIAS);
    const fanoutComposer = await newSpace(page);
    await fanoutComposer.click();
    await page.keyboard.insertText('run the workforce fixture');
    await fanoutComposer.press('Enter');
    await awaitTurnSettled(page);
    await openWorkLog(page);

    await expect(async () => {
      expect(projectIds.length).toBeGreaterThan(0);
    }).toPass({ timeout: 30_000 });
    const fanoutProject = projectIds[0];
    const fanoutEvents = await readTrajectory(fanoutProject);
    const started = fanoutEvents.filter((e) => e.kind === 'subagent_started');
    const ended = fanoutEvents.filter((e) => e.kind === 'subagent_ended');
    summary.fanout_project_id = fanoutProject;
    summary.fanout_terminal = fanoutEvents.at(-1)?.kind;
    summary.subagent_started = started.length;
    summary.subagent_ended = ended.length;
    // The scripted fan-out is what makes any lane reachable; a stack that
    // served no worker events would make the count assertion below vacuous.
    expect(started).toHaveLength(FANOUT_WORKERS);
    expect(ended).toHaveLength(FANOUT_WORKERS);

    const lanes = workerLanes(page);
    await expect(lanes).toHaveCount(started.length);
    // The log body animates its height open under `overflow-hidden`, so a lane
    // can be in the DOM and still clipped out of the user's view.
    await expect(lanes.last()).toBeVisible();
    // Open one lane: a row that cannot say what its worker did is a label, not
    // a lane.
    await lanes.first().click();
    await expect(page.locator('body')).toContainText('Joined the run as worker');
    await expect(page.locator('body')).toContainText('Finished: completed');
    // The height transition is what the capture below is waiting out; without
    // it the evidence shows a half-open log rather than the lanes it proves.
    await page.waitForTimeout(1_000);
    // Each lane is labelled by the worker the edge named, so the rows are the
    // run's actual workers rather than N copies of one placeholder.
    const laneLabels = (await lanes.allInnerTexts()).map((t) =>
      t.replace(/\s+/g, ' ').trim()
    );
    summary.lane_labels = laneLabels;
    for (const event of started) {
      const name = String(event.data?.name ?? '');
      expect(
        laneLabels.some((label) => label.includes(name)),
        `no lane labelled for worker ${name} among ${laneLabels.join(' | ')}`
      ).toBe(true);
    }
    // The orchestrator keeps its own row: the fan-out is drawn beside it, not
    // in place of it.
    await expect(
      page.locator(
        '[data-testid="work-log-agent-group"][data-agent-type="single_agent"]'
      )
    ).toHaveCount(1);

    // A session that staffed workers must stop calling itself a single-agent
    // one, and its panel must name them. The chat log alone is not enough: the
    // panel is the surface that answers "who is working right now".
    await expect(sidePanelMode(page)).toHaveAttribute(
      'data-session-mode',
      'workforce'
    );
    await expect(poolWorkerRows(page)).toHaveCount(started.length);
    // Each row says what its worker is doing, so the panel reports the run
    // rather than just counting it.
    await expect(
      poolWorkerRows(page).first().locator('[data-testid="agent-worker-tag"]')
    ).toBeVisible();
    summary.pool_worker_rows = await poolWorkerRows(page).count();
    // One frame for both claims: the lanes and the side panel share a
    // viewport, so a second capture would be the same bytes twice.
    await screenshot(page, 'fanout-lanes-and-panel');

    // The negative control, same session, same surface: a run that did not fan
    // out must draw no lanes at all.
    await pinAlias(page, SOLO_ALIAS);
    const soloComposer = await newSpace(page);
    await soloComposer.click();
    await page.keyboard.insertText('answer without delegating');
    await soloComposer.press('Enter');
    await awaitTurnSettled(page);
    await openWorkLog(page);

    await expect(async () => {
      expect(projectIds.length).toBeGreaterThan(1);
    }).toPass({ timeout: 30_000 });
    const soloProject = projectIds[1];
    const soloEvents = await readTrajectory(soloProject);
    summary.solo_project_id = soloProject;
    summary.solo_terminal = soloEvents.at(-1)?.kind;
    summary.solo_subagent_started = soloEvents.filter(
      (e) => e.kind === 'subagent_started'
    ).length;
    expect(summary.solo_subagent_started).toBe(0);
    // The orchestrator's own row proves the log rendered, so the empty lane set
    // below is a fact about this turn rather than about an absent surface.
    await expect(
      page.locator(
        '[data-testid="work-log-agent-group"][data-agent-type="single_agent"]'
      )
    ).toHaveCount(1);
    await expect(workerLanes(page)).toHaveCount(0);
    // And the mode follows the run rather than sticking: a session that never
    // delegated stays a single-agent one, with an empty worker pool.
    await expect(sidePanelMode(page)).toHaveAttribute(
      'data-session-mode',
      'single-agent'
    );
    await expect(poolWorkerRows(page)).toHaveCount(0);
    await screenshot(page, 'solo-no-lanes');

    const offEdge = auditEdgeOnly(networkUrls, new URL(edgeBaseUrl!).origin);
    expect(offEdge).toEqual([]);
    // An empty off-edge set is vacuous unless the renderer made requests.
    expect(
      networkUrls.filter((u) => /^https?:/.test(u)).length
    ).toBeGreaterThan(0);
    summary.off_edge_requests = offEdge;
    writeEvidence('eigent-workforce-summary.json', summary);
  } finally {
    await app.close();
  }
});
