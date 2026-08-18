// Artifact-truth desktop E2E: the REAL desktop app in remote-backend mode
// against the eigent-local Compose edge, asserting the A1 claim — a deliverable
// the agent keeps working on is recorded at every revision, and each recorded
// version carries the bytes that were published rather than whatever the file
// ended up holding.
//
// The driver is the `aion-artifact` fixture (artifact-sequence): write_file
// mints a draft, edit_file revises it, bash GROWS it with an append that
// publishes nothing by itself, and publish_artifact captures the grown file.
// That is the exact shape of the real deep-research run this milestone came
// from, whose 61 KB dashboard survived only as its 18 KB first draft.
// `aion-fast` (echo, no tools) is the negative control — a run that publishes
// nothing must list nothing.
//
// Needs the stack in fixture-picker mode:
//   EIGENT_LOCAL_FIXTURE_PICKER=1 bazel run //dev/eigent_local:up   (in aion-v1)
//   EIGENT_E2E_FIXTURE_PICKER=1 npx playwright test --config e2e/playwright.config.ts artifact-truth
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

/** fakeroute artifact-sequence: write_file → edit_file → bash → publish. */
const ARTIFACT_ALIAS = 'aion-artifact';
/** fakeroute echo: answers directly, no tools — the publishes-nothing control. */
const CONTROL_ALIAS = 'aion-fast';

/** The one deliverable the fixture writes, revises, grows and publishes. */
const DELIVERABLE = 'report.md';
/** Present from the FIRST write, so its absence means a version went missing. */
const HEADING = '# Report';
/** Only in v2 onward — the revision edit_file made. */
const REVISION = 'status: revised';
/** Only in v3 — the bytes bash appended, which no write published. */
const APPENDIX = '## Appendix';

const TERMINAL_KINDS = ['run_completed', 'run_failed', 'run_cancelled'];
const TURN_TIMEOUT_MS = 180_000;

interface Bootstrap {
  api_key: string;
  edge_url: string;
  tenant_id: string;
}

interface EdgeEvent {
  kind: string;
  run_id?: string;
  data?: Record<string, unknown>;
}

interface ArtifactRow {
  artifact_id: string;
  name: string;
  version: number;
  media_type: string;
  size_bytes: string;
  sha256: string;
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
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-artifact-'));
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
  const app = await electron.launch(
    packaged
      ? {
          executablePath: packaged.executablePath,
          args: [],
          env: launchEnv(extra),
        }
      : { args: [REPO_ROOT], cwd: REPO_ROOT, env: launchEnv(extra) }
  );
  return { app, page: await findMainWindow(app) };
}

async function screenshot(page: Page, name: string): Promise<void> {
  if (!EVIDENCE_DIR) return;
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `eigent-artifact-${name}.png`),
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

async function edgeJson<T>(pathAndQuery: string): Promise<T> {
  const response = await fetch(`${edgeBaseUrl}${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${bootstrap!.api_key}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`GET ${pathAndQuery} -> ${response.status}`);
  }
  return (await response.json()) as T;
}

/** Replays a finished project's trajectory — the product's own run record. */
async function readTrajectory(projectId: string): Promise<EdgeEvent[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  const events: EdgeEvent[] = [];
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
        if (!data) continue;
        const event = JSON.parse(data) as EdgeEvent;
        events.push(event);
        if (TERMINAL_KINDS.includes(event.kind)) return events;
      }
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
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

async function runTurn(page: Page, prompt: string): Promise<void> {
  const composer = await newSpace(page);
  await composer.click();
  await page.keyboard.insertText(prompt);
  await composer.press('Enter');
  const busy = page.locator('[role="textbox"][contenteditable="false"]');
  await busy
    .first()
    .waitFor({ state: 'attached', timeout: 120_000 })
    .catch(() => {});
  await expect(busy).toHaveCount(0, { timeout: TURN_TIMEOUT_MS });
}

function watchProjects(page: Page, projectIds: string[]): void {
  page.on('response', (response) => {
    const request = response.request();
    if (
      request.method() !== 'POST' ||
      !response.url().endsWith('/projects') ||
      response.status() !== 201
    ) {
      return;
    }
    void response
      .json()
      .then((body: { project_id?: string }) => {
        if (body.project_id) projectIds.push(body.project_id);
      })
      .catch(() => {});
  });
}

/**
 * The artifact plane settles just after the run's terminal event: the harvest
 * runs in the ops worker, not in the turn. Poll rather than assert once, so a
 * slow CAS write reads as latency instead of a missing version.
 */
async function artifactVersions(
  projectId: string,
  name: string,
  want: number
): Promise<ArtifactRow[]> {
  const query = `/projects/${encodeURIComponent(projectId)}/artifacts?name=${encodeURIComponent(name)}`;
  let rows: ArtifactRow[] = [];
  await expect(async () => {
    const body = await edgeJson<{ artifacts?: ArtifactRow[] }>(query);
    rows = body.artifacts ?? [];
    expect(rows.length).toBe(want);
  }).toPass({ timeout: 90_000 });
  return rows;
}

async function inlineContent(
  projectId: string,
  artifactId: string
): Promise<{ content?: string; content_truncated?: boolean }> {
  return edgeJson(
    `/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifactId)}?inline=true`
  );
}

test('every revision of a deliverable is published, and each version holds the bytes it published', async () => {
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
    artifact_alias: ARTIFACT_ALIAS,
    control_alias: CONTROL_ALIAS,
    deliverable: DELIVERABLE,
  };
  const { app, page } = await launchApp();
  const networkUrls: string[] = [];
  page.on('request', (request) => networkUrls.push(request.url()));
  const projectIds: string[] = [];
  watchProjects(page, projectIds);

  try {
    await page
      .locator('[role="textbox"]')
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 });

    // ---- The run that writes, revises, grows and publishes. --------------
    await pinAlias(page, ARTIFACT_ALIAS);
    await runTurn(page, 'artifact truth fixture payload');
    await screenshot(page, 'run-settled');
    expect(projectIds.length).toBeGreaterThan(0);
    const projectId = projectIds[projectIds.length - 1];
    summary.project_id = projectId;

    // The trajectory is the product's own record that all four calls ran, in
    // the order that makes the claim meaningful: bash grew the file BETWEEN
    // the last write and the publish.
    const events = await readTrajectory(projectId);
    const tools = events
      .filter((e) => e.kind === 'tool_call')
      .map((e) => String(e.data?.tool_name ?? ''));
    summary.tool_calls = tools;
    expect(tools).toEqual([
      'write_file',
      'edit_file',
      'bash',
      'publish_artifact',
    ]);

    // ---- Three versions of ONE name, newest first. -----------------------
    const rows = await artifactVersions(projectId, DELIVERABLE, 3);
    summary.versions = rows.map((a) => ({
      version: a.version,
      size_bytes: a.size_bytes,
      sha256: a.sha256,
      media_type: a.media_type,
    }));
    expect(rows.map((a) => a.version)).toEqual([3, 2, 1]);
    expect(rows.every((a) => a.name === DELIVERABLE)).toBe(true);
    expect(rows[0].media_type).toBe('text/markdown');

    // Distinct content per version is the whole point: the harvest reads a
    // frozen copy, so a version says what it published rather than what the
    // file later became. Identical hashes here mean the freeze regressed.
    expect(new Set(rows.map((a) => a.sha256)).size).toBe(3);

    // ---- Each version carries exactly what it published. -----------------
    const byVersion = new Map(rows.map((a) => [a.version, a]));
    const v1 = await inlineContent(projectId, byVersion.get(1)!.artifact_id);
    const v2 = await inlineContent(projectId, byVersion.get(2)!.artifact_id);
    const v3 = await inlineContent(projectId, byVersion.get(3)!.artifact_id);
    summary.inline_bytes = {
      v1: v1.content?.length,
      v2: v2.content?.length,
      v3: v3.content?.length,
    };

    // v1 is the draft: written before the edit and before the append, so it
    // must carry NEITHER. This is the assertion the old read-at-harvest
    // design could not satisfy — it served the final file three times.
    expect(v1.content).toContain(HEADING);
    expect(v1.content).not.toContain(REVISION);
    expect(v1.content).not.toContain(APPENDIX);

    // v2 is the revision: edited, not yet grown.
    expect(v2.content).toContain(REVISION);
    expect(v2.content).not.toContain(APPENDIX);

    // v3 is the deliverable as it actually ended up — and the appendix is the
    // load-bearing part, because bash published nothing itself. A v3 without
    // it is the production loss this milestone exists to close.
    expect(v3.content).toContain(REVISION);
    expect(v3.content).toContain(APPENDIX);
    expect(v3.content!.length).toBeGreaterThan(v2.content!.length);
    expect(v3.content_truncated).toBe(false);

    // Inline content is served whole or not at all, so a length that
    // disagrees with the row means a viewer would render a partial document.
    expect(String(v3.content!.length)).toBe(byVersion.get(3)!.size_bytes);

    // ---- Negative control: a run with no tools publishes nothing. --------
    await pinAlias(page, CONTROL_ALIAS);
    await runTurn(page, 'say hello and stop');
    const controlProject = projectIds[projectIds.length - 1];
    expect(controlProject).not.toBe(projectId);
    const control = await edgeJson<{ artifacts?: ArtifactRow[] }>(
      `/projects/${encodeURIComponent(controlProject)}/artifacts`
    );
    summary.control_project_id = controlProject;
    summary.control_artifacts = control.artifacts?.length ?? 0;
    expect(control.artifacts ?? []).toHaveLength(0);

    // ---- The app talked to nothing but its own edge. ---------------------
    const offEdge = auditEdgeOnly(networkUrls, new URL(edgeBaseUrl!).origin);
    summary.non_edge_requests = offEdge;
    expect(offEdge).toEqual([]);
  } finally {
    writeEvidence('artifact-truth-summary.json', summary);
    await app.close();
  }
});
