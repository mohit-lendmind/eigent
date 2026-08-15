// Real-model driver for connectors: authorize a connector through the REAL
// Connections screen, then ask a real provider a question only that connector
// can answer — and then revoke the grant and ask again.
//
// The second pass is what makes the first one mean anything. A model asked
// about "support ticket T-200" can always produce a confident sentence; the only
// evidence that the connector was actually used is that the SAME model, on the
// SAME stack, stops being able to answer the moment the grant is gone. So the
// oracle is a fact that exists nowhere but behind the connector — the canned
// summary cmd/connectorstub serves — asserted present in the granted pass and
// absent in the revoked one, in the UI and in the edge's own trajectory.
//
// The consent hop is intercepted at the `open-external` IPC handler in the main
// process, so the renderer, preload and IPC path stay real and no browser window
// opens on the machine running the eval. The leg itself is completed by fetching
// the consent URL the way a browser would.
//
// Run: npx playwright test --config e2e/eval.config.ts connectors
// Env: EIGENT_EVAL_MODEL / EIGENT_EVAL_MODEL_LABEL pick the catalog row;
//      the stack must be up with EIGENT_LOCAL_CONNECTORS=1.
// Output: EIGENT_EVAL_DIR (default ../n4-evidence/playwright/real-model).

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
  path.resolve(REPO_ROOT, '..', 'n4-evidence', 'playwright', 'real-model');

const MODEL_ALIAS = process.env.EIGENT_EVAL_MODEL ?? 'kimi-k3';
const MODEL_LABEL = process.env.EIGENT_EVAL_MODEL_LABEL ?? 'Kimi K3';

const CONNECTOR_ID = 'tickets';
/** Tools reach the model namespaced by their connector id. */
const TOOL_PREFIX = `${CONNECTOR_ID}__`;
/**
 * The ticket the stub serves, and the two facts about it that exist only there.
 * The summary is the oracle: a model that never called the tool has no way to
 * produce this sentence.
 */
const TICKET_ID = 'T-200';
const TICKET_STATUS = 'closed';
const TICKET_SUMMARY = 'Export CSV missing the trailing newline';

const FLIP_TIMEOUT_MS = 60_000;
const ANSWER_TIMEOUT_MS = 8 * 60_000;
const TERMINAL_TIMEOUT_MS = 10 * 60_000;
const VIDEO_SIZE = { width: 1280, height: 800 };
// A recording that never started is a few KB of container; a recorded run is
// megabytes. The floor separates the two without pinning a duration.
const MIN_VIDEO_BYTES = 200 * 1024;

interface Bootstrap {
  api_key: string;
  edge_url: string;
  tenant_id: string;
}

const bootstrap: Bootstrap = JSON.parse(
  fs.readFileSync(BOOTSTRAP_PATH, 'utf-8')
);
const edgeBaseUrl = `${bootstrap.edge_url.replace(/\/+$/, '')}/eigent/v1`;

/**
 * A per-invocation tag on every prompt, so a stack that has served this eval
 * before cannot supply the Project this run is looking for.
 */
const RUN_TAG = `n4-${Date.now().toString(36)}`;
const PROMPT =
  `[${RUN_TAG}] Look up support ticket ${TICKET_ID} with the tools available to ` +
  `you. Do not guess: if you cannot read the ticket, say exactly NO_ACCESS. ` +
  `Otherwise reply with exactly one line: TICKET=<status>|<summary>, copying the ` +
  `ticket's own status and summary verbatim.`;
const GRANTED_ANSWER = `TICKET=${TICKET_STATUS}`;

interface EdgeEvent {
  kind: string;
  sequence: string;
  data?: Record<string, unknown>;
}

interface EdgeConnector {
  connector_id: string;
  connected?: boolean;
  connectable?: boolean;
}

interface PassRecord {
  name: string;
  granted: boolean;
  project_id?: string;
  terminal?: string | null;
  event_kinds?: Record<string, number>;
  connector_tool_calls?: string[];
  connector_tool_results?: { is_error: boolean; carried_summary: boolean }[];
  summary_reached_the_screen?: boolean;
}

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

async function edgeFetch(method: string, pathname: string): Promise<Response> {
  return fetch(`${edgeBaseUrl}${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${bootstrap.api_key}` },
  });
}

async function servedRow(): Promise<EdgeConnector> {
  const response = await edgeFetch('GET', '/connectors');
  if (!response.ok) {
    throw new Error(
      `listConnectors: ${response.status} ${await response.text()}`
    );
  }
  const catalog = ((await response.json()) as { connectors: EdgeConnector[] })
    .connectors;
  const row = catalog.find((c) => c.connector_id === CONNECTOR_ID);
  if (!row) {
    throw new Error(
      `connector "${CONNECTOR_ID}" absent — bring the stack up with EIGENT_LOCAL_CONNECTORS=1`
    );
  }
  return row;
}

/** Soft revoke, idempotent — used to normalize the starting state. */
async function revoke(): Promise<void> {
  const response = await edgeFetch(
    'DELETE',
    `/connectors/${encodeURIComponent(CONNECTOR_ID)}/grant`
  );
  if (response.status !== 204) {
    throw new Error(`disconnect: ${response.status} ${await response.text()}`);
  }
}

/**
 * Replaces the main process's `open-external` handler so the consent URL is
 * recorded instead of handed to the OS. Only `shell.openExternal` is displaced;
 * the renderer, preload and IPC hop stay the real code path.
 */
async function captureExternalOpens(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    const opened: string[] = [];
    (globalThis as Record<string, unknown>).__e2eExternalOpens = opened;
    ipcMain.removeHandler('open-external');
    ipcMain.handle('open-external', (_event, url: string) => {
      opened.push(url);
      return { success: true };
    });
  });
}

async function externalOpens(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(
    () =>
      ((globalThis as Record<string, unknown>).__e2eExternalOpens as string[]) ??
      []
  );
}

/**
 * Does what the user's browser would: follows the consent URL to the auto-
 * approving stub and on through the redirect to the edge's callback. Nothing is
 * read back into the desktop — the grant is a server-side effect.
 */
async function completeConsent(authorizationUrl: string): Promise<void> {
  const response = await fetch(authorizationUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`consent leg: ${response.status} at ${response.url}`);
  }
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

/** A fresh Space, so each pass becomes its own aion Project. */
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

/**
 * Picks a provider the way a user does. The trigger carries the effective
 * alias's display name as its accessible name, so asserting that name after the
 * click is what proves the selection stuck rather than silently falling back.
 */
async function selectModel(page: Page, label: string): Promise<void> {
  const trigger = page.getByTestId('aion-model-select');
  await trigger.waitFor({ state: 'visible', timeout: 30_000 });
  await trigger.click();
  await page.getByRole('menuitem').filter({ hasText: label }).first().click();
  await expect(trigger).toHaveAccessibleName(label);
}

/**
 * The durable trajectory, straight from the edge's SSE replay: the run as the
 * product recorded it, independent of anything the renderer displayed.
 */
async function collectTrajectory(
  projectId: string
): Promise<{ events: EdgeEvent[]; terminal: string | null }> {
  const events: EdgeEvent[] = [];
  let terminal: string | null = null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TERMINAL_TIMEOUT_MS);
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
        if (
          ['run_completed', 'run_failed', 'run_cancelled'].includes(event.kind)
        ) {
          terminal = event.kind;
          break outer;
        }
      }
    }
  } catch (error) {
    if (!(error instanceof Error && error.name === 'AbortError')) throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return { events, terminal };
}

function countKinds(events: EdgeEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    counts[event.kind] = (counts[event.kind] ?? 0) + 1;
  }
  return counts;
}

function connectorToolCalls(events: EdgeEvent[]): string[] {
  return events
    .filter((event) => event.kind === 'tool_call')
    .map((event) => String(event.data?.tool_name ?? ''))
    .filter((name) => name.startsWith(TOOL_PREFIX));
}

/**
 * Tool results carrying the oracle. Settlement green is not result green — a
 * connector whose token was rejected still settles a tool_result — so both the
 * error flag and the body are recorded.
 */
function connectorToolResults(
  events: EdgeEvent[]
): { is_error: boolean; carried_summary: boolean }[] {
  const connectorCallIds = new Set(
    events
      .filter(
        (event) =>
          event.kind === 'tool_call' &&
          String(event.data?.tool_name ?? '').startsWith(TOOL_PREFIX)
      )
      .map((event) => String(event.data?.tool_call_id ?? ''))
  );
  return events
    .filter(
      (event) =>
        event.kind === 'tool_result' &&
        connectorCallIds.has(String(event.data?.tool_call_id ?? ''))
    )
    .map((event) => ({
      is_error: event.data?.is_error === true,
      carried_summary: String(event.data?.content ?? '').includes(
        TICKET_SUMMARY
      ),
    }));
}

/** The one Project id this pass created, taken off the command it submitted. */
function projectFrom(urls: string[], exclude: Set<string>): string {
  const found = [
    ...new Set(
      urls
        .map((url) => /\/projects\/([^/?]+)\/commands/.exec(url)?.[1])
        .filter((id): id is string => Boolean(id))
    ),
  ].filter((id) => !exclude.has(id));
  expect(found, 'no command was submitted for this pass').toHaveLength(1);
  return found[0];
}

test('a connector answers what the model cannot, and stops when revoked', async () => {
  test.setTimeout(45 * 60_000);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // The recording opens on a disconnected connector whatever an earlier run
  // left behind.
  await revoke();
  const before = await servedRow();
  expect(before.connected ?? false).toBe(false);
  expect(
    before.connectable,
    'the cell has no connector vault — bring the stack up with EIGENT_LOCAL_CONNECTORS=1'
  ).toBe(true);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-n4-'));
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

  const granted: PassRecord = { name: 'granted', granted: true };
  const revoked: PassRecord = { name: 'revoked', granted: false };
  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
    run_tag: RUN_TAG,
    model_alias: MODEL_ALIAS,
    connector_id: CONNECTOR_ID,
    ticket: { id: TICKET_ID, status: TICKET_STATUS, summary: TICKET_SUMMARY },
    prompt: PROMPT,
    passes: [granted, revoked],
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
    await captureExternalOpens(app);
    const requestUrls: string[] = [];
    page.on('request', (request) => requestUrls.push(request.url()));
    await page
      .locator('[role="textbox"]')
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 });

    // ---- Authorize the connector through the screen the user would use. ----
    await page.evaluate(() => {
      window.location.hash = '#/history?tab=connectors';
    });
    await page.reload();
    await expect(page.getByTestId('aion-connectors')).toBeVisible({
      timeout: 60_000,
    });
    const row = page.locator(
      `[data-testid="aion-connector-row"][data-connector-id="${CONNECTOR_ID}"]`
    );
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute('data-connected', 'false');
    await screenshot(page, '01-disconnected');

    await row.getByTestId('aion-connector-connect').click();
    await expect(row.getByTestId('aion-connector-awaiting')).toHaveCount(1);
    const opens = await externalOpens(app);
    expect(opens, 'the desktop never handed a consent URL to the browser').toHaveLength(
      1
    );
    await completeConsent(opens[0]);
    // The screen's own poll is what notices — in production nothing tells the
    // renderer the browser leg finished.
    await expect(row).toHaveAttribute('data-connected', 'true', {
      timeout: FLIP_TIMEOUT_MS,
    });
    expect((await servedRow()).connected).toBe(true);
    await screenshot(page, '02-connected');

    // ---- Pass 1: the question only the connector can answer. --------------
    const composerA = await newSpace(page);
    await selectModel(page, MODEL_LABEL);
    const createA = page
      .waitForRequest(
        (request) =>
          request.method() === 'POST' &&
          request.url() === `${edgeBaseUrl}/projects`,
        { timeout: 60_000 }
      )
      .then((request) => request.postData() ?? '');
    await typeIntoComposer(page, composerA, PROMPT);
    await composerA.press('Enter');
    const postedA = JSON.parse((await createA) || '{}') as {
      model_alias?: string;
    };
    expect(
      postedA.model_alias,
      "the picker's choice never reached the create"
    ).toBe(MODEL_ALIAS);
    await screenshot(page, '03-granted-sent');

    await page
      .getByText(GRANTED_ANSWER, { exact: false })
      .first()
      .waitFor({ state: 'visible', timeout: ANSWER_TIMEOUT_MS });
    granted.summary_reached_the_screen = await page
      .getByText(TICKET_SUMMARY, { exact: false })
      .first()
      .isVisible();
    expect(
      granted.summary_reached_the_screen,
      'the answer never carried the ticket text the connector holds'
    ).toBe(true);
    await screenshot(page, '04-granted-answered');

    const projectA = projectFrom(requestUrls, new Set());
    granted.project_id = projectA;
    const trajectoryA = await collectTrajectory(projectA);
    granted.terminal = trajectoryA.terminal;
    granted.event_kinds = countKinds(trajectoryA.events);
    granted.connector_tool_calls = connectorToolCalls(trajectoryA.events);
    granted.connector_tool_results = connectorToolResults(trajectoryA.events);
    expect(trajectoryA.terminal, 'the granted run did not complete').toBe(
      'run_completed'
    );
    // The product's own record has to show the connector tool being called —
    // an answer alone could have come from the model.
    expect(
      granted.connector_tool_calls,
      'no connector tool appears in the trajectory'
    ).not.toHaveLength(0);
    // Settlement green is not result green: a rejected token still settles.
    expect(
      granted.connector_tool_results.some(
        (result) => !result.is_error && result.carried_summary
      ),
      'no connector tool result carried the ticket text'
    ).toBe(true);

    // ---- Pass 2: the grant is gone, and so is the answer. ------------------
    await page.evaluate(() => {
      window.location.hash = '#/history?tab=connectors';
    });
    await page.reload();
    await expect(page.getByTestId('aion-connectors')).toBeVisible({
      timeout: 60_000,
    });
    await row.getByTestId('aion-connector-disconnect').click();
    await expect(row).toHaveAttribute('data-connected', 'false', {
      timeout: FLIP_TIMEOUT_MS,
    });
    expect((await servedRow()).connected ?? false).toBe(false);
    await screenshot(page, '05-revoked');

    const composerB = await newSpace(page);
    await selectModel(page, MODEL_LABEL);
    await typeIntoComposer(page, composerB, PROMPT);
    await composerB.press('Enter');
    await screenshot(page, '06-revoked-sent');

    const projectB = projectFrom(requestUrls, new Set([projectA]));
    revoked.project_id = projectB;
    const trajectoryB = await collectTrajectory(projectB);
    revoked.terminal = trajectoryB.terminal;
    revoked.event_kinds = countKinds(trajectoryB.events);
    revoked.connector_tool_calls = connectorToolCalls(trajectoryB.events);
    revoked.connector_tool_results = connectorToolResults(trajectoryB.events);
    expect(trajectoryB.terminal, 'the revoked run never settled').toBeTruthy();
    // The control. Whatever the model chose to say, the ticket text is a fact it
    // could only have obtained through a grant it no longer holds.
    expect(
      revoked.connector_tool_results.some((result) => result.carried_summary),
      'the revoked run still read the ticket'
    ).toBe(false);
    revoked.summary_reached_the_screen = await page
      .getByText(TICKET_SUMMARY, { exact: false })
      .first()
      .isVisible()
      .catch(() => false);
    expect(
      revoked.summary_reached_the_screen,
      'the ticket text reached the screen without a grant'
    ).toBe(false);
    await screenshot(page, '07-revoked-answered');

    // The consent hand-off happened exactly once, at the moment the user asked
    // for it — nothing reopened it while polling or revoking.
    expect(await externalOpens(app)).toHaveLength(1);

    const offEdge = requestUrls.filter((url) => {
      const parsed = new URL(url);
      if (parsed.protocol === 'file:' || parsed.protocol === 'devtools:') {
        return false;
      }
      return !url.startsWith(edgeBaseUrl);
    });
    summary.off_edge_requests = offEdge;
    summary.request_count = requestUrls.length;
    expect(offEdge).toEqual([]);
    expect(
      requestUrls.filter((url) => /^https?:/.test(url)).length,
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
      videoName = 'connectors-run.webm';
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
