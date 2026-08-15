// Real-model driver for the visible workforce: one live provider run that fans
// out to worker agents, driven through the REAL product chat UI against the
// live eigent-local stack, and recorded.
//
// The claim under test is an equality between two independently-sourced
// numbers: the worker lanes the work log draws, and the `subagent_started`
// events the edge recorded for that run. Neither side is a literal — the model
// decides how many workers it staffs, the edge reports what it actually
// admitted, and the UI is only correct if it drew exactly that. A floor of two
// keeps the equality from being satisfied by a run that never delegated.
//
// The negative control is the second pass, same session and same model: a task
// the orchestrator is told to do itself. It still calls a tool, so its work log
// still renders — and that log must carry the orchestrator's own row and no
// worker lanes at all. Without it, a surface that always drew fan-out would
// pass the first pass and be wrong.
//
// Run: npx playwright test --config e2e/eval.config.ts workforce
// Env: EIGENT_EVAL_MODEL / EIGENT_EVAL_MODEL_LABEL pick the catalog row (a REAL
//      provider row — the deterministic fixtures are what layer 2 covers).
// Output: EIGENT_EVAL_DIR (default ../n3-evidence/playwright/real-model).

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
  path.resolve(REPO_ROOT, '..', 'n3-evidence', 'playwright', 'real-model');

const MODEL_ALIAS = process.env.EIGENT_EVAL_MODEL ?? 'kimi-k3';
const MODEL_LABEL = process.env.EIGENT_EVAL_MODEL_LABEL ?? 'Kimi K3';

/** Below this the run delegated too little for the equality to mean anything. */
const MIN_WORKERS = 2;
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
const RUN_TAG = `n3-${Date.now().toString(36)}`;

/** The two workers the fan-out pass asks for, by the names their lanes must
 * carry. Short and literal: the lane label is matched against them. */
const WORKER_NAMES = ['alpha', 'beta'];

// Both prompts are written one paragraph per line and joined by a BLANK line,
// because the composer keeps paragraph breaks and drops single line breaks
// outright — a prompt wrapped for source width would reach the model with its
// words run together across every wrap.
const FANOUT_PROMPT = [
  `[${RUN_TAG}] Staff this as a small team, not as one agent.`,
  'Delegate with spawn_subagent, one worker per task, and name the workers exactly "alpha" and "beta" so their reports can be told apart.',
  'alpha: compute 2 to the power of 17, and report it as ALPHA=<value>',
  'beta: compute the sum of every integer from 1 to 500 inclusive, and report it as BETA=<value>',
  'Tell each worker to use the shell for its own arithmetic. Do not compute either number yourself, and do not answer before both workers have reported.',
  'When both have reported, finish your reply with exactly one line:',
  'ANSWER: ALPHA=<alpha value> BETA=<beta value>',
].join('\n\n');
const FANOUT_ANSWER = 'ALPHA=131072 BETA=125250';

const SOLO_PROMPT = [
  `[${RUN_TAG}] Answer this one yourself. Do not delegate, and do not spawn any worker agents.`,
  'Use the shell exactly once to compute 3 to the power of 7, then reply with exactly one line:',
  'SOLO=<value>',
].join('\n\n');
const SOLO_ANSWER = 'SOLO=2187';

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
  subagent_started?: number;
  subagent_ended?: number;
  worker_names?: string[];
  lane_count?: number;
  lane_labels?: string[];
  side_panel_mode?: string | null;
  pool_worker_rows?: number;
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
  // Both sides, because the interesting failures are near-misses: the composer
  // silently reshaping the text it was given, not dropping it.
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

const workerLanes = (page: Page) =>
  page.locator(
    '[data-testid="work-log-agent-group"][data-agent-type="worker_agent"]'
  );

const orchestratorRows = (page: Page) =>
  page.locator(
    '[data-testid="work-log-agent-group"][data-agent-type="single_agent"]'
  );

/** The panel's own claim about what kind of session this is. */
const sidePanelMode = (page: Page) =>
  page.getByTestId('session-side-panel-header').first();

/**
 * Worker rows in the agent pool, asserted against the accordion's collapsed
 * state on purpose: a fan-out the user has to expand a section to discover is
 * not a visible one.
 */
const poolWorkerRows = (page: Page) =>
  page.locator('[data-testid="agent-pool-row"][data-agent-type="worker_agent"]');

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

test('a real fan-out draws one lane per worker, and a solo run draws none', async () => {
  test.setTimeout(50 * 60_000);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-n3-'));
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

  const fanout: PassRecord = { name: 'fanout', prompt: FANOUT_PROMPT };
  const solo: PassRecord = { name: 'solo', prompt: SOLO_PROMPT };
  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
    run_tag: RUN_TAG,
    model_alias: MODEL_ALIAS,
    passes: [fanout, solo],
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

    // ---- Pass 1: the fan-out. --------------------------------------------
    const composerA = await newSpace(page);
    await selectModel(page, MODEL_LABEL);
    // Resolved rather than rejected on failure: this promise is in flight while
    // the steps below run, so a rejection would land after the app is torn down
    // and be reported in place of whatever actually went wrong. An empty body
    // fails the assertion below instead, with its own message.
    const createA = page
      .waitForRequest(
        (request) =>
          request.method() === 'POST' &&
          request.url() === `${edgeBaseUrl}/projects`,
        { timeout: 60_000 }
      )
      .then((request) => request.postData() ?? '')
      .catch(() => '');
    await typeIntoComposer(page, composerA, FANOUT_PROMPT);
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
    await screenshot(page, '01-fanout-sent');

    await awaitTurnSettled(page);
    await openWorkLog(page);

    const projectA = projectIds()[0];
    expect(projectA, 'no command was submitted for the fan-out pass').toBeTruthy();
    fanout.project_id = projectA;
    const trajectoryA = await collectTrajectory(projectA);
    fanout.terminal = trajectoryA.terminal;
    fanout.event_kinds = countKinds(trajectoryA.events);
    expect(trajectoryA.terminal, 'the fan-out run did not complete').toBe(
      'run_completed'
    );

    const started = trajectoryA.events.filter(
      (e) => e.kind === 'subagent_started'
    );
    const ended = trajectoryA.events.filter((e) => e.kind === 'subagent_ended');
    const startedNames = started.map((e) => String(e.data?.name ?? ''));
    fanout.subagent_started = started.length;
    fanout.subagent_ended = ended.length;
    fanout.worker_names = startedNames;
    // The floor is what stops the equality below from being satisfied by a run
    // that quietly did all the work itself.
    expect(
      started.length,
      'the model answered without delegating, so there is no fan-out to draw'
    ).toBeGreaterThanOrEqual(MIN_WORKERS);
    // Every worker that started also reported an end, so no lane below is a
    // lane the run simply never closed.
    expect(ended.length).toBe(started.length);

    // The milestone's claim: the lanes on screen are exactly the workers the
    // edge recorded — a number the model chose, not one this test picked.
    const lanes = workerLanes(page);
    await expect(lanes).toHaveCount(started.length);
    // The log body animates its height open under `overflow-hidden`, so a lane
    // can be in the DOM and still clipped out of the user's view.
    await expect(lanes.last()).toBeVisible();
    const laneLabels = (await lanes.allInnerTexts()).map(normalize);
    fanout.lane_count = laneLabels.length;
    fanout.lane_labels = laneLabels;
    // Each lane is labelled by the worker the edge named, so the rows are this
    // run's actual workers rather than N copies of one placeholder.
    for (const name of startedNames) {
      expect(name, 'a worker started without a name').not.toBe('');
      expect(
        laneLabels.some((label) =>
          label.toLowerCase().includes(name.toLowerCase())
        ),
        `no lane labelled for worker ${name} among ${laneLabels.join(' | ')}`
      ).toBe(true);
    }
    for (const wanted of WORKER_NAMES) {
      expect(
        startedNames.some((name) => name.toLowerCase().includes(wanted)),
        `the run never staffed a worker named ${wanted}: ${startedNames.join(', ')}`
      ).toBe(true);
    }
    // A row that cannot say what its worker did is a label, not a lane.
    await lanes.first().click();
    await expect(page.locator('body')).toContainText('Joined the run as');
    await expect(page.locator('body')).toContainText('Finished:');
    // The orchestrator keeps its own row: the fan-out is drawn beside it, not
    // in place of it.
    await expect(orchestratorRows(page)).toHaveCount(1);
    // The height transition is what this waits out; without it the capture
    // shows a half-open log rather than the lanes it is evidence of.
    await page.waitForTimeout(1_000);
    // One frame, taken after the panel assertions below have their state on
    // screen: the lanes and the side panel share a viewport, so a second shot
    // would be the same bytes under a different name.
    // A session that staffed workers must stop calling itself a single-agent
    // one, and its panel must name them: the panel is the surface that answers
    // "who is working right now", and it is where the run being a team rather
    // than one agent has to be legible.
    await expect(sidePanelMode(page)).toHaveAttribute(
      'data-session-mode',
      'workforce'
    );
    await expect(poolWorkerRows(page)).toHaveCount(started.length);
    // Each row says what its worker is doing, so the panel reports the run
    // rather than merely counting it.
    await expect(
      poolWorkerRows(page).first().locator('[data-testid="agent-worker-tag"]')
    ).toBeVisible();
    fanout.side_panel_mode = await sidePanelMode(page).getAttribute(
      'data-session-mode'
    );
    fanout.pool_worker_rows = await poolWorkerRows(page).count();
    await screenshot(page, '02-fanout-lanes-and-panel');

    // The workers' arithmetic came back and was merged, so the lanes above
    // belong to a run that actually did its job.
    fanout.answered = normalize(
      await page.locator('body').innerText()
    ).includes(FANOUT_ANSWER);
    expect(fanout.answered, `the run never reported ${FANOUT_ANSWER}`).toBe(
      true
    );

    // ---- Pass 2: the negative control, same session and same model. ------
    const composerB = await newSpace(page);
    await selectModel(page, MODEL_LABEL);
    await typeIntoComposer(page, composerB, SOLO_PROMPT);
    await composerB.press('Enter');
    await screenshot(page, '03-solo-sent');
    await awaitTurnSettled(page);
    await openWorkLog(page);

    const projectB = projectIds().filter((id) => id !== projectA)[0];
    expect(projectB, 'no command was submitted for the solo pass').toBeTruthy();
    solo.project_id = projectB;
    const trajectoryB = await collectTrajectory(projectB);
    solo.terminal = trajectoryB.terminal;
    solo.event_kinds = countKinds(trajectoryB.events);
    solo.subagent_started = trajectoryB.events.filter(
      (e) => e.kind === 'subagent_started'
    ).length;
    expect(trajectoryB.terminal, 'the solo run did not complete').toBe(
      'run_completed'
    );
    expect(solo.subagent_started, 'the control run delegated after all').toBe(0);

    // The orchestrator's own row proves the log rendered, so the empty lane set
    // below is a fact about this turn rather than about an absent surface.
    await expect(orchestratorRows(page)).toHaveCount(1);
    await expect(workerLanes(page)).toHaveCount(0);
    // And the mode follows the run rather than sticking: a session that never
    // delegated stays a single-agent one, with an empty worker pool.
    await expect(sidePanelMode(page)).toHaveAttribute(
      'data-session-mode',
      'single-agent'
    );
    await expect(poolWorkerRows(page)).toHaveCount(0);
    solo.side_panel_mode = await sidePanelMode(page).getAttribute(
      'data-session-mode'
    );
    solo.pool_worker_rows = 0;
    solo.lane_count = 0;
    solo.answered = normalize(await page.locator('body').innerText()).includes(
      SOLO_ANSWER
    );
    expect(solo.answered, `the control never reported ${SOLO_ANSWER}`).toBe(
      true
    );
    await page.waitForTimeout(1_000);
    await screenshot(page, '04-solo-no-lanes');

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
    // The recording only flushes on close, so the video is resolved after
    // teardown and before the summary that reports it.
    await app.close();
    let videoBytes = 0;
    let videoName: string | null = null;
    const recorded = await video?.path().catch(() => undefined);
    if (recorded && fs.existsSync(recorded)) {
      videoName = 'workforce-run.webm';
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
