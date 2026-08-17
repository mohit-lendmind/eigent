// Real-model PDF handoff evaluation: a hand-built PDF stating a codename that
// exists NOWHERE except inside the document is attached through the real
// composer, and Gemini 3 Flash — served by the gemini route on the managed
// inference plane, the one backend whose wire carries document parts — is
// asked to read the codename back. Driven through the REAL desktop app in
// remote-backend mode against a live eigent-local stack, recorded to video.
//
// The verdicts are about the SEAM, not the model's eloquence:
//   1. the run settles completed, and the trajectory carries the upload
//      signature only an attachment can leave — an artifact_created BEFORE the
//      first run_accepted;
//   2. the published artifact's sha256/size are the hash of the exact PDF the
//      picker chose, media type application/pdf — the document leg carried the
//      bytes unmodified;
//   3. the answer names the codename — and the codename appears in NO outgoing
//      request body as text (its only carrier is the PDF, whose upload rides
//      base64-encoded), so the model can only have read it from the document
//      the dispatch path delivered;
//   4. the renderer's traffic is the edge and nothing else.
//
// The negative control runs the SAME PDF on Kimi K3: the moonshot wire has no
// encoding for document parts and refuses them with a typed error rather than
// silently dropping the attachment. The control asserts that refusal is
// LEGIBLE end to end — the run settles run_failed with a non-empty message,
// the chat shows "Run failed", and no answer ever names the codename. A seam
// that dropped the document silently would instead settle completed with a
// hallucinated answer, which is exactly what this control exists to catch.
//
// Run: npx playwright test --config e2e/eval.config.ts pdf-handoff.eval
// Output: EIGENT_EVAL_DIR (default ../pdf-handoff-eval next to the repo).

import {
  _electron as electron,
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
  path.resolve(REPO_ROOT, '..', 'pdf-handoff-eval');

const ANSWER_TIMEOUT_MS = 8 * 60_000;
const VIDEO_SIZE = { width: 1280, height: 800 };
const MIN_VIDEO_BYTES = 50 * 1024;

// The two picker rows, by the display names the trigger carries once each
// selection sticks. The document leg must ride the gemini route — the
// OpenRouter rows share moonshot's OpenAI-compatible wire, which has no
// document encoding.
const READER_LABEL = process.env.EIGENT_EVAL_READER_LABEL ?? 'Gemini 3 Flash';
const READER_ALIAS = process.env.EIGENT_EVAL_READER_ALIAS ?? 'gemini-3-flash';
const REFUSER_LABEL = process.env.EIGENT_EVAL_REFUSER_LABEL ?? 'Kimi K3';
const REFUSER_ALIAS = process.env.EIGENT_EVAL_REFUSER_ALIAS ?? 'kimi-k3';

// Confusable-free capitals only (no I/L/O). Fresh per run: a memorized answer
// cannot exist.
const NONCE = Array.from(
  { length: 8 },
  () => 'ABCDEFGHJKMNPQRSTUVWXYZ'[Math.floor(Math.random() * 23)]
).join('');

// The question deliberately never contains the codename. Its only carrier in
// the entire exchange is the PDF's text stream, which uploads base64-encoded.
const QUERY = [
  'A single PDF document is attached to this message. It states a project',
  'codename in capital letters. Read the document and reply with exactly that',
  'codename and nothing else.',
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

/**
 * A minimal one-page PDF whose text stream is UNCOMPRESSED, hand-assembled so
 * the document owes nothing to a library: every byte is ASCII, offsets are
 * exact, and any conforming reader — vendor-side included — parses it.
 */
function buildPdf(lines: string[]): Buffer {
  const esc = (s: string) =>
    s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const content =
    'BT\n/F1 16 Tf\n72 720 Td\n20 TL\n' +
    lines
      .map((line, i) => `${i === 0 ? '' : 'T* '}(${esc(line)}) Tj\n`)
      .join('') +
    'ET\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [i, obj] of objects.entries()) {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  }
  const xrefStart = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    body += `${off.toString().padStart(10, '0')} 00000 n \n`;
  }
  body +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
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

/** A fresh Space, so each leg starts a project of its own. */
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

interface CapturedRequest {
  method: string;
  url: string;
  body?: string;
}

/** The project id off the wire the renderer actually used, newest last. */
function latestProjectId(requests: CapturedRequest[]): string | null {
  const posts = requests.filter(
    (r) => r.method === 'POST' && /\/projects\/[^/]+\/commands$/.test(r.url)
  );
  const last = posts[posts.length - 1];
  return last ? /\/projects\/([^/]+)\/commands$/.exec(last.url)![1] : null;
}

/** The model alias on the newest project-create body the renderer sent. */
function latestModelAlias(requests: CapturedRequest[]): string | null {
  const posts = requests.filter(
    (r) => r.method === 'POST' && /\/projects$/.test(r.url) && r.body
  );
  const last = posts[posts.length - 1];
  return last?.body
    ? ((JSON.parse(last.body) as { model_alias?: string }).model_alias ?? null)
    : null;
}

test('a model reads a codename that exists only inside an attached PDF; a docless wire refuses it legibly', async () => {
  test.setTimeout(2 * ANSWER_TIMEOUT_MS + 8 * 60_000);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-pdf-'));
  const keyFile = path.join(workDir, 'edge-api-key');
  fs.writeFileSync(keyFile, bootstrap.api_key, { mode: 0o600 });

  const stamp = Date.now().toString(36);
  const fileName = `brief-${stamp}.pdf`;
  const filePath = path.join(workDir, fileName);
  const pdfBytes = buildPdf([
    'INTERNAL PROJECT BRIEF',
    '',
    `Project codename: ${NONCE}`,
    'The codename above is the only authoritative one.',
  ]);
  fs.writeFileSync(filePath, pdfBytes);
  const fileSha = crypto.createHash('sha256').update(pdfBytes).digest('hex');

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
    file_bytes: pdfBytes.length,
    reader_alias: READER_ALIAS,
    refuser_alias: REFUSER_ALIAS,
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
    const requests: CapturedRequest[] = [];
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
    await stubFileDialog(app, filePath);

    // ---- Leg 1: the document leg. Gemini reads the PDF back.
    const composer = await newSpace(page);
    await selectModel(page, READER_LABEL);
    await typeIntoComposer(page, composer, QUERY);
    await page
      .getByRole('button', { name: 'Add files or photos' })
      .click({ timeout: 30_000 });
    await expect(page.getByText(fileName).first()).toBeVisible({
      timeout: 30_000,
    });
    await screenshot(page, '01-composed');
    await composer.press('Enter');
    const readerStarted = Date.now();

    await expect
      .poll(() => latestProjectId(requests), { timeout: 60_000 })
      .not.toBeNull();
    const readerProject = latestProjectId(requests)!;
    summary.reader_project_id = readerProject;
    summary.reader_model_alias = latestModelAlias(requests);

    const reader = await collectTrajectory(readerProject, ANSWER_TIMEOUT_MS);
    summary.reader_elapsed_ms = Date.now() - readerStarted;
    summary.reader_terminal = reader.terminal;
    summary.reader_event_count = reader.events.length;

    await page.waitForTimeout(5_000);
    await screenshot(page, '02-answer');
    const readerTranscript = await pageText(page);
    writeOut('reader-transcript.txt', readerTranscript);

    const readerKinds = reader.events.map((e) => e.kind);
    const firstArtifact = readerKinds.indexOf('artifact_created');
    const firstRun = readerKinds.indexOf('run_accepted');
    summary.upload_precedes_first_run =
      firstArtifact >= 0 && (firstRun < 0 || firstArtifact < firstRun);

    const answer = reader.events
      .filter((e) => e.kind === 'text_delta')
      .map((e) => String(e.data?.text ?? ''))
      .join('');
    writeOut('answer.txt', answer);
    summary.answer = answer.trim().slice(0, 400);

    const listed = await edgeFetch(`/projects/${readerProject}/artifacts`);
    expect(listed.ok, 'artifact list unavailable').toBe(true);
    const artifacts =
      (
        (await listed.json()) as {
          artifacts?: Record<string, unknown>[];
        }
      ).artifacts ?? [];
    const uploaded = artifacts.filter((a) => a.name === fileName);
    summary.uploaded_artifacts = uploaded;

    // ---- Leg 2: the negative control. The moonshot wire has no document
    // encoding; the SAME PDF must be refused legibly, never dropped silently.
    const controlComposer = await newSpace(page);
    await selectModel(page, REFUSER_LABEL);
    await typeIntoComposer(page, controlComposer, QUERY);
    await page
      .getByRole('button', { name: 'Add files or photos' })
      .click({ timeout: 30_000 });
    await expect(page.getByText(fileName).first()).toBeVisible({
      timeout: 30_000,
    });
    await controlComposer.press('Enter');
    const refuserStarted = Date.now();

    await expect
      .poll(() => {
        const id = latestProjectId(requests);
        return id === readerProject ? null : id;
      }, { timeout: 60_000 })
      .not.toBeNull();
    const refuserProject = latestProjectId(requests)!;
    summary.refuser_project_id = refuserProject;
    summary.refuser_model_alias = latestModelAlias(requests);

    const refuser = await collectTrajectory(refuserProject, ANSWER_TIMEOUT_MS);
    summary.refuser_elapsed_ms = Date.now() - refuserStarted;
    summary.refuser_terminal = refuser.terminal;
    const refusal = refuser.events.find((e) => e.kind === 'run_failed');
    summary.refusal_reason = refusal?.data?.reason ?? null;
    summary.refusal_message = refusal?.data?.message ?? null;
    const refuserAnswer = refuser.events
      .filter((e) => e.kind === 'text_delta')
      .map((e) => String(e.data?.text ?? ''))
      .join('');

    await page.waitForTimeout(5_000);
    await screenshot(page, '03-refusal');
    const refuserTranscript = await pageText(page);
    writeOut('refuser-transcript.txt', refuserTranscript);

    // ---- The grounding control spans both legs: the codename rode ONLY
    // inside the PDF. No outgoing request body carries it as text.
    const bodiesWithNonce = requests
      .filter((r) => r.body && r.body.includes(NONCE))
      .map((r) => r.url);
    summary.request_bodies_carrying_nonce = bodiesWithNonce;
    summary.request_count = requests.length;
    writeOut('console.log', consoleLines.join('\n'));
    // Origin-based, not URL-prefix-based: a prefix match would let a port
    // that merely extends the edge's digits pass as on-edge.
    const edgeOrigin = new URL(edgeBaseUrl).origin;
    const offEdge = requests
      .filter((r) => /^https?:/.test(r.url))
      .filter((r) => !r.url.startsWith(edgeOrigin))
      .map((r) => r.url);
    summary.off_edge_requests = offEdge;

    // The verdicts. Each names what actually broke rather than "test failed".
    expect(reader.terminal, 'the document run did not settle completed').toBe(
      'run_completed'
    );
    expect(
      summary.upload_precedes_first_run,
      'no artifact_created preceded the first run_accepted — the upload leg never ran'
    ).toBe(true);
    expect(uploaded.length, 'the attached PDF was never listed').toBe(1);
    expect(uploaded[0].sha256, 'the uploaded bytes differ from the PDF').toBe(
      fileSha
    );
    expect(Number(uploaded[0].size_bytes)).toBe(pdfBytes.length);
    expect(uploaded[0].media_type).toBe('application/pdf');
    expect(
      summary.reader_model_alias,
      'the document run was not served by the gemini alias this eval pins'
    ).toBe(READER_ALIAS);
    expect(
      bodiesWithNonce,
      'the codename leaked into an outgoing request as text — the reading proof is void'
    ).toEqual([]);
    expect(
      answer.toUpperCase(),
      'the model never named the codename that exists only inside the PDF'
    ).toContain(NONCE);
    expect(
      readerTranscript.toUpperCase(),
      'the answer never reached the screen'
    ).toContain(NONCE);

    expect(
      summary.refuser_model_alias,
      'the control run was not served by the moonshot alias this eval pins'
    ).toBe(REFUSER_ALIAS);
    expect(
      refuser.terminal,
      'the docless wire did not fail the run — a silent drop would answer from nothing'
    ).toBe('run_failed');
    expect(
      String(summary.refusal_message ?? ''),
      'the refusal carried no message a user could read'
    ).not.toBe('');
    expect(
      refuserTranscript,
      'the refusal never reached the screen as a failed run'
    ).toContain('Run failed');
    expect(
      refuserAnswer.toUpperCase(),
      'the docless wire produced the codename — the document must have leaked'
    ).not.toContain(NONCE);

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
    // is resolved after teardown and before the summary that reports it. A
    // close that fails must not take the summary with it.
    try {
      await app.close();
    } catch (closeError) {
      summary.close_error = String(closeError);
    }
    let videoBytes = 0;
    let videoName: string | null = null;
    const recorded = await video?.path().catch(() => undefined);
    if (recorded && fs.existsSync(recorded)) {
      videoName = 'pdf-handoff-run.webm';
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
