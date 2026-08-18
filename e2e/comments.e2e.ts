// Comment-loop desktop E2E: the REAL desktop app in remote-backend mode
// against the eigent-local Compose edge, asserting the A4 claim — a comment
// left on a published artifact travels with the revision request, the run
// that republishes the name settles it, and the rail renders the whole
// lifecycle honestly.
//
// The driver is the `aion-comments` fixture (comment-sequence): the first
// command publishes findings.md, and the revision branch is gated on the
// comment block the ops worker inlines for a command carrying comment_ids.
// That gate is the load-bearing proof: if the ids do not travel from the rail
// through submitCommand into the worker's resolveComments, the fixture never
// edits, no second version publishes, and the `addressed` flip this spec
// waits for never happens.
//
// The second claim is the anchor model. A comment quotes text plus context;
// on a newer version the client relocates the quote at read time. The fixture
// edit replaces the one line the dismissed comment quotes ("status: draft"),
// so after the revision that comment — reopened against v2 — must render
// STALE rather than pointing somewhere wrong, while the settled comment's
// text survived. addressed is terminal in both directions, so its row offers
// no actions at all.
//
// Needs the stack in fixture-picker mode:
//   EIGENT_LOCAL_FIXTURE_PICKER=1 bazel run //dev/eigent_local:up   (in aion-v1)
//   EIGENT_E2E_FIXTURE_PICKER=1 npx playwright test --config e2e/playwright.config.ts comments
//
// The desktop API key comes from the gitignored run manifest and rides ONLY
// the env of the launched app — never a committed file or evidence output.

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

/** fakeroute comment-sequence: publish findings.md, edit it on a revision. */
const COMMENTS_ALIAS = 'aion-comments';

const DOC = 'findings.md';
/** Survives the fixture's revision edit — its comment settles addressed. */
const SURVIVING_WORD = 'alpha';
/** Replaced by the edit ("status: draft" → "status: final") — goes stale. */
const DELETED_WORD = 'draft';

const TURN_TIMEOUT_MS = 240_000;
const VIDEO_SIZE = { width: 1280, height: 800 };
const MIN_VIDEO_BYTES = 200 * 1024;

interface Bootstrap {
  api_key: string;
  edge_url: string;
  tenant_id: string;
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
let workDir: string;
let keyFile: string;

test.beforeAll(async () => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-comments-'));
  if (bootstrap && edgeBaseUrl) {
    try {
      const response = await fetch(`${edgeBaseUrl}/status`, {
        signal: AbortSignal.timeout(3_000),
      });
      edgeReady = response.ok;
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
  if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  if (packaged) fs.rmSync(packaged.installDir, { recursive: true, force: true });
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

async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const extra = {
    EIGENT_REMOTE_BACKEND_URL: edgeBaseUrl!,
    EIGENT_REMOTE_BACKEND_API_KEY_FILE: keyFile,
    EIGENT_REMOTE_BACKEND_API_KEY: '',
  };
  const recordVideo = EVIDENCE_DIR
    ? { dir: path.join(EVIDENCE_DIR, 'video'), size: VIDEO_SIZE }
    : undefined;
  const app = await electron.launch(
    packaged
      ? {
          executablePath: packaged.executablePath,
          args: [],
          env: launchEnv(extra),
          recordVideo,
        }
      : { args: [REPO_ROOT], cwd: REPO_ROOT, env: launchEnv(extra), recordVideo }
  );
  return { app, page: await findMainWindow(app) };
}

async function screenshot(page: Page, name: string): Promise<void> {
  if (!EVIDENCE_DIR) return;
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `eigent-comments-${name}.png`),
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

function isPresignedFetch(raw: string): boolean {
  try {
    const url = new URL(raw);
    return [...url.searchParams.keys()].some((key) =>
      /^x-(amz|goog)-signature$/i.test(key)
    );
  } catch {
    return false;
  }
}

function auditEdgeOnly(urls: string[], origin: string): string[] {
  return urls
    .filter((u) => /^https?:/.test(u))
    .filter((u) => !u.startsWith(origin))
    .filter((u) => !isPresignedFetch(u));
}

async function pinAlias(page: Page, alias: string): Promise<void> {
  await page.evaluate((selectedAlias) => {
    localStorage.setItem(
      'aion-model-store',
      JSON.stringify({ state: { selectedAlias }, version: 0 })
    );
  }, alias);
  await page.reload();
}

/** A fresh Space, so the turn is its own project and its own trajectory. */
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

async function waitForTurnSettled(page: Page): Promise<void> {
  const busy = page.locator('[role="textbox"][contenteditable="false"]');
  await busy
    .first()
    .waitFor({ state: 'attached', timeout: 120_000 })
    .catch(() => {});
  await expect(busy).toHaveCount(0, { timeout: TURN_TIMEOUT_MS });
}

async function runTurn(page: Page, prompt: string): Promise<void> {
  const composer = await newSpace(page);
  await composer.click();
  await page.keyboard.insertText(prompt);
  await composer.press('Enter');
  await waitForTurnSettled(page);
}

/**
 * Selects one word in the rendered markdown and fires the mouseup the viewer
 * listens on. A real double-click selects whatever word sits at the element's
 * geometric center, which is not necessarily the word under test — building
 * the Range and dispatching the bubbling mouseup is the deterministic way to
 * hand the viewer exactly this selection.
 */
async function selectWord(page: Page, word: string): Promise<void> {
  await page.evaluate((target) => {
    const container = document.querySelector('[data-artifact-markdown="1"]');
    if (!container) throw new Error('markdown container not rendered');
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let hit: { node: Text; index: number } | null = null;
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const index = (node.textContent ?? '').indexOf(target);
      if (index >= 0) {
        hit = { node, index };
        break;
      }
    }
    if (!hit) throw new Error(`word not rendered: ${target}`);
    const range = document.createRange();
    range.setStart(hit.node, hit.index);
    range.setEnd(hit.node, hit.index + target.length);
    const selection = window.getSelection();
    if (!selection) throw new Error('no selection API');
    selection.removeAllRanges();
    selection.addRange(range);
    container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, word);
}

async function createComment(
  page: Page,
  word: string | null,
  body: string
): Promise<void> {
  if (word !== null) {
    await selectWord(page, word);
    await expect(page.locator('[data-comment-target="1"]')).toContainText(
      word
    );
  }
  const composer = page.locator('[data-comment-composer="1"]');
  await composer.fill(body);
  await page.locator('[data-comment-submit="1"]').click();
  await expect(
    page.locator('[data-comment-row]', { hasText: body })
  ).toBeVisible({ timeout: 30_000 });
}

test('a comment travels with the revision, settles addressed, and a deleted quote goes stale', async () => {
  test.skip(
    process.env.EIGENT_E2E_FIXTURE_PICKER !== '1',
    'needs the fixture-picker stack (EIGENT_LOCAL_FIXTURE_PICKER=1 up + EIGENT_E2E_FIXTURE_PICKER=1)'
  );
  test.skip(
    !bootstrap || !edgeReady || !APP_BUILT,
    'eigent-local stack not running or app not built'
  );
  test.setTimeout(600_000);

  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
    comments_alias: COMMENTS_ALIAS,
  };
  const { app, page } = await launchApp();
  const video = page.video();
  let bodyFailed = false;
  const networkUrls: string[] = [];
  page.on('request', (request) => networkUrls.push(request.url()));

  try {
    await page
      .locator('[role="textbox"]')
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 });

    await pinAlias(page, COMMENTS_ALIAS);
    await runTurn(page, 'draft the findings document');
    await screenshot(page, '01-run-settled');

    // ---- Open the published document in the viewer. ----------------------
    await page
      .locator(`[data-artifact-card="${DOC}"]`)
      .first()
      .getByRole('button', { name: 'Open' })
      .click();
    await expect(page.locator('[data-artifact-lane="markdown"]')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('[data-artifact-ready="1"]')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('[data-artifact-lane]')).toHaveAttribute(
      'data-artifact-version',
      '1'
    );

    // ---- The comment rail opens: the edge negotiated comment support. ----
    // The toggle only renders when the mode probe passed the 1.21 floor, so
    // its presence is itself the compat assertion.
    await page.locator('[data-comment-toggle="1"]').click();
    await expect(page.locator('[data-comment-rail="1"]')).toBeVisible();

    // ---- Two anchored comments, each on a selected word. -----------------
    await createComment(
      page,
      SURVIVING_WORD,
      'Strengthen the alpha finding with a citation.'
    );
    await createComment(page, DELETED_WORD, 'This should not still be draft.');
    const rowA = page.locator('[data-comment-row]', {
      hasText: 'Strengthen the alpha finding',
    });
    const rowB = page.locator('[data-comment-row]', {
      hasText: 'not still be draft',
    });
    await expect(rowA).toHaveAttribute('data-comment-status', 'open');
    await expect(rowA).toHaveAttribute('data-comment-anchor', 'located');
    await expect(rowB).toHaveAttribute('data-comment-status', 'open');
    await expect(rowB).toHaveAttribute('data-comment-anchor', 'located');
    await expect(page.locator('[data-comment-rail="1"]')).toHaveAttribute(
      'data-comment-open-count',
      '2'
    );
    await screenshot(page, '02-two-open-comments');

    // ---- Dismiss one: the caller's reversible move. -----------------------
    // A dismissed comment is NOT collected by the revision request, which is
    // what keeps it open-able later as the stale control.
    await rowB.locator('[data-comment-dismiss="1"]').click();
    await expect(rowB).toHaveAttribute('data-comment-status', 'dismissed', {
      timeout: 30_000,
    });
    await expect(page.locator('[data-comment-rail="1"]')).toHaveAttribute(
      'data-comment-open-count',
      '1'
    );

    // ---- Request the revision. --------------------------------------------
    // The turn goes through the chat store, so the request is a visible user
    // bubble in the conversation, not an invisible side channel.
    await page.locator('[data-request-revision="1"]').click();
    await expect(
      page.getByText(`Please revise the artifact "${DOC}"`, { exact: false })
    ).toBeVisible({ timeout: 60_000 });
    await waitForTurnSettled(page);
    await screenshot(page, '03-revision-settled');

    // ---- The comment settled ADDRESSED. -----------------------------------
    // The fixture only edits when the worker inlined the comment block, and
    // settlement only names comments the command carried — so this flip IS
    // the proof that the id traveled rail → command → worker → settle.
    await expect(rowA).toHaveAttribute('data-comment-status', 'addressed', {
      timeout: 60_000,
    });
    // addressed is earned by the republish and terminal in both directions:
    // the row takes no actions at all.
    await expect(rowA.locator('[data-comment-dismiss="1"]')).toHaveCount(0);
    await expect(rowA.locator('[data-comment-reopen="1"]')).toHaveCount(0);
    summary.settled_addressed = true;

    // ---- The revision published a second version of the same name. --------
    const versionSelect = page.locator('[data-artifact-version-select="1"]');
    await expect(versionSelect.locator('option')).toHaveCount(2, {
      timeout: 60_000,
    });
    const newest = await versionSelect
      .locator('option')
      .first()
      .getAttribute('value');
    await versionSelect.selectOption(newest!);
    await expect(page.locator('[data-artifact-ready="1"]')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('[data-artifact-lane]')).toHaveAttribute(
      'data-artifact-version',
      '2'
    );
    await expect(page.locator('[data-artifact-markdown="1"]')).toContainText(
      'status: final'
    );

    // ---- Negative control: the reopened comment is STALE on v2. -----------
    // Its quote was the line the edit replaced. Relocation must refuse to
    // guess — stale against its original version, never mis-anchored.
    await rowB.locator('[data-comment-reopen="1"]').click();
    await expect(rowB).toHaveAttribute('data-comment-status', 'open', {
      timeout: 30_000,
    });
    await expect(rowB).toHaveAttribute('data-comment-anchor', 'stale');
    // The surviving comment's quote still locates, version-spanning: it was
    // created on v1 and relocates cleanly against the v2 text on screen.
    summary.stale_control = true;
    await screenshot(page, '04-stale-on-v2');

    // ---- The app talked to nothing but its own edge. -----------------------
    const offEdge = auditEdgeOnly(networkUrls, new URL(edgeBaseUrl!).origin);
    summary.off_edge_requests = offEdge;
    expect(offEdge).toEqual([]);
  } catch (error) {
    bodyFailed = true;
    throw error;
  } finally {
    // The recording only flushes when the app closes, so the video resolves
    // after teardown and before the summary that reports it.
    await app.close();
    let videoBytes = 0;
    let videoName: string | null = null;
    const recorded = await video?.path().catch(() => undefined);
    if (recorded && EVIDENCE_DIR && fs.existsSync(recorded)) {
      videoName = 'comments-e2e-run.webm';
      fs.copyFileSync(recorded, path.join(EVIDENCE_DIR, videoName));
      videoBytes = fs.statSync(recorded).size;
    }
    summary.video = videoName;
    summary.video_bytes = videoBytes;
    writeEvidence('comments-summary.json', summary);
    // Only when the run itself passed: a missing recording must never be
    // what gets reported for a run that failed on its own terms.
    if (!bodyFailed && EVIDENCE_DIR) {
      expect(videoBytes, 'the run was not recorded').toBeGreaterThan(
        MIN_VIDEO_BYTES
      );
    }
  }
});
