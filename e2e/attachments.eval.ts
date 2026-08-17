// Real-model attachment evaluation: a PNG carrying a nonce word that exists
// NOWHERE except in its pixels is attached through the real composer attach
// affordance, and a vision model (Gemini 3.7 Flash via OpenRouter, through the
// managed inference plane) is asked to read the word back — driven through the
// REAL desktop app in remote-backend mode against a live eigent-local stack,
// and recorded to video.
//
// The verdicts are about the SEAM, not the model's eloquence:
//   1. the run settles completed, and the trajectory carries the upload
//      signature only an attachment can leave — an artifact_created BEFORE the
//      first run_accepted (nothing else publishes into a Project no run has
//      touched);
//   2. the uploaded artifact's sha256/size are the hash of the exact bytes the
//      picker chose, so the file arrived unmodified;
//   3. the answer names the nonce — and the nonce appears in NO outgoing
//      request body as text (the upload carries it only as encoded pixels), so
//      the model can only have read it from the image the dispatch path
//      delivered. A broken image leg cannot pass this by echoing the prompt;
//   4. the renderer's traffic is the edge and nothing else.
//
// Run: npx playwright test --config e2e/eval.config.ts attachments.eval
// Output: EIGENT_EVAL_DIR (default ../attachments-eval next to the repo).

import {
  _electron as electron,
  chromium,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import crypto from 'node:crypto';
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
  path.resolve(REPO_ROOT, '..', 'attachments-eval');

const ANSWER_TIMEOUT_MS = 8 * 60_000;
const VIDEO_SIZE = { width: 1280, height: 800 };
const MIN_VIDEO_BYTES = 50 * 1024;

// The picker row driving this run, by its display name (the accessible name
// the trigger carries once the selection sticks).
const MODEL_LABEL = process.env.EIGENT_EVAL_MODEL_LABEL ?? 'Gemini 3.7 Flash';

// Confusable-free capitals only (no I/L/O), so the word survives rendering and
// reading without ambiguity. Fresh per run: a memorized answer cannot exist.
const NONCE = Array.from(
  { length: 8 },
  () => 'ABCDEFGHJKMNPQRSTUVWXYZ'[Math.floor(Math.random() * 23)]
).join('');

// The question deliberately never contains the word. Its only carrier in the
// entire exchange is the PNG's pixels.
const QUERY = [
  'A single image file is attached to this message. It shows one word in',
  'capital letters. Read the word from the image and reply with exactly that',
  'word and nothing else.',
].join(' ');

interface Bootstrap {
  api_key: string;
  edge_url: string;
  tenant_id: string;
}

const bootstrap: Bootstrap = JSON.parse(
  fs.readFileSync(BOOTSTRAP_PATH, 'utf-8')
);
const edgeBaseUrl = `${bootstrap.edge_url.replace(/\/+$/, '')}/eigent/v1`;

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

/** Renders the nonce as real pixels: a PNG screenshot of a page showing it. */
async function renderNoncePng(word: string, filePath: string): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 800, height: 300 },
    });
    await page.setContent(
      `<body style="margin:0;display:flex;align-items:center;` +
        `justify-content:center;width:800px;height:300px;background:#fff">` +
        `<div style="font:bold 84px Arial,sans-serif;color:#000;` +
        `letter-spacing:10px">${word}</div></body>`
    );
    await page.screenshot({ path: filePath, type: 'png' });
  } finally {
    await browser.close();
  }
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

/**
 * Replaces the native file picker in the MAIN process, because a real dialog
 * would hang a headless run forever. The renderer path stays fully real: the
 * same select-file IPC, the same read-file-dataurl read, the same upload.
 */
async function stubFileDialog(
  app: ElectronApplication,
  filePath: string
): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [chosen],
      bookmarks: [],
    });
  }, filePath);
}

// The space-switch dropdown's focus trap can outlive its dismiss animation and
// reclaim focus mid-typing, so typing is verify-and-retry.
async function typeIntoComposer(
  page: Page,
  composer: ReturnType<Page['locator']>,
  text: string
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.keyboard.press('Escape').catch(() => {});
    await composer.click();
    await page.keyboard.insertText(text);
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

/** A fresh Space, so the run starts a project of its own. */
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

/** The project id off the wire the renderer actually used, newest last. */
function latestProjectId(
  requests: { method: string; url: string }[]
): string | null {
  const posts = requests.filter(
    (r) => r.method === 'POST' && /\/projects\/[^/]+\/commands$/.test(r.url)
  );
  const last = posts[posts.length - 1];
  return last ? /\/projects\/([^/]+)\/commands$/.exec(last.url)![1] : null;
}

test('a vision model reads a nonce word that exists only inside an attached PNG', async () => {
  test.setTimeout(ANSWER_TIMEOUT_MS + 6 * 60_000);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-att-'));
  const keyFile = path.join(workDir, 'edge-api-key');
  fs.writeFileSync(keyFile, bootstrap.api_key, { mode: 0o600 });

  const stamp = Date.now().toString(36);
  const fileName = `reading-test-${stamp}.png`;
  const filePath = path.join(workDir, fileName);
  await renderNoncePng(NONCE, filePath);
  const pngBytes = fs.readFileSync(filePath);
  const fileSha = crypto.createHash('sha256').update(pngBytes).digest('hex');

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
    nonce: NONCE,
    file_name: fileName,
    file_sha256: fileSha,
    file_bytes: pngBytes.length,
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
    const consoleLines: string[] = [];
    page.on('console', (message) => {
      consoleLines.push(`[${message.type()}] ${message.text()}`);
    });

    await page
      .locator('[role="textbox"]')
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 });

    // 1. A fresh Space, the vision provider, the question, and the attach —
    //    through the same button, dialog IPC, and chip a user sees.
    await stubFileDialog(app, filePath);
    const composer = await newSpace(page);
    await selectModel(page, MODEL_LABEL);
    await typeIntoComposer(page, composer, QUERY);
    await page
      .getByRole('button', { name: 'Add files or photos' })
      .click({ timeout: 30_000 });
    await expect(page.getByText(fileName).first()).toBeVisible({
      timeout: 30_000,
    });
    await screenshot(page, '01-composed');
    await composer.press('Enter');
    const started = Date.now();

    await expect
      .poll(() => latestProjectId(requests), { timeout: 60_000 })
      .not.toBeNull();
    const projectId = latestProjectId(requests)!;
    summary.project_id = projectId;

    // 2. Wait on the product's own record: tail the SSE stream to terminal.
    const { events, terminal } = await collectTrajectory(
      projectId,
      ANSWER_TIMEOUT_MS
    );
    summary.answer_elapsed_ms = Date.now() - started;
    summary.terminal = terminal;
    summary.event_count = events.length;

    await page.waitForTimeout(5_000);
    await screenshot(page, '02-answer');
    const transcript = await pageText(page);
    writeOut('transcript.txt', transcript);

    const kinds = events.map((e) => e.kind);
    const firstArtifact = kinds.indexOf('artifact_created');
    const firstRun = kinds.indexOf('run_accepted');
    summary.upload_precedes_first_run =
      firstArtifact >= 0 && (firstRun < 0 || firstArtifact < firstRun);

    const answer = events
      .filter((e) => e.kind === 'text_delta')
      .map((e) => String(e.data?.text ?? ''))
      .join('');
    writeOut('answer.txt', answer);
    summary.answer = answer.trim().slice(0, 400);

    // 3. The uploaded artifact, listed by the product with the exact bytes'
    //    identity — the file arrived unmodified.
    const listed = await edgeFetch(`/projects/${projectId}/artifacts`);
    expect(listed.ok, 'artifact list unavailable').toBe(true);
    const artifacts = ((await listed.json()) as {
      artifacts?: Record<string, unknown>[];
    }).artifacts ?? [];
    const uploaded = artifacts.filter((a) => a.name === fileName);
    summary.uploaded_artifacts = uploaded;

    // 4. The grounding control: the nonce rode ONLY as pixels. No outgoing
    //    request body carries it as text, so an answer naming it proves the
    //    image itself reached the model.
    const bodiesWithNonce = requests
      .filter((r) => r.body && r.body.includes(NONCE))
      .map((r) => r.url);
    summary.request_bodies_carrying_nonce = bodiesWithNonce;

    const modelSubmit = requests.find(
      (r) => r.method === 'POST' && /\/projects$/.test(r.url)
    );
    summary.model_alias = modelSubmit?.body
      ? (JSON.parse(modelSubmit.body) as { model_alias?: string }).model_alias
      : null;
    summary.request_count = requests.length;
    writeOut('console.log', consoleLines.join('\n'));
    const offEdge = requests
      .filter((r) => /^https?:/.test(r.url))
      .filter((r) => !r.url.startsWith(edgeBaseUrl))
      .map((r) => r.url);
    summary.off_edge_requests = offEdge;

    // The verdicts. Each names what actually broke rather than "test failed".
    expect(terminal, 'the run did not settle completed').toBe('run_completed');
    expect(
      summary.upload_precedes_first_run,
      'no artifact_created preceded the first run_accepted — the upload leg never ran'
    ).toBe(true);
    expect(uploaded.length, 'the attached file was never listed').toBe(1);
    expect(uploaded[0].sha256, 'the uploaded bytes differ from the file').toBe(
      fileSha
    );
    expect(Number(uploaded[0].size_bytes)).toBe(pngBytes.length);
    expect(uploaded[0].media_type).toBe('image/png');
    expect(
      summary.model_alias,
      'the run was not served by the vision alias this eval pins'
    ).toBe('gemini-37-flash');
    expect(
      bodiesWithNonce,
      'the nonce leaked into an outgoing request as text — the reading proof is void'
    ).toEqual([]);
    expect(
      answer.toUpperCase(),
      'the model never named the word that exists only inside the image'
    ).toContain(NONCE);
    expect(
      transcript.toUpperCase(),
      'the answer never reached the screen'
    ).toContain(NONCE);
    expect(requests.length, 'no traffic was observed at all').toBeGreaterThan(
      0
    );
    expect(
      offEdge,
      'the renderer reached somewhere other than the edge'
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
      videoName = 'attachments-run.webm';
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
