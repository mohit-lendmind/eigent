// Plan-visibility desktop E2E: the REAL desktop app in remote-backend mode
// against the eigent-local Compose edge, asserting the A3 claim — the agent's
// own plan (the engine todo subsystem) is visible in the session side panel,
// as a tree with live statuses, not as transcript noise.
//
// The driver is the `aion-plan` fixture (plan-sequence): one parent step with
// two children, walked create → in_progress → done, where the report child
// closes with file evidence naming the report the run published. That evidence
// chip linking into the artifact viewer is the join A1–A3 were designed
// around: a plan step points at the artifact that proves it.
//
// The negative control is the `aion-fast` echo fixture: a single-turn answer
// emits zero todo events and must render NO Plan section at all — an empty
// Plan box would read as "the agent never plans", a claim about the edge
// version rather than the agent.
//
// Needs the stack in fixture-picker mode:
//   EIGENT_LOCAL_FIXTURE_PICKER=1 bazel run //dev/eigent_local:up   (in aion-v1)
//   EIGENT_E2E_FIXTURE_PICKER=1 npx playwright test --config e2e/playwright.config.ts plan.e2e
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

/** fakeroute plan-sequence: a parent with two children, walked to done. */
const PLAN_ALIAS = 'aion-plan';
/** fakeroute echo: a single-turn answer that plans nothing. */
const NO_PLAN_ALIAS = 'aion-fast';

const PARENT_ID = 'td-plan';
const RESEARCH_ID = 'td-research';
const REPORT_ID = 'td-report';
const REPORT_DOC = 'report.md';

const TURN_TIMEOUT_MS = 240_000;

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
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-plan-'));
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
    path: path.join(EVIDENCE_DIR, `eigent-plan-${name}.png`),
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

test('the plan renders as a tree, walks to done, and its evidence opens the artifact it names', async () => {
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
    plan_alias: PLAN_ALIAS,
    no_plan_alias: NO_PLAN_ALIAS,
  };
  const { app, page } = await launchApp();
  const networkUrls: string[] = [];
  page.on('request', (request) => networkUrls.push(request.url()));

  try {
    await page
      .locator('[role="textbox"]')
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 });

    await pinAlias(page, PLAN_ALIAS);
    await runTurn(page, 'plan fixture payload');
    await screenshot(page, '01-run-settled');

    // ---- The Plan section exists, as a tree in creation order. -----------
    const rows = page.locator('[data-testid="plan-row"]');
    await expect(rows).toHaveCount(3, { timeout: 60_000 });
    const shape = await rows.evaluateAll((nodes) =>
      nodes.map((n) => ({
        id: n.getAttribute('data-todo-id'),
        depth: n.getAttribute('data-todo-depth'),
        status: n.getAttribute('data-todo-status'),
      }))
    );
    summary.plan_rows = shape;
    expect(shape.map((r) => [r.id, r.depth])).toEqual([
      [PARENT_ID, '0'],
      [RESEARCH_ID, '1'],
      [REPORT_ID, '1'],
    ]);

    // ---- Every step reached done — the children by their own updates, the
    // parent ONLY by the store's derived rollup: no fixture turn ever writes
    // the parent's status, so a done parent here is the rollup event chain
    // (aion → edge → reducer → panel) working end to end.
    for (const row of shape) {
      expect(row.status, `status of ${row.id}`).toBe('done');
    }
    await expect(page.locator('[data-testid="plan-count"]')).toHaveText('3/3');
    await screenshot(page, '02-plan-done');

    // ---- The report step's evidence links into the artifact viewer. ------
    // This is the A1↔A3 join: the todo closed naming workspace:report.md,
    // the write_file turn published report.md, and the chip resolves one to
    // the other. An unresolved chip would render as an inert span — the
    // button role is the resolution proof.
    const reportRow = page.locator(`[data-todo-id="${REPORT_ID}"]`);
    const chip = reportRow.getByRole('button', { name: REPORT_DOC });
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(page.locator('[data-artifact-lane="markdown"]')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('[data-artifact-ready="1"]')).toBeVisible({
      timeout: 60_000,
    });
    summary.evidence_opened_viewer = true;
    await screenshot(page, '03-evidence-viewer');

    // ---- Negative control: a run that plans nothing shows no Plan. -------
    await pinAlias(page, NO_PLAN_ALIAS);
    await runTurn(page, 'no plan payload');
    await expect(page.locator('[data-testid="plan-count"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="plan-row"]')).toHaveCount(0);
    summary.no_plan_section_on_echo_run = true;
    await screenshot(page, '04-no-plan');

    // ---- The app talked to nothing but its own edge. ----------------------
    const offEdge = auditEdgeOnly(networkUrls, new URL(edgeBaseUrl!).origin);
    summary.off_edge_requests = offEdge;
    expect(offEdge).toEqual([]);
  } finally {
    writeEvidence('plan-summary.json', summary);
    await app.close();
  }
});
