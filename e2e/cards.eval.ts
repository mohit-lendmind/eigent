// Real-model driver for typed tool cards: one live provider run that writes a
// code file, runs a shell command, and visits a page with the browser — so the
// chat timeline must draw one typed card per lane (code / bash / browser) and
// the work-log folds must carry the same cards — driven through the REAL
// product chat UI against the live eigent-local stack (browser mode), and
// recorded.
//
// The claim under test spans both records: the edge's trajectory shows a
// tool_call per lane, and the DOM drew exactly one card per recorded call —
// counted before the work log opens, so the chat pane's cards and the durable
// record are compared one-to-one. Then the folds are opened and each lane's
// card must render there too (the second surface).
//
// The negative control is a second pass in the same session, same model, with
// tools forbidden: zero cards in the DOM and zero tool_call events in the
// trajectory. Without it, a surface that drew a card for every message would
// pass the first pass and be wrong.
//
// Run: npx playwright test --config e2e/eval.config.ts cards
//      (the stack must be booted in browser mode: AION_BROWSER_TEMPLATE=
//      browser-workspace — the visit step needs chromium in the sandbox).
// Env: EIGENT_EVAL_MODEL / EIGENT_EVAL_MODEL_LABEL pick the catalog row (a REAL
//      provider row — the deterministic fixtures are what layer 2 covers).
// Output: EIGENT_EVAL_DIR (default ../l4-evidence/playwright/real-model).

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
  path.resolve(REPO_ROOT, '..', 'l4-evidence', 'playwright', 'real-model');

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
const RUN_TAG = `l4-${Date.now().toString(36)}`;

// Three steps, one per card lane. The page is a file the run writes itself so
// the visit needs no egress; every value the cards must display is pinned in
// the prompt so the DOM can be asserted against it.
const PAGE_MARKUP = '<html><body><h1>cards eval page</h1></body></html>';
const CARDS_PROMPT = [
  `[${RUN_TAG}] Do these three steps in order, each exactly once, using exactly the tool named:`,
  `1. Use the write_file tool to create /workspace/hello.html containing exactly: ${PAGE_MARKUP}`,
  `2. Use the shell to run exactly this command, verbatim: wc -c /workspace/hello.html`,
  `3. Use the browser to visit file:///workspace/hello.html and take a page snapshot.`,
  'Do not use any other tools and do not retry. Then finish your reply with exactly one line:',
  'ANSWER: CARDS_DONE',
].join('\n\n');
const CARDS_ANSWER = 'CARDS_DONE';

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
  project_id?: string;
  terminal?: string | null;
  event_kinds?: Record<string, number>;
  tool_calls?: string[];
  chat_card_lanes?: Record<string, number>;
  work_log_card_lanes?: Record<string, number>;
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

/** Opens the work-log surface, where the second card surface renders. */
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

/** Cards on whatever surface is currently mounted, counted by lane. */
async function cardLanes(page: Page): Promise<Record<string, number>> {
  const lanes: Record<string, number> = {};
  for (const id of await page
    .locator('[data-testid^="tool-card-"]')
    .evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute('data-testid') ?? '')
    )) {
    const lane = id.replace('tool-card-', '');
    lanes[lane] = (lanes[lane] ?? 0) + 1;
  }
  return lanes;
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

test('one typed card per lane on a real run, on both surfaces', async () => {
  test.setTimeout(45 * 60_000);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-l4-'));
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

  const cardsPass: PassRecord = { name: 'cards', prompt: CARDS_PROMPT };
  const controlPass: PassRecord = { name: 'control', prompt: CONTROL_PROMPT };
  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
    model_alias: MODEL_ALIAS,
    run_tag: RUN_TAG,
    passes: [cardsPass, controlPass],
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

    // ---- Pass 1: the three-lane run. --------------------------------------
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
    await typeIntoComposer(page, composerA, CARDS_PROMPT);
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

    await awaitTurnSettled(page);
    await page.waitForTimeout(1_000);

    cardsPass.answered = normalize(
      await page.locator('body').innerText()
    ).includes(CARDS_ANSWER);
    expect(cardsPass.answered, `the run never reported ${CARDS_ANSWER}`).toBe(
      true
    );

    // The chat pane's cards, counted BEFORE the work log opens so the count
    // can be compared one-to-one with the durable record below.
    const chatLanes = await cardLanes(page);
    cardsPass.chat_card_lanes = chatLanes;
    await screenshot(page, '01-cards-inline');
    for (const lane of ['bash', 'code', 'browser']) {
      expect(
        chatLanes[lane] ?? 0,
        `no ${lane} card rendered in the chat timeline`
      ).toBeGreaterThanOrEqual(1);
    }
    // The cards carry the task's own values, not placeholders.
    const chatText = normalize(await page.locator('body').innerText());
    expect(chatText).toContain('wc -c /workspace/hello.html');
    expect(chatText).toContain('hello.html');
    // The code card mounted the real editor.
    await expect(
      page
        .locator('[data-testid="tool-card-code"] [data-monaco-ready="1"]')
        .first()
    ).toBeVisible({ timeout: 60_000 });

    const projectA = projectIds()[0];
    expect(
      projectA,
      'no command was submitted for the cards pass'
    ).toBeTruthy();
    cardsPass.project_id = projectA;
    const trajectoryA = await collectTrajectory(projectA);
    cardsPass.terminal = trajectoryA.terminal;
    cardsPass.event_kinds = countKinds(trajectoryA.events);
    expect(trajectoryA.terminal, 'the cards run did not complete').toBe(
      'run_completed'
    );

    // The durable record: a tool_call per lane, and the pane drew exactly one
    // card per recorded call — no invented cards, no dropped calls.
    const calls = trajectoryA.events
      .filter((e) => e.kind === 'tool_call')
      .map((e) => String(e.data?.tool_name ?? ''));
    cardsPass.tool_calls = calls;
    expect(calls, 'no shell call was recorded').toContain('bash');
    expect(calls, 'no file write was recorded').toContain('write_file');
    expect(
      calls.some((name) => name.startsWith('browser_')),
      `no browser call was recorded (calls: ${calls.join(', ')})`
    ).toBe(true);
    const callIds = new Set(
      trajectoryA.events
        .filter((e) => e.kind === 'tool_call')
        .map((e) => String(e.data?.tool_call_id ?? ''))
    );
    const chatCardCount = Object.values(chatLanes).reduce((a, b) => a + b, 0);
    expect(
      chatCardCount,
      'the chat pane and the trajectory disagree on the call count'
    ).toBe(callIds.size);

    // The second surface: the same cards render inside the work-log folds.
    await openWorkLog(page);
    const groups = page.getByTestId('work-log-agent-group');
    for (let i = 0; i < (await groups.count()); i++) {
      const group = groups.nth(i);
      if ((await group.getAttribute('aria-expanded')) !== 'true') {
        await group.click().catch(() => {});
      }
    }
    const rows = page.locator('[data-tool-status] button');
    for (let i = 0; i < (await rows.count()); i++) {
      await rows.nth(i).click().catch(() => {});
    }
    const bothSurfaces = await cardLanes(page);
    cardsPass.work_log_card_lanes = bothSurfaces;
    for (const lane of ['bash', 'code', 'browser']) {
      expect(
        bothSurfaces[lane] ?? 0,
        `the ${lane} card never rendered in the work-log fold`
      ).toBeGreaterThan(chatLanes[lane] ?? 0);
    }
    await screenshot(page, '02-work-log-cards');

    // ---- Pass 2: the negative control — no tools, no cards. ---------------
    const composerB = await newSpace(page);
    await selectModel(page, MODEL_LABEL);
    await typeIntoComposer(page, composerB, CONTROL_PROMPT);
    await composerB.press('Enter');
    await awaitTurnSettled(page);
    await page.waitForTimeout(1_000);
    await screenshot(page, '03-control-settled');

    await expect(page.locator('[data-testid^="tool-card-"]')).toHaveCount(0);

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
    controlPass.tool_calls = trajectoryB.events
      .filter((e) => e.kind === 'tool_call')
      .map((e) => String(e.data?.tool_name ?? ''));
    expect(
      controlPass.tool_calls,
      'a tool-less run recorded tool calls'
    ).toEqual([]);

    controlPass.answered = normalize(
      await page.locator('body').innerText()
    ).includes(CONTROL_ANSWER);
    expect(
      controlPass.answered,
      `the run never reported ${CONTROL_ANSWER}`
    ).toBe(true);

    // Both halves of the network audit: everything HTTP stayed on the edge —
    // except the presigned object-store GETs a browser run's viewfinder makes
    // by design (the edge mints the signature; it does not proxy the bytes) —
    // and the set is non-vacuous because the renderer did make requests.
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
      videoName = 'cards-run.webm';
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
