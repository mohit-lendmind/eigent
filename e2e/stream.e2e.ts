// Stream desktop E2E: the REAL desktop app in remote-backend mode against the
// eigent-local Compose edge, asserting that a long answer renders
// PROGRESSIVELY — partial text on screen while the run is still streaming —
// instead of popping whole at the end.
//
// The `aion-stream` fixture is echo slowed to ~32ms per 16-byte chunk, so a
// multi-KiB prompt streams back over several seconds and the engine's
// threshold flush journals it as several agent.message records. The proof has
// two halves: the DOM shows the answer's head before its tail exists anywhere
// on screen (impossible when the whole segment journals as one delta), and
// the trajectory records multiple text_delta events whose concatenation is
// the complete answer. The fixture emits no reasoning, which doubles as the
// negative control for the Thinking strip: no strip may render here.
//
// Needs the stack in fixture-picker mode (same requirement as feel):
//   EIGENT_LOCAL_FIXTURE_PICKER=1 bazel run //dev/eigent_local:up   (in aion-v1)
//   EIGENT_E2E_FIXTURE_PICKER=1 npx playwright test --config e2e/playwright.config.ts stream
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

/** internal/inference/fakeroute's delayed `echo`: ~32ms per 16-byte chunk. */
const STREAM_ALIAS = 'aion-stream';

const TERMINAL_KINDS = ['run_completed', 'run_failed', 'run_cancelled'];
const TURN_TIMEOUT_MS = 180_000;

// The echoed answer: distinctive head and tail markers around enough plain
// prose to cross the 1 KiB durable chunk threshold several times. ~3.3 KiB →
// three threshold flushes plus the residue, streamed over ~6.5s.
const STREAM_HEAD = 'stream-proof-alpha';
const STREAM_TAIL = 'stream-proof-omega';
const STREAM_PROMPT = `${STREAM_HEAD} ${'a steady flow of ordinary words keeps the echo moving along. '.repeat(52)}${STREAM_TAIL}`;

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
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-stream-'));
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
    path: path.join(EVIDENCE_DIR, `eigent-stream-${name}.png`),
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

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  for (
    let at = haystack.indexOf(needle);
    at >= 0;
    at = haystack.indexOf(needle, at + needle.length)
  ) {
    count++;
  }
  return count;
}

async function markerCounts(
  page: Page
): Promise<{ head: number; tail: number }> {
  const text = await page.locator('body').innerText();
  return {
    head: countOccurrences(text, STREAM_HEAD),
    tail: countOccurrences(text, STREAM_TAIL),
  };
}

test('a long answer renders progressively while the run streams', async () => {
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
    stream_alias: STREAM_ALIAS,
    prompt_bytes: Buffer.byteLength(STREAM_PROMPT),
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

    await pinAlias(page, STREAM_ALIAS);
    const composer = await newSpace(page);
    await composer.click();
    await page.keyboard.insertText(STREAM_PROMPT);
    await composer.press('Enter');

    // Baseline: the user's own bubble carries both markers immediately; the
    // answer contributes nothing yet. Counting occurrences (rather than
    // locating elements) keeps the check indifferent to how many surfaces
    // mirror the message. Absolute counts are racy — surfaces echoing the
    // prompt keep mounting for a moment after submit — so the proof below
    // reasons about head-minus-tail, not the raw counts.
    const baseline = await markerCounts(page);
    expect(baseline.head).toBeGreaterThan(0);
    summary.baseline_counts = baseline;

    // Sample the DOM until the answer completes. A surface showing the full
    // text contributes one head AND one tail; a truncated echo (the task
    // title) contributes a head forever. Only a partially painted answer
    // holds a head whose tail exists nowhere yet — so any sample whose
    // head-tail spread exceeds the settled spread is a paint no single
    // end-of-run delta could produce.
    const samples: Array<{ at_ms: number; head: number; tail: number }> = [];
    const sampleStart = Date.now();
    const sampleDeadline = sampleStart + 120_000;
    const busy = page.locator('[role="textbox"][contenteditable="false"]');
    let sawBusy = false;
    let screenshotTaken = false;
    for (;;) {
      const counts = await markerCounts(page);
      samples.push({ at_ms: Date.now() - sampleStart, ...counts });
      if (!screenshotTaken && counts.head - counts.tail > baseline.head - baseline.tail) {
        screenshotTaken = true;
        await screenshot(page, 'partial-answer');
      }
      const busyCount = await busy.count();
      if (busyCount > 0) sawBusy = true;
      if ((sawBusy && busyCount === 0) || Date.now() > sampleDeadline) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    // The loop only exits settled or at the deadline; this rules out the
    // deadline case without awaitTurnSettled's wait-for-busy preamble.
    await expect(busy).toHaveCount(0, { timeout: TURN_TIMEOUT_MS });
    await screenshot(page, 'settled-answer');

    const settled = await markerCounts(page);
    const settledSpread = settled.head - settled.tail;
    // Completion: the answer's tail arrived somewhere.
    expect(settled.tail).toBeGreaterThan(baseline.tail);
    // The progressive moment, judged after the fact so no live race can
    // spoil it: some sample held more tail-less heads than the settled DOM
    // does.
    const witness = samples.find((s) => s.head - s.tail > settledSpread);
    summary.settled_counts = settled;
    summary.sample_count = samples.length;
    summary.partial_witness = witness ?? null;
    expect(witness).toBeTruthy();

    // Negative control: echo carries no reasoning, so the Thinking strip must
    // not render for this run.
    await expect(page.getByTestId('thinking-strip')).toHaveCount(0);

    await expect(async () => {
      expect(projectIds.length).toBeGreaterThan(0);
    }).toPass({ timeout: 30_000 });
    const projectId = projectIds[0];
    const events = await readTrajectory(projectId);
    const textDeltas = events.filter((e) => e.kind === 'text_delta');
    summary.project_id = projectId;
    summary.terminal = events.at(-1)?.kind;
    summary.text_delta_count = textDeltas.length;
    summary.text_delta_sizes = textDeltas.map((e) =>
      Buffer.byteLength(String(e.data?.text ?? ''))
    );
    expect(summary.terminal).toBe('run_completed');
    // The durable record must show the answer was journaled in threshold
    // chunks, and that the chunks concatenate to the complete answer.
    expect(textDeltas.length).toBeGreaterThanOrEqual(3);
    expect(String(textDeltas[0].data?.text ?? '')).not.toContain(STREAM_TAIL);
    const concatenated = textDeltas
      .map((e) => String(e.data?.text ?? ''))
      .join('');
    expect(concatenated).toContain(STREAM_PROMPT);
    expect(textDeltas.some((e) => 'reasoning' in (e.data ?? {}))).toBe(false);

    const offEdge = auditEdgeOnly(networkUrls, new URL(edgeBaseUrl!).origin);
    expect(offEdge).toEqual([]);
    // An empty off-edge set is vacuous unless the renderer made requests.
    expect(
      networkUrls.filter((u) => /^https?:/.test(u)).length
    ).toBeGreaterThan(0);
    summary.off_edge_requests = offEdge;
    writeEvidence('eigent-stream-summary.json', summary);
  } finally {
    await app.close();
  }
});
