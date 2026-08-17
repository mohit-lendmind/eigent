// Human-browser desktop E2E: the in-app preview browser is a HUMAN surface —
// the user opens it, drives it to a page, and hands what they see to the run
// as attachments on their own next turn. The agent never touches this browser
// (ADR-022): its browser lives in the pod, and the only thing that crosses
// the boundary here is captured bytes on a user turn.
//
// The suite drives that whole handoff through the real UI: a first plain turn
// (the preview toggle only exists once a task has messages), open the preview
// panel, choose the Browser view, navigate to a page served by THIS test on
// 127.0.0.1, attach the page text and a screenshot via the toolbar, and send a
// second turn. Then it verifies from the product's own record:
//   - both captures are published artifacts whose sha256/size match the files
//     the capture IPC wrote on disk (text additionally contains the page's
//     nonce — the capture is of OUR page, not of anything else);
//   - their artifact_created events sit BETWEEN the first run's terminal and
//     the second run_accepted — the second-turn handoff signature (and the
//     first-turn upload signature is absent, so the check isn't vacuous);
//   - the fixture server saw no hits beyond the human's own navigation, and
//     the renderer never fetched the fixture origin — the page crossed as
//     bytes over IPC, and nothing in the run drove the local browser.
//
// Stack requirements match attachments.e2e.ts (skipped cleanly when absent):
//   EIGENT_LOCAL_FIXTURE_PICKER=1 bazel run //dev/eigent_local:up   (in aion-v1)
//   EIGENT_E2E_FIXTURE_PICKER=1 npx playwright test --config e2e/playwright.config.ts human-browser

import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
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

const MODEL_ALIAS = process.env.EIGENT_E2E_MODEL ?? 'aion-default';

const PAGE_TITLE = 'Preview Capture Fixture';
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

/** Event kinds in arrival order; artifact_created rows keep their name. */
interface TrajectoryEvent {
  kind: string;
  artifactName?: string;
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
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-hbr-'));
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
        // The upload route the capture rides shipped in 1.16.0.
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

/** A fresh Space, so the scenario gets its own Project on the edge. */
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
    path: path.join(EVIDENCE_DIR, `eigent-hbr-${name}.png`),
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

// Everything HTTP the renderer touched must stay on the edge origin. The
// preview browser's page loads live in a separate guest webContents and must
// never show up here at all.
function auditEdgeOnly(urls: string[], origin: string): string[] {
  return urls
    .filter((u) => /^https?:/.test(u))
    .filter((u) => !u.startsWith(origin));
}

async function edgeFetch(method: string, pathname: string): Promise<Response> {
  return fetch(`${edgeBaseUrl}${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${bootstrap!.api_key}` },
  });
}

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
 * The Project's trajectory until the Nth terminal kind, keeping each
 * artifact_created event's artifact name so upload events are addressable by
 * the one thing only an upload controls.
 */
async function collectEvents(
  projectId: string,
  terminals: number
): Promise<TrajectoryEvent[]> {
  const events: TrajectoryEvent[] = [];
  let seen = 0;
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
      if (done) return events;
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
        const parsed = JSON.parse(data) as {
          kind: string;
          data?: { artifact?: { name?: string } };
        };
        events.push({
          kind: parsed.kind,
          ...(parsed.kind === 'artifact_created' &&
          typeof parsed.data?.artifact?.name === 'string'
            ? { artifactName: parsed.data.artifact.name }
            : {}),
        });
        if (TERMINAL_KINDS.includes(parsed.kind)) {
          seen++;
          if (seen >= terminals) return events;
        }
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return events;
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

/** Whether an upload's first-turn signature — publish before any run — holds. */
function uploadPrecedesFirstRun(events: TrajectoryEvent[]): boolean {
  const kinds = events.map((e) => e.kind);
  const firstRun = kinds.indexOf('run_accepted');
  const firstArtifact = kinds.indexOf('artifact_created');
  return firstArtifact >= 0 && (firstRun < 0 || firstArtifact < firstRun);
}

function sha256File(filePath: string): string {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

// The attach dropdown re-arms asynchronously after a capture (the trigger is
// disabled while attaching and the closing menu is still unmounting), so a
// click that lands in that window toggles nothing. Retry the open until the
// requested item is actually mounted — the same verify-and-retry contract
// typeIntoComposer uses.
async function chooseAttach(page: Page, itemTestId: string): Promise<void> {
  const item = page.getByTestId(itemTestId);
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.getByTestId('browser-attach-page').click();
    try {
      await item.waitFor({ state: 'visible', timeout: 3_000 });
      await item.click();
      return;
    } catch {
      // menu never mounted — re-open
    }
  }
  throw new Error(`attach menu never offered ${itemTestId}`);
}

/** The one file under dir written after `since` whose name ends with suffix. */
function newestBySuffix(dir: string, suffix: string, since: number): string {
  const hits = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(suffix))
    .map((name) => path.join(dir, name))
    .filter((p) => fs.statSync(p).mtimeMs >= since)
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (hits.length === 0) {
    throw new Error(`no ${suffix} file newer than the test start in ${dir}`);
  }
  return hits[0];
}

test('a human-driven browser capture crosses into the run as attachments', async () => {
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
  const startedAt = Date.now();
  const stamp = startedAt;
  const setupNonce = `hbr-e2e-${stamp}`;
  const handoffNonce = `hbr-hand-${stamp}`;
  const pageFact = `capture-fact-${stamp}`;

  // The page the human browses: served by this test on loopback, carrying a
  // fact that exists nowhere else — finding it in the published text artifact
  // proves the capture is of this page.
  const guestHits: string[] = [];
  const server = http.createServer((req, res) => {
    guestHits.push(`${req.method} ${req.url}`);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><html><head><title>${PAGE_TITLE}</title></head>` +
        `<body><h1>${PAGE_TITLE}</h1><p>The recorded fact is ${pageFact}.</p></body></html>`
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('fixture server has no port');
  }
  const fixtureOrigin = `http://127.0.0.1:${address.port}`;
  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
    model_alias: MODEL_ALIAS,
    fixture_origin: fixtureOrigin,
    page_fact: pageFact,
  };

  const networkUrls: string[] = [];
  let app: ElectronApplication | undefined;
  try {
    const launched = await launchApp();
    app = launched.app;
    const page = launched.page;
    page.on('request', (request) => networkUrls.push(request.url()));

    // ---- Turn 1: a plain turn, because the preview toggle only renders on a
    // task that already has messages. Also the negative half of the ordering
    // signature: no artifact exists before this run.
    const composer = await newSpaceComposer(page);
    await typeIntoComposer(page, composer, `Say ready. ${setupNonce}`);
    await composer.press('Enter');
    const projectId = await findProjectByTitle(setupNonce);
    summary.project_id = projectId;
    const firstTurn = await collectEvents(projectId, 1);
    expect(firstTurn[firstTurn.length - 1]?.kind).toBe('run_completed');

    // ---- The human opens the preview browser and drives it to the page.
    const toggle = page.getByRole('button', { name: 'Toggle window preview' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await screenshot(page, 'chooser');
    await page
      .getByRole('button')
      .filter({ hasText: 'Open and navigate web pages' })
      .first()
      .click();
    const addressBar = page.getByRole('textbox', { name: 'Enter a URL' });
    await addressBar.fill(`${fixtureOrigin}/`);
    await addressBar.press('Enter');
    // The tab strip echoes the guest's <title> once the page load lands —
    // the guest itself lives outside the renderer DOM.
    await expect(page.getByText(PAGE_TITLE).first()).toBeVisible({
      timeout: 30_000,
    });
    expect(guestHits.length).toBeGreaterThan(0);
    await screenshot(page, 'browsed');

    // ---- Capture-and-attach: page text, then a screenshot.
    await chooseAttach(page, 'browser-attach-text');
    await expect(page.getByText('127.0.0.1.txt').first()).toBeVisible({
      timeout: 15_000,
    });
    await chooseAttach(page, 'browser-attach-screenshot');
    const shotChip = page
      .getByText(/^page-\d{8}-\d{6}-[0-9a-f]{8}\.jpg$/)
      .first();
    await expect(shotChip).toBeVisible({ timeout: 15_000 });
    const shotName = (await shotChip.innerText()).trim();
    summary.screenshot_name = shotName;
    await screenshot(page, 'chips');
    const hitsAfterCapture = guestHits.length;

    // The files the capture IPC wrote are the ground truth the edge rows must
    // reproduce byte-for-byte.
    const tempDir = (await app.evaluate(({ app: electronApp }) =>
      electronApp.getPath('temp')
    )) as string;
    const textPath = newestBySuffix(
      path.join(tempDir, 'eigent-pasted'),
      '-127.0.0.1.txt',
      startedAt
    );
    const textBytes = fs.readFileSync(textPath);
    expect(textBytes.toString('utf-8')).toContain(pageFact);
    const shotPath = path.join(tempDir, 'eigent-captures', shotName);
    const shotBytes = fs.readFileSync(shotPath);
    // JPEG SOI marker: the capture produced an actual image, not an error blob.
    expect(shotBytes[0]).toBe(0xff);
    expect(shotBytes[1]).toBe(0xd8);

    // ---- Turn 2: the handoff — both captures ride this send.
    const sessionComposer = page
      .locator('[role="textbox"][contenteditable="true"]')
      .first();
    await typeIntoComposer(
      page,
      sessionComposer,
      `Use the attached captures. ${handoffNonce}`
    );
    await sessionComposer.press('Enter');

    const events = await collectEvents(projectId, 2);
    const kinds = events.map((e) => e.kind);
    summary.terminal = kinds[kinds.length - 1];
    expect(summary.terminal).toBe('run_completed');
    expect(kinds.filter((k) => k === 'run_accepted')).toHaveLength(2);
    // Second-turn handoff signature: both captures publish AFTER the first
    // run settles and BEFORE the second run is admitted. The first-turn
    // upload signature must be absent — this project started with a plain turn.
    expect(uploadPrecedesFirstRun(events), kinds.join(',')).toBe(false);
    const firstTerminal = kinds.indexOf('run_completed');
    const secondRun = kinds.indexOf('run_accepted', firstTerminal + 1);
    expect(secondRun).toBeGreaterThan(firstTerminal);
    for (const name of ['127.0.0.1.txt', shotName]) {
      const at = events.findIndex((e) => e.artifactName === name);
      expect(at, `artifact_created for ${name} in ${kinds.join(',')}`)
        .toBeGreaterThan(firstTerminal);
      expect(at).toBeLessThan(secondRun);
    }

    // ---- The published bytes are the captured bytes.
    const artifacts = await listArtifacts(projectId);
    const text = artifacts.filter((a) => a.name === '127.0.0.1.txt');
    expect(text).toHaveLength(1);
    expect(text[0].sha256).toBe(sha256File(textPath));
    expect(Number(text[0].size_bytes)).toBe(textBytes.length);
    expect(text[0].media_type).toBe('text/plain');
    expect(text[0].version).toBe(1);
    const shot = artifacts.filter((a) => a.name === shotName);
    expect(shot).toHaveLength(1);
    expect(shot[0].sha256).toBe(sha256File(shotPath));
    expect(Number(shot[0].size_bytes)).toBe(shotBytes.length);
    expect(shot[0].media_type).toBe('image/jpeg');
    expect(shot[0].version).toBe(1);
    summary.text_artifact_id = text[0].artifact_id;
    summary.screenshot_artifact_id = shot[0].artifact_id;
    await screenshot(page, 'settled');

    // ---- ADR-022 controls: nothing in the run drove this browser. The
    // fixture server saw only the human's own navigation, and the renderer
    // never fetched the fixture origin — the page crossed as bytes over IPC.
    expect(guestHits.length).toBe(hitsAfterCapture);
    summary.guest_hits = guestHits;
    expect(networkUrls.filter((u) => u.startsWith(fixtureOrigin))).toEqual([]);
    const offEdge = auditEdgeOnly(networkUrls, new URL(edgeBaseUrl!).origin);
    expect(offEdge).toEqual([]);
    // An empty off-edge set is vacuous unless the renderer made requests.
    expect(
      networkUrls.filter((u) => /^https?:/.test(u)).length
    ).toBeGreaterThan(0);
    summary.off_edge_requests = offEdge;
    writeEvidence('eigent-hbr-summary.json', summary);
  } finally {
    try {
      await app?.close();
    } finally {
      server.close();
    }
  }
});
