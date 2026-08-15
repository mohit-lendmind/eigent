// Real-model driver for triggers: create a cron trigger through the REAL
// Triggers screen and then do nothing at all, while a real provider serves two
// runs the user never submitted.
//
// The claim being demonstrated is narrow and is the whole point of an
// automation plane: a tick admits a run, and it admits exactly one, forever.
// Nothing on a screen can show that. So the oracle is the edge's own pair of
// records — the trigger's audit ledger, which says which ticks the worker acted
// on, and the Project's event trajectory, which says which runs were actually
// accepted — and the property asserted between them is an equality: as many
// accepted runs as fired ticks, no more and no fewer, with the tick→run map
// injective. A duplicate delivery breaks the equality in one direction and a
// swallowed tick breaks it in the other.
//
// "The second tick reused nothing from the first" is asserted the only way it
// can be: the two fires carry different ticks, different commands and different
// runs, neither is flagged as an idempotency replay, and BOTH runs produced
// their own model output and their own terminal. A second tick that had
// collapsed onto the first run would show a fire with no run behind it.
//
// The negative control is the pause: after it the trigger sits through a due
// instant and the ledger gains nothing.
//
// Run: npx playwright test --config e2e/eval.config.ts schedules
// Env: EIGENT_EVAL_MODEL / EIGENT_EVAL_MODEL_LABEL pick the catalog row.
// Output: EIGENT_EVAL_DIR (default ../n5-evidence/playwright/real-model).

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
  path.resolve(REPO_ROOT, '..', 'n5-evidence', 'playwright', 'real-model');

const MODEL_ALIAS = process.env.EIGENT_EVAL_MODEL ?? 'kimi-k3';

// The fastest cadence the edge accepts. Two firings are therefore about two
// minutes apart from the first boundary the trigger meets.
const CRON = '* * * * *';
const TASK_MARKER = 'aion-eval-trigger-probe';
// Every trigger this eval creates carries the marker so a run that died
// half-way can be swept: a leaked minute-cadence trigger keeps submitting
// commands to a real provider forever.
const FIRES_WANTED = 2;
// Room for the two boundaries plus runs slow enough to forfeit a tick between
// them — a forfeited tick is a legitimate outcome here, not a failure.
const FIRES_TIMEOUT_MS = 8 * 60_000;
// Past the fire instant the edge had scheduled when the pause landed.
const QUIET_PAST_NEXT_FIRE_MS = 20_000;
const PAUSE_MARGIN_MS = 10_000;
// `?after=0` replays the whole Project before going live and the stream never
// ends, so every trajectory read is bounded. The read exits as soon as the runs
// it is waiting for have settled, so the ceiling only costs anything when one
// of them never does.
const TRAJECTORY_WINDOW_MS = 120_000;
const VIDEO_SIZE = { width: 1280, height: 800 };
// A recording that never started is a few KB of container; a recorded run is
// megabytes. The floor separates the two without pinning a duration.
const MIN_VIDEO_BYTES = 200 * 1024;

const TERMINAL_KINDS = ['run_completed', 'run_failed', 'run_cancelled'];

interface Bootstrap {
  api_key: string;
  edge_url: string;
  tenant_id: string;
}

interface EdgeEvent {
  kind: string;
  sequence: string;
  run_id?: string;
  data?: Record<string, unknown>;
}

interface EdgeSchedule {
  schedule_id: string;
  project_id: string;
  cron: string;
  task: string;
  status: string;
  attempts: number;
  next_fire_at?: string;
  last_fired_tick?: string;
}

interface EdgeScheduleEvent {
  event_id: string;
  action: string;
  occurred_at: string;
  payload?: Record<string, unknown>;
}

const bootstrap: Bootstrap = JSON.parse(
  fs.readFileSync(BOOTSTRAP_PATH, 'utf-8')
);
const edgeBaseUrl = `${bootstrap.edge_url.replace(/\/+$/, '')}/eigent/v1`;

/**
 * A per-invocation tag on the task text, so a stack that has served this eval
 * before cannot supply the trigger or the runs this one is looking for.
 */
const RUN_TAG = `n5-${Date.now().toString(36)}`;
// Deliberately trivial: the model's job here is to be a real provider serving a
// real run, not to be tested. A short answer also keeps a run inside its own
// minute, so consecutive ticks fire rather than forfeit as busy.
const ANSWER = 'TICK_OK';
const TASK_TEXT =
  `${TASK_MARKER} [${RUN_TAG}] Reply with exactly one line containing only ` +
  `${ANSWER} and nothing else.`;

function writeOut(name: string, body: string): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (body.includes(bootstrap.api_key)) {
    throw new Error(`${name} would leak the API key`);
  }
  fs.writeFileSync(path.join(OUT_DIR, name), body);
}

async function screenshot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(OUT_DIR, `${name}.png`),
    fullPage: true,
  });
}

async function edgeFetch(
  method: string,
  pathname: string,
  body?: unknown
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${bootstrap.api_key}`,
  };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    headers['Idempotency-Key'] = `sch-eval-${Math.random().toString(36).slice(2)}`;
  }
  return fetch(`${edgeBaseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createProject(title: string): Promise<string> {
  const response = await edgeFetch('POST', '/projects', {
    title,
    model_alias: MODEL_ALIAS,
  });
  if (response.status !== 201) {
    throw new Error(
      `createProject: ${response.status} ${await response.text()}`
    );
  }
  return ((await response.json()) as { project_id: string }).project_id;
}

async function servedSchedules(projectId?: string): Promise<EdgeSchedule[]> {
  const query = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
  const response = await edgeFetch('GET', `/schedules${query}`);
  if (!response.ok) {
    throw new Error(
      `listSchedules: ${response.status} ${await response.text()}`
    );
  }
  return ((await response.json()) as { schedules: EdgeSchedule[] }).schedules;
}

async function servedLedger(scheduleId: string): Promise<EdgeScheduleEvent[]> {
  const response = await edgeFetch(
    'GET',
    `/schedules/${encodeURIComponent(scheduleId)}/events?limit=100`
  );
  if (!response.ok) {
    throw new Error(
      `listScheduleEvents: ${response.status} ${await response.text()}`
    );
  }
  return ((await response.json()) as { events: EdgeScheduleEvent[] }).events;
}

/** Removes this eval's own leftovers, whenever it last stopped. */
async function sweepProbes(): Promise<void> {
  for (const row of await servedSchedules()) {
    if (!row.task.startsWith(TASK_MARKER)) continue;
    await edgeFetch('DELETE', `/schedules/${encodeURIComponent(row.schedule_id)}`);
  }
}

/**
 * The durable trajectory, straight from the edge's SSE replay: the runs as the
 * product recorded them, independent of anything the renderer displayed. The
 * read ends once `wantTerminals` runs have finished, because a Project whose
 * trigger is still active never stops producing events.
 */
async function collectTrajectory(
  projectId: string,
  wantTerminals: number
): Promise<EdgeEvent[]> {
  const events: EdgeEvent[] = [];
  let terminals = 0;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRAJECTORY_WINDOW_MS);
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
        if (TERMINAL_KINDS.includes(event.kind)) {
          terminals += 1;
          if (terminals >= wantTerminals) break outer;
        }
      }
    }
  } catch (error) {
    if (!(error instanceof Error && error.name === 'AbortError')) throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return events;
}

/** One run's slice of the trajectory: what it said, and how it ended. */
function runSlice(
  events: EdgeEvent[],
  runId: string
): { text: string; terminal: string | null; kinds: string[] } {
  const mine = events.filter((event) => event.run_id === runId);
  return {
    text: mine
      .filter((event) => event.kind === 'text_delta')
      .map((event) => String(event.data?.text ?? ''))
      .join(''),
    terminal: mine.find((event) => TERMINAL_KINDS.includes(event.kind))?.kind ?? null,
    kinds: mine.map((event) => event.kind),
  };
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

async function sleepUntil(epochMs: number): Promise<void> {
  const remaining = epochMs - Date.now();
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

test('a cron trigger serves two real-model runs nobody submitted', async () => {
  const projectId = await createProject(`Trigger eval ${RUN_TAG}`);
  await sweepProbes();

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-n5-'));
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

  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
    run_tag: RUN_TAG,
    model_alias: MODEL_ALIAS,
    project_id: projectId,
    cron: CRON,
    task: TASK_TEXT,
  };

  const app = await electron.launch({
    args: [REPO_ROOT],
    cwd: REPO_ROOT,
    env,
    recordVideo: { dir: videoDir, size: VIDEO_SIZE },
  });
  let video: ReturnType<Page['video']> = null;
  let bodyFailed = false;
  let scheduleId: string | null = null;
  try {
    const page = await findMainWindow(app);
    video = page.video();
    const requestUrls: string[] = [];
    page.on('request', (request) => requestUrls.push(request.url()));
    await page
      .locator('[role="textbox"]')
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 });

    // ---- Create the trigger through the screen the user would use. ----
    await page.evaluate(() => {
      window.location.hash = '#/history?tab=home&section=triggers';
    });
    await page.reload();
    await expect(page.getByTestId('aion-triggers')).toBeVisible({
      timeout: 60_000,
    });
    await page.getByTestId('aion-triggers-new').click();
    await expect(page.getByTestId('aion-trigger-form')).toBeVisible();
    await page.getByTestId('aion-trigger-project').selectOption(projectId);
    await page.getByTestId('aion-trigger-cron').fill(CRON);
    await page.getByTestId('aion-trigger-task').fill(TASK_TEXT);
    await page.getByTestId('aion-trigger-submit').click();
    await expect(page.getByTestId('aion-trigger-form')).toHaveCount(0, {
      timeout: 60_000,
    });

    const created = await servedSchedules(projectId);
    expect(created).toHaveLength(1);
    scheduleId = created[0].schedule_id;
    expect(created[0].cron).toBe(CRON);
    expect(created[0].last_fired_tick).toBeUndefined();
    summary.schedule_id = scheduleId;

    const row = page.locator(
      `[data-testid="aion-trigger-row"][data-schedule-id="${scheduleId}"]`
    );
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId('aion-trigger-health')).toHaveAttribute(
      'data-health',
      'never_fired'
    );
    await row.getByTestId('aion-trigger-expand').click();
    await screenshot(page, '01-created');

    // ---- Then wait. Nothing below submits anything. ----
    const deadline = Date.now() + FIRES_TIMEOUT_MS;
    let ledger: EdgeScheduleEvent[] = [];
    for (;;) {
      ledger = await servedLedger(scheduleId);
      const dead = ledger.find((e) => e.action === 'dead_lettered');
      if (dead) {
        throw new Error(
          `trigger dead-lettered: ${String(dead.payload?.error ?? '')}`
        );
      }
      const fires = ledger.filter((e) => e.action === 'fired');
      if (fires.length >= FIRES_WANTED) break;
      if (Date.now() > deadline) {
        throw new Error(
          `only ${fires.length} of ${FIRES_WANTED} firings within ` +
            `${FIRES_TIMEOUT_MS}ms; ledger: ${ledger.map((e) => e.action).join(', ')}`
        );
      }
      // The screen has no poll: a re-read is what fetches the plane's own
      // clock, and it is what the recording shows the ledger growing from.
      await page.getByTestId('aion-triggers-refresh').click();
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }

    await page.getByTestId('aion-triggers-refresh').click();
    await expect(row.getByTestId('aion-trigger-health')).toHaveAttribute(
      'data-health',
      'firing',
      { timeout: 30_000 }
    );
    // At least, not exactly: the trigger is still active while this runs, and
    // another tick landing here would be the plane working, not a failure. The
    // exact screen-versus-edge equality is asserted below, after the pause has
    // frozen the ledger.
    expect(
      await row
        .locator('[data-testid="aion-trigger-ledger-entry"][data-action="fired"]')
        .count()
    ).toBeGreaterThanOrEqual(FIRES_WANTED);
    await screenshot(page, '02-fired-twice');

    // ---- Pause first, so everything asserted below is about a fixed set. ----
    const beforePause = (await servedSchedules(projectId))[0];
    const nextFireAt = Date.parse(beforePause.next_fire_at!);
    // The pause must not race a tick that is already due, or a legitimate
    // firing would read as a broken pause.
    expect(nextFireAt - Date.now()).toBeGreaterThan(PAUSE_MARGIN_MS);

    await row.getByTestId('aion-trigger-pause').click();
    await expect(row).toHaveAttribute('data-status', 'paused', {
      timeout: 30_000,
    });
    await expect(row.getByTestId('aion-trigger-health')).toHaveAttribute(
      'data-health',
      'paused'
    );
    expect((await servedSchedules(projectId))[0].status).toBe('paused');
    await screenshot(page, '03-paused');

    ledger = await servedLedger(scheduleId);
    const fires = ledger.filter((e) => e.action === 'fired');
    const ticks = fires.map((e) => String(e.payload?.tick ?? ''));
    const runIds = fires.map((e) => String(e.payload?.run_id ?? ''));
    const commandIds = fires.map((e) => String(e.payload?.command_id ?? ''));
    summary.fires = fires.map((e, index) => ({
      tick: ticks[index],
      run_id: runIds[index],
      command_id: commandIds[index],
    }));
    summary.ledger_actions = ledger.map((e) => e.action);

    expect(fires.length).toBeGreaterThanOrEqual(FIRES_WANTED);
    // Nothing about a later tick is borrowed from an earlier one.
    expect(new Set(ticks).size).toBe(fires.length);
    expect(new Set(runIds).size).toBe(fires.length);
    expect(new Set(commandIds).size).toBe(fires.length);
    for (const fire of fires) {
      expect(fire.payload?.run_id).toBeTruthy();
      // `trg-<schedule>-<tick>` is what makes a REDELIVERED tick collapse onto
      // the run it already produced. A distinct tick must never collapse, so a
      // replay flag here would mean two ticks sharing one run.
      expect(fire.payload?.reused).toBeUndefined();
    }

    // ---- The property, from the Project's own record. ----
    const events = await collectTrajectory(projectId, fires.length);
    const accepted = events
      .filter((event) => event.kind === 'run_accepted' && event.run_id)
      .map((event) => event.run_id as string);
    // As many accepted runs as fired ticks, in the same order, and the same
    // ones: a duplicate delivery breaks this in one direction, a tick
    // collapsed onto an earlier run breaks it in the other.
    expect(accepted).toEqual(runIds);
    summary.accepted_run_ids = accepted;

    // Every run did its own work. A tick that had been deduped onto an earlier
    // run would leave a fire with no output and no terminal of its own.
    const slices = runIds.map((runId) => runSlice(events, runId));
    summary.runs = slices.map((slice, index) => ({
      run_id: runIds[index],
      terminal: slice.terminal,
      text: slice.text,
      answered: slice.text.includes(ANSWER),
    }));
    for (const slice of slices) {
      expect(slice.terminal).toBe('run_completed');
      // Settlement green is not result green — assert the model actually said
      // something, and said the thing it was asked for.
      expect(slice.text.trim().length).toBeGreaterThan(0);
      expect(slice.text).toContain(ANSWER);
    }

    // ---- The negative control: past the due instant, nothing happened. ----
    const lastFireId = BigInt(fires[fires.length - 1].event_id);
    await sleepUntil(nextFireAt + QUIET_PAST_NEXT_FIRE_MS);
    const quiet = await servedLedger(scheduleId);
    const sinceLastFire = quiet.filter((e) => BigInt(e.event_id) > lastFireId);
    // Past the instant the trigger was due, the only thing that happened is
    // the user's own pause. Not a skip, not a forfeited tick — nothing.
    expect(sinceLastFire.map((e) => e.action)).toEqual(['paused']);
    expect(quiet.filter((e) => e.action === 'fired')).toHaveLength(fires.length);
    summary.actions_after_pause = sinceLastFire.map((e) => e.action);

    await page.getByTestId('aion-triggers-refresh').click();
    await expect(row.getByTestId('aion-trigger-health')).toHaveAttribute(
      'data-health',
      'paused',
      { timeout: 30_000 }
    );
    // Nothing can move the ledger now, so the screen and the edge are held to
    // the same number rather than to a floor.
    await expect(
      row.locator('[data-testid="aion-trigger-ledger-entry"][data-action="fired"]')
    ).toHaveCount(fires.length);
    await screenshot(page, '04-quiet');

    const offEdge = requestUrls.filter((url) => {
      if (!/^https?:/.test(url)) return false;
      return !url.startsWith(edgeBaseUrl);
    });
    summary.off_edge_requests = offEdge;
    summary.request_count = requestUrls.length;
    expect(offEdge).toEqual([]);
    expect(
      requestUrls.filter((url) => /^https?:/.test(url)).length,
      'an empty off-edge set is vacuous unless the renderer made requests'
    ).toBeGreaterThan(0);

    await row.getByTestId('aion-trigger-delete').click();
    await expect(row).toHaveCount(0, { timeout: 30_000 });
    expect(await servedSchedules(projectId)).toHaveLength(0);
  } catch (error) {
    bodyFailed = true;
    throw error;
  } finally {
    // The recording only flushes on close, so the video is resolved after
    // teardown and before the summary that reports it.
    await app.close();
    // Whatever happened above, the trigger does not outlive the eval.
    await sweepProbes();
    let videoBytes = 0;
    let videoName: string | null = null;
    const recorded = await video?.path().catch(() => undefined);
    if (recorded && fs.existsSync(recorded)) {
      videoName = 'schedules-run.webm';
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
