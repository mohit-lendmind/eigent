// Real-model driver for plan visibility: one live provider run plans its own
// work through the engine's todo subsystem, and the product shows that plan —
// a tree in the session side panel whose steps turn green as the run works,
// with the report step's evidence pointing at the artifact that proves it.
//
// The claim that needs a real model rather than a fixture is authorship: the
// fixture proves the pipes carry a plan, this proves a model actually drives
// them — it structures a parent with subtasks, walks statuses forward, and
// closes with evidence, through real inference and the real cell.
//
// The trajectory owns the strict claims (the DOM only proves membership):
// todo_created with at least one parent having children, and a monotonic
// status progression — a terminal todo never reopens. The negative control is
// a single-turn question: zero todo events, and NO Plan section — an empty
// plan box would read as "the agent never plans".
//
// Run: npx playwright test --config e2e/eval.config.ts plan
//      (the stack must be booted with REAL provider keys.)
// Env: EIGENT_EVAL_MODEL / EIGENT_EVAL_MODEL_LABEL pick the catalog row.
// Output: EIGENT_EVAL_DIR (default ../a3-evidence/playwright/real-model).

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
  path.resolve(REPO_ROOT, '..', 'a3-evidence', 'playwright', 'real-model');

const MODEL_ALIAS = process.env.EIGENT_EVAL_MODEL ?? 'kimi-k3';
const MODEL_LABEL = process.env.EIGENT_EVAL_MODEL_LABEL ?? 'Kimi K3';

const TURN_TIMEOUT_MS = 15 * 60_000;
const TRAJECTORY_TIMEOUT_MS = 60_000;
const VIDEO_SIZE = { width: 1280, height: 800 };
const MIN_VIDEO_BYTES = 200 * 1024;

const REPORT = 'report.md';

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
const RUN_TAG = `a3-${Date.now().toString(36)}`;

const PLAN_PROMPT = [
  `[${RUN_TAG}] Research task, from your own knowledge only (no web access): compare the three Galilean moons Io, Europa and Ganymede by diameter and one distinctive surface feature each, then write /workspace/${REPORT} containing a markdown table with those columns.`,
  'Track the work with the todo tool, exactly like this:',
  `1. First call todo with action "plan": ONE parent item titled "Research and report" with execution "sequential" and exactly two subtasks — "Collect the facts" and "Write ${REPORT}".`,
  '2. Before starting each subtask, call todo with action "update" moving it to "in_progress".',
  '3. When a subtask is finished, call todo with action "update" moving it to "done".',
  `4. Close the report subtask with evidence: pass evidence [{"kind":"file","ref":"workspace:${REPORT}"}] on that final update.`,
  'Never update the parent item directly; its status is derived.',
  'Then finish your reply with exactly one line:',
  'ANSWER: PLAN_DONE',
].join('\n\n');
const PLAN_ANSWER = 'PLAN_DONE';

const CONTROL_PROMPT = `[${RUN_TAG}] Reply with exactly one line and use no tools: ANSWER: NO_PLAN`;
const CONTROL_ANSWER = 'NO_PLAN';

interface EdgeEvent {
  kind: string;
  sequence: string;
  data?: Record<string, unknown>;
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
  // Restoring a real session on reload (SSE resubscribe + replay) can hold the
  // header back well past a click's default patience.
  const title = page.locator('#active-space-title-btn');
  await title.waitFor({ state: 'visible', timeout: 120_000 });
  await title.click();
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

const TERMINAL_TODO = new Set(['done', 'cancelled']);
const TODO_KINDS = new Set(['todo_created', 'todo_updated', 'todo_closed']);

interface TodoTransition {
  todoId: string;
  from: string;
  to: string;
  kind: string;
}

/**
 * Replays every todo event in stream order and returns the transitions plus
 * any reversal — a terminal todo moving back to a non-terminal status. The
 * store's forward-only ledger makes that impossible on a correct pipeline, so
 * one reversal here means the projection reordered or corrupted the plan.
 */
function todoProgression(events: EdgeEvent[]): {
  created: { todoId: string; parentId: string }[];
  transitions: TodoTransition[];
  reversals: TodoTransition[];
} {
  const created: { todoId: string; parentId: string }[] = [];
  const transitions: TodoTransition[] = [];
  const reversals: TodoTransition[] = [];
  const last: Record<string, string> = {};
  for (const event of events) {
    if (!TODO_KINDS.has(event.kind)) continue;
    const d = event.data ?? {};
    const todoId = String(d.todo_id ?? '');
    const status = String(d.status ?? '');
    if (event.kind === 'todo_created') {
      created.push({ todoId, parentId: String(d.parent_id ?? '') });
      last[todoId] = status;
      continue;
    }
    const t: TodoTransition = {
      todoId,
      from: last[todoId] ?? '',
      to: status,
      kind: event.kind,
    };
    transitions.push(t);
    if (TERMINAL_TODO.has(t.from) && !TERMINAL_TODO.has(t.to)) {
      reversals.push(t);
    }
    last[todoId] = status;
  }
  return { created, transitions, reversals };
}

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The Project the turn just created, read off the wire. */
function newestCommandProject(
  requests: { url: string }[],
  seen: Set<string>
): string {
  const ids = requests
    .map((r) => /\/projects\/([^/?]+)\/commands/.exec(r.url)?.[1])
    .filter((id): id is string => Boolean(id))
    .filter((id) => !seen.has(id));
  expect(ids.length, 'no new command was submitted').toBeGreaterThan(0);
  return ids[ids.length - 1];
}

test('a real run plans its own work and the plan is visible, live and joined to its artifact', async () => {
  test.setTimeout(45 * 60_000);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-a3-'));
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
    model_alias: MODEL_ALIAS,
    run_tag: RUN_TAG,
    prompt: PLAN_PROMPT,
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

    await page
      .locator('[role="textbox"]')
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 });

    // ---- The planned run. --------------------------------------------------
    const composer = await newSpace(page);
    await selectModel(page, MODEL_LABEL);
    const created = page
      .waitForRequest(
        (request) =>
          request.method() === 'POST' &&
          request.url() === `${edgeBaseUrl}/projects`,
        { timeout: 60_000 }
      )
      .then((request) => request.postData() ?? '')
      .catch(() => '');
    await typeIntoComposer(page, composer, PLAN_PROMPT);
    await composer.press('Enter');
    const posted = JSON.parse((await created) || '{}') as {
      model_alias?: string;
    };
    expect(
      posted.model_alias,
      "the picker's choice never reached the create"
    ).toBe(MODEL_ALIAS);

    await awaitTurnSettled(page);
    await page.waitForTimeout(1_000);
    await screenshot(page, '01-run-settled');

    const answered = normalize(await page.locator('body').innerText()).includes(
      PLAN_ANSWER
    );
    summary.answered = answered;
    expect(answered, `the run never reported ${PLAN_ANSWER}`).toBe(true);

    const seenProjects = new Set<string>();
    const projectId = newestCommandProject(requests, seenProjects);
    seenProjects.add(projectId);
    summary.project_id = projectId;

    // ---- The durable trajectory owns the strict claims. --------------------
    const trajectory = await collectTrajectory(projectId);
    summary.terminal = trajectory.terminal;
    summary.event_kinds = countKinds(trajectory.events);
    expect(trajectory.terminal, 'the run did not complete').toBe(
      'run_completed'
    );

    // In-band failure scan: a run can report an answer and still have failed a
    // tool along the way.
    const errored = trajectory.events
      .filter((e) => e.kind === 'tool_result')
      .filter((e) => e.data?.is_error === true)
      .map((e) => String(e.data?.content ?? '').slice(0, 120));
    summary.errored_tools = errored;
    expect(errored, 'a tool failed inside the run').toEqual([]);

    const progression = todoProgression(trajectory.events);
    summary.todo_created = progression.created;
    summary.todo_transitions = progression.transitions;
    // The model structured the plan: at least one created todo names a parent,
    // so at least one parent has children.
    expect(
      progression.created.length,
      'the run never created a todo'
    ).toBeGreaterThanOrEqual(3);
    expect(
      progression.created.filter((c) => c.parentId !== '').length,
      'no created todo has a parent — the plan is flat'
    ).toBeGreaterThan(0);
    // Monotonic: a terminal todo never reopens.
    expect(
      progression.reversals,
      'a terminal todo moved back to a non-terminal status'
    ).toEqual([]);
    // The walk genuinely progressed: something reached done.
    expect(
      progression.transitions.filter((t) => t.to === 'done').length
    ).toBeGreaterThan(0);
    // The report step closed carrying file evidence.
    const evidenceClosures = trajectory.events
      .filter((e) => TODO_KINDS.has(e.kind))
      .map((e) => (e.data?.evidence ?? []) as { kind?: string; ref?: string }[])
      .flat()
      .filter((ref) => ref.kind === 'file' || ref.kind === 'file_store_id');
    summary.file_evidence = evidenceClosures;
    expect(
      evidenceClosures.length,
      'no todo closed with file evidence'
    ).toBeGreaterThan(0);

    // ---- The panel shows the plan (membership only — the trajectory above
    // owns ordering). ---------------------------------------------------------
    const rows = page.locator('[data-testid="plan-row"]');
    await expect(rows.first()).toBeVisible({ timeout: 60_000 });
    const shape = await rows.evaluateAll((nodes) =>
      nodes.map((n) => ({
        id: n.getAttribute('data-todo-id'),
        depth: n.getAttribute('data-todo-depth'),
        status: n.getAttribute('data-todo-status'),
      }))
    );
    summary.plan_rows = shape;
    expect(shape.length).toBeGreaterThanOrEqual(3);
    expect(shape.some((r) => r.depth === '1')).toBe(true);
    expect(shape.some((r) => r.status === 'done')).toBe(true);
    const pill = await page.locator('[data-testid="plan-count"]').innerText();
    summary.plan_count = pill;
    expect(pill).toMatch(/^\d+\/\d+$/);
    await screenshot(page, '02-plan-panel');

    // ---- Negative control: a single-turn answer plans nothing. -------------
    const controlComposer = await newSpace(page);
    await selectModel(page, MODEL_LABEL);
    await typeIntoComposer(page, controlComposer, CONTROL_PROMPT);
    await controlComposer.press('Enter');
    await awaitTurnSettled(page);
    const controlAnswered = normalize(
      await page.locator('body').innerText()
    ).includes(CONTROL_ANSWER);
    summary.control_answered = controlAnswered;
    expect(controlAnswered, 'the control never answered').toBe(true);

    const controlProject = newestCommandProject(requests, seenProjects);
    summary.control_project_id = controlProject;
    const controlTrajectory = await collectTrajectory(controlProject);
    summary.control_event_kinds = countKinds(controlTrajectory.events);
    expect(
      controlTrajectory.events.filter((e) => TODO_KINDS.has(e.kind)),
      'the control run emitted todo events'
    ).toEqual([]);
    await expect(page.locator('[data-testid="plan-count"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="plan-row"]')).toHaveCount(0);
    summary.no_plan_section_on_control = true;
    await screenshot(page, '03-control-no-plan');

    // ---- Both halves of the network audit. ----------------------------------
    const isPresignedFetch = (u: string): boolean => {
      try {
        const url = new URL(u);
        return [...url.searchParams.keys()].some((k) =>
          /^x-(amz|goog)-signature$/i.test(k)
        );
      } catch {
        return false;
      }
    };
    const offEdge = requests
      .map((r) => r.url)
      .filter((u) => /^https?:/.test(u))
      .filter((u) => !u.startsWith(new URL(edgeBaseUrl).origin))
      .filter((u) => !isPresignedFetch(u));
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
      videoName = 'plan-run.webm';
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
