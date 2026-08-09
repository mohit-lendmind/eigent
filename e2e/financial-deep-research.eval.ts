// Deep-research financial-analysis evaluation driver (user request 2026-08-09):
// drives a complex multi-part financial research brief through the REAL desktop
// app in remote-backend mode against the live eigent-local Compose stack, on
// the REAL Moonshot Kimi K3 model (alias kimi-k3 → internal/inference/
// moonshotroute; user directive: no fakeroute for evaluations). Measures the
// full trajectory: 500ms samples of cursor/timeline growth, stage screenshots,
// timeline text, receipts, runs, the sanitized evidence export, and cold-replay
// equivalence.
//
// Run: npx playwright test --config e2e/eval.config.ts
// Output: EIGENT_EVAL_DIR (default ../eval-deep-research next to the repo).

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

const REPO_ROOT =
  process.env.EIGENT_E2E_APP_DIR ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOOTSTRAP_PATH =
  process.env.EIGENT_E2E_BOOTSTRAP ??
  path.resolve(REPO_ROOT, '../aion-v1/deploy/eigent-local/run/bootstrap.json');
const EVAL_DIR =
  process.env.EIGENT_EVAL_DIR ??
  path.resolve(REPO_ROOT, '..', 'eval-deep-research');

const MODEL_ALIAS = 'kimi-k3';
// A real deep-research loop (multi-turn tool use in real sandboxes on a real
// model) is minutes, not seconds.
const RUN_TIMEOUT_MS = 25 * 60_000;

interface Bootstrap {
  api_key: string;
  edge_url: string;
  tenant_id: string;
}

const bootstrap: Bootstrap = JSON.parse(
  fs.readFileSync(BOOTSTRAP_PATH, 'utf-8')
);
const edgeBaseUrl = `${bootstrap.edge_url.replace(/\/+$/, '')}/eigent/v1`;

const RESEARCH_BRIEF = [
  'Deep research task — institutional-grade financial analysis of NVIDIA (NVDA) for FY2025.',
  '1) Decompose revenue by segment (Data Center, Gaming, Professional Visualization, Automotive, OEM) with YoY growth and mix shift.',
  '2) Analyze the gross-margin trajectory and its drivers: H100/H200/Blackwell product mix, CoWoS advanced-packaging supply, inventory reserves.',
  '3) Quantify concentration risk: top hyperscaler customers, China export-control exposure, and custom-silicon substitution risk (TPU, Trainium, MTIA).',
  '4) Build a 5-year DCF: revenue CAGR scenarios bear 15% / base 35% / bull 50%, operating-margin fade to 45%, WACC 11%, terminal growth 4%; report per-share values for each scenario.',
  '5) Cross-check the DCF with comparable multiples (AMD, AVGO, TSM forward P/E and EV/Sales).',
  '6) Save intermediate findings to files, verify all arithmetic with shell commands, and finish with a one-page investor memo giving a buy/hold/sell call and the three assumptions most likely to be wrong.',
].join('\n');

interface Sample {
  t_ms: number;
  cursor: string;
  timeline_entries: number;
  terminal_runs: number;
}

const byId = (page: Page, id: string) => page.getByTestId(id);

async function cursorValue(page: Page): Promise<bigint> {
  const text = (await byId(page, 'lab-cursor').textContent()) ?? 'cursor: 0';
  return BigInt(text.replace('cursor:', '').trim() || '0');
}

function writeEvalFile(name: string, payload: string): void {
  if (payload.includes(bootstrap.api_key)) {
    throw new Error(`eval output ${name} would leak the API key`);
  }
  fs.writeFileSync(path.join(EVAL_DIR, name), payload);
}

async function screenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: path.join(EVAL_DIR, `${name}.png`),
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

// The renderer may still be booting its router when the first hash change
// lands (the earlier run died here: no lab-* element ever appeared). Navigate,
// wait for any lab surface, and re-drive the hash until the lab mounts.
async function openLab(page: Page): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    await page.evaluate(() => {
      window.location.hash = '#/integration-lab';
    });
    const surfaced = await page
      .locator(
        '[data-testid="lab-root"], [data-testid="lab-loading"], ' +
          '[data-testid="lab-mode-local"], [data-testid="lab-config-error"]'
      )
      .first()
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (surfaced) return;
    if (Date.now() > deadline) {
      throw new Error('Integration Lab never mounted');
    }
  }
}

// Samples the reduced view every ~500ms until a run reaches terminal status;
// screenshots the stream at first output and every ~2 minutes after.
async function sampleUntilTerminal(
  page: Page,
  series: Sample[],
  t0: number,
  timeoutMs: number
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let shots = 0;
  let nextShotAt = 0;
  for (;;) {
    const cursor = await cursorValue(page);
    const timelineEntries = await page.getByTestId('lab-timeline-entry').count();
    const runsText = (await byId(page, 'lab-runs').textContent()) ?? '';
    const terminalRuns = (runsText.match(/succeeded|failed|cancelled/g) ?? [])
      .length;
    series.push({
      t_ms: Date.now() - t0,
      cursor: cursor.toString(),
      timeline_entries: timelineEntries,
      terminal_runs: terminalRuns,
    });
    if (timelineEntries > 0 && Date.now() >= nextShotAt && shots < 8) {
      shots += 1;
      nextShotAt = Date.now() + 120_000;
      await screenshot(page, `02-streaming-${String(shots).padStart(2, '0')}`);
    }
    if (terminalRuns >= 1) return runsText;
    if (Date.now() > deadline) {
      throw new Error(`run did not reach terminal state; runs: ${runsText}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function captureProjectView(page: Page) {
  return {
    cursor: (await cursorValue(page)).toString(),
    session_status: ((await byId(page, 'lab-session-status').textContent()) ?? '').trim(),
    gap_count: ((await byId(page, 'lab-gap-count').textContent()) ?? '').trim(),
    suppressed: ((await byId(page, 'lab-suppressed-count').textContent()) ?? '').trim(),
    receipts: ((await byId(page, 'lab-command-receipts').textContent()) ?? '').trim(),
    runs: ((await byId(page, 'lab-runs').textContent()) ?? '').trim(),
    approvals: ((await byId(page, 'lab-approvals').textContent()) ?? '').trim(),
    artifacts: ((await byId(page, 'lab-artifacts').textContent()) ?? '').trim(),
    timeline: await page.getByTestId('lab-timeline-entry').allTextContents(),
  };
}

test('deep-research financial-analysis evaluation on kimi-k3', async () => {
  fs.mkdirSync(EVAL_DIR, { recursive: true });
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-eval-'));
  const keyFile = path.join(workDir, 'edge-api-key');
  fs.writeFileSync(keyFile, bootstrap.api_key, { mode: 0o600 });

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value;
  }
  delete env.VITE_DEV_SERVER_URL;
  env.EIGENT_E2E_USER_DATA = fs.mkdtempSync(path.join(workDir, 'user-data-'));
  env.EIGENT_REMOTE_BACKEND_URL = edgeBaseUrl;
  env.EIGENT_REMOTE_BACKEND_API_KEY_FILE = keyFile;
  env.EIGENT_REMOTE_BACKEND_API_KEY = '';

  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
    model_alias: MODEL_ALIAS,
    provider: 'moonshot kimi-k3 via internal/inference/moonshotroute',
    brief_chars: RESEARCH_BRIEF.length,
    window_start: new Date().toISOString(),
  };

  const app = await electron.launch({ args: [REPO_ROOT], cwd: REPO_ROOT, env });
  try {
    const page = await findMainWindow(app);
    const requests: { t: string; method: string; url: string }[] = [];
    const responses: { t: string; status: number; url: string }[] = [];
    page.on('request', (request) => {
      requests.push({
        t: new Date().toISOString(),
        method: request.method(),
        url: request.url(),
      });
    });
    page.on('response', (response) => {
      responses.push({
        t: new Date().toISOString(),
        status: response.status(),
        url: response.url(),
      });
    });
    await openLab(page);

    // --- status handshake -------------------------------------------------
    await expect(byId(page, 'lab-health')).toHaveText('health: ok');
    await expect(byId(page, `lab-model-row-${MODEL_ALIAS}`)).toBeVisible();
    summary.status = {
      execution_mode: (await byId(page, 'lab-execution-mode').textContent())?.trim(),
      inference: (await byId(page, 'lab-inference-status').textContent())?.trim(),
      harness: (await byId(page, 'lab-harness-generation').textContent())?.trim(),
      identity: (await byId(page, 'lab-auth-identity').textContent())?.trim(),
      edge_version: (await byId(page, 'lab-edge-version').textContent())?.trim(),
      event_schema: (await byId(page, 'lab-event-schema-version').textContent())?.trim(),
      models: (await byId(page, 'lab-models').textContent())?.trim(),
    };
    await screenshot(page, '01-status');

    // --- deep research on kimi-k3 ----------------------------------------
    await byId(page, 'lab-project-title').fill(
      'Deep Research: NVIDIA FY2025 Financial Analysis'
    );
    await byId(page, 'lab-project-alias').selectOption(MODEL_ALIAS);
    const tCreate = Date.now();
    await byId(page, 'lab-project-create').click();
    await expect(byId(page, 'lab-project-id')).toBeVisible();
    const projectId = ((await byId(page, 'lab-project-id').textContent()) ?? '')
      .replace('project:', '')
      .trim();
    expect(projectId).toMatch(/^prj[-_]/);

    await byId(page, 'lab-command-input').fill(RESEARCH_BRIEF);
    const tSubmit = Date.now();
    await byId(page, 'lab-command-submit').click();
    await expect(byId(page, 'lab-command-receipts')).toContainText('run ');
    const tReceipt = Date.now();

    const series: Sample[] = [];
    const runsText = await sampleUntilTerminal(page, series, tSubmit, RUN_TIMEOUT_MS);
    const tTerminal = Date.now();
    const view = await captureProjectView(page);
    await screenshot(page, '03-run-terminal');

    await byId(page, 'lab-export').click();
    const evidence = (await byId(page, 'lab-evidence-json').textContent()) ?? '';
    expect(evidence).toContain(projectId);
    writeEvalFile('evidence-export.json', evidence);

    summary.deep_research = {
      project_id: projectId,
      create_ms: tSubmit - tCreate,
      submit_to_receipt_ms: tReceipt - tSubmit,
      submit_to_terminal_ms: tTerminal - tSubmit,
      final_cursor: view.cursor,
      timeline_entries: view.timeline.length,
      run_terminal: /succeeded/.test(runsText)
        ? 'succeeded'
        : /cancelled/.test(runsText)
          ? 'cancelled'
          : 'failed',
    };
    writeEvalFile(
      'trajectory-view.json',
      JSON.stringify({ view, samples: series }, null, 2)
    );

    // --- cold replay equivalence ------------------------------------------
    await byId(page, 'lab-detach').click();
    await byId(page, 'lab-project-attach-input').fill(projectId);
    const tAttach = Date.now();
    await byId(page, 'lab-project-attach').click();
    await expect
      .poll(async () => (await cursorValue(page)).toString(), {
        timeout: 120_000,
      })
      .toBe(view.cursor);
    const tReplayed = Date.now();
    const replayView = await captureProjectView(page);
    await screenshot(page, '04-replay');
    summary.replay = {
      attach_to_cursor_ms: tReplayed - tAttach,
      runs_equal: replayView.runs === view.runs,
      timeline_equal:
        replayView.timeline.length === view.timeline.length &&
        replayView.timeline.every((t, i) => t === view.timeline[i]),
    };
    expect(summary.replay).toMatchObject({
      runs_equal: true,
      timeline_equal: true,
    });

    // --- network log ------------------------------------------------------
    const edgeOrigin = new URL(edgeBaseUrl).origin;
    const UPSTREAM_TELEMETRY = /^https:\/\/([a-z0-9-]+\.)*amplitude\.com\//;
    const httpRequests = requests.filter((r) => /^https?:/.test(r.url));
    summary.network = {
      http_requests: httpRequests.length,
      edge_requests: httpRequests.filter((r) => r.url.startsWith(edgeOrigin))
        .length,
      telemetry_requests: httpRequests.filter((r) =>
        UPSTREAM_TELEMETRY.test(r.url)
      ).length,
      off_edge: httpRequests.filter(
        (r) => !r.url.startsWith(edgeOrigin) && !UPSTREAM_TELEMETRY.test(r.url)
      ),
    };
    writeEvalFile(
      'network-log.json',
      JSON.stringify({ requests, responses }, null, 2)
    );

    summary.window_end = new Date().toISOString();
    writeEvalFile('eval-summary.json', JSON.stringify(summary, null, 2));
  } finally {
    await app.close();
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});
