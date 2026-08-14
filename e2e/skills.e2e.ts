// SkillStore desktop E2E: the REAL desktop app in remote-backend mode
// against the eigent-local Compose edge, driving the product Skills surfaces —
// not the Integration Lab. Three scenarios:
//   1. CRUD: compose → row → scope to one worker (Metadata scope tag) →
//      disable (server round-trip) → delete, all persisted across a full
//      reload, with an edge-only network audit.
//   2. Save-as-skill: the deterministic `aion-fast` echo model returns the
//      user's SKILL.md verbatim, the reply offers the save action, and the
//      saved skill is usable next turn via the # picker.
//   3. Edge-too-old: a stub edge on 1.3.0 (below the 1.4 skills floor) must
//      render the visible read-only state, never a guessed 404 loop.
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
  type Locator,
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
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-skc-'));
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

async function launchApp(
  extra: Record<string, string>
): Promise<{ app: ElectronApplication; page: Page }> {
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

// Route + reload so React mounts directly on the Skills section (the same
// deterministic-mount trick the Lab suite uses for its route).
async function openSkillsPage(page: Page, extraParams = ''): Promise<void> {
  await page.evaluate((params) => {
    window.location.hash = `#/history?tab=agents&section=skills${params}`;
  }, extraParams);
  await page.reload();
}

const byId = (page: Page, id: string) => page.getByTestId(id);

async function screenshot(page: Page, name: string): Promise<void> {
  if (!EVIDENCE_DIR) return;
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `eigent-skc-${name}.png`),
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

const skillMd = (name: string, description: string, body: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;

// The composer serializes newlines only from <br> elements (RichChatInput
// brToNewlineInTree), and bare Enter sends — so multiline input must arrive
// as Shift+Enter between insertText'd lines, exactly like a human types it.
async function typeMultiline(page: Page, text: string): Promise<void> {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) await page.keyboard.press('Shift+Enter');
    if (lines[i]) await page.keyboard.insertText(lines[i]);
  }
}

// The scope popover is row-local state, so it survives only as long as the row
// does. Assert on the panel itself rather than on the click: the click is the
// means, the open panel is the precondition the chip assertions need, and a
// row that re-mounted between the two would otherwise fail as a missing chip.
async function openScopePopover(
  page: Page,
  row: Locator,
  name: string
): Promise<void> {
  const panel = byId(page, `skill-scope-${name}`);
  await expect(async () => {
    if (!(await panel.isVisible())) {
      await row.getByRole('button', { name: 'Select agent access' }).click();
    }
    await expect(panel).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

test('skills CRUD: compose, disable, delete — all server-persisted', async () => {
  test.skip(
    !bootstrap || !edgeReady || !APP_BUILT,
    'eigent-local stack not running or app not built'
  );
  const name = `e2e-crud-${Date.now()}`;
  const { app, page } = await launchApp({
    EIGENT_REMOTE_BACKEND_URL: edgeBaseUrl!,
    EIGENT_REMOTE_BACKEND_API_KEY_FILE: keyFile,
    EIGENT_REMOTE_BACKEND_API_KEY: '',
  });
  const networkUrls: string[] = [];
  page.on('request', (request) => networkUrls.push(request.url()));
  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
    skill: name,
  };

  try {
    // Create via the compose dialog (skillAction=create deep link).
    await openSkillsPage(page, '&skillAction=create');
    await expect(byId(page, 'skill-compose-input')).toBeVisible({
      timeout: 60_000,
    });
    await byId(page, 'skill-compose-input').fill(
      skillMd(name, 'CRUD e2e skill.', 'Reply with the word crud-ok.')
    );
    await screenshot(page, 'crud-compose');
    await byId(page, 'skill-compose-save').click();
    await expect(byId(page, `skill-row-${name}`)).toBeVisible();
    summary.created = true;
    await screenshot(page, 'crud-created');

    // Scope: scoping the skill to one worker writes the stored
    // document's Metadata scope tag. The chips re-project from the remote
    // list after a reload, and the tag itself is asserted over the edge API.
    const row = byId(page, `skill-row-${name}`);
    const chip = (label: string) => row.getByRole('button', { name: label });
    const check = (label: string) =>
      chip(label).locator('svg[class*="lucide-check"]');
    const scopePut = () =>
      page.waitForResponse(
        (r) => r.url().includes('/skills/') && r.request().method() === 'PUT'
      );
    await openScopePopover(page, row, name);
    await expect(check('All Agents')).toBeVisible(); // new skills are global
    // Unselect All Agents (names-nothing still reads as global), then pick
    // one worker; await each PUT so the If-Match version chain stays ordered.
    let put = scopePut();
    await chip('All Agents').click();
    expect((await put).ok()).toBe(true);
    put = scopePut();
    await chip('Developer Agent').click();
    expect((await put).ok()).toBe(true);
    await expect(check('Developer Agent')).toBeVisible();
    await page.reload();
    await expect(row).toBeVisible({ timeout: 60_000 });
    await openScopePopover(page, row, name);
    await expect(check('Developer Agent')).toBeVisible();
    await expect(check('All Agents')).toHaveCount(0);
    await expect(check('Single Agent')).toHaveCount(0);
    // The stored document carries exactly the worker id (node-side fetch —
    // stays out of the renderer's edge-only network audit).
    const storedRow = (await (
      await fetch(`${edgeBaseUrl}/skills/${encodeURIComponent(name)}`, {
        headers: { Authorization: `Bearer ${bootstrap!.api_key}` },
      })
    ).json()) as { document?: { Metadata?: Record<string, string> } };
    expect(storedRow.document?.Metadata?.scope).toBe('developer_agent');
    summary.scope_persisted = true;
    await screenshot(page, 'crud-scoped');

    // Disable, then prove the status survived a full reload (the row is
    // re-projected from the remote list, not from optimistic state).
    const toggle = byId(page, `skill-toggle-${name}`);
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await page.reload();
    await expect(byId(page, `skill-row-${name}`)).toBeVisible({
      timeout: 60_000,
    });
    await expect(byId(page, `skill-toggle-${name}`)).toHaveAttribute(
      'aria-checked',
      'false'
    );
    summary.disable_persisted = true;
    await screenshot(page, 'crud-disabled');

    // Delete, and prove the removal also survived a reload.
    await byId(page, `skill-menu-${name}`).click();
    await byId(page, `skill-delete-${name}`).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(byId(page, `skill-row-${name}`)).toHaveCount(0);
    await page.reload();
    await expect(byId(page, 'skills-add')).toBeVisible({ timeout: 60_000 });
    await expect(byId(page, `skill-row-${name}`)).toHaveCount(0);
    summary.delete_persisted = true;
    await screenshot(page, 'crud-deleted');

    const offEdge = auditEdgeOnly(networkUrls, new URL(edgeBaseUrl!).origin);
    expect(offEdge).toEqual([]);
    summary.off_edge_requests = offEdge;
    writeEvidence('eigent-skc-crud-summary.json', summary);
  } finally {
    await app.close();
  }
});

// Needs the stack in fixture-picker mode: the deterministic fixture aliases
// must be user-facing (a normal stack marks them internal, so the desktop's
// alias resolution ignores the aion-fast pin and falls back to a real model).
// Bring-up:
//   EIGENT_LOCAL_FIXTURE_PICKER=1 bazel run //dev/eigent_local:up   (in aion-v1)
//   EIGENT_E2E_FIXTURE_PICKER=1 npx playwright test --config e2e/playwright.config.ts skills
test('save-as-skill: scripted echo reply → saved to the store → # picker next turn', async () => {
  test.skip(
    process.env.EIGENT_E2E_FIXTURE_PICKER !== '1',
    'needs the fixture-picker stack (EIGENT_LOCAL_FIXTURE_PICKER=1 up + EIGENT_E2E_FIXTURE_PICKER=1)'
  );
  test.skip(
    !bootstrap || !edgeReady || !APP_BUILT,
    'eigent-local stack not running or app not built'
  );
  test.setTimeout(300_000);
  const name = `e2e-saved-${Date.now()}`;
  const { app, page } = await launchApp({
    EIGENT_REMOTE_BACKEND_URL: edgeBaseUrl!,
    EIGENT_REMOTE_BACKEND_API_KEY_FILE: keyFile,
    EIGENT_REMOTE_BACKEND_API_KEY: '',
  });
  const networkUrls: string[] = [];
  page.on('request', (request) => networkUrls.push(request.url()));
  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
    skill: name,
    model_alias: 'aion-fast',
  };

  try {
    // Pin the deterministic echo model for new conversations, then reload so
    // the persisted store rehydrates with it.
    await page
      .locator('[role="textbox"]')
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 });
    await page.evaluate(() => {
      localStorage.setItem(
        'aion-model-store',
        JSON.stringify({ state: { selectedAlias: 'aion-fast' }, version: 0 })
      );
    });
    await page.reload();

    // A fresh profile boots into the read-only legacy Space; create a real one.
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

    // The message IS a fenced SKILL.md; the echo script returns it verbatim,
    // so the assistant reply carries a parseable skill document.
    const message =
      '```markdown\n' +
      skillMd(name, 'Saved from the scripted reply.', 'Say hello politely.') +
      '```';
    await composer.click();
    await typeMultiline(page, message);
    await screenshot(page, 'save-composed');
    await composer.press('Enter');

    // The echoed reply renders and offers the save action (remote mode gate
    // + successful SKILL.md parse of the fenced block).
    const saveButton = byId(page, 'save-as-skill');
    await expect(saveButton.first()).toBeVisible({ timeout: 120_000 });
    await screenshot(page, 'save-offered');
    await saveButton.first().click();
    await expect(page.getByText(name).first()).toBeVisible();
    await byId(page, 'save-skill-confirm').click();
    // The dialog closes once the PUT lands and the catalog re-syncs.
    await expect(byId(page, 'save-skill-confirm')).toHaveCount(0, {
      timeout: 60_000,
    });
    summary.saved = true;

    // Next-turn use: the saved skill surfaces in the # picker with its
    // description and inserts its #token into the composer.
    await byId(page, 'skill-picker-toggle').click();
    const pickerItem = byId(page, `picker-item-aion-${name}`);
    await expect(pickerItem).toBeVisible({ timeout: 60_000 });
    await expect(pickerItem).toContainText('Saved from the scripted reply.');
    await screenshot(page, 'save-picker');
    await pickerItem.click();
    await expect(composer).toContainText(`#${name}`);
    summary.picker_use = true;

    // The saved row is also live on the Skills page; delete it there so the
    // suite stays rerunnable against a persistent stack.
    await openSkillsPage(page);
    await expect(byId(page, `skill-row-${name}`)).toBeVisible({
      timeout: 60_000,
    });
    await screenshot(page, 'save-listed');
    await byId(page, `skill-menu-${name}`).click();
    await byId(page, `skill-delete-${name}`).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(byId(page, `skill-row-${name}`)).toHaveCount(0);
    summary.cleaned_up = true;

    const offEdge = auditEdgeOnly(networkUrls, new URL(edgeBaseUrl!).origin);
    expect(offEdge).toEqual([]);
    summary.off_edge_requests = offEdge;
    writeEvidence('eigent-skc-save-summary.json', summary);
  } finally {
    await app.close();
  }
});

test('edge-too-old: a 1.3.0 backend renders the visible read-only state', async () => {
  test.skip(!APP_BUILT, 'app not built');

  // Stub edge below the 1.4 skills floor but inside every overall compat
  // gate: shared major 1, event schema 1.0, permissive desktop floor.
  const stub = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url?.endsWith('/status')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          edge_api_version: '1.3.0',
          event_schema_version: '1.0',
          minimum_desktop_version: '0.0.1',
          harness_generation: 'aion-go/1',
          execution_mode: 'remote',
          inference_status: 'managed',
          server_time: new Date().toISOString(),
        })
      );
      return;
    }
    res.writeHead(404, { 'content-type': 'application/problem+json' });
    res.end(
      JSON.stringify({ type: 'about:blank', title: 'Not Found', status: 404 })
    );
  });
  await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
  const address = stub.address();
  if (address === null || typeof address === 'string') {
    throw new Error('stub edge failed to bind');
  }
  const stubBase = `http://127.0.0.1:${address.port}/eigent/v1`;
  const stubKeyFile = path.join(workDir, 'stub-api-key');
  fs.writeFileSync(stubKeyFile, 'stub-key-for-too-old-e2e', { mode: 0o600 });

  const { app, page } = await launchApp({
    EIGENT_REMOTE_BACKEND_URL: stubBase,
    EIGENT_REMOTE_BACKEND_API_KEY_FILE: stubKeyFile,
    EIGENT_REMOTE_BACKEND_API_KEY: '',
  });
  try {
    await openSkillsPage(page);
    const banner = byId(page, 'skills-remote-banner');
    await expect(banner).toBeVisible({ timeout: 60_000 });
    await expect(banner).toContainText('1.3.0');
    // Read-only: no tabs, no add button, no silent fallback to local rows.
    await expect(byId(page, 'skills-add')).toHaveCount(0);
    await screenshot(page, 'too-old-banner');
    writeEvidence('eigent-skc-too-old-summary.json', {
      captured_at: new Date().toISOString(),
      stub_edge_api_version: '1.3.0',
      banner_visible: true,
    });
  } finally {
    await app.close();
    await new Promise<void>((resolve, reject) =>
      stub.close((err) => (err ? reject(err) : resolve()))
    );
  }
});
