// Browser-agent evaluation: one real browsing task through the REAL desktop
// app in remote-backend mode, against the live eigent-local stack running in
// browser mode (AION_BROWSER_TEMPLATE), with a REAL model — and the whole run
// recorded to video.
//
// The task cannot be answered from the prompt: the model must drive the
// pod-local headless Chromium to example.com, follow its outbound link, and
// report the destination page's title and first sentence — facts that appear
// nowhere in the query. Ground truth is asserted three ways, none of which
// trusts the model's narration alone:
//   1. the answer text carries the destination facts ("Example Domains",
//      RFC 2606) that only a real page visit can supply;
//   2. the edge event trajectory shows browser_* tool calls settling without
//      in-band failure bodies (settlement green != result green — a broken
//      pod image reports exit 127 INSIDE a successful tool_result);
//   3. the screenshot the task demands arrives as a durable artifact whose
//      presigned bytes are a real PNG.
//
// Run: npx playwright test --config e2e/eval.config.ts browser-task
// Output: EIGENT_EVAL_DIR (default ../browser-task-eval next to the repo).

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
  path.resolve(REPO_ROOT, '..', 'browser-task-eval');

// One browse-follow-read-screenshot chain — shorter than a skills chain, but
// each browser action is a pod exec plus a page load.
const ANSWER_TIMEOUT_MS = 10 * 60_000;
// The trajectory tail after the answer is already on screen: the run settles
// within seconds of the final text delta.
const TRAJECTORY_TIMEOUT_MS = 120_000;
// Recorded at the app's own window size, scaled to this frame.
const VIDEO_SIZE = { width: 1280, height: 800 };
// A recording of a multi-minute run is megabytes; anything tiny is a stub file
// from a window that never painted.
const MIN_VIDEO_BYTES = 100 * 1024;

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
  "Open https://example.com in the browser. Take a snapshot to read it. Then",
  "follow the 'Learn more' link on that page, take a snapshot of the page you",
  'land on, and take a screenshot of it. Finally tell me: the exact title of',
  'the destination page, and the first sentence of its body text.',
].join('\n');

// Facts that live only on the destination page (iana.org), never in the
// prompt: their presence in the answer proves a real page visit.
const GROUND_TRUTH = ['Example Domains', 'RFC 2606'];

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

test('a real browsing task through the UI, on the pod-local Chromium', async () => {
  test.setTimeout(ANSWER_TIMEOUT_MS + 10 * 60_000);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-brt-'));
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

    // 1. One query, one fresh Space. Nothing tells the model which browser
    //    tools exist or in what order to use them.
    const composer = await newSpace(page);
    await typeIntoComposer(page, composer, QUERY);
    await screenshot(page, '01-composed');
    await composer.press('Enter');
    const started = Date.now();

    const deadline = Date.now() + ANSWER_TIMEOUT_MS;
    let shots = 0;
    let answered = false;
    for (;;) {
      const text = await pageText(page);
      if (GROUND_TRUTH.every((fact) => text.includes(fact))) {
        answered = true;
        break;
      }
      if (Date.now() > deadline) break;
      if (shots < 8) {
        await screenshot(page, `02-progress-${shots++}`);
      }
      await page.waitForTimeout(15_000);
    }
    summary.answer_elapsed_ms = Date.now() - started;
    await screenshot(page, '03-answer');
    const transcript = await pageText(page);
    writeOut('03-transcript.txt', transcript);
    summary.answered = answered;
    summary.facts_seen = GROUND_TRUTH.filter((fact) =>
      transcript.includes(fact)
    );

    // 2. The durable trajectory, from the product's own event log. The
    //    project id comes off the wire the renderer actually used.
    const commandPost = requests.find(
      (r) => r.method === 'POST' && /\/projects\/[^/]+\/commands$/.test(r.url)
    );
    expect(commandPost, 'the renderer never submitted a command').toBeTruthy();
    const projectId = /\/projects\/([^/]+)\/commands$/.exec(
      commandPost!.url
    )![1];
    summary.project_id = projectId;

    const { events, terminal } = await collectTrajectory(projectId);
    summary.terminal = terminal;
    summary.event_count = events.length;

    const toolCalls = events
      .filter((e) => e.kind === 'tool_call')
      .map((e) => ({
        sequence: e.sequence,
        tool: String(e.data?.tool_name ?? ''),
        args: String(e.data?.arguments_json ?? '').slice(0, 200),
      }));
    summary.tool_calls = toolCalls;

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

    // 3. The screenshot the task demanded, as a durable artifact whose
    //    presigned bytes are a real PNG — the model cannot narrate this into
    //    existence. The run also publishes JPEG viewfinder frames after every
    //    mutating browser action; each artifact's bytes must match its own
    //    declared media type, and the demanded screenshot is the PNG one.
    const artifactEvents = events.filter((e) => e.kind === 'artifact_created');
    summary.artifact_events = artifactEvents.map((e) => e.data);
    const artifacts: Record<string, unknown>[] = [];
    for (const event of artifactEvents) {
      const artifact = (event.data?.artifact ?? {}) as Record<string, unknown>;
      const artifactId = String(artifact.artifact_id ?? '');
      const meta = await edgeFetch(
        `/projects/${projectId}/artifacts/${artifactId}`
      );
      expect(meta.ok, `artifact ${artifactId} not downloadable`).toBe(true);
      const grant = (await meta.json()) as { download_url?: string };
      expect(grant.download_url, `artifact ${artifactId} has no grant`).toBeTruthy();
      const bytes = Buffer.from(
        await (await fetch(grant.download_url!)).arrayBuffer()
      );
      const isPng = bytes
        .subarray(0, 4)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const isJpeg = bytes
        .subarray(0, 3)
        .equals(Buffer.from([0xff, 0xd8, 0xff]));
      const mediaType = String(artifact.media_type ?? '');
      const magicOk =
        mediaType === 'image/png'
          ? isPng
          : mediaType === 'image/jpeg'
            ? isJpeg
            : false;
      artifacts.push({
        artifact_id: artifactId,
        name: artifact.name,
        media_type: mediaType,
        sha256: artifact.sha256,
        bytes: bytes.length,
        png_magic: isPng,
        magic_ok: magicOk,
      });
      if (magicOk) {
        fs.writeFileSync(
          path.join(OUT_DIR, `artifact-${String(artifact.name ?? artifactId)}`),
          bytes
        );
      }
    }
    summary.artifacts = artifacts;

    const modelSubmit = requests.find(
      (r) => r.method === 'POST' && /\/projects$/.test(r.url)
    );
    summary.model_alias = modelSubmit?.body
      ? (JSON.parse(modelSubmit.body) as { model_alias?: string }).model_alias
      : null;
    summary.request_count = requests.length;
    summary.off_edge_requests = requests
      .filter((r) => /^https?:/.test(r.url))
      .filter((r) => !r.url.startsWith(edgeBaseUrl))
      .map((r) => r.url);

    // The verdicts. Each names what actually broke rather than "test failed".
    expect(
      answered,
      'the destination facts never reached the answer'
    ).toBe(true);
    expect(terminal, 'the run did not settle completed').toBe('run_completed');
    const toolsUsed = toolCalls.map((c) => c.tool);
    expect(
      toolsUsed.some((t) => t === 'browser_visit_page'),
      'the model never navigated the pod browser'
    ).toBe(true);
    expect(
      toolsUsed.some((t) => t === 'browser_get_screenshot'),
      'the demanded screenshot was never taken'
    ).toBe(true);
    expect(
      inBandFailures,
      'a browser action failed inside a settled tool_result'
    ).toEqual([]);
    expect(
      artifacts.some((a) => a.png_magic === true),
      'no screenshot artifact was published'
    ).toBe(true);
    for (const artifact of artifacts) {
      expect(
        artifact.magic_ok,
        `${artifact.artifact_id} bytes do not match declared ${artifact.media_type}`
      ).toBe(true);
      expect(Number(artifact.bytes)).toBeGreaterThan(0);
    }
    expect(summary.off_edge_requests).toEqual([]);
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
      videoName = 'browser-task-run.webm';
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
