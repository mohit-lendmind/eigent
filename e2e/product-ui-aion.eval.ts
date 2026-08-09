// Experience-track driver (M6 train-1 preview): the REAL product chat UI —
// not the Integration Lab — in remote-backend mode against the live
// eigent-local Compose stack on the real kimi-k3 model. Boots to the
// workspace without the local brain, sends a task through the composer,
// and captures the streamed answer, the tool work log, screenshots, and an
// edge-only network audit.
//
// Run: npx playwright test --config e2e/eval.config.ts product-ui-aion
// Output: EIGENT_EVAL_DIR (default ../experience-track next to the repo).

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
  path.resolve(REPO_ROOT, '..', 'experience-track');

const RUN_TIMEOUT_MS = 8 * 60_000;

interface Bootstrap {
  api_key: string;
  edge_url: string;
  tenant_id: string;
}

const bootstrap: Bootstrap = JSON.parse(
  fs.readFileSync(BOOTSTRAP_PATH, 'utf-8')
);
const edgeBaseUrl = `${bootstrap.edge_url.replace(/\/+$/, '')}/eigent/v1`;

const PROMPT =
  'Use the shell to compute 17^3 and reply with exactly one line: RESULT=<value>';
const EXPECTED = 'RESULT=4913';
// The follow-up leans on conversation memory ("that result") so a correct
// answer proves the second command ran in the same aion Project with the
// first turn's history, not as a fresh conversation.
const FOLLOW_UP =
  'Add 87 to that result and reply with exactly one line: SECOND=<value>';
const FOLLOW_UP_EXPECTED = 'SECOND=5000';

function writeOut(name: string, payload: string): void {
  if (payload.includes(bootstrap.api_key)) {
    throw new Error(`output ${name} would leak the API key`);
  }
  fs.writeFileSync(path.join(OUT_DIR, name), payload);
}

async function screenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: path.join(OUT_DIR, `${name}.png`),
    fullPage: true,
  });
}

// The space-switch dropdown's focus trap can outlive its dismiss animation
// and reclaim focus mid-typing (its search box then swallows the keystrokes),
// so typing is verify-and-retry rather than fire-and-forget.
async function typeIntoComposer(
  page: Page,
  composer: ReturnType<Page['locator']>,
  text: string
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.keyboard.press('Escape').catch(() => {});
    await composer.click();
    await composer.pressSequentially(text, { delay: 5 });
    const got = (await composer.innerText()).trim();
    if (got === text) return;
    await composer.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
  }
  throw new Error('composer never captured the full prompt');
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

test('product chat UI serves a real task from the aion edge', async () => {
  test.setTimeout(RUN_TIMEOUT_MS + 120_000);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-exp-'));
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

  const app = await electron.launch({ args: [REPO_ROOT], cwd: REPO_ROOT, env });
  try {
    const page = await findMainWindow(app);
    const requests: { t: string; method: string; url: string }[] = [];
    page.on('request', (request) => {
      requests.push({
        t: new Date().toISOString(),
        method: request.method(),
        url: request.url(),
      });
    });
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await page.waitForTimeout(4_000);
    await screenshot(page, '01-boot');

    // The product shell must be reachable without the local brain: no login
    // page, no installation flow.
    await page
      .locator('[role="textbox"]')
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 });
    await screenshot(page, '02-workspace');

    // A fresh profile boots into the read-only legacy Space; a real user's
    // first step is creating a Space, so the driver does the same.
    await page.getByText('Legacy Space', { exact: true }).first().click();
    await page.getByText('Create a new space', { exact: true }).first().click();
    await page
      .getByText('Start from scratch', { exact: true })
      .first()
      .click();
    const composer = page
      .locator('[role="textbox"][contenteditable="true"]')
      .first();
    await composer.waitFor({ state: 'visible', timeout: 30_000 });
    // Let the space dropdown finish tearing down before touching the composer.
    await page
      .getByText('Create a new space', { exact: true })
      .waitFor({ state: 'hidden', timeout: 10_000 })
      .catch(() => {});
    await screenshot(page, '02b-new-space');

    await typeIntoComposer(page, composer, PROMPT);
    await screenshot(page, '03-composed');
    await composer.press('Enter');
    await page.waitForTimeout(2_000);
    await screenshot(page, '04-sent');

    // Terminal condition: the exact answer line rendered in the chat pane.
    const answer = page.getByText(EXPECTED, { exact: false }).first();
    const deadline = Date.now() + RUN_TIMEOUT_MS;
    let shots = 0;
    for (;;) {
      if (await answer.isVisible().catch(() => false)) break;
      if (Date.now() > deadline) {
        await screenshot(page, 'timeout-final');
        writeOut(
          'console-errors.json',
          JSON.stringify(consoleErrors, null, 2)
        );
        throw new Error('run did not surface the expected answer in time');
      }
      if (shots < 6 && requests.length > 0) {
        await screenshot(page, `05-progress-${shots++}`);
      }
      await page.waitForTimeout(5_000);
    }
    await screenshot(page, '06-answer');

    // Second turn in the same task pane: the "Ask a follow-up" composer
    // exercises the continue-conversation path (a new command on the same
    // aion Project → a new run projected into the same pane).
    const followUpComposer = page
      .locator('[role="textbox"][contenteditable="true"]')
      .first();
    await followUpComposer.waitFor({ state: 'visible', timeout: 30_000 });
    await typeIntoComposer(page, followUpComposer, FOLLOW_UP);
    await followUpComposer.press('Enter');
    await page.waitForTimeout(2_000);
    await screenshot(page, '07-follow-up-sent');

    const followUpAnswer = page
      .getByText(FOLLOW_UP_EXPECTED, { exact: false })
      .first();
    const followUpDeadline = Date.now() + RUN_TIMEOUT_MS;
    for (;;) {
      if (await followUpAnswer.isVisible().catch(() => false)) break;
      if (Date.now() > followUpDeadline) {
        await screenshot(page, 'timeout-follow-up');
        writeOut(
          'console-errors.json',
          JSON.stringify(consoleErrors, null, 2)
        );
        throw new Error('follow-up turn did not surface its answer in time');
      }
      await page.waitForTimeout(5_000);
    }
    // Both turns must remain rendered — the second run's projection may not
    // disturb the first turn's messages.
    await expect(page.getByText(EXPECTED, { exact: false }).first()).toBeVisible();
    await screenshot(page, '08-follow-up-answer');

    // Network audit: everything non-telemetry stays on the edge.
    const offEdge = requests.filter((r) => {
      const url = new URL(r.url);
      if (url.protocol === 'file:' || url.protocol === 'devtools:')
        return false;
      if (r.url.startsWith(edgeBaseUrl)) return false;
      return true;
    });
    writeOut(
      'network-log.json',
      JSON.stringify({ total: requests.length, off_edge: offEdge, requests }, null, 2)
    );
    writeOut('console-errors.json', JSON.stringify(consoleErrors, null, 2));
    writeOut(
      'summary.json',
      JSON.stringify(
        {
          captured_at: new Date().toISOString(),
          edge_base_url: edgeBaseUrl,
          prompt: PROMPT,
          expected: EXPECTED,
          follow_up: FOLLOW_UP,
          follow_up_expected: FOLLOW_UP_EXPECTED,
          answered: true,
          request_count: requests.length,
          off_edge_count: offEdge.length,
        },
        null,
        2
      )
    );
    expect(offEdge).toEqual([]);
  } finally {
    await app.close();
  }
});
