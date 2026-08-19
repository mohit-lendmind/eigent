// Cloud demo driver (user request 2026-08-19): open the real desktop app
// against cell-dev-1 and run a deep-research task similar to the 2026-08-18
// Micron run — investor base, volatility drivers, financials & AI positioning,
// finishing in an interactive HTML dashboard. Records video and stage
// screenshots; the plan panel and artifact registry now capture what the
// original run lost (the A1–A4 train).
//
// Run: EIGENT_E2E_BOOTSTRAP=<bootstrap-cloud.json> \
//      npx playwright test --config e2e/eval.config.ts deep-research-demo
// Output: EIGENT_EVAL_DIR (default ../cloud-demo-deep-research).

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
const OUT_DIR =
  process.env.EIGENT_EVAL_DIR ??
  path.resolve(REPO_ROOT, '..', 'cloud-demo-deep-research');

const MODEL_ALIAS = process.env.EIGENT_EVAL_MODEL ?? 'kimi-k3';
const MODEL_LABEL = process.env.EIGENT_EVAL_MODEL_LABEL ?? 'Kimi K3';

const TURN_TIMEOUT_MS = 30 * 60_000;
const VIDEO_SIZE = { width: 1280, height: 800 };
const DASHBOARD = 'mu-dashboard.html';

interface Bootstrap {
  api_key: string;
  edge_url: string;
  tenant_id: string;
}

const bootstrap: Bootstrap = JSON.parse(
  fs.readFileSync(BOOTSTRAP_PATH, 'utf-8')
);
const edgeBaseUrl = `${bootstrap.edge_url.replace(/\/+$/, '')}/eigent/v1`;

const RUN_TAG = `mu-demo-${Date.now().toString(36)}`;

// Single-newline runs vanish inside the contenteditable composer, so
// paragraphs join with blank lines only.
const RESEARCH_BRIEF = [
  `[${RUN_TAG}] Deep research task — Micron Technology (MU) investor briefing.`,
  'Research three areas: (1) the investor base and ownership structure; (2) the main volatility drivers for the stock, including memory-cycle pricing across DRAM, NAND and HBM, guidance revisions, and export-control exposure; (3) financials and AI positioning — revenue trend, margins, and the HBM roadmap versus SK hynix and Samsung.',
  'Plan the work with your todo tool first and keep the plan updated as steps finish. Save each research area to its own markdown file in /workspace as you go.',
  `Then build one self-contained interactive HTML dashboard at /workspace/${DASHBOARD} covering all three areas with at least one chart, and publish it with the publish_artifact tool.`,
  'Finish with a one-paragraph investment summary ending exactly with: ANSWER: MU_RESEARCH_DONE',
].join('\n\n');
const DONE_MARKER = 'MU_RESEARCH_DONE';

// The window is open on the user's screen and they may click around (Home,
// panels) while the run works — DOM state is not a reliable settle signal.
// The server trajectory is: poll a bounded SSE read for a terminal run event.
async function fetchTrajectory(projectId: string): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  let buffer = '';
  try {
    const response = await fetch(
      `${edgeBaseUrl}/projects/${projectId}/events?after=0`,
      {
        headers: {
          authorization: `Bearer ${bootstrap.api_key}`,
          accept: 'text/event-stream',
        },
        signal: controller.signal,
      }
    );
    if (!response.ok || !response.body) return [];
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }
  } catch {
    // the abort is the expected way out of an infinite stream
  } finally {
    clearTimeout(timer);
  }
  return buffer
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice('data: '.length));
}

function terminalKind(events: string[]): string | null {
  for (const raw of events) {
    try {
      const kind = (JSON.parse(raw) as { kind?: string }).kind ?? '';
      if (/^run_(completed|failed|canceled)$/.test(kind)) return kind;
    } catch {
      // partial frame cut by the bounded read
    }
  }
  return null;
}

function writeOut(name: string, payload: string): void {
  if (payload.includes(bootstrap.api_key)) {
    throw new Error(`output ${name} would leak the API key`);
  }
  fs.writeFileSync(path.join(OUT_DIR, name), payload);
}

async function screenshot(page: Page, name: string): Promise<void> {
  await page
    .screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: true })
    .catch(() => {});
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

async function typeIntoComposer(
  page: Page,
  composer: ReturnType<Page['locator']>,
  text: string
): Promise<void> {
  const want = text.replace(/\s+/g, ' ').trim();
  let last = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.keyboard.press('Escape').catch(() => {});
    await composer.click();
    await page.keyboard.insertText(text);
    const got = (await composer.innerText()).replace(/\s+/g, ' ').trim();
    if (got === want) return;
    last = got;
    await composer.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
  }
  throw new Error(
    `composer never captured the full prompt\n  got:  ${last}\n  want: ${want}`
  );
}

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

async function selectModel(page: Page, label: string): Promise<void> {
  const trigger = page.getByTestId('aion-model-select');
  await trigger.waitFor({ state: 'visible', timeout: 30_000 });
  await trigger.click();
  await page.getByRole('menuitem').filter({ hasText: label }).first().click();
  await expect(trigger).toHaveAccessibleName(label);
}

/** Wait for a terminal run event server-side, screenshotting as it works. */
async function settleWithScreenshots(
  page: Page,
  projectId: () => string | undefined
): Promise<{ shots: number; terminal: string }> {
  const deadline = Date.now() + TURN_TIMEOUT_MS;
  let shots = 0;
  let nextShot = Date.now() + 45_000;
  for (;;) {
    const id = projectId();
    if (id) {
      const kind = terminalKind(await fetchTrajectory(id));
      if (kind) return { shots, terminal: kind };
    }
    if (Date.now() > deadline) {
      throw new Error('the research run never reached a terminal event');
    }
    if (Date.now() >= nextShot && shots < 14) {
      shots += 1;
      nextShot = Date.now() + 120_000;
      await screenshot(page, `02-progress-${String(shots).padStart(2, '0')}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
}

/** The user may have clicked to Home mid-run; re-enter the session view. */
async function ensureSessionView(page: Page): Promise<void> {
  const inSession = await page
    .getByText('Ask a follow-up')
    .first()
    .isVisible()
    .catch(() => false);
  if (inSession) return;
  await page
    .getByText(`[${RUN_TAG}]`)
    .first()
    .click({ timeout: 15_000 })
    .catch(() => {});
  await page
    .getByText('Ask a follow-up')
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 })
    .catch(() => {});
}

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

test('cloud deep-research demo: Micron investor briefing on kimi-k3', async () => {
  test.setTimeout(45 * 60_000);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-demo-'));
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

  const videoDir = path.join(OUT_DIR, 'video');
  fs.rmSync(videoDir, { recursive: true, force: true });

  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
    model_alias: MODEL_ALIAS,
    run_tag: RUN_TAG,
    prompt: RESEARCH_BRIEF,
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
    const requests: { method: string; url: string }[] = [];
    page.on('request', (request) => {
      requests.push({ method: request.method(), url: request.url() });
    });

    await page
      .locator('[role="textbox"]')
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 });

    const composer = await newSpace(page);
    await selectModel(page, MODEL_LABEL);
    const created = page
      .waitForRequest(
        (request) =>
          request.method() === 'POST' &&
          request.url() === `${edgeBaseUrl}/projects`,
        { timeout: 60_000 }
      )
      .then((request) => request.postData() ?? '')
      .catch(() => '');
    await typeIntoComposer(page, composer, RESEARCH_BRIEF);
    await screenshot(page, '01-brief-typed');
    const tSubmit = Date.now();
    await composer.press('Enter');
    const posted = JSON.parse((await created) || '{}') as {
      model_alias?: string;
    };
    expect(
      posted.model_alias,
      "the picker's choice never reached the create"
    ).toBe(MODEL_ALIAS);

    const projectIdOf = () =>
      requests
        .map((r) => /\/projects\/([^/?]+)\/commands/.exec(r.url)?.[1])
        .find((id): id is string => Boolean(id));

    const { shots, terminal } = await settleWithScreenshots(page, projectIdOf);
    summary.terminal_event = terminal;
    summary.turn_seconds = Math.round((Date.now() - tSubmit) / 1000);
    summary.progress_screenshots = shots;
    summary.project_id = projectIdOf();

    await ensureSessionView(page);
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    await screenshot(page, '03-settled');

    const bodyText = normalize(await page.locator('body').innerText());
    summary.answered = bodyText.includes(DONE_MARKER);

    // Demo garnish, not gates: open the dashboard artifact if its card is
    // there, and record what the plan section shows.
    try {
      await page
        .locator(`[data-artifact-card="${DASHBOARD}"]`)
        .first()
        .getByRole('button', { name: 'Open', exact: true })
        .click({ timeout: 15_000 });
      await page
        .locator('[data-artifact-ready="1"]')
        .waitFor({ state: 'visible', timeout: 60_000 });
      summary.dashboard_opened = true;
      await screenshot(page, '04-dashboard-viewer');
    } catch {
      summary.dashboard_opened = false;
      await screenshot(page, '04-no-dashboard-card');
    }

    const edgeOrigin = new URL(edgeBaseUrl).origin;
    const presigned = /[?&]x-(amz|goog)-signature=/i;
    summary.non_edge_requests = requests
      .filter((r) => /^https?:/.test(r.url))
      .filter((r) => !r.url.startsWith(edgeOrigin))
      .filter((r) => !presigned.test(r.url))
      .map((r) => r.url);

    expect(
      terminal,
      'the run ended on a non-success terminal event'
    ).toBe('run_completed');
    expect(summary.answered, `the run never reported ${DONE_MARKER}`).toBe(
      true
    );
  } catch (error) {
    bodyFailed = true;
    throw error;
  } finally {
    writeOut('demo-summary.json', JSON.stringify(summary, null, 2));
    await app.close();
    if (video) {
      const recorded = await video.path().catch(() => null);
      if (recorded && fs.existsSync(recorded)) {
        const out = path.join(OUT_DIR, 'deep-research-run.webm');
        fs.copyFileSync(recorded, out);
        summary.video_bytes = fs.statSync(out).size;
        writeOut('demo-summary.json', JSON.stringify(summary, null, 2));
        if (!bodyFailed && (summary.video_bytes as number) < 200 * 1024) {
          throw new Error('recorded video is implausibly small');
        }
      }
    }
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});
