// Real-model parity: one session that remembers something, uses it in a run
// that cannot have seen it, produces a file, and finds all of it on screen.
//
// Two Spaces are two aion Projects, which is what makes the recall a claim
// rather than a coincidence. The fact is a random token written in the first
// Project and read back in the second, and the second Project's session shares
// no conversation history with the first — memory is scoped to the profile, so
// the token can only have come out of the memory store. A follow-up turn in the
// same Project would have proven nothing: the model could read the token off
// its own transcript.
//
// The artifact is produced by the same recall run, so the two halves are one
// task the way a user would give it: look up what you stored, write it to a
// file. Nothing host-side observes that write — the managed cell wires no
// FileStore — so the artifact exists only because the sandbox publishes the pod
// file and the ops worker harvests it.
//
// The negative control is the first Project: it wrote a memory and no file, and
// it must list ZERO artifacts, on the edge and on screen. A surface that always
// draws rows would pass everything above and fail here.
//
// The two Spaces are also asserted as Spaces: each run is submitted from one
// the user just created, so each Project must come back filed under a DIFFERENT
// aion Space. A desktop that only minted Spaces in its own renderer would still
// pass every assertion above and fail this one.
//
// Run: npx playwright test --config e2e/eval.config.ts parity
// Env: EIGENT_EVAL_MODEL / EIGENT_EVAL_MODEL_LABEL pick the catalog row;
//      EIGENT_E2E_PACKAGED_APP records the SHIPPING artifact instead of the
//      dev build, which is what the recording is supposed to show.
// Output: EIGENT_EVAL_DIR (default ../n7-evidence/playwright/real-model).

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
const BOOTSTRAP_PATH =
  process.env.EIGENT_E2E_BOOTSTRAP ??
  path.resolve(REPO_ROOT, '../aion-v1/deploy/eigent-local/run/bootstrap.json');
const OUT_DIR =
  process.env.EIGENT_EVAL_DIR ??
  path.resolve(REPO_ROOT, '..', 'n7-evidence', 'playwright', 'real-model');
const PACKAGED_SOURCE = process.env.EIGENT_E2E_PACKAGED_APP;

const MODEL_ALIAS = process.env.EIGENT_EVAL_MODEL ?? 'kimi-k3';
const MODEL_LABEL = process.env.EIGENT_EVAL_MODEL_LABEL ?? 'Kimi K3';

const VIDEO_SIZE = { width: 1280, height: 800 };
// A recording that never started is a few KB of container; a recorded run is
// megabytes. The floor separates the two without pinning a duration.
const MIN_VIDEO_BYTES = 200 * 1024;
const ANSWER_TIMEOUT_MS = 8 * 60_000;
// The trajectory read is also the wait: the stream blocks until the run's
// terminal event arrives, so it must outlast a real tool loop.
const TRAJECTORY_WINDOW_MS = ANSWER_TIMEOUT_MS;
// The harvest runs after the run settles: bytes into the CAS, then the public
// artifact_created event. The list is polled rather than read once.
const ARTIFACT_TIMEOUT_MS = 90_000;
// Filing follows the create rather than riding it: CreateProjectRequest
// carries only a title and an alias.
const FILING_TIMEOUT_MS = 60_000;

const TERMINAL_KINDS = ['run_completed', 'run_failed', 'run_cancelled'];

/**
 * Lowercase phrases inside a tool_result body that mean the call did not do
 * what it settled as having done — a missing interpreter, a rejected tool
 * name, an unwritable path. Every one of these arrives inside a SUCCESSFUL
 * tool_result, which is why reading the terminal alone is not enough.
 */
const FAILURE_MARKERS = [
  'exit status 127',
  'command not found',
  'unknown tool',
  'no such file or directory',
  'permission denied',
  'read-only file system',
];

interface Bootstrap {
  api_key: string;
  edge_url: string;
  tenant_id: string;
}

interface EdgeEvent {
  kind: string;
  sequence: string;
  data?: Record<string, unknown>;
}

interface MemoryDoc {
  scope: string;
  key: string;
  bytes: string;
  content?: string;
}

interface Artifact {
  artifact_id: string;
  name: string;
  media_type: string;
  size_bytes: string;
  version: number;
}

const bootstrap: Bootstrap = JSON.parse(
  fs.readFileSync(BOOTSTRAP_PATH, 'utf-8')
);
const edgeBaseUrl = `${bootstrap.edge_url.replace(/\/+$/, '')}/eigent/v1`;

const RUN_TAG = `n7-${Date.now().toString(36)}`;
// A random token: the model cannot produce it in the second Project without
// having read it back, and it cannot be quoted from that Project's own prompt.
const SECRET = `PARITY-${RUN_TAG.toUpperCase()}-${Math.random()
  .toString(36)
  .slice(2, 8)
  .toUpperCase()}`;
const MEMORY_KEY = `parity-codename-${RUN_TAG}`;
const ARTIFACT_NAME = `parity-${RUN_TAG}.md`;

// The title the desktop sends is the first 120 characters of the prompt, so
// each prompt opens with its own tag and the Projects screen row is findable
// by a string this test chose.
const WRITE_PROMPT =
  `[${RUN_TAG}-remember] Use your memory tool to store the value ${SECRET} ` +
  `under the key ${MEMORY_KEY}. Do not create any files. When the memory is ` +
  `written, reply with the single word STORED.`;
const RECALL_PROMPT =
  `[${RUN_TAG}-recall] Read the key ${MEMORY_KEY} from your memory. Then use ` +
  `the write_file tool to create ${ARTIFACT_NAME} in the workspace whose only ` +
  `line is the value you read. Finally reply with that value on its own line.`;

let packaged: PackagedInstall | null = null;

function writeOut(name: string, body: string): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (body.includes(bootstrap.api_key)) {
    throw new Error(`${name} would leak an API key`);
  }
  fs.writeFileSync(path.join(OUT_DIR, name), body);
}

async function screenshot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(OUT_DIR, `${name}.png`),
    fullPage: true,
  });
}

async function edgeFetch(method: string, pathname: string): Promise<Response> {
  return fetch(`${edgeBaseUrl}${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${bootstrap.api_key}` },
  });
}

async function listMemory(): Promise<MemoryDoc[]> {
  const response = await edgeFetch('GET', '/memory');
  expect(response.status, 'the memory listing must be served').toBe(200);
  return ((await response.json()) as { docs?: MemoryDoc[] }).docs ?? [];
}

async function listArtifacts(projectId: string): Promise<Artifact[]> {
  const response = await edgeFetch(
    'GET',
    `/projects/${encodeURIComponent(projectId)}/artifacts`
  );
  expect(response.status, 'the artifact listing must be served').toBe(200);
  return ((await response.json()) as { artifacts?: Artifact[] }).artifacts ?? [];
}

/** The aion Space a Project is filed under, polled because filing trails the create. */
async function spaceOfProject(projectId: string): Promise<string | undefined> {
  const deadline = Date.now() + FILING_TIMEOUT_MS;
  for (;;) {
    const response = await edgeFetch(
      'GET',
      `/projects/${encodeURIComponent(projectId)}`
    );
    expect(response.status, 'the project must be readable').toBe(200);
    const snapshot = (await response.json()) as {
      project?: { space_id?: string };
    };
    if (snapshot.project?.space_id) return snapshot.project.space_id;
    if (Date.now() > deadline) return undefined;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

/** Publication trails settlement, so the list is polled up to a deadline. */
async function artifactsWhenPublished(projectId: string): Promise<Artifact[]> {
  const deadline = Date.now() + ARTIFACT_TIMEOUT_MS;
  for (;;) {
    const artifacts = await listArtifacts(projectId);
    if (artifacts.length > 0 || Date.now() > deadline) return artifacts;
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
}

/**
 * The durable trajectory, straight from the edge's SSE replay: the run as the
 * product recorded it, independent of anything the renderer displayed.
 */
async function collectTrajectory(projectId: string): Promise<EdgeEvent[]> {
  const events: EdgeEvent[] = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRAJECTORY_WINDOW_MS);
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
        if (TERMINAL_KINDS.includes(event.kind)) break outer;
      }
    }
  } catch (error) {
    if (!(error instanceof Error && error.name === 'AbortError')) throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return events;
}

function toolNames(events: EdgeEvent[]): string[] {
  return events
    .filter((event) => event.kind === 'tool_call')
    .map((event) => String(event.data?.tool_name ?? ''));
}

function trajectoryText(events: EdgeEvent[]): string {
  return events
    .filter((event) => event.kind === 'text_delta')
    .map((event) => String(event.data?.text ?? ''))
    .join('');
}

/** Settlement green is not result green: scan the bodies that settled fine. */
function inBandFailures(
  events: EdgeEvent[]
): { sequence: string; marker: string }[] {
  const found: { sequence: string; marker: string }[] = [];
  for (const event of events) {
    if (event.kind !== 'tool_result') continue;
    const body = JSON.stringify(event.data ?? {}).toLowerCase();
    for (const marker of FAILURE_MARKERS) {
      if (body.includes(marker)) found.push({ sequence: event.sequence, marker });
    }
  }
  return found;
}

/** The published bytes, through the presigned grant that is the only read. */
async function downloadArtifact(
  projectId: string,
  artifactId: string
): Promise<Buffer> {
  const meta = await edgeFetch(
    'GET',
    `/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(
      artifactId
    )}`
  );
  expect(meta.ok, `artifact ${artifactId} is not downloadable`).toBe(true);
  const grant = (await meta.json()) as { download_url?: string };
  expect(grant.download_url, `artifact ${artifactId} has no grant`).toBeTruthy();
  const bytes = await fetch(grant.download_url!);
  expect(bytes.ok, `the grant for ${artifactId} did not serve`).toBe(true);
  return Buffer.from(await bytes.arrayBuffer());
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
  throw new Error('composer never captured the full prompt');
}

/** A fresh Space, which is what makes the next submission its own Project. */
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
  await composer.waitFor({ state: 'visible', timeout: 60_000 });
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
async function selectModel(page: Page): Promise<void> {
  const trigger = page.getByTestId('aion-model-select');
  await trigger.waitFor({ state: 'visible', timeout: 30_000 });
  await trigger.click();
  await page
    .getByRole('menuitem')
    .filter({ hasText: MODEL_LABEL })
    .first()
    .click();
  await expect(trigger).toHaveAccessibleName(MODEL_LABEL);
}

/** Submits a prompt in a fresh Space and returns the Project it created. */
async function runInNewSpace(page: Page, prompt: string): Promise<string> {
  const composer = await newSpace(page);
  await selectModel(page);
  const createRequest = page.waitForRequest(
    (request) =>
      request.method() === 'POST' && request.url() === `${edgeBaseUrl}/projects`,
    { timeout: 60_000 }
  );
  await typeIntoComposer(page, composer, prompt);
  await composer.press('Enter');
  const response = await (await createRequest).response();
  expect(response?.status()).toBe(201);
  return ((await response!.json()) as { project_id: string }).project_id;
}

/** Opens a Projects row by its title and returns its artifact panel. */
async function openProjectArtifacts(
  page: Page,
  titlePrefix: string
): Promise<ReturnType<Page['locator']>> {
  await page.evaluate(() => {
    window.location.hash = '#/history?tab=home&section=projects';
  });
  await page.reload();
  await expect(page.getByTestId('aion-projects')).toBeVisible({
    timeout: 60_000,
  });
  const row = page
    .getByTestId('aion-project-row')
    .filter({ hasText: titlePrefix })
    .first();
  await row.waitFor({ state: 'visible', timeout: 60_000 });
  if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click();
  const panel = page.getByTestId('aion-artifacts');
  await panel.waitFor({ state: 'visible', timeout: 60_000 });
  return panel;
}

test.beforeAll(() => {
  if (PACKAGED_SOURCE) packaged = installPackagedApp(PACKAGED_SOURCE);
});

test.afterAll(async () => {
  await edgeFetch(
    'DELETE',
    `/memory/${encodeURIComponent(MEMORY_KEY)}`
  ).catch(() => undefined);
  if (packaged) fs.rmSync(packaged.installDir, { recursive: true, force: true });
});

test('a real run remembers, recalls in a new project, produces a file, and shows all of it', async () => {
  test.setTimeout(25 * 60_000);

  // Nothing under this key yet, so the recall below cannot be reading a
  // leftover from an earlier run of this eval.
  expect(
    (await listMemory()).map((doc) => doc.key),
    'the memory key must not pre-exist'
  ).not.toContain(MEMORY_KEY);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-n7-'));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value;
  }
  delete env.VITE_DEV_SERVER_URL;
  env.EIGENT_E2E_USER_DATA = fs.mkdtempSync(path.join(workDir, 'user-data-'));
  env.EIGENT_REMOTE_BACKEND_URL = edgeBaseUrl;
  const keyFile = path.join(workDir, 'edge-api-key');
  fs.writeFileSync(keyFile, bootstrap.api_key, { mode: 0o600 });
  env.EIGENT_REMOTE_BACKEND_API_KEY_FILE = keyFile;
  env.EIGENT_REMOTE_BACKEND_API_KEY = '';

  const videoDir = path.join(OUT_DIR, 'video');
  fs.rmSync(videoDir, { recursive: true, force: true });

  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
    run_tag: RUN_TAG,
    model_alias: MODEL_ALIAS,
    packaged: packaged !== null,
    memory_key: MEMORY_KEY,
    artifact_name: ARTIFACT_NAME,
  };

  const app = await electron.launch({
    ...(packaged
      ? { executablePath: packaged.executablePath, args: [] }
      : { args: [REPO_ROOT], cwd: REPO_ROOT }),
    env,
    recordVideo: { dir: videoDir, size: VIDEO_SIZE },
  });
  let video: ReturnType<Page['video']> = null;
  let bodyFailed = false;
  try {
    const page = await findMainWindow(app);
    video = page.video();
    const requestUrls: string[] = [];
    page.on('request', (request) => requestUrls.push(request.url()));
    await page
      .locator('[role="textbox"]')
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 });

    // ---- The run that remembers. ----
    const writeProject = await runInNewSpace(page, WRITE_PROMPT);
    summary.write_project_id = writeProject;
    // The stream is the wait: it returns when the run settles. Screen text is
    // no signal here — the prompt names the word the model was asked to reply
    // with, so the user's own bubble would satisfy a text assertion.
    const writeEvents = await collectTrajectory(writeProject);
    await screenshot(page, '01-remembered');
    const writeTools = toolNames(writeEvents);
    summary.write_run = {
      terminal: writeEvents.find((e) => TERMINAL_KINDS.includes(e.kind))?.kind,
      tools: writeTools,
      in_band_failures: inBandFailures(writeEvents),
    };
    expect(
      writeEvents.find((e) => TERMINAL_KINDS.includes(e.kind))?.kind
    ).toBe('run_completed');
    expect(
      writeTools.some((name) => name.startsWith('memory_')),
      'the first run never touched a memory tool'
    ).toBe(true);

    // The store's own answer, not the screen's.
    const stored = (await listMemory()).find((doc) => doc.key === MEMORY_KEY);
    expect(stored, `${MEMORY_KEY} is not in the memory scope`).toBeTruthy();
    summary.memory_doc = { key: stored!.key, bytes: stored!.bytes };

    // ---- The run that uses it, in a Project that never saw it written. ----
    const recallProject = await runInNewSpace(page, RECALL_PROMPT);
    summary.recall_project_id = recallProject;
    expect(recallProject).not.toBe(writeProject);
    const recallEvents = await collectTrajectory(recallProject);
    // Here the screen IS a claim: nothing in this Project's prompt or history
    // carries the value, so it can only have been rendered from the answer.
    await expect(page.getByText(SECRET, { exact: false }).first()).toBeVisible({
      timeout: 60_000,
    });
    await screenshot(page, '02-recalled');
    const recallTools = toolNames(recallEvents);
    const recallText = trajectoryText(recallEvents);
    const recallFailures = inBandFailures(recallEvents);
    summary.recall_run = {
      terminal: recallEvents.find((e) => TERMINAL_KINDS.includes(e.kind))?.kind,
      tools: recallTools,
      recalled: recallText.includes(SECRET),
      in_band_failures: recallFailures,
    };
    expect(
      recallFailures,
      'a tool failed inside a settled tool_result'
    ).toEqual([]);
    expect(
      recallEvents.find((e) => TERMINAL_KINDS.includes(e.kind))?.kind
    ).toBe('run_completed');
    // Settlement green is not result green.
    expect(recallText, 'the recall run never produced the stored value').toContain(
      SECRET
    );
    expect(
      recallTools.some((name) => name.startsWith('memory_')),
      'the value appeared without a memory read'
    ).toBe(true);
    expect(recallTools, 'the recall run never wrote a file').toContain(
      'write_file'
    );

    // ---- The artifact, on the product's own list. ----
    const artifacts = await artifactsWhenPublished(recallProject);
    summary.artifacts = artifacts.map((a) => ({
      name: a.name,
      media_type: a.media_type,
      size_bytes: a.size_bytes,
      version: a.version,
    }));
    const produced = artifacts.find((a) => a.name === ARTIFACT_NAME);
    expect(
      produced,
      `${ARTIFACT_NAME} was never published; the run's output lives only in the pod`
    ).toBeTruthy();
    expect(Number(produced!.size_bytes)).toBeGreaterThan(0);

    // The bytes, not the row. This is what joins the two halves into one
    // causal chain: the file the run wrote carries the value it recalled, so
    // neither half can be a coincidence of the other.
    const bytes = await downloadArtifact(recallProject, produced!.artifact_id);
    const text = bytes.toString('utf-8');
    summary.artifact_bytes = bytes.length;
    writeOut(ARTIFACT_NAME, text);
    expect(
      text.includes(SECRET),
      'the published file does not carry the recalled value'
    ).toBe(true);

    // ---- The Spaces the runs were submitted from. ----
    // Each run began in a Space the user had just created, so each Project must
    // come back filed under its own — a desktop that minted Spaces only in its
    // own renderer would leave both of these unfiled.
    const writeSpace = await spaceOfProject(writeProject);
    const recallSpace = await spaceOfProject(recallProject);
    summary.spaces = { write: writeSpace, recall: recallSpace };
    expect(writeSpace, 'the first Project was never filed under a Space').toBeTruthy();
    expect(recallSpace, 'the second Project was never filed under a Space').toBeTruthy();
    expect(
      recallSpace,
      'both Projects landed in the same Space, so the filing is not per-Space'
    ).not.toBe(writeSpace);

    // The negative control: the first Project wrote a memory and no file.
    const writeArtifacts = await listArtifacts(writeProject);
    summary.write_project_artifacts = writeArtifacts.length;
    expect(
      writeArtifacts,
      'a project that wrote no file must list no artifacts'
    ).toEqual([]);

    // ---- All of it, on screen. ----
    await page.evaluate(() => {
      window.location.hash = '#/history?tab=agents&section=memory';
    });
    await page.reload();
    await expect(page.getByTestId('aion-memory')).toBeVisible({
      timeout: 60_000,
    });
    const memoryRow = page
      .getByTestId('aion-memory-row')
      .filter({ hasText: MEMORY_KEY })
      .first();
    await expect(
      memoryRow,
      'the stored memory is not on the Memory screen'
    ).toBeVisible({ timeout: 60_000 });
    await screenshot(page, '03-memory-screen');

    // The Spaces screen counts what the edge holds, so a renderer-only Space
    // would show zero here while the switcher still listed two.
    await page.evaluate(() => {
      window.location.hash = '#/history?tab=home&section=spaces';
    });
    await page.reload();
    const spaceRows = page.getByTestId('aion-space-row');
    await expect(
      spaceRows.first(),
      'the Spaces screen lists nothing the edge owns'
    ).toBeVisible({ timeout: 60_000 });
    summary.space_rows = await spaceRows.count();
    expect(await spaceRows.count()).toBeGreaterThanOrEqual(2);
    await screenshot(page, '04-spaces-screen');

    const recallPanel = await openProjectArtifacts(page, `${RUN_TAG}-recall`);
    await expect(
      recallPanel.getByTestId('aion-artifact-row').filter({
        hasText: ARTIFACT_NAME,
      }),
      'the artifact is not on the Projects screen'
    ).toHaveCount(1);
    await screenshot(page, '05-artifact-on-screen');

    // And the same panel on the Project that produced none says so.
    const writePanel = await openProjectArtifacts(page, `${RUN_TAG}-remember`);
    await expect(writePanel.getByTestId('aion-artifacts-empty')).toBeVisible();
    await expect(writePanel.getByTestId('aion-artifact-row')).toHaveCount(0);
    await screenshot(page, '06-empty-is-empty');

    const httpRequests = requestUrls.filter((url) => /^https?:/.test(url));
    const offEdge = httpRequests.filter((url) => !url.startsWith(edgeBaseUrl));
    summary.off_edge_requests = offEdge;
    summary.request_count = httpRequests.length;
    expect(offEdge, 'a screen reached an origin other than the edge').toEqual(
      []
    );
    expect(
      httpRequests.length,
      'an empty off-edge set is vacuous unless the renderer made requests'
    ).toBeGreaterThan(0);
  } catch (error) {
    bodyFailed = true;
    throw error;
  } finally {
    // The recording only flushes on close, so the video is resolved after
    // teardown and before the summary that reports it.
    await app.close();
    let videoBytes = 0;
    let videoName: string | null = null;
    const recorded = await video?.path().catch(() => undefined);
    if (recorded && fs.existsSync(recorded)) {
      videoName = 'parity-run.webm';
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
