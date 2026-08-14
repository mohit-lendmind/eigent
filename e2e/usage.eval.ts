// Real-model driver for run metering: the same task run twice through the REAL
// product chat UI against the live eigent-local stack — once with no ceiling,
// then once under a deliberately tiny one.
//
// The two passes are what make each other meaningful. The first proves a real
// provider run settles a real figure and that the number the Usage screen shows
// is the number the edge settled. The second proves the ceiling BINDS rather
// than merely being stored: the run stops, the desktop says why in its own
// words, and — the sharpest control available — that run made FEWER provider
// calls than the uncapped one did on the identical prompt.
//
// The ceiling is stamped at mint time from the ops worker's boot config, so the
// only way to change it is to recreate that service between the passes. That is
// what //dev/eigent_local:ceiling does, and why this is one recording of two
// passes rather than two independent runs.
//
// Run: npx playwright test --config e2e/eval.config.ts usage
// Env: EIGENT_EVAL_MODEL / EIGENT_EVAL_MODEL_LABEL pick the catalog row (it
//      must be a PRICED one, or the first pass settles zero and proves
//      nothing); EIGENT_EVAL_AION_ROOT locates the stack checkout.
// Output: EIGENT_EVAL_DIR (default ../n2-evidence/playwright/real-model).

import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT =
  process.env.EIGENT_E2E_APP_DIR ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOOTSTRAP_PATH =
  process.env.EIGENT_E2E_BOOTSTRAP ??
  path.resolve(REPO_ROOT, '../aion-v1/deploy/eigent-local/run/bootstrap.json');
const AION_ROOT =
  process.env.EIGENT_EVAL_AION_ROOT ??
  path.resolve(path.dirname(BOOTSTRAP_PATH), '../../..');
const OUT_DIR =
  process.env.EIGENT_EVAL_DIR ??
  path.resolve(REPO_ROOT, '..', 'n2-evidence', 'playwright', 'real-model');

const MODEL_ALIAS = process.env.EIGENT_EVAL_MODEL ?? 'kimi-k3';
const MODEL_LABEL = process.env.EIGENT_EVAL_MODEL_LABEL ?? 'Kimi K3';
/** Provider calls the capped pass is allowed. The prompt needs more. */
const CAP_PROVIDER_CALLS = 2;

const ANSWER_TIMEOUT_MS = 8 * 60_000;
const STOP_TIMEOUT_MS = 8 * 60_000;
const TRAJECTORY_TIMEOUT_MS = 60_000;
const VIDEO_SIZE = { width: 1280, height: 800 };
// A recording that never started is a few KB of container; a recorded run is
// megabytes. The floor separates the two without pinning a duration.
const MIN_VIDEO_BYTES = 200 * 1024;

interface Bootstrap {
  api_key: string;
  edge_url: string;
  tenant_id: string;
}

const bootstrap: Bootstrap = JSON.parse(
  fs.readFileSync(BOOTSTRAP_PATH, 'utf-8')
);
const edgeBaseUrl = `${bootstrap.edge_url.replace(/\/+$/, '')}/eigent/v1`;

/**
 * A per-invocation tag on every prompt, so a stack that has served this eval
 * before cannot supply the Project this run is looking for.
 */
const RUN_TAG = `n2-${Date.now().toString(36)}`;
/**
 * Three cubes, one shell command each, summed. The arithmetic is incidental;
 * the sequence is the point — a run that must take several provider turns is
 * the only kind a two-call ceiling can visibly cut short.
 */
const PROMPT =
  `[${RUN_TAG}] Use the shell three times, one command per turn and never more ` +
  `than one at a time: compute 12^3, then 13^3, then 14^3. Do not compute them ` +
  `yourself and do not batch them into one command. When you have all three, ` +
  `reply with exactly one line: RESULT=<their sum>`;
const EXPECTED_ANSWER = 'RESULT=6669';
/** What the desktop says, in its own words, when a ceiling stops a run. */
const STOPPED_TEXT = 'budget exhausted';

interface EdgeEvent {
  kind: string;
  sequence: string;
  data?: Record<string, unknown>;
}

interface EdgeRun {
  run_id: string;
  project_id: string;
  status: string;
  ended_at?: string;
  cost_micro_usd?: string;
  provider_calls?: string;
}

interface PassRecord {
  name: string;
  ceiling_provider_calls: number;
  project_id?: string;
  run_id?: string;
  terminal?: string | null;
  event_kinds?: Record<string, number>;
  cost_micro_usd?: string;
  provider_calls?: string;
  rendered_cost?: string;
  ui_said?: string;
}

function writeOut(name: string, payload: string): void {
  if (payload.includes(bootstrap.api_key)) {
    throw new Error(`output ${name} would leak the API key`);
  }
  fs.writeFileSync(path.join(OUT_DIR, name), payload);
}

async function screenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: path.join(OUT_DIR, `${name}.png`),
    fullPage: true,
  });
}

/**
 * Recreates the ops worker with the given per-run ceiling. Zero is uncapped,
 * which is the state the stack is left in — a leftover ceiling would silently
 * cut short every later run on this stack.
 */
function setCeiling(providerCalls: number): void {
  execFileSync(
    'bash',
    [path.join(AION_ROOT, 'dev', 'eigent_local', 'ceiling.sh'), String(providerCalls)],
    {
      cwd: AION_ROOT,
      env: { ...process.env, BUILD_WORKSPACE_DIRECTORY: AION_ROOT },
      stdio: 'pipe',
    }
  );
}

async function findMainWindow(app: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const main = app
      .windows()
      .find((w) => w.url().includes('/dist/index.html'));
    if (main) return main;
    if (Date.now() > deadline) {
      throw new Error(
        `main renderer window not found among: ${app
          .windows()
          .map((w) => w.url())
          .join(', ')}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

// The space-switch dropdown's focus trap can outlive its dismiss animation and
// reclaim focus mid-typing, so typing is verify-and-retry.
async function typeIntoComposer(
  page: Page,
  composer: ReturnType<Page['locator']>,
  text: string
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.keyboard.press('Escape').catch(() => {});
    await composer.click();
    await page.keyboard.insertText(text);
    const got = (await composer.innerText()).replace(/\s+/g, ' ').trim();
    if (got === text.replace(/\s+/g, ' ').trim()) return;
    await composer.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
  }
  throw new Error('composer never captured the full prompt');
}

/** A fresh Space, so each pass becomes its own aion Project. */
async function newSpace(page: Page): Promise<ReturnType<Page['locator']>> {
  await page.evaluate(() => {
    window.location.hash = '#/';
  });
  await page.reload();
  await page.locator('#active-space-title-btn').click();
  await page.getByText('Create a new space', { exact: true }).first().click();
  await page.getByText('Start from scratch', { exact: true }).first().click();
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

/**
 * Picks a provider the way a user does. The trigger carries the effective
 * alias's display name as its accessible name, so asserting that name after the
 * click is what proves the selection stuck rather than silently falling back.
 */
async function selectModel(page: Page, label: string): Promise<void> {
  const trigger = page.getByTestId('aion-model-select');
  await trigger.waitFor({ state: 'visible', timeout: 30_000 });
  await trigger.click();
  await page.getByRole('menuitem').filter({ hasText: label }).first().click();
  await expect(trigger).toHaveAccessibleName(label);
}

/**
 * The durable trajectory, straight from the edge's SSE replay: the run as the
 * product recorded it, independent of anything the renderer displayed.
 */
async function collectTrajectory(
  projectId: string
): Promise<{ events: EdgeEvent[]; terminal: string | null }> {
  const events: EdgeEvent[] = [];
  let terminal: string | null = null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRAJECTORY_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${edgeBaseUrl}/projects/${encodeURIComponent(projectId)}/events?after=0`,
      {
        headers: { Authorization: `Bearer ${bootstrap.api_key}` },
        signal: controller.signal,
      }
    );
    if (!response.ok || !response.body) {
      throw new Error(`event stream failed: ${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    outer: for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
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
        if (
          ['run_completed', 'run_failed', 'run_cancelled'].includes(event.kind)
        ) {
          terminal = event.kind;
          break outer;
        }
      }
    }
  } catch (error) {
    if (!(error instanceof Error && error.name === 'AbortError')) throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return { events, terminal };
}

function countKinds(events: EdgeEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    counts[event.kind] = (counts[event.kind] ?? 0) + 1;
  }
  return counts;
}

/** What the tenant's own bill says this Project's single run cost. */
async function projectSpend(projectId: string): Promise<EdgeRun> {
  const response = await fetch(
    `${edgeBaseUrl}/usage?project_id=${encodeURIComponent(projectId)}`,
    { headers: { Authorization: `Bearer ${bootstrap.api_key}` } }
  );
  if (!response.ok) {
    throw new Error(`getUsage: ${response.status} ${await response.text()}`);
  }
  const page = (await response.json()) as { runs: EdgeRun[] };
  expect(page.runs.length, `${projectId}: expected exactly one settled run`).toBe(
    1
  );
  return page.runs[0];
}

/**
 * The displayed dollar figure has to be the settled micro-USD, allowing for the
 * rounding the display does at its own precision (4 decimals under a dollar,
 * 2 above) and the below-the-smallest-unit bound it shows instead of a zero.
 */
function amountMatches(text: string, microUsd: bigint): boolean {
  if (text.startsWith('<$')) return microUsd > 0n && microUsd < 50n;
  const parsed = Number(text.replace(/[$,]/g, ''));
  if (!Number.isFinite(parsed)) return false;
  const halfUnit = microUsd < 1_000_000n ? 50 : 5_000;
  return Math.abs(Math.round(parsed * 1e6) - Number(microUsd)) <= halfUnit;
}

/** Opens the Usage screen and returns what the given run's row shows. */
async function readUsageRow(page: Page, runId: string): Promise<string> {
  await page.evaluate(() => {
    window.location.hash = '#/history?tab=home&section=usage';
  });
  await page.reload();
  await expect(page.getByTestId('aion-usage')).toBeVisible({ timeout: 60_000 });
  const row = page.locator(
    `[data-testid="aion-usage-row"][data-run-id="${runId}"]`
  );
  await expect(row, `${runId}: no row on the Usage screen`).toHaveCount(1);
  return row.getByTestId('aion-usage-cost-amount').innerText();
}

test('a real run costs what the bill says, and a ceiling stops one short', async () => {
  test.setTimeout(40 * 60_000);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-n2-'));
  const keyFile = path.join(workDir, 'edge-api-key');
  fs.writeFileSync(keyFile, bootstrap.api_key, { mode: 0o600 });

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value;
  }
  delete env.VITE_DEV_SERVER_URL;
  env.EIGENT_E2E_USER_DATA = fs.mkdtempSync(path.join(workDir, 'user-data-'));
  env.EIGENT_REMOTE_BACKEND_URL = edgeBaseUrl;
  env.EIGENT_REMOTE_BACKEND_API_KEY_FILE = keyFile;
  env.EIGENT_REMOTE_BACKEND_API_KEY = '';

  const videoDir = path.join(OUT_DIR, 'video');
  fs.rmSync(videoDir, { recursive: true, force: true });

  const uncapped: PassRecord = { name: 'uncapped', ceiling_provider_calls: 0 };
  const capped: PassRecord = {
    name: 'capped',
    ceiling_provider_calls: CAP_PROVIDER_CALLS,
  };
  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
    run_tag: RUN_TAG,
    model_alias: MODEL_ALIAS,
    prompt: PROMPT,
    passes: [uncapped, capped],
  };

  // A ceiling left behind by an earlier run would make the first pass the
  // capped one without saying so.
  setCeiling(0);

  const app = await electron.launch({
    args: [REPO_ROOT],
    cwd: REPO_ROOT,
    env,
    recordVideo: { dir: videoDir, size: VIDEO_SIZE },
  });
  let video: ReturnType<Page['video']> = null;
  let bodyFailed = false;
  try {
    const page = await findMainWindow(app);
    video = page.video();
    const requests: { method: string; url: string; body?: string }[] = [];
    page.on('request', (request) => {
      requests.push({
        method: request.method(),
        url: request.url(),
        body: request.postData() ?? undefined,
      });
    });
    await page
      .locator('[role="textbox"]')
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 });

    // ---- Pass 1: no ceiling. The run finishes and costs something. --------
    const composerA = await newSpace(page);
    await selectModel(page, MODEL_LABEL);
    const createA = page
      .waitForRequest(
        (request) =>
          request.method() === 'POST' &&
          request.url() === `${edgeBaseUrl}/projects`,
        { timeout: 60_000 }
      )
      .then((request) => request.postData() ?? '');
    await typeIntoComposer(page, composerA, PROMPT);
    await composerA.press('Enter');
    const postedA = JSON.parse((await createA) || '{}') as {
      model_alias?: string;
    };
    expect(
      postedA.model_alias,
      "the picker's choice never reached the create"
    ).toBe(MODEL_ALIAS);
    await screenshot(page, '01-uncapped-sent');

    await page
      .getByText(EXPECTED_ANSWER, { exact: false })
      .first()
      .waitFor({ state: 'visible', timeout: ANSWER_TIMEOUT_MS });
    await screenshot(page, '02-uncapped-answered');

    const projectA = /\/projects\/([^/?]+)\/commands/.exec(
      requests.find((r) => /\/projects\/[^/]+\/commands$/.test(r.url))?.url ?? ''
    )?.[1];
    expect(projectA, 'no command was submitted for the uncapped pass').toBeTruthy();
    uncapped.project_id = projectA;
    const trajectoryA = await collectTrajectory(projectA!);
    uncapped.terminal = trajectoryA.terminal;
    uncapped.event_kinds = countKinds(trajectoryA.events);
    expect(trajectoryA.terminal, 'the uncapped run did not complete').toBe(
      'run_completed'
    );

    const spendA = await projectSpend(projectA!);
    uncapped.run_id = spendA.run_id;
    uncapped.cost_micro_usd = spendA.cost_micro_usd;
    uncapped.provider_calls = spendA.provider_calls;
    // A real provider run has to settle a real figure: an absent pair would be
    // an unmetered run, and a zero beside real calls an unpriced catalog row.
    expect(
      spendA.cost_micro_usd,
      `${MODEL_ALIAS} settled no cost — is the catalog row priced?`
    ).toBeTruthy();
    expect(BigInt(spendA.cost_micro_usd!)).toBeGreaterThan(0n);
    // The cap has to be a real constraint on this prompt, or the second pass
    // would prove nothing by stopping.
    expect(
      Number(spendA.provider_calls),
      'the uncapped run fit inside the ceiling, so the ceiling cannot bind'
    ).toBeGreaterThan(CAP_PROVIDER_CALLS);

    const renderedA = await readUsageRow(page, spendA.run_id);
    uncapped.rendered_cost = renderedA;
    expect(
      amountMatches(renderedA, BigInt(spendA.cost_micro_usd!)),
      `the screen shows ${renderedA} for ${spendA.cost_micro_usd} micro-USD`
    ).toBe(true);
    await screenshot(page, '03-uncapped-usage');

    // ---- Pass 2: the same prompt under a ceiling that cannot hold it. -----
    setCeiling(CAP_PROVIDER_CALLS);
    const composerB = await newSpace(page);
    await selectModel(page, MODEL_LABEL);
    await typeIntoComposer(page, composerB, PROMPT);
    await composerB.press('Enter');
    await screenshot(page, '04-capped-sent');

    // The desktop names the ceiling rather than reporting a provider error, so
    // this text is the product-level claim under test.
    const stopped = page.getByText(STOPPED_TEXT, { exact: false }).first();
    await stopped.waitFor({ state: 'visible', timeout: STOP_TIMEOUT_MS });
    capped.ui_said = (await stopped.innerText()).trim();
    await screenshot(page, '05-capped-stopped');
    // The answer is what the run never got to produce.
    await expect(
      page.getByText(EXPECTED_ANSWER, { exact: false })
    ).toHaveCount(0);

    const projectB = [
      ...new Set(
        requests
          .map((r) => /\/projects\/([^/?]+)\/commands/.exec(r.url)?.[1])
          .filter(Boolean)
      ),
    ].filter((id) => id !== projectA)[0];
    expect(projectB, 'no command was submitted for the capped pass').toBeTruthy();
    capped.project_id = projectB;
    const trajectoryB = await collectTrajectory(projectB!);
    capped.terminal = trajectoryB.terminal;
    capped.event_kinds = countKinds(trajectoryB.events);
    expect(trajectoryB.terminal, 'the capped run did not stop').toBe(
      'run_failed'
    );

    const spendB = await projectSpend(projectB!);
    capped.run_id = spendB.run_id;
    capped.cost_micro_usd = spendB.cost_micro_usd;
    capped.provider_calls = spendB.provider_calls;
    expect(
      spendB.provider_calls,
      'the capped run settled without a recorded figure'
    ).toBeTruthy();
    // The control: the ceiling BOUND. Same prompt, same model, fewer calls —
    // and never more than the ceiling allowed.
    expect(Number(spendB.provider_calls)).toBeLessThanOrEqual(
      CAP_PROVIDER_CALLS
    );
    expect(
      Number(spendB.provider_calls),
      'the capped run made as many provider calls as the uncapped one'
    ).toBeLessThan(Number(spendA.provider_calls));

    const renderedB = await readUsageRow(page, spendB.run_id);
    capped.rendered_cost = renderedB;
    expect(
      amountMatches(renderedB, BigInt(spendB.cost_micro_usd ?? '0')),
      `the screen shows ${renderedB} for ${spendB.cost_micro_usd} micro-USD`
    ).toBe(true);
    await screenshot(page, '06-capped-usage');

    // Everything the renderer touched stayed on the edge.
    const offEdge = requests.filter((request) => {
      const url = new URL(request.url);
      if (url.protocol === 'file:' || url.protocol === 'devtools:') return false;
      return !request.url.startsWith(edgeBaseUrl);
    });
    summary.off_edge_requests = offEdge.map((request) => request.url);
    summary.request_count = requests.length;
    expect(offEdge.map((request) => request.url)).toEqual([]);
    expect(
      requests.filter((request) => /^https?:/.test(request.url)).length,
      'an empty off-edge set is vacuous unless the renderer made requests'
    ).toBeGreaterThan(0);
  } catch (error) {
    bodyFailed = true;
    throw error;
  } finally {
    // Uncapped is the stack's documented default; leaving a ceiling behind
    // would quietly cut short every later run on it.
    try {
      setCeiling(0);
      summary.ceiling_restored = true;
    } catch (error) {
      summary.ceiling_restored = false;
      summary.ceiling_restore_error = String(error);
    }
    // The recording only flushes on close, so the video is resolved after
    // teardown and before the summary that reports it.
    await app.close();
    let videoBytes = 0;
    let videoName: string | null = null;
    const recorded = await video?.path().catch(() => undefined);
    if (recorded && fs.existsSync(recorded)) {
      videoName = 'usage-run.webm';
      fs.copyFileSync(recorded, path.join(OUT_DIR, videoName));
      videoBytes = fs.statSync(recorded).size;
    }
    summary.video = videoName;
    summary.video_bytes = videoBytes;
    writeOut('summary.json', JSON.stringify(summary, null, 2));
    fs.rmSync(workDir, { recursive: true, force: true });
    // Only when the run itself passed: a missing recording must never be what
    // gets reported for a run that failed on its own terms.
    if (!bodyFailed) {
      expect(videoBytes, 'the run was not recorded').toBeGreaterThan(
        MIN_VIDEO_BYTES
      );
    }
  }
});
