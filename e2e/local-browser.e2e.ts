// Local-browser desktop E2E: the INVERSION of human-browser.e2e.ts. There the
// agent must never touch the desktop browser; here a run submitted with
// browser_execution=local delegates every browser_* call to a visible window
// on this desktop, and the proof obligations flip accordingly:
//   - the fixture server MUST see hits, and they must come from the desktop
//     (a Chrome UA on the host loopback — a sandbox pod cannot reach it);
//   - the trajectory carries one browser_delegation_requested per action,
//     each session_mode=isolated, each paired with a tool_result whose body
//     keeps the pod-mode format (url:/snapshot refs/screenshot name);
//   - the evidence still publishes SERVER-side: viewfinder frames and the
//     screenshot are artifacts on the edge, same as a pod run.
// Folded in: the Take Control smoke (D3 pause-and-fail) — with control taken,
// a second delegated run settles cleanly with every action answered by the
// in-band takeover error and the fixture server untouched. A separate
// pod-mode test is the negative control: same model alias, toggle left on
// Cloud, zero delegation events and zero fixture hits.
//
// Stack requirements (skipped cleanly when absent):
//   AION_BROWSER_TEMPLATE=browser-workspace EIGENT_LOCAL_FIXTURE_PICKER=1 \
//     bazel run //dev/eigent_local:up                            (in aion-v1)
//   EIGENT_E2E_FIXTURE_PICKER=1 EIGENT_E2E_BROWSER_MODE=1 \
//     npx playwright test --config e2e/playwright.config.ts local-browser
// (The delegated tests need only the fixture picker; the pod-mode control
// additionally needs the browser template.)

import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
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

// The fixture-picker display name of the aion-local-browser fakeroute alias.
const MODEL_LABEL = 'Aion Local Browser';

const DELEGATED_TOOLS = [
  'browser_visit_page',
  'browser_get_page_snapshot',
  'browser_click',
  'browser_type',
  'browser_get_screenshot',
];

const TERMINAL_KINDS = ['run_completed', 'run_failed', 'run_cancelled'];
const TERMINAL_TIMEOUT_MS = 120_000;

interface Bootstrap {
  api_key: string;
  edge_url: string;
  tenant_id: string;
}

interface EdgeArtifact {
  artifact_id: string;
  name: string;
  media_type: string;
  sha256: string;
  size_bytes: string;
  version: number;
}

/** One trajectory event, keeping the fields these assertions pair on. */
interface TrajectoryEvent {
  kind: string;
  delegationId?: string;
  toolCallId?: string;
  toolName?: string;
  sessionMode?: string;
  argumentsJson?: string;
  content?: string;
  isError?: boolean;
  artifactName?: string;
  text?: string;
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
let delegationsServed = false;
let workDir: string;
let keyFile: string;

test.beforeAll(async () => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-lbr-'));
  if (bootstrap && edgeBaseUrl) {
    try {
      const response = await fetch(`${edgeBaseUrl}/status`, {
        signal: AbortSignal.timeout(3_000),
      });
      edgeReady = response.ok;
      if (edgeReady) {
        const status = (await response.json()) as {
          edge_api_version?: string;
        };
        // Delegated browser execution shipped in 1.22.0.
        const [major, minor] = (status.edge_api_version ?? '0.0.0')
          .split('.')
          .map(Number);
        delegationsServed = major === 1 && minor >= 22;
      }
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

// The space-switch dropdown's focus trap can outlive its dismiss animation and
// reclaim focus mid-typing, so typing is verify-and-retry (the same guard the
// skills suites carry).
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
  throw new Error('composer never captured the full query');
}

/** A fresh Space, so the scenario gets its own Project on the edge. */
async function newSpaceComposer(
  page: Page
): Promise<ReturnType<Page['locator']>> {
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
 * Flip the composer's browser-execution toggle. The trigger renders only when
 * the support probe accepted the connected edge, so its presence is itself an
 * assertion that the 1.22 floor gates the affordance.
 */
async function setBrowserExecution(page: Page, local: boolean): Promise<void> {
  const want = local ? 'Use my browser' : 'Cloud browser';
  const trigger = page
    .getByRole('button', { name: /^(Cloud browser|Use my browser)$/ })
    .first();
  await trigger.waitFor({ state: 'visible', timeout: 30_000 });
  await trigger.click();
  await page.getByRole('menuitem').filter({ hasText: want }).first().click();
  await expect(trigger).toHaveAccessibleName(want);
  await page.keyboard.press('Escape').catch(() => {});
}

async function screenshot(page: Page, name: string): Promise<void> {
  if (!EVIDENCE_DIR) return;
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `eigent-lbr-${name}.png`),
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

/**
 * Viewfinder frames arrive under presigned grants (a signed GET on the object
 * store) — the one legitimate off-edge fetch, recognizable by the signature
 * on the query.
 */
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

async function edgeFetch(method: string, pathname: string): Promise<Response> {
  return fetch(`${edgeBaseUrl}${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${bootstrap!.api_key}` },
  });
}

async function findProjectByTitle(nonce: string): Promise<string> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const response = await edgeFetch('GET', '/projects');
    if (response.ok) {
      const page = (await response.json()) as {
        projects?: { project: { project_id: string; title: string } }[];
      };
      const hit = (page.projects ?? []).find((entry) =>
        entry.project.title.includes(nonce)
      );
      if (hit) return hit.project.project_id;
    }
    if (Date.now() > deadline) {
      throw new Error(`no project titled with ${nonce} appeared on the edge`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

/** The Project's trajectory until the Nth terminal kind. */
async function collectEvents(
  projectId: string,
  terminals: number
): Promise<TrajectoryEvent[]> {
  const events: TrajectoryEvent[] = [];
  let seen = 0;
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
        if (!data) continue; // retry hint or keep-alive comment
        const parsed = JSON.parse(data) as {
          kind: string;
          data?: {
            delegation_id?: string;
            tool_call_id?: string;
            tool_name?: string;
            session_mode?: string;
            arguments_json?: string;
            content?: string;
            is_error?: boolean;
            text?: string;
            artifact?: { name?: string };
          };
        };
        const d = parsed.data ?? {};
        const event: TrajectoryEvent = { kind: parsed.kind };
        if (parsed.kind === 'browser_delegation_requested') {
          event.delegationId = d.delegation_id;
          event.toolCallId = d.tool_call_id;
          event.toolName = d.tool_name;
          event.sessionMode = d.session_mode;
          event.argumentsJson = d.arguments_json;
        } else if (parsed.kind === 'tool_result') {
          event.toolCallId = d.tool_call_id;
          event.content = d.content;
          event.isError = d.is_error;
        } else if (parsed.kind === 'tool_call') {
          event.toolCallId = d.tool_call_id;
          event.toolName = d.tool_name;
        } else if (parsed.kind === 'text_delta') {
          event.text = d.text;
        } else if (
          parsed.kind === 'artifact_created' &&
          typeof d.artifact?.name === 'string'
        ) {
          event.artifactName = d.artifact.name;
        }
        events.push(event);
        if (TERMINAL_KINDS.includes(parsed.kind)) {
          seen++;
          if (seen >= terminals) return events;
        }
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return events;
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function listArtifacts(projectId: string): Promise<EdgeArtifact[]> {
  const response = await edgeFetch(
    'GET',
    `/projects/${encodeURIComponent(projectId)}/artifacts`
  );
  if (!response.ok) {
    throw new Error(`listArtifacts: ${response.status}`);
  }
  return (
    ((await response.json()) as { artifacts?: EdgeArtifact[] }).artifacts ?? []
  );
}

/** Delegation → its paired tool_result within the same event window. */
function pairedResult(
  events: TrajectoryEvent[],
  delegation: TrajectoryEvent
): TrajectoryEvent | undefined {
  const at = events.indexOf(delegation);
  return events.find(
    (e, i) =>
      i > at && e.kind === 'tool_result' && e.toolCallId === delegation.toolCallId
  );
}

interface FixtureHit {
  method: string;
  url: string;
  userAgent: string;
}

/**
 * The page the AGENT drives: a button and a text input, so the fixture
 * script's tag-targeted ref parsing has one unambiguous target each. Served
 * by this test on host loopback — reachable from the desktop's own browser,
 * unreachable from a sandbox pod.
 */
function fixtureServer(hits: FixtureHit[]): http.Server {
  return http.createServer((req, res) => {
    hits.push({
      method: req.method ?? '',
      url: req.url ?? '',
      userAgent: req.headers['user-agent'] ?? '',
    });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      '<!doctype html><html><head><title>Delegated Browser Fixture</title></head>' +
        '<body><h1>Delegated Browser Fixture</h1>' +
        '<button id="go" onclick="document.getElementById(\'go\').textContent=\'Went\'">Go</button>' +
        '<label>message <input type="text" name="message"></label>' +
        '</body></html>'
    );
  });
}

async function listenOn(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('fixture server has no port');
  }
  return `http://127.0.0.1:${address.port}`;
}

/**
 * The Take Control strip lives on the browser card inside the expanded
 * workforce overlay, reached the way a user reaches it: expand the workforce,
 * then pick the browser agent from the strip. The overlay is modal — the
 * composer is unreachable while it is open — so callers that need to type
 * afterwards close it again with closeWorkforceOverlay.
 */
async function openBrowserWorkspace(page: Page): Promise<void> {
  const filmstrip = page.getByTestId('browser-filmstrip');
  if (await filmstrip.isVisible().catch(() => false)) return;
  const browserToggle = page.locator(
    '[data-testid="workforce-agent-toggle"][data-agent-type="browser_agent"]'
  );
  if (!(await browserToggle.isVisible().catch(() => false))) {
    await page
      .getByRole('button', { name: 'Expand workforce' })
      .click({ timeout: 30_000 });
  }
  await expect(browserToggle).toBeEnabled({ timeout: 30_000 });
  await browserToggle.click();
  await filmstrip.waitFor({ state: 'visible', timeout: 30_000 });
}

async function closeWorkforceOverlay(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page
    .getByTestId('browser-filmstrip')
    .waitFor({ state: 'hidden', timeout: 15_000 });
}

test('a delegated run drives the desktop browser and pauses under Take Control', async () => {
  test.skip(
    !bootstrap || !edgeReady || !APP_BUILT,
    'eigent-local stack not running or app not built'
  );
  test.skip(
    !delegationsServed,
    'this stack predates delegated browser execution (edge API < 1.22)'
  );
  test.skip(
    process.env.EIGENT_E2E_FIXTURE_PICKER !== '1',
    'needs the fixture-picker stack (EIGENT_LOCAL_FIXTURE_PICKER=1 up + EIGENT_E2E_FIXTURE_PICKER=1)'
  );
  test.setTimeout(300_000);
  const stamp = Date.now();
  const runNonce = `lbr-e2e-${stamp}`;
  const takenNonce = `lbr-taken-${stamp}`;

  const hits: FixtureHit[] = [];
  const server = fixtureServer(hits);
  const fixtureOrigin = await listenOn(server);
  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
    model_label: MODEL_LABEL,
    fixture_origin: fixtureOrigin,
  };

  const networkUrls: string[] = [];
  let app: ElectronApplication | undefined;
  try {
    const launched = await launchApp();
    app = launched.app;
    const page = launched.page;
    page.on('request', (request) => networkUrls.push(request.url()));

    // ---- Turn 1: one delegated run. Model and execution mode both bind at
    // submit, so the toggle flip must precede Enter — after it, D4 makes the
    // run immutable.
    const composer = await newSpaceComposer(page);
    await selectModel(page, MODEL_LABEL);
    await setBrowserExecution(page, true);
    await screenshot(page, 'toggle-local');
    await typeIntoComposer(
      page,
      composer,
      `Drive the delegated browser fixture at ${fixtureOrigin}/fixture. ${runNonce}`
    );
    await composer.press('Enter');
    const projectId = await findProjectByTitle(runNonce);
    summary.project_id = projectId;

    const firstRun = await collectEvents(projectId, 1);
    summary.first_terminal = firstRun[firstRun.length - 1]?.kind;
    expect(summary.first_terminal).toBe('run_completed');

    // ---- The delegation chain: one request per scripted action, in script
    // order, all isolated-session, each answered by a non-error result.
    const delegations = firstRun.filter(
      (e) => e.kind === 'browser_delegation_requested'
    );
    expect(delegations.map((d) => d.toolName)).toEqual(DELEGATED_TOOLS);
    expect(new Set(delegations.map((d) => d.delegationId)).size).toBe(
      DELEGATED_TOOLS.length
    );
    for (const delegation of delegations) {
      expect(delegation.sessionMode).toBe('isolated');
      const result = pairedResult(firstRun, delegation);
      expect(
        result,
        `no tool_result paired with ${delegation.toolName}`
      ).toBeDefined();
      expect(result!.isError).toBe(false);
    }
    summary.delegation_ids = delegations.map((d) => d.delegationId);

    // The visit was told OUR origin, and its result body keeps the pod-mode
    // format: the landed URL line plus a snapshot with minted refs.
    expect(delegations[0].argumentsJson).toContain(fixtureOrigin);
    const visitResult = pairedResult(firstRun, delegations[0])!;
    expect(visitResult.content).toContain(`url: ${fixtureOrigin}/fixture`);
    expect(visitResult.content).toContain('- [e');
    const clickResult = pairedResult(firstRun, delegations[2])!;
    expect(clickResult.content).toContain('- [e');
    const shotResult = pairedResult(firstRun, delegations[4])!;
    expect(shotResult.content).toMatch(/screenshot-1\.png/);

    // ---- The inverted core: the fixture server DID see the run, and the
    // visitor was this desktop's browser, not a pod.
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].method).toBe('GET');
    expect(hits[0].url).toBe('/fixture');
    expect(hits[0].userAgent).toContain('Chrome');
    const hitsAfterRun = hits.length;
    summary.fixture_hits = hits.map((h) => `${h.method} ${h.url}`);
    summary.fixture_user_agent = hits[0].userAgent;

    // The model's final text closes the loop over the last tool result.
    const runText = firstRun.map((e) => e.text ?? '').join('');
    expect(runText).toContain('local browser sequence complete');

    // ---- Server-side evidence is mode-independent: frames and the
    // screenshot are published artifacts exactly as in a pod run.
    const artifacts = await listArtifacts(projectId);
    const frames = artifacts.filter((a) =>
      /^aion-browser-frame-\d+\.jpg$/.test(a.name)
    );
    expect(frames.length).toBeGreaterThan(0);
    const shots = artifacts.filter((a) => a.name === 'screenshot-1.png');
    expect(shots).toHaveLength(1);
    expect(shots[0].media_type).toBe('image/png');
    summary.frame_artifacts = frames.map((a) => a.name);
    await screenshot(page, 'delegated-settled');

    // ---- Take Control (D3): control taken BETWEEN runs holds until given
    // back, so every delegation of the next run is answered by the in-band
    // takeover error — the run still settles, and the desktop browser saw
    // nothing.
    await openBrowserWorkspace(page);
    const takeControl = page.getByRole('button', { name: 'Take control' });
    await takeControl.waitFor({ state: 'visible', timeout: 30_000 });
    await takeControl.click();
    const giveBack = page.getByRole('button', { name: 'Give back to agent' });
    await giveBack.waitFor({ state: 'visible', timeout: 15_000 });
    await screenshot(page, 'taken');
    await closeWorkforceOverlay(page);

    const sessionComposer = page
      .locator('[role="textbox"][contenteditable="true"]')
      .first();
    await typeIntoComposer(
      page,
      sessionComposer,
      `Drive the delegated browser fixture at ${fixtureOrigin}/fixture. ${takenNonce}`
    );
    await sessionComposer.press('Enter');

    const bothRuns = await collectEvents(projectId, 2);
    const firstTerminalAt = bothRuns.findIndex((e) =>
      TERMINAL_KINDS.includes(e.kind)
    );
    const secondRun = bothRuns.slice(firstTerminalAt + 1);
    summary.second_terminal = secondRun[secondRun.length - 1]?.kind;
    expect(summary.second_terminal).toBe('run_completed');
    const takenDelegations = secondRun.filter(
      (e) => e.kind === 'browser_delegation_requested'
    );
    expect(takenDelegations.map((d) => d.toolName)).toEqual(DELEGATED_TOOLS);
    for (const delegation of takenDelegations) {
      const result = pairedResult(secondRun, delegation);
      expect(
        result,
        `no tool_result paired with ${delegation.toolName} under takeover`
      ).toBeDefined();
      // Pause-and-fail is IN-BAND: the action failed, the run did not.
      expect(result!.isError).toBe(false);
      expect(result!.content).toContain('the user took control of the browser');
    }
    expect(hits.length).toBe(hitsAfterRun);
    summary.takeover_results = takenDelegations.length;

    // Give the browser back so the executor is clean for whatever runs next.
    // The second run's settle left the panel on its own turn, so re-open the
    // browser card first.
    await openBrowserWorkspace(page);
    await giveBack.waitFor({ state: 'visible', timeout: 15_000 });
    await giveBack.click();
    await takeControl.waitFor({ state: 'visible', timeout: 15_000 });
    await screenshot(page, 'given-back');

    // ---- The main renderer never fetched the fixture origin — the page
    // loaded in the agent's own window, not in the product UI.
    expect(networkUrls.filter((u) => u.startsWith(fixtureOrigin))).toEqual([]);
    const offEdge = auditEdgeOnly(networkUrls, new URL(edgeBaseUrl!).origin);
    expect(offEdge).toEqual([]);
    expect(
      networkUrls.filter((u) => /^https?:/.test(u)).length
    ).toBeGreaterThan(0);
    writeEvidence('eigent-lbr-summary.json', summary);
  } finally {
    try {
      await app?.close();
    } finally {
      server.close();
    }
  }
});

test('a pod-mode run on the same model leaves the desktop untouched', async () => {
  test.skip(
    !bootstrap || !edgeReady || !APP_BUILT,
    'eigent-local stack not running or app not built'
  );
  test.skip(
    !delegationsServed,
    'this stack predates delegated browser execution (edge API < 1.22)'
  );
  test.skip(
    process.env.EIGENT_E2E_FIXTURE_PICKER !== '1',
    'needs the fixture-picker stack (EIGENT_LOCAL_FIXTURE_PICKER=1 up + EIGENT_E2E_FIXTURE_PICKER=1)'
  );
  test.skip(
    process.env.EIGENT_E2E_BROWSER_MODE !== '1',
    'stack not in browser mode (set AION_BROWSER_TEMPLATE on the stack and EIGENT_E2E_BROWSER_MODE=1 here)'
  );
  test.setTimeout(240_000);
  const stamp = Date.now();
  const podNonce = `lbr-pod-${stamp}`;

  const hits: FixtureHit[] = [];
  const server = fixtureServer(hits);
  const fixtureOrigin = await listenOn(server);
  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
    fixture_origin: fixtureOrigin,
  };

  let app: ElectronApplication | undefined;
  try {
    const launched = await launchApp();
    app = launched.app;
    const page = launched.page;

    // Same model alias, toggle LEFT on the Cloud default: the run must
    // execute in the pod. The pod cannot reach the host loopback, so the
    // visit fails in-band — which is itself proof of where it ran.
    const composer = await newSpaceComposer(page);
    await selectModel(page, MODEL_LABEL);
    await typeIntoComposer(
      page,
      composer,
      `Drive the delegated browser fixture at ${fixtureOrigin}/fixture. ${podNonce}`
    );
    await composer.press('Enter');
    const projectId = await findProjectByTitle(podNonce);
    summary.project_id = projectId;

    const events = await collectEvents(projectId, 1);
    summary.terminal = events[events.length - 1]?.kind;
    expect(summary.terminal).toBe('run_completed');

    // Zero delegations: pod mode is bit-identical pre-LB behavior.
    expect(
      events.filter((e) => e.kind === 'browser_delegation_requested')
    ).toEqual([]);
    // The pod DID run browser tools (this is not a vacuous pass) …
    const browserCalls = events.filter(
      (e) => e.kind === 'tool_call' && e.toolName === 'browser_visit_page'
    );
    expect(browserCalls.length).toBeGreaterThan(0);
    // … and the visit's failure is in-band: the pod's chromium cannot reach
    // the host loopback, so navigation lands on Chrome's error page — the
    // result reports chrome-error://chromewebdata rather than a `browser
    // error:` refusal (CDP-level navigation itself succeeded).
    const visitResult = events.find(
      (e) =>
        e.kind === 'tool_result' &&
        e.toolCallId === browserCalls[0].toolCallId
    );
    expect(visitResult).toBeDefined();
    expect(visitResult!.content).toContain('chrome-error://chromewebdata');
    // The desktop was never touched.
    expect(hits).toEqual([]);
    summary.fixture_hits = hits.length;
    writeEvidence('eigent-lbr-pod-summary.json', summary);
  } finally {
    try {
      await app?.close();
    } finally {
      server.close();
    }
  }
});
