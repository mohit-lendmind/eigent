// Usage desktop E2E: the REAL desktop app in remote-backend mode against the
// eigent-local Compose edge, driving the Home Usage section.
//
// The whole point of this suite is that the three cost states stay apart, and
// the fixture stack is what makes them all reachable at once: `aion-priced`
// settles a scripted 12500 micro-USD, `aion-fast` runs the same script with no
// price list at all (a zero beside real provider calls — UNPRICED, not free),
// and any run that settled without a recorded figure is ABSENT (pending). Every
// rendered row is cross-checked against the state the edge actually served, so
// a surface that collapsed two of them into `$0.00` fails here.
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

// The one catalog row that scripts a settled cost, and the row running the
// same script with nothing priced. Both must be aliases the stack's catalog
// serves — an unknown alias is refused with 422 model_alias_denied.
const PRICED_ALIAS = 'aion-priced';
const UNPRICED_ALIAS = 'aion-fast';
// What internal/inference/fakeroute settles for the priced row, and how
// src/store/aionUsageStore.ts renders that figure.
const PRICED_MICRO_USD = 12500n;
const PRICED_RENDERED = '$0.0125';

const TERMINAL_KINDS = ['run_completed', 'run_failed', 'run_cancelled'];
const TERMINAL_TIMEOUT_MS = 120_000;

interface Bootstrap {
  api_key: string;
  edge_url: string;
  tenant_id: string;
}

interface EdgeRun {
  run_id: string;
  project_id: string;
  status: string;
  ended_at?: string;
  cost_micro_usd?: string;
  provider_calls?: string;
}

interface EdgeUsage {
  totals: {
    cost_micro_usd: string;
    provider_calls: string;
    runs_settled: string;
    runs_unrecorded: string;
  };
  runs: EdgeRun[];
  next_page_token?: string;
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
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-usage-'));
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
  const page = await findMainWindow(app);
  return { app, page };
}

// Route + reload so React mounts directly on the target section (the same
// deterministic-mount trick the Lab, Skills and Projects suites use).
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
    path: path.join(EVIDENCE_DIR, `eigent-usage-${name}.png`),
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
    // Every write carries its own key, so a retried POST cannot double-admit.
    headers['Idempotency-Key'] =
      `usage-e2e-${Math.random().toString(36).slice(2)}`;
  }
  return fetch(`${edgeBaseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createProject(title: string, alias: string): Promise<string> {
  const response = await edgeFetch('POST', '/projects', {
    title,
    model_alias: alias,
  });
  if (response.status !== 201) {
    throw new Error(
      `createProject(${title}): ${response.status} ${await response.text()}`
    );
  }
  return ((await response.json()) as { project_id: string }).project_id;
}

/** Admits one command and returns the run it was admitted onto. */
async function submitCommand(
  projectId: string,
  text: string
): Promise<string> {
  const commandId = `usage-cmd-${Math.random().toString(36).slice(2, 10)}`;
  const response = await edgeFetch(
    'POST',
    `/projects/${encodeURIComponent(projectId)}/commands`,
    { command_id: commandId, text }
  );
  if (response.status !== 202) {
    throw new Error(
      `submitCommand(${projectId}): ${response.status} ${await response.text()}`
    );
  }
  return ((await response.json()) as { run_id: string }).run_id;
}

/**
 * Waits for the run to settle by reading the Project's own SSE trajectory —
 * usage only ever reports TERMINAL runs, so a spend read before this returns
 * would be racing the settle rather than testing it.
 */
async function awaitTerminal(projectId: string): Promise<string | null> {
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
      if (done) return null;
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
        if (TERMINAL_KINDS.includes(kind)) return kind;
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return null;
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/** The tenant's first page of spend, exactly as the desktop asks for it. */
async function fetchUsage(): Promise<EdgeUsage> {
  const response = await edgeFetch('GET', '/usage');
  if (!response.ok) {
    throw new Error(`getUsage: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as EdgeUsage;
}

type CostState = 'amount' | 'unpriced' | 'pending';

/**
 * The state the edge's own row implies. The cost pair is omitted, never zeroed,
 * when nothing was recorded, so an absent half is what makes a run pending —
 * and a recorded zero beside real calls is a missing price list, not a free run.
 */
function servedState(run: EdgeRun): CostState {
  if (run.cost_micro_usd === undefined || run.provider_calls === undefined) {
    return 'pending';
  }
  if (BigInt(run.cost_micro_usd) === 0n && BigInt(run.provider_calls) > 0n) {
    return 'unpriced';
  }
  return 'amount';
}

interface RenderedRow {
  runId: string;
  amount: string | null;
  unpriced: boolean;
  pending: boolean;
  calls: string;
}

async function renderedRows(page: Page): Promise<RenderedRow[]> {
  return page.$$eval('[data-testid="aion-usage-row"]', (rows) =>
    rows.map((row) => ({
      runId: row.getAttribute('data-run-id') ?? '',
      amount:
        row.querySelector('[data-testid="aion-usage-cost-amount"]')
          ?.textContent ?? null,
      unpriced:
        row.querySelector('[data-testid="aion-usage-cost-unpriced"]') !== null,
      pending:
        row.querySelector('[data-testid="aion-usage-cost-pending"]') !== null,
      calls:
        row.querySelector('[data-testid="aion-usage-calls"]')?.textContent ??
        '',
    }))
  );
}

function renderedState(row: RenderedRow): CostState | 'ambiguous' {
  const shown = [row.amount !== null, row.unpriced, row.pending].filter(
    Boolean
  );
  if (shown.length !== 1) return 'ambiguous';
  if (row.amount !== null) return 'amount';
  return row.unpriced ? 'unpriced' : 'pending';
}

/**
 * The displayed dollar figure has to be the settled micro-USD, allowing for the
 * rounding the display does at its own precision (4 decimals under a dollar,
 * 2 above) and the below-the-smallest-unit bound it shows instead of a zero.
 */
function amountMatches(text: string, microUsd: bigint): boolean {
  if (text.startsWith('<$')) return microUsd > 0n && microUsd < 50n;
  const parsed = Number(text.replace(/[$,]/g, ''));
  if (!Number.isFinite(parsed)) return false;
  const halfUnit = microUsd < 1_000_000n ? 50 : 5_000;
  return Math.abs(Math.round(parsed * 1e6) - Number(microUsd)) <= halfUnit;
}

test('the cost the desktop shows is the cost the edge settled', async () => {
  test.skip(
    !bootstrap || !edgeReady || !APP_BUILT,
    'eigent-local stack not running or app not built'
  );
  test.setTimeout(300_000);
  const stamp = Date.now();
  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
    priced_alias: PRICED_ALIAS,
    unpriced_alias: UNPRICED_ALIAS,
  };

  // Two runs of the SAME script, differing only in whether the catalog row
  // prices it, plus a project that never runs anything.
  const pricedProject = await createProject(
    `e2e-usage-priced-${stamp}`,
    PRICED_ALIAS
  );
  const unpricedProject = await createProject(
    `e2e-usage-unpriced-${stamp}`,
    UNPRICED_ALIAS
  );
  const idleProject = await createProject(
    `e2e-usage-idle-${stamp}`,
    UNPRICED_ALIAS
  );
  const pricedRun = await submitCommand(pricedProject, 'settle a priced run');
  const unpricedRun = await submitCommand(
    unpricedProject,
    'settle an unpriced run'
  );
  summary.priced_run_id = pricedRun;
  summary.unpriced_run_id = unpricedRun;
  summary.idle_project_id = idleProject;
  summary.priced_terminal = await awaitTerminal(pricedProject);
  summary.unpriced_terminal = await awaitTerminal(unpricedProject);
  expect(summary.priced_terminal).toBe('run_completed');
  expect(summary.unpriced_terminal).toBe('run_completed');

  const served = await fetchUsage();
  const byRunId = new Map(served.runs.map((run) => [run.run_id, run]));
  const pricedServed = byRunId.get(pricedRun);
  const unpricedServed = byRunId.get(unpricedRun);
  expect(pricedServed, 'priced run missing from the edge bill').toBeTruthy();
  expect(
    unpricedServed,
    'unpriced run missing from the edge bill'
  ).toBeTruthy();
  // The scripted cost is what makes an AMOUNT reachable at all on a fixture
  // stack; without it every fixture run is the unpriced case.
  expect(BigInt(pricedServed!.cost_micro_usd ?? '0')).toBe(PRICED_MICRO_USD);
  expect(BigInt(pricedServed!.provider_calls ?? '0')).toBeGreaterThan(0n);
  expect(unpricedServed!.cost_micro_usd).toBe('0');
  expect(BigInt(unpricedServed!.provider_calls ?? '0')).toBeGreaterThan(0n);
  // A project with no run has nothing to bill, and an empty bill is not a zero.
  expect(served.runs.filter((r) => r.project_id === idleProject)).toEqual([]);
  summary.served_totals = served.totals;
  summary.served_rows = served.runs.length;

  const { app, page } = await launchApp();
  const networkUrls: string[] = [];
  page.on('request', (request) => networkUrls.push(request.url()));

  try {
    await openSection(page, 'tab=home&section=usage');
    await expect(byId(page, 'aion-usage')).toBeVisible({ timeout: 60_000 });
    const pricedRow = page.locator(
      `[data-testid="aion-usage-row"][data-run-id="${pricedRun}"]`
    );
    await expect(pricedRow).toHaveCount(1);
    await expect(
      pricedRow.getByTestId('aion-usage-cost-amount')
    ).toHaveText(PRICED_RENDERED);
    const unpricedRow = page.locator(
      `[data-testid="aion-usage-row"][data-run-id="${unpricedRun}"]`
    );
    await expect(unpricedRow).toHaveCount(1);
    // The zero the edge served is shown as unpriced, never as a price.
    await expect(unpricedRow.getByTestId('aion-usage-cost-unpriced')).toHaveCount(
      1
    );
    await expect(unpricedRow.getByTestId('aion-usage-cost-amount')).toHaveCount(
      0
    );
    await screenshot(page, 'rows');

    // The whole rendered page is the edge's page: same runs, and every row in
    // the state the edge's own JSON implies. A surface that rendered an absent
    // figure as $0.00, or a zero as a price, diverges here on that row.
    const rows = await renderedRows(page);
    expect([...rows.map((r) => r.runId)].sort()).toEqual(
      [...served.runs.map((r) => r.run_id)].sort()
    );
    const states: Record<string, number> = {
      amount: 0,
      unpriced: 0,
      pending: 0,
    };
    for (const row of rows) {
      const run = byRunId.get(row.runId)!;
      const expected = servedState(run);
      expect(renderedState(row), `row ${row.runId}`).toBe(expected);
      states[expected] += 1;
      if (expected === 'amount') {
        expect(
          amountMatches(row.amount!, BigInt(run.cost_micro_usd!)),
          `row ${row.runId} shows ${row.amount} for ${run.cost_micro_usd} micro-USD`
        ).toBe(true);
      }
      // The call count is the term that keeps a zero cost legible, so it has to
      // be the served count — and absent when the pair was never recorded.
      expect(row.calls, `row ${row.runId} calls`).toBe(
        run.provider_calls === undefined
          ? '—'
          : Number(run.provider_calls).toLocaleString('en-US')
      );
    }
    summary.rendered_states = states;
    expect(states.amount).toBeGreaterThan(0);
    expect(states.unpriced).toBeGreaterThan(0);

    // Totals cover the whole window, not the page, so they are read straight
    // across rather than re-summed from the rows.
    await expect(byId(page, 'aion-usage-total-cost')).toHaveText(
      // Fixture-scale figures only; the store's own formatter is unit-tested.
      /^[<]?\$[\d,]+\.\d{2,4}$/
    );
    const shownTotalCost = await byId(page, 'aion-usage-total-cost').innerText();
    expect(
      amountMatches(shownTotalCost, BigInt(served.totals.cost_micro_usd))
    ).toBe(true);
    await expect(byId(page, 'aion-usage-total-calls')).toHaveText(
      Number(served.totals.provider_calls).toLocaleString('en-US')
    );
    await expect(byId(page, 'aion-usage-runs-settled')).toHaveText(
      Number(served.totals.runs_settled).toLocaleString('en-US')
    );
    // An unrecorded run makes the totals a FLOOR, and the surface has to say so
    // — its absence is equally load-bearing when everything was recorded.
    const floorNote = byId(page, 'aion-usage-floor-note');
    await expect(floorNote).toHaveCount(
      BigInt(served.totals.runs_unrecorded) > 0n ? 1 : 0
    );
    summary.floor_note_shown = BigInt(served.totals.runs_unrecorded) > 0n;

    const offEdge = auditEdgeOnly(networkUrls, new URL(edgeBaseUrl!).origin);
    expect(offEdge).toEqual([]);
    // An empty off-edge set is vacuous unless the renderer made requests.
    expect(
      networkUrls.filter((u) => /^https?:/.test(u)).length
    ).toBeGreaterThan(0);
    summary.off_edge_requests = offEdge;
    writeEvidence('eigent-usage-summary.json', summary);
  } finally {
    await app.close();
  }
});
