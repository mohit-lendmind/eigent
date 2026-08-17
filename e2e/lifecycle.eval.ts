// Real-model driver for live run visibility: one live provider run whose
// admission window must carry the announced dispatch stages (run_progress
// rendered as `data-run-stage` on the pre-content indicator — the window that
// used to be dead air while the sandbox provisioned), and whose long-running
// shell command must stream its stdout into the work-log row
// (`tool-live-output`) BEFORE the tool settles — driven through the REAL
// product chat UI against the live eigent-local stack, and recorded.
//
// The claim under test spans both records: the edge's trajectory shows
// run_progress journaled in lifecycle order and the tool's stdout journaled
// as user-visible tool_output chunks that precede the tool's own result, and
// the DOM shows the stage label filling the blank window then the live tail
// under the running row. The command prints ~25 KiB (past the 8 KiB durable
// chunk threshold, so chunks journal mid-run) and then sleeps, holding the
// tool open while the tail is on screen.
//
// The negative control is a second pass in the same session, same model, with
// tools forbidden: its trajectory must still carry run_progress — the stages
// announce ANY run's admission — but zero tool_output events, and no live
// output block may ever render. Without it, a surface that invented a tail
// for every row would pass the first pass and be wrong.
//
// Run: npx playwright test --config e2e/eval.config.ts lifecycle
// Env: EIGENT_EVAL_MODEL / EIGENT_EVAL_MODEL_LABEL pick the catalog row (a REAL
//      provider row — the deterministic fixtures are what layer 2 covers).
// Output: EIGENT_EVAL_DIR (default ../l3-evidence/playwright/real-model).

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
  path.resolve(REPO_ROOT, '..', 'l3-evidence', 'playwright', 'real-model');

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
const RUN_TAG = `l3-${Date.now().toString(36)}`;

// One shell command that prints past the durable chunk threshold and then
// stays alive: the printing makes mid-run tool_output records exist, the
// sleep holds the window open long enough for the tail to be on screen and
// on video. It is a single line on purpose — the composer drops single line
// breaks outright, so a wrapped command would reach the model mangled.
const LIVE_COMMAND = `i=0; while [ "$i" -lt 600 ]; do i=$((i+1)); printf 'live-line %04d: streaming eval output\\n' "$i"; done; sleep 15`;
const LIVE_PROMPT = [
  `[${RUN_TAG}] Use the shell exactly once, running exactly this command, verbatim and unmodified:`,
  LIVE_COMMAND,
  'Do not run anything else and do not retry. When the command has returned, finish your reply with exactly one line:',
  'ANSWER: STREAMED',
].join('\n\n');
const LIVE_ANSWER = 'STREAMED';

const CONTROL_PROMPT = [
  `[${RUN_TAG}] Do not use any tools. Reply with exactly one line:`,
  'ANSWER: CONTROL_OK',
].join('\n\n');
const CONTROL_ANSWER = 'CONTROL_OK';

const KNOWN_STAGES = ['dispatching', 'workspace_ready', 'starting'];

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
  run_progress_stages?: string[];
  stages_seen_in_dom?: string[];
  tool_output_count?: number;
  tool_output_bytes?: number;
  live_text_lines?: number;
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

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

test('dispatch stages and live tool output reach the surface on a real run', async () => {
  test.setTimeout(45 * 60_000);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-l3-'));
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

  const livePass: PassRecord = { name: 'live', prompt: LIVE_PROMPT };
  const controlPass: PassRecord = { name: 'control', prompt: CONTROL_PROMPT };
  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
    model_alias: MODEL_ALIAS,
    run_tag: RUN_TAG,
    passes: [livePass, controlPass],
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

    // ---- Pass 1: the live run. --------------------------------------------
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
    await typeIntoComposer(page, composerA, LIVE_PROMPT);
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

    // One sampling loop covers both live claims, because they share a clock:
    // the dispatch stages own the window before the first activity renders,
    // and the live tail owns the window between the first journaled chunk and
    // the tool's own result. The loop keeps the work log open (the surface
    // the rows render in), records every data-run-stage value it sees, and
    // stops the moment the live output block carries text.
    const stagesSeen: string[] = [];
    let liveText = '';
    let stageShot = false;
    let workLogOpened = false;
    const busy = page.locator('[role="textbox"][contenteditable="false"]');
    let sawBusy = false;
    const liveDeadline = Date.now() + 10 * 60_000;
    while (Date.now() < liveDeadline) {
      for (const stage of await page
        .locator('[data-run-stage]')
        .evaluateAll((nodes) =>
          nodes.map((n) => n.getAttribute('data-run-stage') ?? '')
        )) {
        if (stage && !stagesSeen.includes(stage)) stagesSeen.push(stage);
      }
      if (!stageShot && stagesSeen.length > 0) {
        stageShot = true;
        await screenshot(page, '01-dispatch-stage');
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
    livePass.stages_seen_in_dom = stagesSeen;
    livePass.live_text_lines = liveText ? liveText.split('\n').length : 0;
    await screenshot(page, '02-live-output');

    // The blank window carried at least one announced stage on screen, and
    // the live tail showed the command's own lines while it was still
    // running — the two windows that used to render as dead air.
    expect(
      stagesSeen.length,
      'no dispatch stage ever rendered in the admission window'
    ).toBeGreaterThan(0);
    expect(
      stagesSeen.some((s) => KNOWN_STAGES.includes(s)),
      `only unknown stages rendered: ${stagesSeen.join(', ')}`
    ).toBe(true);
    expect(
      liveText,
      'the running row never showed the streamed output'
    ).toContain('live-line');

    await awaitTurnSettled(page);
    // Settlement replaces the tail with the result: no live block survives.
    await expect(page.getByTestId('tool-live-output')).toHaveCount(0);
    await page.waitForTimeout(1_000);
    await screenshot(page, '03-live-settled');

    livePass.answered = normalize(
      await page.locator('body').innerText()
    ).includes(LIVE_ANSWER);
    expect(livePass.answered, `the run never reported ${LIVE_ANSWER}`).toBe(
      true
    );

    const projectA = projectIds()[0];
    expect(projectA, 'no command was submitted for the live pass').toBeTruthy();
    livePass.project_id = projectA;
    const trajectoryA = await collectTrajectory(projectA);
    livePass.terminal = trajectoryA.terminal;
    livePass.event_kinds = countKinds(trajectoryA.events);
    expect(trajectoryA.terminal, 'the live run did not complete').toBe(
      'run_completed'
    );

    // The durable record, first claim: the admission stages were journaled in
    // their lifecycle order — dispatched before the workspace is ready, ready
    // before the agent starts.
    const stages = trajectoryA.events
      .filter((e) => e.kind === 'run_progress')
      .map((e) => String(e.data?.stage ?? ''));
    livePass.run_progress_stages = stages;
    for (const stage of KNOWN_STAGES) {
      expect(stages, `stage ${stage} was never announced`).toContain(stage);
    }
    expect(stages.indexOf('dispatching')).toBeLessThan(
      stages.indexOf('workspace_ready')
    );
    expect(stages.indexOf('workspace_ready')).toBeLessThan(
      stages.indexOf('starting')
    );

    // Second claim: the command's stdout was journaled as user-visible
    // tool_output chunks correlated to recorded shell calls, and at least one
    // chunk landed BEFORE its call's own result — the mid-run journaling that
    // makes a live tail possible at all.
    const callIds = new Set(
      trajectoryA.events
        .filter((e) => e.kind === 'tool_call' && e.data?.tool_name === 'bash')
        .map((e) => String(e.data?.tool_call_id ?? ''))
    );
    expect(callIds.size, 'no shell call was recorded').toBeGreaterThan(0);
    const outputs = trajectoryA.events
      .map((e, index) => ({ e, index }))
      .filter(({ e }) => e.kind === 'tool_output');
    livePass.tool_output_count = outputs.length;
    expect(
      outputs.length,
      'no tool_output chunk reached the user-visible record'
    ).toBeGreaterThanOrEqual(1);
    for (const { e } of outputs) {
      expect(callIds.has(String(e.data?.tool_call_id ?? ''))).toBe(true);
    }
    const firstOutput = outputs[0];
    const itsResultIndex = trajectoryA.events.findIndex(
      (e) =>
        e.kind === 'tool_result' &&
        e.data?.tool_call_id === firstOutput.e.data?.tool_call_id
    );
    expect(itsResultIndex, 'the streamed call never settled').toBeGreaterThan(
      0
    );
    expect(
      firstOutput.index,
      'every chunk arrived only at settlement'
    ).toBeLessThan(itsResultIndex);
    const streamed = outputs
      .map(({ e }) => String(e.data?.content ?? ''))
      .join('');
    livePass.tool_output_bytes = Buffer.byteLength(streamed);
    expect(streamed).toContain('live-line');
    // Past the chunk threshold — the property that made mid-run records exist.
    expect(Buffer.byteLength(streamed)).toBeGreaterThan(8_192);

    // ---- Pass 2: the negative control — no tools, no tool_output. ---------
    const composerB = await newSpace(page);
    await selectModel(page, MODEL_LABEL);
    await typeIntoComposer(page, composerB, CONTROL_PROMPT);
    await composerB.press('Enter');
    await awaitTurnSettled(page);
    await expect(page.getByTestId('tool-live-output')).toHaveCount(0);
    await page.waitForTimeout(1_000);
    await screenshot(page, '04-control-settled');

    const projectB = projectIds().find((id) => id !== projectA);
    expect(
      projectB,
      'no command was submitted for the control pass'
    ).toBeTruthy();
    controlPass.project_id = projectB;
    const trajectoryB = await collectTrajectory(projectB!);
    controlPass.terminal = trajectoryB.terminal;
    controlPass.event_kinds = countKinds(trajectoryB.events);
    expect(trajectoryB.terminal, 'the control run did not complete').toBe(
      'run_completed'
    );

    // The stages announce every run's admission; the chunks only a tool's.
    const controlStages = trajectoryB.events
      .filter((e) => e.kind === 'run_progress')
      .map((e) => String(e.data?.stage ?? ''));
    controlPass.run_progress_stages = controlStages;
    expect(
      controlStages.length,
      'the control run announced no stages'
    ).toBeGreaterThan(0);
    controlPass.tool_output_count = trajectoryB.events.filter(
      (e) => e.kind === 'tool_output'
    ).length;
    expect(
      controlPass.tool_output_count,
      'a tool-less run recorded tool output'
    ).toBe(0);

    controlPass.answered = normalize(
      await page.locator('body').innerText()
    ).includes(CONTROL_ANSWER);
    expect(
      controlPass.answered,
      `the run never reported ${CONTROL_ANSWER}`
    ).toBe(true);

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
      videoName = 'lifecycle-run.webm';
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
