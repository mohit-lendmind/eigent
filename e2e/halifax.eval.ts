// Live-site browser-navigation evaluation: a real mortgage-research task on
// https://www.halifax-intermediaries.co.uk/ — find residential products for a
// First Time Buyer at 70% LTV — driven through the REAL desktop app in
// remote-backend mode against a live eigent-local stack in browser mode, with
// a REAL model, and recorded to video.
//
// Unlike the fixture-shaped browser evals, the destination here is a live
// production site whose figures change: no rate can be pinned as ground truth.
// The verdicts are therefore about GROUNDING rather than recall:
//   1. the run settles completed, and the trajectory shows the pod browser
//      actually reaching a Halifax property (the tool_result bodies carry the
//      URLs the browser reported, not URLs the model claimed);
//   2. every interest-rate figure the answer names appears somewhere in the
//      bytes a browser action returned this session — a model reciting
//      remembered rates fails here, because live rates drift;
//   3. the answer reached the SCREEN (a rate figure in the rendered
//      transcript), and the run's viewfinder frames are real JPEGs behind
//      presigned grants, reachable as the filmstrip;
//   4. the renderer's traffic is the edge plus this run's own frame grants and
//      nothing else — the POD browses the open web, the desktop never does.
//
// A browser action that fails mid-run does NOT fail the eval: a heavy
// production site can crash the pod Chromium (observed: CDP websocket 1006,
// then the relaunch), and recovering via browser_open is the designed path.
// Those results are counted in the summary as recovered_browser_errors; the
// run is judged on whether it completed with a grounded answer.
//
// Run: npx playwright test --config e2e/eval.config.ts halifax
// Output: EIGENT_EVAL_DIR (default ../halifax-eval next to the repo).

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
  process.env.EIGENT_EVAL_DIR ?? path.resolve(REPO_ROOT, '..', 'halifax-eval');

// The de-risking probe of this exact task ran 33 turns: the product search is
// a cross-origin iframe the model has to discover and enter, and the pod
// browser crashed twice on the way. Budget for the slow honest path.
const ANSWER_TIMEOUT_MS = 20 * 60_000;
const FILMSTRIP_TIMEOUT_MS = 90_000;
const VIDEO_SIZE = { width: 1280, height: 800 };
const MIN_VIDEO_BYTES = 100 * 1024;

// Mirrors engine.BrowserFrameArtifactPrefix (see browser-view.eval.ts).
const FRAME_PREFIX = 'aion-browser-frame-';

// The picker row driving this run, by its display name (the accessible name
// the trigger carries once the selection sticks). Overridable so the same
// spec can compare providers on the identical task.
const MODEL_LABEL = process.env.EIGENT_EVAL_MODEL_LABEL ?? 'Gemini 3.7 Flash';

interface Bootstrap {
  api_key: string;
  edge_url: string;
  tenant_id: string;
}

const bootstrap: Bootstrap = JSON.parse(
  fs.readFileSync(BOOTSTRAP_PATH, 'utf-8')
);
const edgeBaseUrl = `${bootstrap.edge_url.replace(/\/+$/, '')}/eigent/v1`;

const QUERY = [
  'Use the browser to research residential mortgage products on the Halifax',
  'Intermediaries website at https://www.halifax-intermediaries.co.uk/ .',
  'I need products available to a First Time Buyer at 70% loan-to-value.',
  'Navigate the site to find the current product information for that case:',
  'start at the home page, find the products or rates section, and open the',
  'residential First Time Buyer products. For each product you find that is',
  'available at up to 70% LTV, report the product type (for example 2 year',
  'fixed or 5 year fixed), the initial interest rate, the product fee, and',
  'the maximum LTV. Report the exact URL of every page you took the figures',
  'from. If the figures are only published in a downloadable rate sheet',
  'rather than on a web page, say so explicitly and give the URL of that',
  'sheet. Do not guess or recall rates from memory: every number you report',
  'must come from a page you actually opened in this session.',
].join('\n');

// An initial mortgage rate as written in an answer: 4.68%, never the 70% of
// the LTV in the question. The captured numeric part is what must also appear
// in the bytes a browser action returned.
const RATE_PATTERN = /\b(\d\.\d{2})%/g;

interface EdgeEvent {
  sequence: string;
  kind: string;
  data?: Record<string, unknown>;
}

async function edgeFetch(
  suffix: string,
  init: RequestInit = {}
): Promise<Response> {
  return fetch(`${edgeBaseUrl}${suffix}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${bootstrap.api_key}`,
    },
  });
}

/**
 * The durable trajectory, straight from the edge's SSE replay: every event
 * from sequence 0 through the run's terminal. The stream stays open while the
 * run works, so tailing it to the terminal IS the wait for the answer.
 */
async function collectTrajectory(
  projectId: string,
  timeoutMs: number
): Promise<{ events: EdgeEvent[]; terminal: string | null }> {
  const events: EdgeEvent[] = [];
  let terminal: string | null = null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      `${edgeBaseUrl}/projects/${projectId}/events?after=0`,
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

function artifactsOf(events: EdgeEvent[]): Record<string, unknown>[] {
  return events
    .filter((e) => e.kind === 'artifact_created')
    .map((e) => (e.data?.artifact ?? {}) as Record<string, unknown>);
}

function writeOut(name: string, payload: string): void {
  if (payload.includes(bootstrap.api_key)) {
    throw new Error(`output ${name} would leak the API key`);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, name), payload);
}

async function screenshot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
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
// reclaim focus mid-typing, so typing is verify-and-retry. Multi-line text
// arrives as Shift+Enter between lines because a bare Enter sends.
async function typeIntoComposer(
  page: Page,
  composer: ReturnType<Page['locator']>,
  text: string
): Promise<void> {
  const lines = text.split('\n');
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.keyboard.press('Escape').catch(() => {});
    await composer.click();
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) await page.keyboard.press('Shift+Enter');
      if (lines[i]) await page.keyboard.insertText(lines[i]);
    }
    const got = (await composer.innerText()).replace(/\s+/g, ' ').trim();
    if (got === text.replace(/\s+/g, ' ').trim()) return;
    await composer.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
  }
  throw new Error('composer never captured the full query');
}

/** Whole-page text, whitespace-collapsed: answers are asserted on values. */
async function pageText(page: Page): Promise<string> {
  return (await page.locator('body').innerText()).replace(/\s+/g, ' ');
}

/**
 * A fresh Space, so the run starts a project of its own. The switcher button
 * carries the active space's own name, so it is clicked by id, not label.
 */
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
 * Picks the provider the way a user does. The trigger carries the effective
 * alias's display name as its accessible name, so asserting that name after
 * the click proves the selection stuck rather than silently falling back.
 */
async function selectModel(page: Page, label: string): Promise<void> {
  const trigger = page.getByTestId('aion-model-select');
  await trigger.waitFor({ state: 'visible', timeout: 30_000 });
  await trigger.click();
  await page.getByRole('menuitem').filter({ hasText: label }).first().click();
  await expect(trigger).toHaveAccessibleName(label);
}

/**
 * Whether a renderer request is one of this run's frames being fetched under
 * its read grant: the object store the edge itself pointed at, one of the
 * object paths this run's frames resolve to, and a signature on the query. Any
 * of those missing makes it ordinary off-edge traffic, which is a leak.
 */
function isFrameGrant(
  raw: string,
  casOrigin: string | null,
  casPaths: Set<string>
): boolean {
  if (!casOrigin) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.origin !== casOrigin || !casPaths.has(url.pathname)) return false;
  return [...url.searchParams.keys()].some((key) =>
    /^x-(amz|goog)-signature$/i.test(key)
  );
}

/** The project id off the wire the renderer actually used, newest submission last. */
function latestProjectId(
  requests: { method: string; url: string }[]
): string | null {
  const posts = requests.filter(
    (r) => r.method === 'POST' && /\/projects\/[^/]+\/commands$/.test(r.url)
  );
  const last = posts[posts.length - 1];
  return last ? /\/projects\/([^/]+)\/commands$/.exec(last.url)![1] : null;
}

test('First Time Buyer products at 70% LTV, researched live on halifax-intermediaries.co.uk', async () => {
  test.setTimeout(ANSWER_TIMEOUT_MS + 12 * 60_000);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-hfx-'));
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
    query: QUERY,
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
    const requests: {
      method: string;
      url: string;
      body?: string;
      at: string;
    }[] = [];
    // The previous run of this task settled run_cancelled with no click and no
    // recorded user command — so every cancel POST the renderer issues is
    // captured verbatim (URL, body, wall-clock), and the renderer console is
    // kept, to attribute the next unexplained cancel instead of guessing.
    const cancelPosts: typeof requests = [];
    page.on('request', (request) => {
      const record = {
        method: request.method(),
        url: request.url(),
        body: request.postData() ?? undefined,
        at: new Date().toISOString(),
      };
      requests.push(record);
      if (/\/runs\/[^/]+\/cancel$/.test(record.url)) cancelPosts.push(record);
    });
    const consoleLines: string[] = [];
    page.on('console', (message) => {
      consoleLines.push(
        `${new Date().toISOString()} [${message.type()}] ${message.text()}`
      );
    });

    await page
      .locator('[role="textbox"]')
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 });

    // 1. The research task in a fresh Space, phrased the way a broker would
    //    ask it. Nothing names a tool, a URL structure, or the iframe the
    //    model will have to find.
    const composer = await newSpace(page);
    await selectModel(page, MODEL_LABEL);
    await typeIntoComposer(page, composer, QUERY);
    await screenshot(page, '01-composed');
    await composer.press('Enter');
    const started = Date.now();

    await expect
      .poll(() => latestProjectId(requests), { timeout: 60_000 })
      .not.toBeNull();
    const projectId = latestProjectId(requests)!;
    summary.project_id = projectId;

    // 2. Wait on the product's own record, not the screen: tail the SSE
    //    stream to the terminal, photographing progress for the record while
    //    the video keeps rolling.
    let shots = 0;
    const progress = setInterval(() => {
      if (shots < 10) {
        void screenshot(page, `02-progress-${shots++}`).catch(() => {});
      }
    }, 90_000);
    const { events, terminal } = await collectTrajectory(
      projectId,
      ANSWER_TIMEOUT_MS
    ).finally(() => clearInterval(progress));
    summary.answer_elapsed_ms = Date.now() - started;
    summary.terminal = terminal;
    summary.event_count = events.length;

    // Let the renderer catch up to the terminal before photographing it.
    await page.waitForTimeout(8_000);
    await screenshot(page, '03-answer');
    const transcript = await pageText(page);
    writeOut('03-transcript.txt', transcript);

    const toolsUsed = events
      .filter((e) => e.kind === 'tool_call')
      .map((e) => String(e.data?.tool_name ?? ''));
    summary.tool_calls = toolsUsed.length;
    summary.browser_tool_calls = toolsUsed.filter((t) =>
      t.startsWith('browser_')
    );

    const toolBodies = events
      .filter((e) => e.kind === 'tool_result')
      .map((e) => JSON.stringify(e.data ?? {}))
      .join('\n');
    summary.recovered_browser_errors = (
      toolBodies.match(/browser error:/g) ?? []
    ).length;

    const answer = events
      .filter((e) => e.kind === 'text_delta')
      .map((e) => String(e.data?.text ?? ''))
      .join('');
    writeOut('04-answer.txt', answer);

    // 3. Grounding. Every rate the answer names must exist in bytes a browser
    //    action returned this session; the trajectory must show the browser
    //    on a Halifax property; a rate must have reached the screen.
    const rates = [
      ...new Set([...answer.matchAll(RATE_PATTERN)].map((m) => m[1])),
    ];
    summary.answer_rates = rates;
    const unsupportedRates = rates.filter((rate) => !toolBodies.includes(rate));
    summary.unsupported_rates = unsupportedRates;
    summary.visited_halifax = toolBodies.includes('halifax-intermediaries');
    summary.screen_has_rate = /\b\d\.\d{2}%/.test(transcript);

    // 4. The viewfinder frames: named as frames, real JPEG bytes behind
    //    presigned grants. The grants minted here also teach the network
    //    audit which object paths this run's frames resolve to.
    const frameArtifacts = artifactsOf(events).filter((a) =>
      String(a.name ?? '').startsWith(FRAME_PREFIX)
    );
    let casOrigin: string | null = null;
    const casPaths = new Set<string>();
    const frames: Record<string, unknown>[] = [];
    for (const artifact of frameArtifacts) {
      const artifactId = String(artifact.artifact_id ?? '');
      const meta = await edgeFetch(
        `/projects/${projectId}/artifacts/${artifactId}`
      );
      expect(meta.ok, `frame ${artifactId} not downloadable`).toBe(true);
      const grant = (await meta.json()) as { download_url?: string };
      expect(grant.download_url, `frame ${artifactId} has no grant`).toBeTruthy();
      const grantUrl = new URL(grant.download_url!);
      casOrigin = grantUrl.origin;
      casPaths.add(grantUrl.pathname);
      const bytes = Buffer.from(
        await (await fetch(grant.download_url!)).arrayBuffer()
      );
      frames.push({
        artifact_id: artifactId,
        name: artifact.name,
        media_type: artifact.media_type,
        bytes: bytes.length,
        jpeg_magic: bytes
          .subarray(0, 3)
          .equals(Buffer.from([0xff, 0xd8, 0xff])),
      });
    }
    summary.frame_count = frames.length;

    // 5. The filmstrip, reached the way a user reaches it.
    await expect(
      page.getByTestId('session-side-panel-header')
    ).toHaveAttribute('data-session-mode', 'workforce');
    await page
      .getByRole('button', { name: 'Expand workforce' })
      .click({ timeout: 30_000 });
    const browserToggle = page.locator(
      '[data-testid="workforce-agent-toggle"][data-agent-type="browser_agent"]'
    );
    await expect(browserToggle).toBeVisible({ timeout: 30_000 });
    await expect(
      browserToggle,
      'the browser card is greyed out, so the strip is unreachable'
    ).toBeEnabled();
    await browserToggle.click();

    const filmstrip = page.getByTestId('browser-filmstrip');
    await expect(filmstrip).toBeVisible({ timeout: FILMSTRIP_TIMEOUT_MS });
    summary.filmstrip_frame_count =
      await filmstrip.getAttribute('data-frame-count');
    const current = page.getByTestId('browser-filmstrip-current');
    await expect(current).toBeVisible({ timeout: FILMSTRIP_TIMEOUT_MS });
    await expect
      .poll(
        () =>
          current.evaluate(
            (node) => (node as HTMLImageElement).naturalWidth ?? 0
          ),
        { timeout: FILMSTRIP_TIMEOUT_MS }
      )
      .toBeGreaterThan(0);
    await screenshot(page, '05-filmstrip');

    const modelSubmit = requests.find(
      (r) => r.method === 'POST' && /\/projects$/.test(r.url)
    );
    summary.model_alias = modelSubmit?.body
      ? (JSON.parse(modelSubmit.body) as { model_alias?: string }).model_alias
      : null;
    summary.request_count = requests.length;
    summary.cancel_posts = cancelPosts;
    writeOut('06-console.log', consoleLines.join('\n'));
    const offEdge = requests
      .filter((r) => /^https?:/.test(r.url))
      .filter((r) => !r.url.startsWith(edgeBaseUrl))
      .map((r) => r.url);
    const grantRequests = offEdge.filter((raw) =>
      isFrameGrant(raw, casOrigin, casPaths)
    );
    summary.frame_grant_requests = grantRequests.length;
    summary.off_edge_requests = offEdge.filter(
      (raw) => !isFrameGrant(raw, casOrigin, casPaths)
    );

    // The verdicts. Each names what actually broke rather than "test failed".
    expect(terminal, 'the run did not settle completed').toBe('run_completed');
    expect(
      (summary.browser_tool_calls as string[]).length,
      'the model never drove the pod browser'
    ).toBeGreaterThan(0);
    expect(
      summary.visited_halifax,
      'no browser action ever reported a Halifax page'
    ).toBe(true);
    expect(
      rates.length,
      'the answer names no rate figures at all'
    ).toBeGreaterThanOrEqual(3);
    expect(
      unsupportedRates,
      'rates in the answer never appeared in anything the browser read — recalled, not researched'
    ).toEqual([]);
    expect(
      summary.screen_has_rate,
      'the rendered transcript never showed a rate'
    ).toBe(true);
    expect(
      frames.length,
      'the run published no viewfinder frame'
    ).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(frame.jpeg_magic, `${frame.artifact_id} is not a JPEG`).toBe(true);
      expect(frame.media_type, `${frame.artifact_id} is mistyped`).toBe(
        'image/jpeg'
      );
    }
    expect(requests.length, 'no traffic was observed at all').toBeGreaterThan(
      0
    );
    expect(
      grantRequests.length,
      'the strip never fetched a frame, so the allowance below proves nothing'
    ).toBeGreaterThan(0);
    expect(
      summary.off_edge_requests,
      'the renderer reached somewhere that is neither the edge nor a frame grant'
    ).toEqual([]);
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
      videoName = 'halifax-run.webm';
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
