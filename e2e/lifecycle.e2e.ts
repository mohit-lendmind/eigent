// Lifecycle desktop E2E: the REAL desktop app in remote-backend mode against
// the eigent-local Compose edge, asserting the two L3 live-visibility claims:
// the formerly blank admission window now carries dispatch stages
// (run_progress rendered as `data-run-stage` on the pre-content indicator),
// and a running tool's streamed stdout reaches its work-log row
// (`tool-live-output`) BEFORE the tool settles — then leaves when the result
// lands.
//
// The `aion-live` fixture is one bash call that prints ~24 KiB (past the
// 8 KiB durable tool-output chunk threshold, so chunks journal mid-run) and
// then sleeps, holding the tool open while the tail renders. The negative
// control is a second pass on `aion-fast` (echo, no tools): its trajectory
// must carry run_progress — the stages announce ANY run's admission — but
// zero tool_output events, and no live-output block may ever render.
//
// Needs the stack in fixture-picker mode (same requirement as feel/stream):
//   EIGENT_LOCAL_FIXTURE_PICKER=1 bazel run //dev/eigent_local:up   (in aion-v1)
//   EIGENT_E2E_FIXTURE_PICKER=1 npx playwright test --config e2e/playwright.config.ts lifecycle
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

/** fakeroute live-sequence: ~24 KiB of bash stdout, then a 6s sleep. */
const LIVE_ALIAS = 'aion-live';
/** fakeroute echo: answers directly, no tools — the tool_output control. */
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
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-lifecycle-'));
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
    path: path.join(EVIDENCE_DIR, `eigent-lifecycle-${name}.png`),
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

/** Opens the work-log surface, where the live tool rows render. */
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
}

const knownStages = ['dispatching', 'workspace_ready', 'starting'];

test('dispatch stages fill the blank window and tool output streams before settlement', async () => {
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
    live_alias: LIVE_ALIAS,
    control_alias: CONTROL_ALIAS,
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

    // ---- Pass 1: the live fixture. ----------------------------------------
    await pinAlias(page, LIVE_ALIAS);
    const composer = await newSpace(page);
    await composer.click();
    await page.keyboard.insertText('run the live fixture');
    await composer.press('Enter');

    // One sampling loop covers both live claims, because they share a clock:
    // the dispatch stages own the window before the tool call renders, and
    // the live tail owns the window between the first journaled chunk and the
    // tool's own result. The loop keeps the work log open (the surface the
    // rows render in), records every data-run-stage value it sees, and stops
    // the moment the live output block is on screen.
    const stagesSeen: string[] = [];
    let liveText = '';
    let workLogOpened = false;
    const busy = page.locator('[role="textbox"][contenteditable="false"]');
    let sawBusy = false;
    const liveDeadline = Date.now() + 120_000;
    while (Date.now() < liveDeadline) {
      for (const stage of await page
        .locator('[data-run-stage]')
        .evaluateAll((nodes) =>
          nodes.map((n) => n.getAttribute('data-run-stage') ?? '')
        )) {
        if (stage && !stagesSeen.includes(stage)) stagesSeen.push(stage);
      }
      if (!workLogOpened) {
        const toggle = page.getByTestId('work-log-toggle').last();
        if (await toggle.isVisible().catch(() => false)) {
          await openWorkLog(page);
          workLogOpened = true;
        }
      } else {
        // A collapsed group unmounts its rows; keep any group open so a
        // streaming row is observable the moment it exists.
        const groups = page.getByTestId('work-log-agent-group');
        for (let i = 0; i < (await groups.count()); i++) {
          const group = groups.nth(i);
          if ((await group.getAttribute('aria-expanded')) !== 'true') {
            await group.click().catch(() => {});
          }
        }
      }
      const live = page.getByTestId('tool-live-output');
      if ((await live.count()) > 0) {
        liveText = (await live.first().innerText()).trim();
        if (liveText) break;
      }
      const busyCount = await busy.count();
      if (busyCount > 0) sawBusy = true;
      if (sawBusy && busyCount === 0) break; // settled without live output
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    summary.stages_seen = stagesSeen;
    summary.live_text_lines = liveText.split('\n').length;
    await screenshot(page, 'live-output');

    // The blank window carried at least one announced stage, and only stages
    // (an empty attribute never renders). The vocabulary may grow, so this
    // asserts membership one way only: everything ANNOUNCED as one of the
    // three known stages must have shown, not that nothing else may.
    expect(stagesSeen.length).toBeGreaterThan(0);
    expect(stagesSeen.some((s) => knownStages.includes(s))).toBe(true);

    // The live tail was on screen while the tool ran, showing the fixture's
    // own lines — the window that used to render as an eternal shimmer.
    expect(liveText).toContain('live-line');

    // Settlement replaces the tail with the result: no live block survives.
    await expect(busy).toHaveCount(0, { timeout: TURN_TIMEOUT_MS });
    await expect(page.getByTestId('tool-live-output')).toHaveCount(0);
    await screenshot(page, 'settled');

    await expect(async () => {
      expect(projectIds.length).toBeGreaterThan(0);
    }).toPass({ timeout: 30_000 });
    const projectId = projectIds[0];
    const events = await readTrajectory(projectId);
    summary.project_id = projectId;
    summary.terminal = events.at(-1)?.kind;
    expect(summary.terminal).toBe('run_completed');

    // The durable record, first claim: the admission stages were journaled in
    // their lifecycle order — a run is dispatched before its workspace is
    // ready, and ready before the agent starts.
    const stageEvents = events
      .map((e, index) => ({ e, index }))
      .filter(({ e }) => e.kind === 'run_progress');
    const stages = stageEvents.map(({ e }) => String(e.data?.stage ?? ''));
    summary.run_progress_stages = stages;
    for (const stage of knownStages) {
      expect(stages, `stage ${stage} was never announced`).toContain(stage);
    }
    expect(stages.indexOf('dispatching')).toBeLessThan(
      stages.indexOf('workspace_ready')
    );
    expect(stages.indexOf('workspace_ready')).toBeLessThan(
      stages.indexOf('starting')
    );

    // Second claim: the tool's output was journaled as user-visible chunks
    // correlated to the bash call, and at least one chunk landed BEFORE the
    // call's own result — the mid-run journaling that makes a live tail
    // possible at all.
    const bashCall = events.find(
      (e) => e.kind === 'tool_call' && e.data?.tool_name === 'bash'
    );
    expect(bashCall).toBeTruthy();
    const bashCallId = String(bashCall!.data?.tool_call_id ?? '');
    const outputs = events
      .map((e, index) => ({ e, index }))
      .filter(({ e }) => e.kind === 'tool_output');
    summary.tool_output_count = outputs.length;
    expect(outputs.length).toBeGreaterThanOrEqual(1);
    for (const { e } of outputs) {
      expect(e.data?.tool_call_id).toBe(bashCallId);
    }
    const resultIndex = events.findIndex(
      (e) => e.kind === 'tool_result' && e.data?.tool_call_id === bashCallId
    );
    expect(resultIndex).toBeGreaterThan(0);
    expect(outputs[0].index).toBeLessThan(resultIndex);
    const streamed = outputs
      .map(({ e }) => String(e.data?.content ?? ''))
      .join('');
    summary.tool_output_bytes = Buffer.byteLength(streamed);
    expect(streamed).toContain('live-line 0001');
    // Past the chunk threshold — the property that made mid-run records exist.
    expect(Buffer.byteLength(streamed)).toBeGreaterThan(8_192);

    // ---- Pass 2: the negative control — no tools, no tool_output. ---------
    await pinAlias(page, CONTROL_ALIAS);
    const controlComposer = await newSpace(page);
    await controlComposer.click();
    await page.keyboard.insertText('control probe');
    await controlComposer.press('Enter');
    const controlBusy = page.locator(
      '[role="textbox"][contenteditable="false"]'
    );
    await controlBusy
      .first()
      .waitFor({ state: 'attached', timeout: 120_000 })
      .catch(() => {});
    await expect(controlBusy).toHaveCount(0, { timeout: TURN_TIMEOUT_MS });
    await expect(page.getByTestId('tool-live-output')).toHaveCount(0);

    await expect(async () => {
      expect(projectIds.length).toBeGreaterThan(1);
    }).toPass({ timeout: 30_000 });
    const controlProjectId = projectIds.find((id) => id !== projectId);
    expect(controlProjectId).toBeTruthy();
    const controlEvents = await readTrajectory(controlProjectId!);
    summary.control_project_id = controlProjectId;
    summary.control_terminal = controlEvents.at(-1)?.kind;
    expect(summary.control_terminal).toBe('run_completed');
    // The stages announce every run's admission; the chunks only a tool's.
    const controlStages = controlEvents
      .filter((e) => e.kind === 'run_progress')
      .map((e) => String(e.data?.stage ?? ''));
    summary.control_run_progress_stages = controlStages;
    expect(controlStages.length).toBeGreaterThan(0);
    expect(
      controlEvents.filter((e) => e.kind === 'tool_output')
    ).toHaveLength(0);

    const offEdge = auditEdgeOnly(networkUrls, new URL(edgeBaseUrl!).origin);
    expect(offEdge).toEqual([]);
    // An empty off-edge set is vacuous unless the renderer made requests.
    expect(
      networkUrls.filter((u) => /^https?:/.test(u)).length
    ).toBeGreaterThan(0);
    summary.off_edge_requests = offEdge;
    writeEvidence('eigent-lifecycle-summary.json', summary);
  } finally {
    await app.close();
  }
});
