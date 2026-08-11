// SkillStore publish-approval desktop E2E (SK-D D2): the REAL desktop app in
// remote-backend mode driving the in-chat durable human gate for
// `publish_skill`. The deterministic `aion-publish` fixture proposes saving
// "zz-chat-published" on any first turn, which parks the run awaiting
// approval; the desktop renders the ApprovalCard from the projected Project
// event and resolves it over POST /approvals/{id}/response.
//   1. Deny: the card renders the parsed proposal, Deny settles the turn with
//      the tool-unavailable result, and the store holds NO row (edge 404).
//   2. Allow: the same proposal publishes ("Published skill … as version N"),
//      the stored row is active with origin chat_save, and the skill is
//      LOADABLE on the very next turn of the same conversation.
//
// Needs the fixture-picker stack with the publish gate on (both envs — the
// gate exposes publish_skill AND escalates it onto the durable approval path):
//   EIGENT_LOCAL_FIXTURE_PICKER=1 AION_SKILL_PUBLISH=1 bazel run //dev/eigent_local:up
//   EIGENT_E2E_PUBLISH_MODE=1 npx playwright test --config e2e/playwright.config.ts publish-approval
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

// The fixture publishes this fixed name; the suite pre/post-deletes it so a
// persistent stack stays rerunnable (versions grow — append-only store).
const SKILL_NAME = 'zz-chat-published';

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
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-skd-'));
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

const byId = (page: Page, id: string) => page.getByTestId(id);

async function screenshot(page: Page, name: string): Promise<void> {
  if (!EVIDENCE_DIR) return;
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `eigent-skd-${name}.png`),
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

// The composer serializes newlines only from <br> elements, and bare Enter
// sends — multiline input arrives as Shift+Enter between insertText'd lines.
async function typeMultiline(page: Page, text: string): Promise<void> {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) await page.keyboard.press('Shift+Enter');
    if (lines[i]) await page.keyboard.insertText(lines[i]);
  }
}

// Node-side edge reads/cleanup (with Bearer) stay OUT of the renderer's
// edge-only network audit.
async function fetchSkill(): Promise<{ status: number; body: any }> {
  const response = await fetch(
    `${edgeBaseUrl}/skills/${encodeURIComponent(SKILL_NAME)}`,
    { headers: { Authorization: `Bearer ${bootstrap!.api_key}` } }
  );
  const body = response.ok ? await response.json() : null;
  return { status: response.status, body };
}

// Idempotent: DELETE is SetSkillStatus(deleted); a missing skill 404s and a
// deleted-latest GET 404s, so a pre-clean makes the deny leg's 404 assertion
// valid even after a prior aborted run left an active row.
async function deleteSkill(): Promise<void> {
  const response = await fetch(
    `${edgeBaseUrl}/skills/${encodeURIComponent(SKILL_NAME)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${bootstrap!.api_key}` },
    }
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`skill cleanup DELETE failed: ${response.status}`);
  }
}

// Pin the deterministic publish fixture for new conversations, then create a
// real space (a fresh profile boots into the read-only legacy Space) and
// return once the composer is ready.
async function startConversation(page: Page): Promise<void> {
  await page
    .locator('[role="textbox"]')
    .first()
    .waitFor({ state: 'visible', timeout: 60_000 });
  await page.evaluate(() => {
    localStorage.setItem(
      'aion-model-store',
      JSON.stringify({ state: { selectedAlias: 'aion-publish' }, version: 0 })
    );
  });
  await page.reload();
  await page.getByText('Legacy Space', { exact: true }).first().click();
  await page.getByText('Create a new space', { exact: true }).first().click();
  await page.getByText('Start from scratch', { exact: true }).first().click();
  const composer = page
    .locator('[role="textbox"][contenteditable="true"]')
    .first();
  await composer.waitFor({ state: 'visible', timeout: 30_000 });
  await page
    .getByText('Create a new space', { exact: true })
    .waitFor({ state: 'hidden', timeout: 10_000 })
    .catch(() => {});
}

async function send(page: Page, text: string): Promise<void> {
  const composer = page
    .locator('[role="textbox"][contenteditable="true"]')
    .first();
  await composer.click();
  await typeMultiline(page, text);
  await composer.press('Enter');
}

// Any first-turn text without "load zz-chat-published" makes the fixture
// propose the publish; the run parks on the durable gate and the card renders
// once the projector's approval_required event reaches the stream.
const TRIGGER = 'Please save this procedure as a reusable skill.';

async function awaitApprovalCard(page: Page): Promise<void> {
  const card = byId(page, 'chat-approval-card').first();
  await expect(card).toBeVisible({ timeout: 120_000 });
  // The parsed proposal renders the skill identity, not a raw JSON dump.
  await expect(card).toContainText(SKILL_NAME);
  await expect(card).toContainText('Published from the chat surface.');
}

test('publish approval: deny leaves no store row; allow publishes and loads next turn', async () => {
  test.skip(
    process.env.EIGENT_E2E_PUBLISH_MODE !== '1',
    'needs the publish stack (EIGENT_LOCAL_FIXTURE_PICKER=1 AION_SKILL_PUBLISH=1 up + EIGENT_E2E_PUBLISH_MODE=1)'
  );
  test.skip(
    !bootstrap || !edgeReady || !APP_BUILT,
    'eigent-local stack not running or app not built'
  );
  test.setTimeout(600_000);
  await deleteSkill();
  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
    skill: SKILL_NAME,
    model_alias: 'aion-publish',
  };

  // ── Deny leg: fresh profile, propose → Deny → tool unavailable, no row.
  {
    const { app, page } = await launchApp();
    const networkUrls: string[] = [];
    page.on('request', (request) => networkUrls.push(request.url()));
    try {
      await startConversation(page);
      await send(page, TRIGGER);
      await awaitApprovalCard(page);
      await screenshot(page, 'deny-card');
      await byId(page, 'chat-approval-deny').first().click();
      // The verdict arrives only via approval_resolved on the stream — the
      // buttons give way to the resolved state, never an optimistic flip.
      await expect(byId(page, 'chat-approval-decision').first()).toBeVisible({
        timeout: 60_000,
      });
      await expect(byId(page, 'chat-approval-allow')).toHaveCount(0);
      // The 202-with-no-body accept must decode cleanly — a recorded verdict
      // may never surface the delivery-failure toast.
      await expect(
        page.getByText('Could not deliver your decision')
      ).toHaveCount(0);
      // The denied tool call settles the turn with the synthetic result.
      await expect(page.getByText('tool unavailable').first()).toBeVisible({
        timeout: 120_000,
      });
      await screenshot(page, 'deny-settled');
      const denied = await fetchSkill();
      expect(denied.status).toBe(404);
      summary.deny = { decision_rendered: true, store_status: denied.status };

      const offEdge = auditEdgeOnly(networkUrls, new URL(edgeBaseUrl!).origin);
      expect(offEdge).toEqual([]);
    } finally {
      await app.close();
    }
  }

  // ── Allow leg: fresh profile, propose → Allow → published row, then the
  // published skill is loadable on the very next turn of the same session.
  {
    const { app, page } = await launchApp();
    const networkUrls: string[] = [];
    page.on('request', (request) => networkUrls.push(request.url()));
    try {
      await startConversation(page);
      await send(page, TRIGGER);
      await awaitApprovalCard(page);
      await screenshot(page, 'allow-card');
      await byId(page, 'chat-approval-allow').first().click();
      await expect(byId(page, 'chat-approval-decision').first()).toBeVisible({
        timeout: 60_000,
      });
      await expect(
        page.getByText('Could not deliver your decision')
      ).toHaveCount(0);
      // Version is asserted as a pattern, not "1": the store is append-only
      // and a rerun against a persistent stack publishes the next version.
      await expect(
        page.getByText(`Published skill "${SKILL_NAME}" as version`).first()
      ).toBeVisible({ timeout: 120_000 });
      await screenshot(page, 'allow-published');

      const published = await fetchSkill();
      expect(published.status).toBe(200);
      expect(published.body.status).toBe('active');
      expect(published.body.origin).toBe('chat_save');
      expect(published.body.version).toBeGreaterThanOrEqual(1);
      expect(published.body.document?.Name).toBe(SKILL_NAME);
      summary.allow = {
        version: published.body.version,
        origin: published.body.origin,
        status: published.body.status,
      };

      // Live next turn: the just-approved publish is in the session registry
      // without a restart — the skill tool renders its prompt verbatim. The
      // "published skill loaded" prefix is the wait signal (the proposal card
      // above already shows the prompt text, so that alone can't be one).
      await send(page, `load ${SKILL_NAME}`);
      const loaded = page.getByText('published skill loaded').first();
      await expect(loaded).toBeVisible({ timeout: 120_000 });
      await expect(loaded).toContainText('Published from the chat surface.');
      await screenshot(page, 'allow-loaded');
      summary.live_next_turn = true;

      const offEdge = auditEdgeOnly(networkUrls, new URL(edgeBaseUrl!).origin);
      expect(offEdge).toEqual([]);
      summary.off_edge_requests = offEdge;
    } finally {
      await app.close();
    }
  }

  await deleteSkill();
  summary.cleaned_up = true;
  writeEvidence('eigent-skd-publish-summary.json', summary);
});
