// Local-browser eval (LB4): a REAL model drives the delegated browser — every
// browser_* call parks on the cloud edge and executes in the visible agent
// window on THIS machine — recorded on video. The proof anchor is a page this
// eval serves on 127.0.0.1 carrying a nonce fact that exists nowhere else:
// the cloud pod cannot reach this laptop's loopback, so the model answering
// with the fact is only possible if the desktop executed its browsing. The
// trajectory must additionally show the delegation events (all isolated),
// each settled by a tool_result, and published viewfinder frames.
//
// Visible-window laws (the 2026-08-19 demo lessons): settle on the server
// trajectory via bounded SSE reads — never on DOM state; never close the app
// before the terminal event (teardown CANCELS in-flight runs).
//
// Run: EIGENT_E2E_BOOTSTRAP=<bootstrap-cloud.json> \
//      npx playwright test --config e2e/eval.config.ts local-browser.eval
// Output: EIGENT_EVAL_DIR (default ../lb-evidence/eval).

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

const REPO_ROOT =
  process.env.EIGENT_E2E_APP_DIR ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOOTSTRAP_PATH =
  process.env.EIGENT_E2E_BOOTSTRAP ??
  path.resolve(REPO_ROOT, '../aion-v1/deploy/eigent-local/run/bootstrap.json');
const OUT_DIR =
  process.env.EIGENT_EVAL_DIR ??
  path.resolve(REPO_ROOT, '..', 'lb-evidence', 'eval');

const MODEL_ALIAS = process.env.EIGENT_EVAL_MODEL ?? 'kimi-k3';
const MODEL_LABEL = process.env.EIGENT_EVAL_MODEL_LABEL ?? 'Kimi K3';

const TURN_TIMEOUT_MS = 25 * 60_000;
const VIDEO_SIZE = { width: 1280, height: 800 };
const FRAME_PREFIX = 'aion-browser-frame-';

interface Bootstrap {
  api_key: string;
  edge_url: string;
  tenant_id: string;
}

const bootstrap: Bootstrap = JSON.parse(
  fs.readFileSync(BOOTSTRAP_PATH, 'utf-8')
);
const edgeBaseUrl = `${bootstrap.edge_url.replace(/\/+$/, '')}/eigent/v1`;

const RUN_TAG = `lb-eval-${Date.now().toString(36)}`;
// The fact the model must browse to learn. Random per run: no training-data
// or guessing path to it, and no collision with an earlier eval's page.
const PAGE_FACT = `LB-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;

function brief(origin: string): string {
  // Single-newline runs vanish inside the contenteditable composer, so
  // paragraphs join with blank lines only.
  return [
    `[${RUN_TAG}] Local desktop browsing task.`,
    `Use your browser tools to visit ${origin}/welcome and read the page. It states an access code.`,
    'Take a screenshot of the page with browser_get_screenshot once you can see the access code.',
    'Then finish with one sentence ending exactly with: ANSWER: <the access code>',
  ].join('\n\n');
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

/**
 * Flips the composer control to "Use my browser". The control only renders
 * once the support probe confirms both this build and the connected edge —
 * on a pre-1.22 edge this times out, which is the negative control's answer.
 */
async function enableLocalBrowser(page: Page): Promise<void> {
  const trigger = page.getByRole('button', { name: 'Cloud browser' });
  await trigger.waitFor({ state: 'visible', timeout: 30_000 });
  await trigger.click();
  await page
    .getByRole('menuitem')
    .filter({ hasText: 'Use my browser' })
    .click();
  await expect(
    page.getByRole('button', { name: 'Use my browser' })
  ).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Escape').catch(() => {});
}

// The window is visible on the user's screen; DOM state is not a reliable
// settle signal. The server trajectory is.
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

interface DelegationRow {
  delegation_id: string;
  tool_call_id: string;
  tool_name: string;
  session_mode: string;
}

interface TrajectoryFacts {
  terminal: string | null;
  frameArtifacts: number;
  delegations: DelegationRow[];
  settledToolCallIds: Set<string>;
  finalText: string;
}

function trajectoryFacts(events: string[]): TrajectoryFacts {
  const facts: TrajectoryFacts = {
    terminal: null,
    frameArtifacts: 0,
    delegations: [],
    settledToolCallIds: new Set(),
    finalText: '',
  };
  for (const raw of events) {
    try {
      const event = JSON.parse(raw) as {
        kind?: string;
        data?: {
          delegation_id?: string;
          tool_call_id?: string;
          tool_name?: string;
          session_mode?: string;
          text?: string;
          artifact?: { name?: string };
        };
      };
      const kind = event.kind ?? '';
      if (/^run_(completed|failed|cancelled)$/.test(kind)) {
        facts.terminal = kind;
      }
      if (kind === 'browser_delegation_requested' && event.data) {
        facts.delegations.push({
          delegation_id: event.data.delegation_id ?? '',
          tool_call_id: event.data.tool_call_id ?? '',
          tool_name: event.data.tool_name ?? '',
          session_mode: event.data.session_mode ?? '',
        });
      }
      if (kind === 'tool_result' && event.data?.tool_call_id) {
        facts.settledToolCallIds.add(event.data.tool_call_id);
      }
      if (kind === 'text_delta' && typeof event.data?.text === 'string') {
        facts.finalText += event.data.text;
      }
      if (
        kind === 'artifact_created' &&
        event.data?.artifact?.name?.startsWith(FRAME_PREFIX)
      ) {
        facts.frameArtifacts += 1;
      }
    } catch {
      // partial frame cut by the bounded read
    }
  }
  return facts;
}

/** One fixture hit as the server saw it — origin proof rides the UA. */
interface FixtureHit {
  method: string;
  url: string;
  userAgent: string;
}

test('local-browser eval: a real model browses on this desktop, on video', async () => {
  test.setTimeout(40 * 60_000);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-lbeval-'));
  const keyFile = path.join(workDir, 'edge-api-key');
  fs.writeFileSync(keyFile, bootstrap.api_key, { mode: 0o600 });

  // The desktop-only page: loopback of THIS machine, unreachable from any
  // pod. The access code is the browse-or-fail anchor.
  const hits: FixtureHit[] = [];
  const server = http.createServer((req, res) => {
    hits.push({
      method: req.method ?? '',
      url: req.url ?? '',
      userAgent: req.headers['user-agent'] ?? '',
    });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><html><head><title>Desktop Welcome</title></head><body>` +
        `<h1>Welcome</h1><p>The access code is <strong>${PAGE_FACT}</strong>.</p>` +
        `</body></html>`
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('fixture server has no port');
  }
  const fixtureOrigin = `http://127.0.0.1:${address.port}`;

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
    fixture_origin: fixtureOrigin,
    page_fact: PAGE_FACT,
    prompt: brief(fixtureOrigin),
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
    await enableLocalBrowser(page);
    await screenshot(page, '01-toggle-on');
    await typeIntoComposer(page, composer, brief(fixtureOrigin));
    await screenshot(page, '02-brief-typed');
    const tSubmit = Date.now();
    await composer.press('Enter');

    const projectIdOf = () =>
      requests
        .map((r) => /\/projects\/([^/?]+)\/commands/.exec(r.url)?.[1])
        .find((id): id is string => Boolean(id));

    // Trajectory-settled wait, photographing the app and the agent window
    // while the run browses — the agent window lives outside the renderer, so
    // its stills come from the main process.
    let shots = 0;
    let nextShot = 0;
    let terminal: string | null = null;
    const deadline = Date.now() + TURN_TIMEOUT_MS;
    for (;;) {
      if (Date.now() >= nextShot && shots < 14) {
        shots += 1;
        nextShot = Date.now() + 30_000;
        await screenshot(page, `03-run-${String(shots).padStart(2, '0')}`);
        const agentShot = (await app
          .evaluate(async ({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows().find((w) =>
              w.getTitle().includes('Eternyl agent browser')
            );
            if (!win) return null;
            const image = await win.webContents.capturePage();
            return image.isEmpty() ? null : image.toPNG().toString('base64');
          })
          .catch(() => null)) as string | null;
        if (agentShot) {
          fs.writeFileSync(
            path.join(
              OUT_DIR,
              `04-agent-window-${String(shots).padStart(2, '0')}.png`
            ),
            Buffer.from(agentShot, 'base64')
          );
        }
      }
      const id = projectIdOf();
      if (id) {
        terminal = trajectoryFacts(await fetchTrajectory(id)).terminal;
        if (terminal) break;
      }
      if (Date.now() > deadline) {
        throw new Error('the delegated run never reached a terminal event');
      }
      await new Promise((resolve) => setTimeout(resolve, 15_000));
    }
    summary.terminal_event = terminal;
    summary.turn_seconds = Math.round((Date.now() - tSubmit) / 1000);
    summary.project_id = projectIdOf();
    await screenshot(page, '05-settled');

    const facts = trajectoryFacts(
      await fetchTrajectory(String(summary.project_id))
    );
    summary.delegations = facts.delegations;
    summary.frame_artifacts = facts.frameArtifacts;
    summary.fixture_hits = hits.slice();
    summary.final_text_tail = facts.finalText.slice(-400);

    expect(terminal, 'the run ended on a non-success terminal event').toBe(
      'run_completed'
    );
    // The seam fired: real browser calls parked as delegations, all isolated,
    // and every one of them settled.
    expect(
      facts.delegations.length,
      'no browser call parked as a delegation'
    ).toBeGreaterThan(0);
    for (const d of facts.delegations) {
      expect(d.session_mode).toBe('isolated');
      expect(
        facts.settledToolCallIds.has(d.tool_call_id),
        `delegation ${d.delegation_id} (${d.tool_name}) never settled`
      ).toBe(true);
    }
    // The desktop executed them: the loopback server saw the page loads...
    expect(
      hits.length,
      'the fixture origin saw no traffic — nothing browsed from this desktop'
    ).toBeGreaterThan(0);
    // ...and the model learned the fact that exists only on that page.
    expect(
      facts.finalText.includes(PAGE_FACT),
      `the answer never carried the access code (tail: ${facts.finalText.slice(-200)})`
    ).toBe(true);
    // The viewfinder streamed: delegated frames became published artifacts.
    expect(
      facts.frameArtifacts,
      'the delegated run published no browser frames'
    ).toBeGreaterThan(0);
    summary.answered = true;
  } catch (error) {
    bodyFailed = true;
    throw error;
  } finally {
    writeOut('eval-summary.json', JSON.stringify(summary, null, 2));
    await app.close();
    server.close();
    if (video) {
      const recorded = await video.path().catch(() => null);
      if (recorded && fs.existsSync(recorded)) {
        const out = path.join(OUT_DIR, 'local-browser-run.webm');
        fs.copyFileSync(recorded, out);
        summary.video_bytes = fs.statSync(out).size;
        writeOut('eval-summary.json', JSON.stringify(summary, null, 2));
        if (!bodyFailed && (summary.video_bytes as number) < 200 * 1024) {
          throw new Error('recorded video is implausibly small');
        }
      }
    }
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});
