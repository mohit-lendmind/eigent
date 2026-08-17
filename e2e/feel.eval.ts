// Real-model driver for the settled work log: one live provider run whose tool
// rows must finish — settle out of the running shimmer, carry the tool's real
// output in their Response fold, and sit under a header clock that counted the
// run — driven through the REAL product chat UI against the live eigent-local
// stack, and recorded.
//
// The claim under test is a correspondence between two independently-sourced
// records: the tool_call/tool_result pairs the edge stored for the run, and
// the settled rows the work log draws. Neither side is a literal — the model
// decides how many tool calls it makes, the edge records what actually ran,
// and the UI is only correct if every recorded call has a settled row whose
// fold shows that call's recorded result.
//
// The negative control is the second pass, same session and same model: a
// read_file against a path that does not exist. The sandbox refuses it, the
// edge records is_error on the result, and the row must render the error
// state — not "done". Without it, a surface that force-settled every row as
// done would pass the first pass and be wrong.
//
// Run: npx playwright test --config e2e/eval.config.ts feel
// Env: EIGENT_EVAL_MODEL / EIGENT_EVAL_MODEL_LABEL pick the catalog row (a REAL
//      provider row — the deterministic fixtures are what layer 2 covers).
// Output: EIGENT_EVAL_DIR (default ../l1-evidence/playwright/real-model).

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

const REPO_ROOT =
  process.env.EIGENT_E2E_APP_DIR ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOOTSTRAP_PATH =
  process.env.EIGENT_E2E_BOOTSTRAP ??
  path.resolve(REPO_ROOT, '../aion-v1/deploy/eigent-local/run/bootstrap.json');
const OUT_DIR =
  process.env.EIGENT_EVAL_DIR ??
  path.resolve(REPO_ROOT, '..', 'l1-evidence', 'playwright', 'real-model');

const MODEL_ALIAS = process.env.EIGENT_EVAL_MODEL ?? 'kimi-k3';
const MODEL_LABEL = process.env.EIGENT_EVAL_MODEL_LABEL ?? 'Kimi K3';

const TURN_TIMEOUT_MS = 15 * 60_000;
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

/** A per-invocation tag, so a stack that has served this eval before cannot
 * supply the Project this run is looking for. */
const RUN_TAG = `l1-${Date.now().toString(36)}`;

// Both prompts are written one paragraph per line and joined by a BLANK line,
// because the composer keeps paragraph breaks and drops single line breaks
// outright — a prompt wrapped for source width would reach the model with its
// words run together across every wrap.
const TOOL_PROMPT = [
  `[${RUN_TAG}] Use the shell exactly twice, one command per call.`,
  'First compute 2 to the power of 17 with the shell, then compute the sum of every integer from 1 to 500 inclusive with the shell.',
  'Do not compute either number yourself. When both commands have returned, finish your reply with exactly one line:',
  'ANSWER: POW=<first value> SUM=<second value>',
].join('\n\n');
const TOOL_ANSWER = 'POW=131072 SUM=125250';

const MISSING_PATH = `notes/never-written-${RUN_TAG}.txt`;
const ERROR_PROMPT = [
  `[${RUN_TAG}] Use the read_file tool exactly once, on the path ${MISSING_PATH} — this file does not exist and the read will fail.`,
  'Do not create the file first and do not retry. When the read has failed, reply with exactly one line:',
  'ANSWER: READ_FAILED',
].join('\n\n');
const ERROR_ANSWER = 'READ_FAILED';

interface EdgeEvent {
  kind: string;
  sequence: string;
  data?: Record<string, unknown>;
}

interface PassRecord {
  name: string;
  prompt: string;
  project_id?: string;
  terminal?: string | null;
  event_kinds?: Record<string, number>;
  tool_calls?: unknown[];
  tool_results?: number;
  error_results?: number;
  row_labels?: string[];
  settled_clock_label?: string;
  answered?: boolean;
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
  const want = text.replace(/\s+/g, ' ').trim();
  let last = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.keyboard.press('Escape').catch(() => {});
    await composer.click();
    await page.keyboard.insertText(text);
    const got = (await composer.innerText()).replace(/\s+/g, ' ').trim();
    if (got === want) return;
    last = got;
    await composer.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
  }
  throw new Error(
    `composer never captured the full prompt\n  got:  ${last}\n  want: ${want}`
  );
}

/** A fresh Space, so each pass becomes its own aion Project. */
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

/** The composer is not editable while the turn is busy. */
async function awaitTurnSettled(page: Page): Promise<void> {
  const busy = page.locator('[role="textbox"][contenteditable="false"]');
  await busy
    .first()
    .waitFor({ state: 'attached', timeout: 120_000 })
    .catch(() => {});
  await expect(busy).toHaveCount(0, { timeout: TURN_TIMEOUT_MS });
}

/**
 * The work log collapses itself when the task finishes, and its body unmounts
 * while collapsed — so what a settled turn did is only readable after reopening
 * it. Idempotent: an already-open log is left alone.
 */
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

/**
 * A settled turn's agent groups auto-collapse, and a collapsed group unmounts
 * its tool rows — so the rows are only countable after expanding every group.
 */
async function expandAgentGroups(page: Page): Promise<void> {
  const groups = page.getByTestId('work-log-agent-group');
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

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

test('tool rows settle with real output, and a failed tool renders as failed', async () => {
  test.setTimeout(45 * 60_000);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-l1-'));
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

  const toolPass: PassRecord = { name: 'tools', prompt: TOOL_PROMPT };
  const errorPass: PassRecord = { name: 'error', prompt: ERROR_PROMPT };
  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
    run_tag: RUN_TAG,
    model_alias: MODEL_ALIAS,
    passes: [toolPass, errorPass],
  };

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
    const requests: { method: string; url: string }[] = [];
    page.on('request', (request) => {
      requests.push({ method: request.method(), url: request.url() });
    });
    /** Each pass admits its own Project; the id is taken off the renderer's own
     * submit, so the trajectory read back is the one the UI drew from. */
    const projectIds = (): string[] => [
      ...new Set(
        requests
          .map((r) => /\/projects\/([^/?]+)\/commands/.exec(r.url)?.[1])
          .filter((id): id is string => Boolean(id))
      ),
    ];

    await page
      .locator('[role="textbox"]')
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 });

    // ---- Pass 1: two shell calls, every row settles with its output. -------
    const composerA = await newSpace(page);
    await selectModel(page, MODEL_LABEL);
    const createA = page
      .waitForRequest(
        (request) =>
          request.method() === 'POST' &&
          request.url() === `${edgeBaseUrl}/projects`,
        { timeout: 60_000 }
      )
      .then((request) => request.postData() ?? '')
      .catch(() => '');
    await typeIntoComposer(page, composerA, TOOL_PROMPT);
    await composerA.press('Enter');
    const postedA = JSON.parse((await createA) || '{}') as {
      model_alias?: string;
    };
    // Which provider actually served the run, read off the wire rather than
    // off the picker that was clicked.
    expect(
      postedA.model_alias,
      "the picker's choice never reached the create"
    ).toBe(MODEL_ALIAS);
    await screenshot(page, '01-tools-sent');

    await awaitTurnSettled(page);
    await openWorkLog(page);
    await expandAgentGroups(page);

    const projectA = projectIds()[0];
    expect(projectA, 'no command was submitted for the tool pass').toBeTruthy();
    toolPass.project_id = projectA;
    const trajectoryA = await collectTrajectory(projectA);
    toolPass.terminal = trajectoryA.terminal;
    toolPass.event_kinds = countKinds(trajectoryA.events);
    expect(trajectoryA.terminal, 'the tool run did not complete').toBe(
      'run_completed'
    );

    const callsA = trajectoryA.events.filter((e) => e.kind === 'tool_call');
    const resultsA = trajectoryA.events.filter((e) => e.kind === 'tool_result');
    toolPass.tool_calls = callsA.map((e) => e.data?.tool_name);
    toolPass.tool_results = resultsA.length;
    toolPass.error_results = resultsA.filter(
      (e) => e.data?.is_error === true
    ).length;
    // The floor is what keeps the row assertions from being satisfied by a run
    // that answered without touching a tool.
    expect(
      callsA.length,
      'the model answered without calling any tool'
    ).toBeGreaterThanOrEqual(2);
    // Every call the edge recorded also has its result recorded, so no settled
    // row below stands in for a call the run simply never closed.
    const callIds = callsA.map((e) => String(e.data?.tool_call_id ?? ''));
    const resultIds = new Set(
      resultsA.map((e) => String(e.data?.tool_call_id ?? ''))
    );
    for (const id of callIds) {
      expect(resultIds.has(id), `tool call ${id} has no recorded result`).toBe(
        true
      );
    }

    // The milestone's claim: one settled row per recorded call, none still
    // shimmering — a number the model chose, not one this test picked.
    const rowsA = toolRows(page);
    await expect(rowsA).toHaveCount(callsA.length);
    await expect(page.locator('[data-tool-status="running"]')).toHaveCount(0);
    toolPass.row_labels = (await rowsA.allInnerTexts()).map(normalize);
    // Open a bash row: its Response fold must carry the recorded result — the
    // fold that used to render permanently empty. The first line is asserted
    // because the fold may cap a long output.
    const bashResultContent = resultsA
      .map((e) => String(e.data?.content ?? ''))
      .find((content) => content.startsWith('exit='));
    expect(
      bashResultContent,
      'no bash-shaped result in the trajectory'
    ).toBeTruthy();
    const bashRowA = rowsA.filter({ hasText: 'bash' }).first();
    await bashRowA.locator('button').first().click();
    await expect(bashRowA).toContainText('Response');
    await expect(bashRowA).toContainText(bashResultContent!.split('\n')[0]);
    // The clock: before the fix nothing set taskTime on the aion path and this
    // label read "Worked for 0s" no matter how long the run took.
    const clockA = normalize(
      await page.getByTestId('work-log-toggle').last().innerText()
    );
    toolPass.settled_clock_label = clockA;
    expect(clockA).toMatch(/Worked for /);
    expect(clockA).not.toContain('Worked for 0s');
    await page.waitForTimeout(1_000);
    await screenshot(page, '02-tools-settled-rows');

    // The arithmetic came back and was merged, so the rows above belong to a
    // run that actually did its job.
    toolPass.answered = normalize(
      await page.locator('body').innerText()
    ).includes(TOOL_ANSWER);
    expect(toolPass.answered, `the run never reported ${TOOL_ANSWER}`).toBe(
      true
    );

    // ---- Pass 2: the negative control — a failed read renders as failed. ---
    const composerB = await newSpace(page);
    await selectModel(page, MODEL_LABEL);
    await typeIntoComposer(page, composerB, ERROR_PROMPT);
    await composerB.press('Enter');
    await awaitTurnSettled(page);
    await openWorkLog(page);
    await expandAgentGroups(page);

    const projectB = projectIds().find((id) => id !== projectA);
    expect(projectB, 'no command was submitted for the error pass').toBeTruthy();
    errorPass.project_id = projectB;
    const trajectoryB = await collectTrajectory(projectB!);
    errorPass.terminal = trajectoryB.terminal;
    errorPass.event_kinds = countKinds(trajectoryB.events);
    expect(trajectoryB.terminal, 'the error run did not complete').toBe(
      'run_completed'
    );

    const resultsB = trajectoryB.events.filter(
      (e) => e.kind === 'tool_result'
    );
    const errorResults = resultsB.filter((e) => e.data?.is_error === true);
    errorPass.tool_results = resultsB.length;
    errorPass.error_results = errorResults.length;
    // The refused read is what makes any error row reachable; without it the
    // error-state assertion below would be vacuous.
    expect(
      errorResults.length,
      'the run never recorded a failed tool result'
    ).toBeGreaterThanOrEqual(1);

    // The control: a row whose result came back is_error must render the error
    // state — not "done", and never a shimmer that outlives the run.
    const errorRows = page.locator('[data-tool-status="error"]');
    await expect(errorRows).toHaveCount(errorResults.length);
    await expect(page.locator('[data-tool-status="running"]')).toHaveCount(0);
    await expect(errorRows.first()).toContainText('failed');
    errorPass.row_labels = (
      await toolRows(page).allInnerTexts()
    ).map(normalize);
    await page.waitForTimeout(1_000);
    await screenshot(page, '03-error-row-failed');

    errorPass.answered = normalize(
      await page.locator('body').innerText()
    ).includes(ERROR_ANSWER);
    expect(errorPass.answered, `the run never reported ${ERROR_ANSWER}`).toBe(
      true
    );

    // Both halves of the network audit: everything HTTP stayed on the edge,
    // and the set is non-vacuous because the renderer did make requests.
    const offEdge = requests
      .map((r) => r.url)
      .filter((u) => /^https?:/.test(u))
      .filter((u) => !u.startsWith(new URL(edgeBaseUrl).origin));
    summary.off_edge_requests = offEdge;
    expect(offEdge).toEqual([]);
    expect(
      requests.filter((r) => /^https?:/.test(r.url)).length
    ).toBeGreaterThan(0);
  } catch (error) {
    bodyFailed = true;
    throw error;
  } finally {
    // The recording is only flushed to disk when the app closes, so the video
    // is resolved after teardown and before the summary that reports it.
    await app.close();
    let videoBytes = 0;
    let videoName: string | null = null;
    const recorded = await video?.path().catch(() => undefined);
    if (recorded && fs.existsSync(recorded)) {
      videoName = 'feel-run.webm';
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
