// Browser-filmstrip evaluation: the frames a real browsing run photographs
// inside the sandbox pod, reaching the desktop as a viewable strip — proven
// through the REAL desktop app in remote-backend mode against a live
// eigent-local stack in browser mode (AION_BROWSER_TEMPLATE), with a REAL
// model, and recorded to video.
//
// browser-task.eval.ts already proves a browsing run works. What is unproven,
// and what this asserts, is that the viewfinder frames are reachable by a
// user: the browser card has to become selectable, its workspace has to render
// the strip, and the strip has to show bytes the pod actually photographed.
// So the verdicts are stacked so that no single layer can carry the run alone:
//   1. the answer carries destination facts that only a real page visit
//      supplies, and the run settles completed;
//   2. every mutating browser action published an `aion-browser-frame-*`
//      artifact whose presigned bytes start with the JPEG marker — the model
//      cannot narrate a frame into existence;
//   3. the filmstrip the UI renders reports the SAME frame count as the
//      trajectory read back from the edge, and its current frame decoded in
//      the renderer (naturalWidth > 0), so the strip is showing those bytes
//      rather than an empty <img> with a plausible src;
//   4. a second run in the same app session that is told not to browse renders
//      no filmstrip and publishes no frames — the strip is read from the run,
//      not always drawn.
//
// The network audit is the one place this eval cannot demand edge-only traffic:
// artifact bytes live in a default-deny object store and the edge mints a
// presigned GET rather than proxying them, so a strip that renders MUST reach
// the store directly. The audit allows exactly that — same origin, one of the
// object paths this run's own frames resolve to, and a signature on the query
// — and requires the allowance to have been used, so an empty "everything
// else" set is not the vacuous kind.
//
// Run: npx playwright test --config e2e/eval.config.ts browser-view
// Output: EIGENT_EVAL_DIR (default ../browser-view-eval next to the repo).

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
  path.resolve(REPO_ROOT, '..', 'browser-view-eval');

// A browse-follow-read chain: each action is a pod exec plus a page load, and
// each now also carries a screenshot capture and an artifact publish.
const ANSWER_TIMEOUT_MS = 10 * 60_000;
// The negative control asks one arithmetic question and forbids browsing.
const CONTROL_TIMEOUT_MS = 4 * 60_000;
// The trajectory tail after the answer is on screen: the run settles within
// seconds of the final text delta.
const TRAJECTORY_TIMEOUT_MS = 120_000;
// The presigned GETs behind the strip are minted lazily, one fetch per frame.
const FILMSTRIP_TIMEOUT_MS = 90_000;
const VIDEO_SIZE = { width: 1280, height: 800 };
const MIN_VIDEO_BYTES = 100 * 1024;

// Mirrors engine.BrowserFrameArtifactPrefix. A frame is named as a frame:
// CAS addresses bytes by digest, so the artifact row's name is the only place
// a viewfinder frame is distinguishable from a report the agent wrote.
const FRAME_PREFIX = 'aion-browser-frame-';

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
  'Open https://example.com in the browser. Take a snapshot to read it. Then',
  "follow the 'Learn more' link on that page, take a snapshot of the page you",
  'land on, and tell me: the exact title of the destination page, and the',
  'first sentence of its body text.',
].join('\n');

// Facts that live only on the destination page (iana.org), never in the
// prompt: their presence in the answer proves a real page visit.
const GROUND_TRUTH = ['Example Domains', 'RFC 2606'];

const CONTROL_QUERY = [
  'Do not open a browser or visit any web page. Using arithmetic only,',
  'what is 17 multiplied by 23? Reply with just the number.',
].join('\n');
const CONTROL_TRUTH = '391';

/**
 * Lowercase phrases inside a tool_result body that mean a browser action did
 * not actually run: the exec seam reporting a missing binary, the resolver
 * rejecting a tool name, or the browserctl wrapper's own failure prefix. All
 * of these settle as SUCCESSFUL tool_results, which is exactly why the scan
 * exists.
 */
const FAILURE_MARKERS = [
  'browser tool failed',
  'browser error:',
  'exit status 127',
  'command not found',
  'unknown tool',
  'no such file or directory',
];

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
 * from sequence 0 through the run's terminal. This is the run as the product
 * recorded it, independent of anything the renderer displayed.
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

/** Polls the visible transcript until every fact is on screen, or time runs out. */
async function waitForAnswer(
  page: Page,
  facts: string[],
  timeoutMs: number,
  shotPrefix: string
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let shots = 0;
  for (;;) {
    const text = await pageText(page);
    if (facts.every((fact) => text.includes(fact))) return true;
    if (Date.now() > deadline) return false;
    if (shots < 8) await screenshot(page, `${shotPrefix}-${shots++}`);
    await page.waitForTimeout(15_000);
  }
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

test('the viewfinder frames of a real browsing run, as a filmstrip in the UI', async () => {
  test.setTimeout(ANSWER_TIMEOUT_MS + CONTROL_TIMEOUT_MS + 12 * 60_000);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-brv-'));
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
    ground_truth: GROUND_TRUTH,
    control_query: CONTROL_QUERY,
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

    // 1. One browsing query in a fresh Space. Nothing tells the model which
    //    browser tools exist, and nothing asks it to take a screenshot — the
    //    frames are the runtime's own doing.
    const composer = await newSpace(page);
    await typeIntoComposer(page, composer, QUERY);
    await screenshot(page, '01-composed');
    await composer.press('Enter');
    const started = Date.now();

    const answered = await waitForAnswer(
      page,
      GROUND_TRUTH,
      ANSWER_TIMEOUT_MS,
      '02-progress'
    );
    summary.answer_elapsed_ms = Date.now() - started;
    await screenshot(page, '03-answer');
    const transcript = await pageText(page);
    writeOut('03-transcript.txt', transcript);
    summary.answered = answered;

    // 2. The durable trajectory, from the product's own event log.
    const projectId = latestProjectId(requests);
    expect(projectId, 'the renderer never submitted a command').toBeTruthy();
    summary.project_id = projectId;

    const { events, terminal } = await collectTrajectory(projectId!);
    summary.terminal = terminal;
    summary.event_count = events.length;

    const toolsUsed = events
      .filter((e) => e.kind === 'tool_call')
      .map((e) => String(e.data?.tool_name ?? ''));
    summary.browser_tool_calls = toolsUsed.filter((t) =>
      t.startsWith('browser_')
    );

    const inBandFailures: { sequence: string; marker: string }[] = [];
    for (const event of events) {
      if (event.kind !== 'tool_result') continue;
      const body = JSON.stringify(event.data ?? {}).toLowerCase();
      for (const marker of FAILURE_MARKERS) {
        if (body.includes(marker)) {
          inBandFailures.push({ sequence: event.sequence, marker });
        }
      }
    }
    summary.in_band_failures = inBandFailures;

    // 3. The frames themselves: named as frames, and real JPEG bytes behind a
    //    presigned GET. A frame the run only claimed to take fails here.
    const frameArtifacts = artifactsOf(events).filter((a) =>
      String(a.name ?? '').startsWith(FRAME_PREFIX)
    );
    const frames: Record<string, unknown>[] = [];
    // Where the frames' bytes actually live, learned from the grants this eval
    // minted rather than configured — the audit below allows exactly these.
    let casOrigin: string | null = null;
    const casPaths = new Set<string>();
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
    summary.frames = frames;
    summary.frame_count = frames.length;

    // 4. The strip, reached the way a user reaches it: a browsing run infers
    //    workforce mode, which is what puts the expand control on the panel
    //    header, and the browser card is selectable because it has a workspace
    //    to open onto — not because it was assigned a task.
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
    await screenshot(page, '04-filmstrip');
    summary.filmstrip_frame_count =
      await filmstrip.getAttribute('data-frame-count');

    const current = page.getByTestId('browser-filmstrip-current');
    await expect(current).toBeVisible({ timeout: FILMSTRIP_TIMEOUT_MS });
    // A decoded image is the difference between showing the pod's bytes and
    // showing an <img> with a plausible src that 403s.
    await expect
      .poll(
        () =>
          current.evaluate(
            (node) => (node as HTMLImageElement).naturalWidth ?? 0
          ),
        { timeout: FILMSTRIP_TIMEOUT_MS }
      )
      .toBeGreaterThan(0);
    summary.filmstrip_thumbnails = await page
      .getByTestId('browser-filmstrip-frame')
      .count();

    // 5. The negative control: a second run, in the same app session, told not
    //    to browse. It must publish no frames AND render no strip — so the
    //    strip is proven to be read off the run rather than always drawn.
    await page.keyboard.press('Escape');
    await expect(filmstrip).toBeHidden({ timeout: 30_000 });
    const controlComposer = await newSpace(page);
    await typeIntoComposer(page, controlComposer, CONTROL_QUERY);
    await controlComposer.press('Enter');
    const controlAnswered = await waitForAnswer(
      page,
      [CONTROL_TRUTH],
      CONTROL_TIMEOUT_MS,
      '05-control-progress'
    );
    await screenshot(page, '06-control');
    summary.control_answered = controlAnswered;

    const controlProjectId = latestProjectId(requests);
    expect(
      controlProjectId,
      'the control run never reached the edge'
    ).toBeTruthy();
    expect(controlProjectId).not.toBe(projectId);
    summary.control_project_id = controlProjectId;
    const control = await collectTrajectory(controlProjectId!);
    summary.control_terminal = control.terminal;
    summary.control_browser_tool_calls = control.events
      .filter((e) => e.kind === 'tool_call')
      .map((e) => String(e.data?.tool_name ?? ''))
      .filter((t) => t.startsWith('browser_'));
    summary.control_frames = artifactsOf(control.events).filter((a) =>
      String(a.name ?? '').startsWith(FRAME_PREFIX)
    ).length;

    const modelSubmit = requests.find(
      (r) => r.method === 'POST' && /\/projects$/.test(r.url)
    );
    summary.model_alias = modelSubmit?.body
      ? (JSON.parse(modelSubmit.body) as { model_alias?: string }).model_alias
      : null;
    summary.request_count = requests.length;
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
    expect(answered, 'the destination facts never reached the answer').toBe(
      true
    );
    expect(terminal, 'the run did not settle completed').toBe('run_completed');
    expect(
      (summary.browser_tool_calls as string[]).length,
      'the model never drove the pod browser'
    ).toBeGreaterThan(0);
    expect(
      inBandFailures,
      'a browser action failed inside a settled tool_result'
    ).toEqual([]);
    expect(
      frames.length,
      'the run published no viewfinder frame'
    ).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(frame.jpeg_magic, `${frame.artifact_id} is not a JPEG`).toBe(true);
      expect(frame.media_type, `${frame.artifact_id} is mistyped`).toBe(
        'image/jpeg'
      );
      expect(Number(frame.bytes)).toBeGreaterThan(0);
    }
    expect(
      summary.filmstrip_frame_count,
      'the strip disagrees with the trajectory about how many frames exist'
    ).toBe(String(frames.length));

    expect(controlAnswered, 'the control run never answered').toBe(true);
    expect(summary.control_terminal, 'the control run did not settle').toBe(
      'run_completed'
    );
    expect(
      summary.control_browser_tool_calls,
      'the control run browsed, so it proves nothing about the strip'
    ).toEqual([]);
    expect(summary.control_frames, 'the control run published frames').toBe(0);
    await expect(
      page.getByTestId('browser-filmstrip'),
      'a run that never browsed still renders a filmstrip'
    ).toHaveCount(0);
    await expect(
      page.locator(
        '[data-testid="workforce-agent-toggle"][data-agent-type="browser_agent"]'
      ),
      'a run that never browsed still projects a browser card'
    ).toHaveCount(0);

    expect(requests.length, 'no traffic was observed at all').toBeGreaterThan(0);
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
      videoName = 'browser-view-run.webm';
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
