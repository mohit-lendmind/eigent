// Project-list desktop E2E: the REAL desktop app in remote-backend mode
// against the eigent-local Compose edge, driving the Home Projects section and
// the aion-mode nav gating. Two scenarios:
//   1. The list is the edge's list — projects created over the API appear as
//      rows, the rendered page equals the page the edge serves, and a project
//      created after mount shows up only once the renderer re-reads.
//   2. In aion mode the sections only the removed local backend could serve are
//      absent from the nav AND unreachable by deep link, while the sections
//      aion does serve stay present.
//
// Preconditions match aion-lab.e2e.ts (skipped cleanly when absent): the
// Compose stack up in the sibling aion-v1 checkout and `npx vite build` here.
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

// Seeded over the edge API, so the alias has to be one the stack's catalog
// serves — an unknown alias is refused with 422 model_alias_denied. The
// fixture stack seeds aion-default; a deployed cell's catalog is operator-owned
// and names whatever that operator provisioned, so the same walk reaches a real
// edge only if the alias is a parameter.
const MODEL_ALIAS = process.env.EIGENT_E2E_MODEL ?? 'aion-default';

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
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-prj-'));
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

// Route + reload so React mounts directly on the target section (the same
// deterministic-mount trick the Lab and Skills suites use).
async function openSection(page: Page, query: string): Promise<void> {
  await page.evaluate((params) => {
    window.location.hash = `#/history?${params}`;
  }, query);
  await page.reload();
}

const byId = (page: Page, id: string) => page.getByTestId(id);

async function screenshot(page: Page, name: string): Promise<void> {
  if (!EVIDENCE_DIR) return;
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `eigent-prj-${name}.png`),
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

// Node-side edge calls: they seed and cross-check the fixture, and staying off
// the renderer keeps them out of its edge-only network audit.
async function edgeFetch(
  method: string,
  pathname: string,
  body?: unknown
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${bootstrap!.api_key}`,
  };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    // Every create carries its own key, so a retried POST cannot double-seed.
    headers['Idempotency-Key'] = `prj-e2e-${Math.random().toString(36).slice(2)}`;
  }
  return fetch(`${edgeBaseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createProject(title: string): Promise<string> {
  const response = await edgeFetch('POST', '/projects', {
    title,
    model_alias: MODEL_ALIAS,
  });
  if (response.status !== 201) {
    throw new Error(
      `createProject(${title}): ${response.status} ${await response.text()}`
    );
  }
  const created = (await response.json()) as { project_id: string };
  return created.project_id;
}

/** The titles on the edge's first page, newest first. */
async function listProjectTitles(): Promise<string[]> {
  const response = await edgeFetch('GET', '/projects');
  if (!response.ok) {
    throw new Error(`listProjects: ${response.status}`);
  }
  const page = (await response.json()) as {
    projects?: { project: { title: string } }[];
  };
  return (page.projects ?? []).map((entry) => entry.project.title);
}

/**
 * The titles the Projects section is currently rendering, in row order. Taken
 * verbatim — a title the edge stored with surrounding whitespace must compare
 * equal to what the row shows, so normalizing here would hide a divergence.
 */
async function renderedTitles(page: Page): Promise<string[]> {
  return page.$$eval('[data-testid="aion-project-row"]', (rows) =>
    rows.map((row) => row.querySelector('span')?.textContent ?? '')
  );
}

test('the Home project list is the edge\'s list', async () => {
  test.skip(
    !bootstrap || !edgeReady || !APP_BUILT,
    'eigent-local stack not running or app not built'
  );
  test.setTimeout(180_000);
  const stamp = Date.now();
  const titleA = `e2e-projects-a-${stamp}`;
  const titleB = `e2e-projects-b-${stamp}`;
  const titleLate = `e2e-projects-late-${stamp}`;
  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
    model_alias: MODEL_ALIAS,
    titles: [titleA, titleB, titleLate],
  };

  // Seeded before launch so the first render already has something to show —
  // an empty-then-filled list would not distinguish "read the edge" from
  // "subscribed to a live feed".
  summary.project_a = await createProject(titleA);
  summary.project_b = await createProject(titleB);

  const { app, page } = await launchApp();
  const networkUrls: string[] = [];
  page.on('request', (request) => networkUrls.push(request.url()));

  try {
    await openSection(page, 'tab=home&section=projects');
    await expect(byId(page, 'aion-projects')).toBeVisible({ timeout: 60_000 });
    const rowA = page
      .getByTestId('aion-project-row')
      .filter({ hasText: titleA });
    const rowB = page
      .getByTestId('aion-project-row')
      .filter({ hasText: titleB });
    await expect(rowA).toHaveCount(1);
    await expect(rowB).toHaveCount(1);
    // The row carries the Project's own alias, so the column is proven to be
    // per-Project data and not the renderer's currently selected model.
    await expect(rowA).toContainText(MODEL_ALIAS);
    await screenshot(page, 'list-seeded');

    // The rendered page IS the edge's page: same set, same size. A UI that
    // padded, dropped or cached rows would diverge here even with both
    // seeded titles present.
    const shown = await renderedTitles(page);
    const served = await listProjectTitles();
    summary.rows_rendered = shown.length;
    summary.rows_served = served.length;
    expect([...shown].sort()).toEqual([...served].sort());

    // A project created after mount is absent until the renderer re-reads,
    // then present. This is the control that the list is a read of the edge
    // rather than renderer-local state that happens to agree with it.
    summary.project_late = await createProject(titleLate);
    const rowLate = page
      .getByTestId('aion-project-row')
      .filter({ hasText: titleLate });
    await expect(rowLate).toHaveCount(0);
    await page.reload();
    await expect(byId(page, 'aion-projects')).toBeVisible({ timeout: 60_000 });
    await expect(rowLate).toHaveCount(1);
    summary.reread_picked_up_new_project = true;
    await screenshot(page, 'list-after-reread');

    const offEdge = auditEdgeOnly(networkUrls, new URL(edgeBaseUrl!).origin);
    expect(offEdge).toEqual([]);
    // An empty off-edge set is vacuous unless the renderer made requests.
    expect(networkUrls.filter((u) => /^https?:/.test(u)).length).toBeGreaterThan(
      0
    );
    summary.off_edge_requests = offEdge;
    writeEvidence('eigent-prj-list-summary.json', summary);
  } finally {
    await app.close();
  }
});

test('the sections only the local backend could serve are gone', async () => {
  test.skip(
    !bootstrap || !edgeReady || !APP_BUILT,
    'eigent-local stack not running or app not built'
  );
  test.setTimeout(180_000);
  const { app, page } = await launchApp();
  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
  };

  const navTab = (name: string) => page.getByRole('tab', { name, exact: true });

  try {
    await openSection(page, 'tab=agents&section=skills');
    // The sections aion does serve are the control: without them, "absent"
    // could just mean the nav never rendered.
    await expect(navTab('Skills')).toBeVisible({ timeout: 60_000 });
    await expect(navTab('Memory')).toBeVisible();
    await expect(navTab('Models')).toHaveCount(0);
    await expect(navTab('Sub Agents')).toHaveCount(0);
    summary.agents_dead_nav_absent = true;
    await screenshot(page, 'nav-agents');

    // A link kept from before those screens were retired still lands on one
    // that exists rather than on a blank pane.
    await openSection(page, 'tab=agents&section=models');
    await expect(byId(page, 'skills-add')).toBeVisible({ timeout: 60_000 });
    await expect(navTab('Skills')).toHaveAttribute('aria-selected', 'true');
    await expect(navTab('Models')).toHaveCount(0);
    summary.agents_deep_link_falls_back = true;

    // Cookies died with the local backend; the CDP connections screen died
    // with the pool itself — the browser runs headless inside the aion
    // sandbox pod, so Plugins is the tab's only remaining section.
    await openSection(page, 'tab=browser');
    await expect(navTab('Plugins')).toBeVisible({ timeout: 60_000 });
    await expect(navTab('Connections')).toHaveCount(0);
    await expect(navTab('Cookies')).toHaveCount(0);
    await openSection(page, 'tab=browser&browserSection=cookies');
    await expect(navTab('Plugins')).toHaveAttribute('aria-selected', 'true');
    await expect(navTab('Cookies')).toHaveCount(0);
    summary.browser_dead_nav_absent = true;
    await screenshot(page, 'nav-browser');

    writeEvidence('eigent-prj-nav-summary.json', summary);
  } finally {
    await app.close();
  }
});
