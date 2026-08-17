// Triggers desktop E2E: the REAL desktop app in remote-backend mode against
// the eigent-local Compose edge, driving the Home Triggers section through a
// whole cadence — create, fire, pause, stay quiet.
//
// The property under test is the one a cron plane has to get right and cannot
// be checked from a screen: ONE due tick admits exactly ONE run, and a paused
// trigger admits none. So the run count is read back from the Project's own
// event trajectory and from the trigger's audit ledger — both the edge's
// records — while the screen is only asked to agree with them.
//
// The negative control is the second half and the reason the suite runs for
// minutes rather than seconds: after the pause the test deliberately sits
// through two would-be firing instants and asserts the ledger gained nothing
// but the user's own `paused` entry. A pause that merely hid the row, or that
// stopped the list from polling, fails there.
//
// One deviation from the milestone's original text, stated rather than worked
// around: the plan expected this suite to use the store's per-second cron so a
// firing lands inside a test's lifetime. The edge REFUSES a six-field cron by
// policy (an every-second trigger hammers admission), which this suite asserts
// as its own step, so the cadence here is a one-minute cron and the waits are
// sized for it — the worker's scheduler interval is 5s, so a due tick fires
// within a few seconds of the minute boundary.
//
// Preconditions match aion-lab.e2e.ts (skipped cleanly when absent): the
// Compose stack up in the sibling aion-v1 checkout, and `npx vite build` here.
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

// Seeded over the edge API, so the alias has to be one the stack's catalog
// serves — an unknown alias is refused with 422 model_alias_denied. The
// fixture stack seeds aion-default; a deployed cell's catalog is operator-owned
// and names whatever that operator provisioned, so the same walk reaches a real
// edge only if the alias is a parameter.
const MODEL_ALIAS = process.env.EIGENT_E2E_MODEL ?? 'aion-default';
// The product cadence, five fields. The fastest one the edge will accept.
const CRON = '* * * * *';
// Every trigger this suite creates carries the marker, so a run that died
// half-way can be swept without touching anything a human left behind. A
// leaked minute-cadence trigger would keep submitting commands forever.
const TASK_MARKER = 'aion-e2e-trigger-probe';
// A due tick is claimed within one scheduler interval (5s), so the worst case
// is a boundary that had just passed when the trigger was created.
const FIRE_TIMEOUT_MS = 120_000;
// Measured from the next fire the edge had scheduled when the pause landed:
// far enough past it to cover that instant AND the one a minute after it.
const QUIET_PAST_NEXT_FIRE_MS = 75_000;
// The pause must not race a tick that is already due, or a legitimate firing
// would read as a broken pause. Asserted rather than assumed.
const PAUSE_MARGIN_MS = 10_000;
// `?after=0` replays the Project's whole history before going live; the stream
// itself never ends, so the read is bounded by this window.
const TRAJECTORY_WINDOW_MS = 15_000;
// Everything the worker writes when it looks at a due trigger. After a pause,
// none of these may appear.
const FIRING_ACTIONS = [
  'fired',
  'skipped_busy',
  'skipped_generation',
  'fire_failed',
  'dead_lettered',
];

interface Bootstrap {
  api_key: string;
  edge_url: string;
  tenant_id: string;
}

interface EdgeSchedule {
  schedule_id: string;
  project_id: string;
  cron: string;
  task: string;
  single_shot: boolean;
  status: string;
  attempts: number;
  next_fire_at?: string;
  last_fired_tick?: string;
  last_error?: string;
}

interface EdgeScheduleEvent {
  event_id: string;
  schedule_id: string;
  action: string;
  occurred_at: string;
  payload?: Record<string, unknown>;
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
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-schedules-'));
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
  if (edgeReady) {
    await sweepProbes();
  }
  if (PACKAGED_SOURCE) {
    packaged = installPackagedApp(PACKAGED_SOURCE);
  }
});

test.afterAll(async () => {
  // On the way out as well as on the way in: a failure between create and
  // delete otherwise leaves a trigger firing once a minute for good.
  if (edgeReady) {
    await sweepProbes();
  }
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

// Route + reload so React mounts directly on the target section (the same
// deterministic-mount trick the Lab, Skills and Projects suites use).
async function openSection(page: Page, query: string): Promise<void> {
  await page.evaluate((params) => {
    window.location.hash = `#/history?${params}`;
  }, query);
  await page.reload();
}

const byId = (page: Page, id: string) => page.getByTestId(id);

async function screenshot(page: Page, name: string): Promise<void> {
  if (!EVIDENCE_DIR) return;
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `eigent-schedules-${name}.png`),
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

// Everything HTTP the renderer touched must stay on the edge origin.
function auditEdgeOnly(urls: string[], origin: string): string[] {
  return urls
    .filter((u) => /^https?:/.test(u))
    .filter((u) => !u.startsWith(origin));
}

async function edgeFetch(
  method: string,
  pathname: string,
  body?: unknown
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${bootstrap!.api_key}`,
  };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    // Every create carries its own key, so a retried POST cannot double-seed —
    // and on this plane a duplicate is not one spare row, it is a second
    // trigger firing beside the first forever.
    headers['Idempotency-Key'] = `sch-e2e-${Math.random().toString(36).slice(2)}`;
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
      `createProject(${title}): ${response.status} ${await response.text()}`
    );
  }
  return ((await response.json()) as { project_id: string }).project_id;
}

/** The triggers the edge serves, optionally narrowed to one Project. */
async function servedSchedules(projectId?: string): Promise<EdgeSchedule[]> {
  const query = projectId
    ? `?project_id=${encodeURIComponent(projectId)}`
    : '';
  const response = await edgeFetch('GET', `/schedules${query}`);
  if (!response.ok) {
    throw new Error(
      `listSchedules: ${response.status} ${await response.text()}`
    );
  }
  return ((await response.json()) as { schedules: EdgeSchedule[] }).schedules;
}

/** One trigger's audit ledger, oldest-first within the newest window. */
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

async function deleteSchedule(scheduleId: string): Promise<void> {
  const response = await edgeFetch(
    'DELETE',
    `/schedules/${encodeURIComponent(scheduleId)}`
  );
  if (response.status !== 204) {
    throw new Error(
      `deleteSchedule: ${response.status} ${await response.text()}`
    );
  }
}

/** Removes this suite's own leftovers, whenever it last stopped. */
async function sweepProbes(): Promise<number> {
  let removed = 0;
  for (const row of await servedSchedules()) {
    if (!row.task.startsWith(TASK_MARKER)) continue;
    await deleteSchedule(row.schedule_id);
    removed += 1;
  }
  return removed;
}

/**
 * The run ids the Project's own trajectory reports as accepted. This is the
 * count that decides the test: the ledger says what the trigger believes it
 * did, and this says what the Project actually admitted.
 */
async function acceptedRunIds(projectId: string): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRAJECTORY_WINDOW_MS);
  const runIds: string[] = [];
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
        const event = JSON.parse(data) as { kind: string; run_id?: string };
        if (event.kind === 'run_accepted' && event.run_id) {
          runIds.push(event.run_id);
        }
      }
    }
  } catch (error) {
    if (!(error instanceof Error && error.name === 'AbortError')) throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return runIds;
}

/**
 * Waits for the trigger's first firing. A ledger entry that says the fire went
 * wrong ends the wait immediately, carrying the store's own reason — waiting
 * out the full timeout on a dead-lettered trigger would report "no firing"
 * when the answer was there in two seconds.
 */
async function awaitFirstFire(
  scheduleId: string
): Promise<EdgeScheduleEvent[]> {
  const deadline = Date.now() + FIRE_TIMEOUT_MS;
  for (;;) {
    const events = await servedLedger(scheduleId);
    const failure = events.find(
      (e) => e.action === 'fire_failed' || e.action === 'dead_lettered'
    );
    if (failure) {
      throw new Error(
        `trigger ${failure.action}: ${String(failure.payload?.error ?? '')}`
      );
    }
    if (events.some((e) => e.action === 'fired')) return events;
    if (Date.now() > deadline) {
      throw new Error(
        `no firing within ${FIRE_TIMEOUT_MS}ms; ledger: ${events
          .map((e) => e.action)
          .join(', ')}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

async function sleepUntil(epochMs: number): Promise<void> {
  const remaining = epochMs - Date.now();
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

test('one due tick admits one run, and a paused trigger admits none', async () => {
  test.skip(
    !bootstrap || !edgeReady || !APP_BUILT,
    'eigent-local stack not running or app not built'
  );
  test.setTimeout(420_000);
  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
    cron: CRON,
  };

  const projectId = await createProject(
    `Trigger probe ${new Date().toISOString()}`
  );
  summary.project_id = projectId;
  const taskText = `${TASK_MARKER}: reply with the single word ready.`;

  // The policy this suite's cadence is a consequence of: the store parses a
  // six-field per-second cron, and the edge will not accept one. It is a
  // refusal, not a syntax error, so it carries its own code and is not
  // retryable — and it leaves nothing behind.
  const denied = await edgeFetch('POST', '/schedules', {
    project_id: projectId,
    cron: '*/5 * * * * *',
    task: `${TASK_MARKER}: refused`,
    single_shot: false,
  });
  expect(denied.status).toBe(422);
  const problem = (await denied.json()) as {
    code?: string;
    retryable?: boolean;
  };
  expect(problem.code).toBe('schedule_cron_denied');
  expect(problem.retryable).toBe(false);
  expect(await servedSchedules(projectId)).toHaveLength(0);
  summary.seconds_cron_refusal = problem.code;

  const { app, page } = await launchApp();
  const networkUrls: string[] = [];
  page.on('request', (request) => networkUrls.push(request.url()));

  // This spec's long quiet window means the renderer receives no inputs for
  // minutes; if a control then goes missing, the only distinction that
  // matters is renderer-death versus product state — record which.
  const rendererIncidents: string[] = [];
  page.on('crash', () =>
    rendererIncidents.push(`${new Date().toISOString()} crash`)
  );
  page.on('pageerror', (err) =>
    rendererIncidents.push(`${new Date().toISOString()} pageerror: ${err.message}`)
  );
  page.on('close', () =>
    rendererIncidents.push(`${new Date().toISOString()} close`)
  );

  try {
    await openSection(page, 'tab=home&section=triggers');
    await expect(byId(page, 'aion-triggers')).toBeVisible({ timeout: 60_000 });

    await byId(page, 'aion-triggers-new').click();
    await expect(byId(page, 'aion-trigger-form')).toBeVisible();
    await byId(page, 'aion-trigger-project').selectOption(projectId);
    await byId(page, 'aion-trigger-task').fill(taskText);

    // The screen refuses the shapes the edge refuses, in the field, before a
    // request exists.
    await byId(page, 'aion-trigger-cron').fill('@daily');
    await byId(page, 'aion-trigger-cron').blur();
    await expect(byId(page, 'aion-trigger-cron-error')).toBeVisible();
    await expect(byId(page, 'aion-trigger-submit')).toBeDisabled();
    // And a keyboard user cannot walk around the disabled button: Enter in the
    // field submits nothing, so no request exists to be refused later.
    await byId(page, 'aion-trigger-cron').press('Enter');
    expect(await servedSchedules(projectId)).toHaveLength(0);
    await screenshot(page, 'cron-refused');

    await byId(page, 'aion-trigger-cron').fill(CRON);
    await expect(byId(page, 'aion-trigger-cron-error')).toHaveCount(0);
    await byId(page, 'aion-trigger-submit').click();
    // The form closes only on a create the edge accepted.
    await expect(byId(page, 'aion-trigger-form')).toHaveCount(0, {
      timeout: 30_000,
    });

    const created = await servedSchedules(projectId);
    expect(created).toHaveLength(1);
    const scheduleId = created[0].schedule_id;
    expect(created[0].cron).toBe(CRON);
    expect(created[0].task).toBe(taskText);
    expect(created[0].status).toBe('active');
    expect(created[0].next_fire_at).toBeTruthy();
    // Never fired yet, and the row says so by omission rather than by a zero.
    expect(created[0].last_fired_tick).toBeUndefined();
    summary.schedule_id = scheduleId;

    const row = page.locator(
      `[data-testid="aion-trigger-row"][data-schedule-id="${scheduleId}"]`
    );
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute('data-status', 'active');
    await expect(row.getByTestId('aion-trigger-health')).toHaveAttribute(
      'data-health',
      'never_fired'
    );
    await screenshot(page, 'created');

    const firedLedger = await awaitFirstFire(scheduleId);
    const fires = firedLedger.filter((e) => e.action === 'fired');
    expect(fires).toHaveLength(1);
    const fire = fires[0];
    const runId = fire.payload?.run_id;
    const tick = fire.payload?.tick;
    expect(typeof runId).toBe('string');
    expect(typeof tick).toBe('string');
    // A fresh admission, not the idempotency key replaying an earlier one: the
    // `trg-<schedule>-<tick>` key is what makes a redelivered tick collapse
    // onto the run it already produced, and it must not have collapsed here.
    expect(fire.payload?.reused).toBeUndefined();
    summary.first_fire = { tick, run_id: runId };

    // The property, read from the Project's own record rather than from the
    // trigger's: one tick, one accepted run.
    expect(await acceptedRunIds(projectId)).toEqual([runId]);

    const afterFire = (await servedSchedules(projectId))[0];
    expect(afterFire.last_fired_tick).toBe(tick);
    expect(afterFire.status).toBe('active');
    expect(afterFire.attempts).toBe(0);
    const nextFireAt = Date.parse(afterFire.next_fire_at!);
    // Everything below rests on the pause landing well before the next tick is
    // due; a pause racing a due tick would make a legitimate firing look like a
    // broken pause, so the margin is asserted, not assumed.
    expect(nextFireAt - Date.now()).toBeGreaterThan(PAUSE_MARGIN_MS);
    summary.next_fire_at = afterFire.next_fire_at;

    // The screen has no poll — a trigger's state changes on the plane's clock,
    // and the user's re-read is what fetches it. That is the read under test.
    await byId(page, 'aion-triggers-refresh').click();
    await expect(row.getByTestId('aion-trigger-health')).toHaveAttribute(
      'data-health',
      'firing',
      { timeout: 30_000 }
    );
    await row.getByTestId('aion-trigger-expand').click();
    await expect(row.getByTestId('aion-trigger-ledger')).toBeVisible();
    await expect(
      row.locator('[data-testid="aion-trigger-ledger-entry"][data-action="fired"]')
    ).toHaveCount(1);
    await screenshot(page, 'fired');

    await row.getByTestId('aion-trigger-pause').click();
    await expect(row).toHaveAttribute('data-status', 'paused', {
      timeout: 30_000,
    });
    await expect(row.getByTestId('aion-trigger-health')).toHaveAttribute(
      'data-health',
      'paused'
    );
    // Resume is offered in its place: the two are exclusive, so a user cannot
    // be looking at a pause button on a trigger that is already stopped.
    await expect(row.getByTestId('aion-trigger-resume')).toHaveCount(1);
    await expect(row.getByTestId('aion-trigger-pause')).toHaveCount(0);
    expect((await servedSchedules(projectId))[0].status).toBe('paused');
    await screenshot(page, 'paused');

    // The negative control. Sit past the tick that was due and the one after
    // it, then ask what happened.
    await sleepUntil(nextFireAt + QUIET_PAST_NEXT_FIRE_MS);
    const quietLedger = await servedLedger(scheduleId);
    const sinceFire = quietLedger.filter(
      (e) => BigInt(e.event_id) > BigInt(fire.event_id)
    );
    // Across two would-be firing instants the only thing that happened is the
    // user's own pause. Not a skip, not a forfeited tick — nothing.
    expect(sinceFire.map((e) => e.action)).toEqual(['paused']);
    expect(
      quietLedger.filter((e) => FIRING_ACTIONS.includes(e.action))
    ).toHaveLength(1);
    // And the Project admitted no second run, which is the half a ledger
    // written by the same component could not prove on its own.
    expect(await acceptedRunIds(projectId)).toEqual([runId]);
    summary.actions_after_pause = sinceFire.map((e) => e.action);

    await byId(page, 'aion-triggers-refresh').click();
    await expect(row.getByTestId('aion-trigger-health')).toHaveAttribute(
      'data-health',
      'paused',
      { timeout: 30_000 }
    );
    await screenshot(page, 'quiet');

    const offEdge = auditEdgeOnly(networkUrls, new URL(edgeBaseUrl!).origin);
    expect(offEdge).toEqual([]);
    // An empty off-edge set is vacuous unless the renderer made requests.
    expect(
      networkUrls.filter((u) => /^https?:/.test(u)).length
    ).toBeGreaterThan(0);
    summary.off_edge_requests = offEdge;

    await row.getByTestId('aion-trigger-delete').click();
    await expect(row).toHaveCount(0, { timeout: 30_000 });
    expect(await servedSchedules(projectId)).toHaveLength(0);
    summary.completed = true;
  } finally {
    // Written on failure too: a rerun wipes Playwright's own artifacts, so
    // the partial summary is the only durable record of where a run died.
    summary.renderer_incidents = rendererIncidents;
    writeEvidence('eigent-schedules-summary.json', summary);
    await app.close();
  }
});
