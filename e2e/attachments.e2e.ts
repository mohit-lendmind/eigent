// Attachments desktop E2E: the REAL desktop app in remote-backend mode against
// the eigent-local Compose edge, driving the composer's attach affordance end
// to end — pick a file, see the chip, send, and find the bytes on the edge.
//
// The upload has a signature only an attachment can leave: an artifact_created
// event BEFORE the first run_accepted, because a user upload is the one path
// that publishes into a Project no run has touched yet. The suite asserts that
// signature, the byte-level sha256 of the published artifact against the file
// on disk, and — as the negative control — that a plain turn in a fresh
// Project leaves neither the signature nor a same-named artifact behind. A
// fixture run publishes its own scripted artifacts, so "no artifacts at all"
// would be the wrong control.
//
// Both turns are COMPOSER-driven, so the app resolves the model itself — and
// its resolution chain only ever picks from the rows the picker would offer.
// On a mixed catalog the fixture aliases are internal, so a composer turn
// binds the first real-provider row and this gate silently stops being
// deterministic. Hence the same stack requirement as workforce.e2e.ts:
//   EIGENT_LOCAL_FIXTURE_PICKER=1 bazel run //dev/eigent_local:up   (in aion-v1)
//   EIGENT_E2E_FIXTURE_PICKER=1 npx playwright test --config e2e/playwright.config.ts attachments
//
// Remaining preconditions match aion-lab.e2e.ts (skipped cleanly when absent):
// the Compose stack up in the sibling aion-v1 checkout and `npx vite build`
// here. The desktop API key comes from the gitignored run manifest and rides
// ONLY the env of the launched app — never a committed file or evidence output.

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

// The alias the composer turns are expected to bind: the app resolves the
// catalog's offered default itself, which the fixture-picker overlay pins to
// aion-default. Recorded in the summary so the claim is checkable against the
// run bindings, not asserted here — resolution belongs to the app.
const MODEL_ALIAS = process.env.EIGENT_E2E_MODEL ?? 'aion-default';

// A real 1x1 PNG, so the ride is exercised with genuine image bytes whose
// sha256 the edge's artifact row must reproduce exactly.
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const TERMINAL_KINDS = ['run_completed', 'run_failed', 'run_cancelled'];
const TERMINAL_TIMEOUT_MS = 120_000;

interface Bootstrap {
  api_key: string;
  edge_url: string;
  tenant_id: string;
}

interface EdgeArtifact {
  artifact_id: string;
  name: string;
  media_type: string;
  sha256: string;
  size_bytes: string;
  version: number;
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
let attachmentsServed = false;
let workDir: string;
let keyFile: string;

test.beforeAll(async () => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-att-'));
  if (bootstrap && edgeBaseUrl) {
    try {
      const response = await fetch(`${edgeBaseUrl}/status`, {
        signal: AbortSignal.timeout(3_000),
      });
      edgeReady = response.ok;
      if (edgeReady) {
        const status = (await response.json()) as {
          edge_api_version?: string;
        };
        // The upload route shipped in 1.16.0; on an older stack the composer
        // itself refuses the turn, which is its own (unit-tested) behaviour,
        // not this suite's.
        const [major, minor] = (status.edge_api_version ?? '0.0.0')
          .split('.')
          .map(Number);
        attachmentsServed = major === 1 && minor >= 16;
      }
    } catch {
      edgeReady = false;
    }
    keyFile = path.join(workDir, 'edge-api-key');
    fs.writeFileSync(keyFile, bootstrap.api_key, { mode: 0o600 });
  }
  if (PACKAGED_SOURCE) {
    packaged = installPackagedApp(PACKAGED_SOURCE);
  }
});

test.afterAll(() => {
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

async function launchApp(): Promise<{
  app: ElectronApplication;
  page: Page;
}> {
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
// reclaim focus mid-typing, so typing is verify-and-retry (the same guard the
// skills suites carry).
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

/** A fresh Space, so each scenario gets its own Project on the edge. */
async function newSpaceComposer(
  page: Page
): Promise<ReturnType<Page['locator']>> {
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

async function screenshot(page: Page, name: string): Promise<void> {
  if (!EVIDENCE_DIR) return;
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `eigent-att-${name}.png`),
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

// Node-side edge calls: they cross-check the app's work from the product's own
// record, and staying off the renderer keeps them out of its network audit.
async function edgeFetch(method: string, pathname: string): Promise<Response> {
  return fetch(`${edgeBaseUrl}${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${bootstrap!.api_key}` },
  });
}

/**
 * The Project the app itself created for a question, found by the title the
 * bridge derives from it. Polled because the create happens inside the app
 * after the send, not before it.
 */
async function findProjectByTitle(nonce: string): Promise<string> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const response = await edgeFetch('GET', '/projects');
    if (response.ok) {
      const page = (await response.json()) as {
        projects?: { project: { project_id: string; title: string } }[];
      };
      const hit = (page.projects ?? []).find((entry) =>
        entry.project.title.includes(nonce)
      );
      if (hit) return hit.project.project_id;
    }
    if (Date.now() > deadline) {
      throw new Error(`no project titled with ${nonce} appeared on the edge`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

/**
 * The Project's own trajectory, read until the first terminal kind: the event
 * kinds in arrival order. The ORDER is load-bearing — an upload's
 * artifact_created precedes the first run_accepted, and nothing else can put
 * an artifact there before a run exists.
 */
async function collectKinds(projectId: string): Promise<string[]> {
  const kinds: string[] = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TERMINAL_TIMEOUT_MS);
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
      if (done) return kinds;
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
        const kind = (JSON.parse(data) as { kind: string }).kind;
        kinds.push(kind);
        if (TERMINAL_KINDS.includes(kind)) return kinds;
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return kinds;
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function listArtifacts(projectId: string): Promise<EdgeArtifact[]> {
  const response = await edgeFetch(
    'GET',
    `/projects/${encodeURIComponent(projectId)}/artifacts`
  );
  if (!response.ok) {
    throw new Error(`listArtifacts: ${response.status}`);
  }
  return ((await response.json()) as { artifacts?: EdgeArtifact[] })
    .artifacts ?? [];
}

/** Whether an upload's signature — publish before any run — is in the kinds. */
function uploadPrecedesFirstRun(kinds: string[]): boolean {
  const firstRun = kinds.indexOf('run_accepted');
  const firstArtifact = kinds.indexOf('artifact_created');
  return firstArtifact >= 0 && (firstRun < 0 || firstArtifact < firstRun);
}

test('a composer attachment reaches the run as a published artifact', async () => {
  test.skip(
    !bootstrap || !edgeReady || !APP_BUILT,
    'eigent-local stack not running or app not built'
  );
  test.skip(
    !attachmentsServed,
    'this stack predates the attachment route (edge API < 1.16)'
  );
  test.skip(
    process.env.EIGENT_E2E_FIXTURE_PICKER !== '1',
    'needs the fixture-picker stack (EIGENT_LOCAL_FIXTURE_PICKER=1 up + EIGENT_E2E_FIXTURE_PICKER=1)'
  );
  test.setTimeout(300_000);
  const stamp = Date.now();
  const fileName = `receipt-${stamp}.png`;
  const filePath = path.join(workDir, fileName);
  fs.writeFileSync(filePath, PNG_BYTES);
  const fileSha = crypto.createHash('sha256').update(PNG_BYTES).digest('hex');
  const attachNonce = `att-e2e-${stamp}`;
  const controlNonce = `att-ctl-${stamp}`;
  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
    model_alias: MODEL_ALIAS,
    file_name: fileName,
    file_sha256: fileSha,
  };

  const { app, page } = await launchApp();
  const networkUrls: string[] = [];
  page.on('request', (request) => networkUrls.push(request.url()));
  await stubFileDialog(app, filePath);

  try {
    // ---- The attached turn ----
    const composer = await newSpaceComposer(page);
    await typeIntoComposer(
      page,
      composer,
      `Describe the attached file. ${attachNonce}`
    );
    await page
      .getByRole('button', { name: 'Add files or photos' })
      .first()
      .click();
    // The chip is the user-visible receipt that the pick landed on the task.
    await expect(page.getByText(fileName).first()).toBeVisible({
      timeout: 15_000,
    });
    await screenshot(page, 'chip');
    await composer.press('Enter');

    const projectId = await findProjectByTitle(attachNonce);
    summary.project_id = projectId;
    const kinds = await collectKinds(projectId);
    summary.terminal = kinds[kinds.length - 1];
    expect(summary.terminal).toBe('run_completed');
    // Publish-before-any-run is the trajectory signature only an attachment
    // upload can leave.
    expect(uploadPrecedesFirstRun(kinds), kinds.join(',')).toBe(true);

    const artifacts = await listArtifacts(projectId);
    const uploaded = artifacts.filter((a) => a.name === fileName);
    expect(uploaded).toHaveLength(1);
    // The bytes on the edge are the bytes on disk — same hash, same size —
    // so the IPC read, the base64 ride and the CAS publish were all lossless.
    expect(uploaded[0].sha256).toBe(fileSha);
    expect(Number(uploaded[0].size_bytes)).toBe(PNG_BYTES.length);
    expect(uploaded[0].media_type).toBe('image/png');
    expect(uploaded[0].version).toBe(1);
    summary.uploaded_artifact_id = uploaded[0].artifact_id;
    summary.project_artifacts = artifacts.length;
    await screenshot(page, 'settled');

    // ---- Negative control: a plain turn leaves no upload behind ----
    // A fixture run publishes its own scripted artifacts, so the control is
    // the SIGNATURE and the NAME, not an empty list.
    const controlComposer = await newSpaceComposer(page);
    await typeIntoComposer(
      page,
      controlComposer,
      `Answer briefly with no files. ${controlNonce}`
    );
    await controlComposer.press('Enter');
    const controlProject = await findProjectByTitle(controlNonce);
    summary.control_project_id = controlProject;
    const controlKinds = await collectKinds(controlProject);
    summary.control_terminal = controlKinds[controlKinds.length - 1];
    expect(summary.control_terminal).toBe('run_completed');
    expect(
      uploadPrecedesFirstRun(controlKinds),
      controlKinds.join(',')
    ).toBe(false);
    const controlArtifacts = await listArtifacts(controlProject);
    expect(controlArtifacts.filter((a) => a.name === fileName)).toEqual([]);
    summary.control_artifacts = controlArtifacts.length;

    const offEdge = auditEdgeOnly(networkUrls, new URL(edgeBaseUrl!).origin);
    expect(offEdge).toEqual([]);
    // An empty off-edge set is vacuous unless the renderer made requests.
    expect(
      networkUrls.filter((u) => /^https?:/.test(u)).length
    ).toBeGreaterThan(0);
    summary.off_edge_requests = offEdge;
    writeEvidence('eigent-att-summary.json', summary);
  } finally {
    await app.close();
  }
});
