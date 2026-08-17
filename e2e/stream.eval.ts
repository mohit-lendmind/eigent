// Real-model driver for streaming: one live run on a THINKING model whose
// long answer must reach the durable record as several threshold-flushed
// text_delta events — with the model's reasoning trace riding at least one of
// them — and whose chat surface must render the Thinking strip above the
// answer, driven through the REAL product chat UI against the live
// eigent-local stack, and recorded.
//
// The claim under test spans both records: the edge's trajectory shows the
// answer journaled in chunks (not one end-of-segment blob) with non-empty
// reasoning on the wire, and the DOM shows the strip that surfaces it —
// collapsed with a preview, expandable to the full trace.
//
// The negative control is a second pass in the same session on
// gemini-3-flash, a model that reports no reasoning: its deltas must carry no
// reasoning key and its chat must render no Thinking strip. Without it, a
// surface that invented a strip for every answer would pass the first pass
// and be wrong. (kimi-k3 cannot serve as the control: it emits
// reasoning_content even on trivial prompts.)
//
// Run: npx playwright test --config e2e/eval.config.ts stream
// Env: EIGENT_EVAL_MODEL / EIGENT_EVAL_MODEL_LABEL pick the thinking row
//      (default gemini-3-reasoning); EIGENT_EVAL_CONTROL_MODEL /
//      EIGENT_EVAL_CONTROL_MODEL_LABEL pick the no-thinking control row
//      (default gemini-3-flash).
// Output: EIGENT_EVAL_DIR (default ../l2-evidence/playwright/real-model).

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
  path.resolve(REPO_ROOT, '..', 'l2-evidence', 'playwright', 'real-model');

const THINKING_ALIAS = process.env.EIGENT_EVAL_MODEL ?? 'gemini-3-reasoning';
const THINKING_LABEL =
  process.env.EIGENT_EVAL_MODEL_LABEL ?? 'Gemini 3 Reasoning';
const CONTROL_ALIAS =
  process.env.EIGENT_EVAL_CONTROL_MODEL ?? 'gemini-3-flash';
const CONTROL_LABEL =
  process.env.EIGENT_EVAL_CONTROL_MODEL_LABEL ?? 'Gemini 3 Flash';

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
const RUN_TAG = `l2-${Date.now().toString(36)}`;

// Both prompts are written one paragraph per line and joined by a BLANK line,
// because the composer keeps paragraph breaks and drops single line breaks
// outright — a prompt wrapped for source width would reach the model with its
// words run together across every wrap.
//
// The thinking prompt wants two things at once: a question with enough going
// on to make a thinking model actually think, and an answer long enough
// (well past the 1 KiB durable chunk threshold) to journal as several
// text_delta events.
const THINKING_PROMPT = [
  `[${RUN_TAG}] Do not use any tools for this task — answer directly from reasoning alone.`,
  'Three friends split a restaurant bill of exactly 173 dollars. Ana pays twice what Ben pays, and Ben pays 7 dollars more than Cara. Work out what each person pays.',
  'Then write a thorough explanation of at least 500 words: walk through setting up the equations, solving them step by step, checking the arithmetic, and describing one common mistake people make on problems like this.',
  'Finish your reply with exactly one line:',
  'ANSWER: ANA=<amount> BEN=<amount> CARA=<amount>',
].join('\n\n');
// 173 = 2b + b + (b - 7) → b = 45, so Ana 90, Ben 45, Cara 38.
const THINKING_ANSWER = 'ANA=90 BEN=45 CARA=38';

const CONTROL_PROMPT = [
  `[${RUN_TAG}] Do not use any tools. Reply with exactly one line:`,
  'ANSWER: CONTROL_OK',
].join('\n\n');
const CONTROL_ANSWER = 'CONTROL_OK';

interface EdgeEvent {
  kind: string;
  sequence: string;
  data?: Record<string, unknown>;
}

interface PassRecord {
  name: string;
  prompt: string;
  model_alias: string;
  project_id?: string;
  terminal?: string | null;
  event_kinds?: Record<string, number>;
  text_delta_count?: number;
  text_delta_sizes?: number[];
  reasoning_delta_count?: number;
  reasoning_bytes?: number;
  strip_count?: number;
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

function recordDeltas(pass: PassRecord, events: EdgeEvent[]): EdgeEvent[] {
  const deltas = events.filter((e) => e.kind === 'text_delta');
  pass.text_delta_count = deltas.length;
  pass.text_delta_sizes = deltas.map((e) =>
    Buffer.byteLength(String(e.data?.text ?? ''))
  );
  const reasoned = deltas.filter(
    (e) => String(e.data?.reasoning ?? '') !== ''
  );
  pass.reasoning_delta_count = reasoned.length;
  pass.reasoning_bytes = reasoned.reduce(
    (sum, e) => sum + Buffer.byteLength(String(e.data?.reasoning ?? '')),
    0
  );
  return deltas;
}

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

test('a thinking model streams reasoning into the strip and its answer in chunks', async () => {
  test.setTimeout(45 * 60_000);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-l2-'));
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

  const thinkingPass: PassRecord = {
    name: 'thinking',
    prompt: THINKING_PROMPT,
    model_alias: THINKING_ALIAS,
  };
  const controlPass: PassRecord = {
    name: 'control',
    prompt: CONTROL_PROMPT,
    model_alias: CONTROL_ALIAS,
  };
  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
    run_tag: RUN_TAG,
    passes: [thinkingPass, controlPass],
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

    // ---- Pass 1: the thinking model. --------------------------------------
    const composerA = await newSpace(page);
    await selectModel(page, THINKING_LABEL);
    const createA = page
      .waitForRequest(
        (request) =>
          request.method() === 'POST' &&
          request.url() === `${edgeBaseUrl}/projects`,
        { timeout: 60_000 }
      )
      .then((request) => request.postData() ?? '')
      .catch(() => '');
    await typeIntoComposer(page, composerA, THINKING_PROMPT);
    await composerA.press('Enter');
    const postedA = JSON.parse((await createA) || '{}') as {
      model_alias?: string;
    };
    // Which provider actually served the run, read off the wire rather than
    // off the picker that was clicked.
    expect(
      postedA.model_alias,
      "the picker's choice never reached the create"
    ).toBe(THINKING_ALIAS);
    await screenshot(page, '01-thinking-sent');

    await awaitTurnSettled(page);

    const projectA = projectIds()[0];
    expect(
      projectA,
      'no command was submitted for the thinking pass'
    ).toBeTruthy();
    thinkingPass.project_id = projectA;
    const trajectoryA = await collectTrajectory(projectA);
    thinkingPass.terminal = trajectoryA.terminal;
    thinkingPass.event_kinds = countKinds(trajectoryA.events);
    expect(trajectoryA.terminal, 'the thinking run did not complete').toBe(
      'run_completed'
    );

    // The durable record: a 500-word answer must have crossed the 1 KiB
    // threshold several times — several text_delta events, not one blob —
    // and the model's thinking must ride at least one of them.
    const deltasA = recordDeltas(thinkingPass, trajectoryA.events);
    expect(
      deltasA.length,
      'the long answer was journaled as too few deltas'
    ).toBeGreaterThanOrEqual(3);
    expect(
      thinkingPass.reasoning_delta_count,
      'no delta carried the model reasoning'
    ).toBeGreaterThanOrEqual(1);

    // The surface: the Thinking strip is above the answer, collapsed with a
    // preview, and expands to the full trace on click.
    const strips = page.getByTestId('thinking-strip');
    thinkingPass.strip_count = await strips.count();
    expect(
      thinkingPass.strip_count,
      'no Thinking strip rendered for a reasoning run'
    ).toBeGreaterThanOrEqual(1);
    const toggle = page.getByTestId('thinking-strip-toggle').last();
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
      await toggle.click();
    }
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const trace = page.getByTestId('thinking-strip-trace').last();
    await expect(trace).toBeVisible();
    expect(
      normalize(await trace.innerText()).length,
      'the expanded trace is empty'
    ).toBeGreaterThan(0);
    await page.waitForTimeout(1_000);
    await screenshot(page, '02-thinking-strip-expanded');
    // Collapse again so the persisted preference does not pre-expand a strip
    // in the control pass — where no strip may exist at all.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // The arithmetic came back and was merged, so the streaming above belongs
    // to a run that actually did its job.
    thinkingPass.answered = normalize(
      await page.locator('body').innerText()
    ).includes(THINKING_ANSWER);
    expect(
      thinkingPass.answered,
      `the run never reported ${THINKING_ANSWER}`
    ).toBe(true);

    // ---- Pass 2: the negative control — no thinking, no strip. ------------
    const composerB = await newSpace(page);
    await selectModel(page, CONTROL_LABEL);
    await typeIntoComposer(page, composerB, CONTROL_PROMPT);
    await composerB.press('Enter');
    await awaitTurnSettled(page);

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

    // The control: no delta carries reasoning, and no strip renders.
    recordDeltas(controlPass, trajectoryB.events);
    expect(
      controlPass.reasoning_delta_count,
      'the control model unexpectedly reported reasoning'
    ).toBe(0);
    controlPass.strip_count = await page
      .getByTestId('thinking-strip')
      .count();
    expect(
      controlPass.strip_count,
      'a Thinking strip rendered for a run with no reasoning'
    ).toBe(0);
    await page.waitForTimeout(1_000);
    await screenshot(page, '03-control-no-strip');

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
      videoName = 'stream-run.webm';
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
