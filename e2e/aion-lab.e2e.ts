// M4-I development Electron E2E (doc 10 §10): the REAL desktop app in
// remote-backend mode against the eigent-local Compose edge. The suite
// drives the Integration Lab through bootstrap → project → command →
// streaming → terminal run, then edge-restart reconnect and detach/attach
// replay equivalence, and separately the backend-unavailable UX. All
// renderer network traffic is captured and must target ONLY the edge.
//
// Preconditions (skipped cleanly when absent):
//   bazel run //dev/eigent_local:images && bazel run //dev/eigent_local:up
// in the sibling aion-v1 checkout, and `npx vite build` here. The desktop
// API key comes from the gitignored run manifest and rides ONLY the env of
// the launched app — never a committed file, never the evidence summary.

import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installPackagedApp, type PackagedInstall } from './packaged';

// Under Bazel the spec runs from a bin-dir copy that has no built app —
// EIGENT_E2E_APP_DIR points back at the source workspace (see BUILD.bazel).
const REPO_ROOT =
  process.env.EIGENT_E2E_APP_DIR ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_BUILT = fs.existsSync(
  path.join(REPO_ROOT, 'dist-electron', 'main', 'index.js')
);
const BOOTSTRAP_PATH =
  process.env.EIGENT_E2E_BOOTSTRAP ??
  path.resolve(REPO_ROOT, '../aion-v1/deploy/eigent-local/run/bootstrap.json');
const EDGE_CONTAINER =
  process.env.EIGENT_E2E_EDGE_CONTAINER ?? 'eigent-aion-local-aion-edge-1';
const EVIDENCE_DIR = process.env.EIGENT_E2E_EVIDENCE_DIR;
// WP3 packaged E2E (doc 10 §11): point EIGENT_E2E_PACKAGED_APP at the
// unsigned package (e.g. bazel-bin/release) and this whole suite runs its
// unchanged contract against the installed app instead of dev Electron.
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
// The edge base already targets the mounted contract root.
const edgeBaseUrl = bootstrap
  ? `${bootstrap.edge_url.replace(/\/+$/, '')}/eigent/v1`
  : null;
let edgeReady = false;
let workDir: string;
let keyFile: string;

test.beforeAll(async () => {
  if (!bootstrap || !edgeBaseUrl) return;
  try {
    const response = await fetch(`${edgeBaseUrl}/status`, {
      signal: AbortSignal.timeout(3_000),
    });
    edgeReady = response.ok;
  } catch {
    edgeReady = false;
  }
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-e2e-'));
  keyFile = path.join(workDir, 'edge-api-key');
  if (bootstrap) {
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
  // A leaked dev-server URL would make the app load a live vite instead of
  // the built renderer under test.
  delete env.VITE_DEV_SERVER_URL;
  env.EIGENT_E2E_USER_DATA = fs.mkdtempSync(
    path.join(workDir, 'user-data-')
  );
  return { ...env, ...extra };
}

// The app opens hidden about:blank browser-tool windows (CDP pool, webviews)
// before and around the main renderer, so firstWindow() is a lottery. The
// real UI is the only window whose URL is the built dist/index.html.
async function findMainWindow(app: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const main = app
      .windows()
      .find((w) => w.url().includes('/dist/index.html'));
    if (main) return main;
    if (Date.now() > deadline) {
      const urls = app.windows().map((w) => w.url());
      throw new Error(`main renderer window not found among: ${urls.join(', ')}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function launchLab(
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
  // Set the lab route, then reload so React mounts directly on it. A bare
  // hash assignment after mount is timing-sensitive: when the transport
  // config is invalid the default route renders an empty tree that never
  // re-routes on hashchange, so the lab surface (and its error state)
  // would never appear.
  await page.evaluate(() => {
    window.location.hash = '#/integration-lab';
  });
  await page.reload();
  return { app, page };
}

const byId = (page: Page, id: string) => page.getByTestId(id);

async function screenshot(page: Page, name: string): Promise<void> {
  if (!EVIDENCE_DIR) return;
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `eigent-m4i-${name}.png`),
    fullPage: true,
  });
}

function restartEdgeContainer(): boolean {
  try {
    execSync(`docker restart ${EDGE_CONTAINER}`, {
      stdio: 'ignore',
      timeout: 90_000,
    });
    return true;
  } catch {
    return false;
  }
}

async function cursorValue(page: Page): Promise<bigint> {
  const text = (await byId(page, 'lab-cursor').textContent()) ?? 'cursor: 0';
  return BigInt(text.replace('cursor:', '').trim() || '0');
}

test('backend-unavailable UX: set-but-invalid config is a typed error, never local fallback', async () => {
  test.skip(!bootstrap || !edgeReady || !APP_BUILT, 'eigent-local stack not running or app not built');
  const { app, page } = await launchLab({
    EIGENT_REMOTE_BACKEND_URL: edgeBaseUrl!,
    EIGENT_REMOTE_BACKEND_API_KEY: '',
    EIGENT_REMOTE_BACKEND_API_KEY_FILE: '',
  });
  try {
    const error = byId(page, 'lab-config-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText('invalid');
    await screenshot(page, 'backend-unavailable');
  } finally {
    await app.close();
  }
});

test('bootstrap → project → command → streaming → reconnect → replay, edge-only network', async () => {
  test.skip(!bootstrap || !edgeReady || !APP_BUILT, 'eigent-local stack not running or app not built');
  // This scenario's command itself writes a file, so under the approval-gated
  // stack (AION_APPROVAL_REQUIRED=write_file) it would suspend on the human
  // gate by design. It runs against the default stack; approval mode runs the
  // dedicated approval scenario below.
  test.skip(
    process.env.EIGENT_E2E_APPROVAL_MODE === '1',
    'write_file is human-gated on the approval-mode stack'
  );

  const { app, page } = await launchLab({
    EIGENT_REMOTE_BACKEND_URL: edgeBaseUrl!,
    EIGENT_REMOTE_BACKEND_API_KEY_FILE: keyFile,
    EIGENT_REMOTE_BACKEND_API_KEY: '',
  });
  const networkUrls: string[] = [];
  page.on('request', (request) => {
    networkUrls.push(request.url());
  });

  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
  };

  try {
    // --- bootstrap: status handshake over the real edge -------------------
    await expect(byId(page, 'lab-health')).toHaveText('health: ok');
    await expect(byId(page, 'lab-execution-mode')).toContainText('remote');
    await expect(byId(page, 'lab-inference-status')).toContainText('managed');
    await expect(byId(page, 'lab-auth-identity')).toContainText(
      `tenant ${bootstrap!.tenant_id}`
    );
    await expect(byId(page, 'lab-model-row-aion-default')).toBeVisible();
    await screenshot(page, 'status');

    // --- project ----------------------------------------------------------
    await byId(page, 'lab-project-create').click();
    await expect(byId(page, 'lab-project-id')).toBeVisible();
    const projectId = ((await byId(page, 'lab-project-id').textContent()) ?? '')
      .replace('project:', '')
      .trim();
    expect(projectId).toMatch(/^prj[-_]/);
    summary.project_id = projectId;

    // --- command → streaming → terminal run -------------------------------
    // The session reports `live` only once a frame is APPLIED (M4-F: progress
    // proves the cursor is live) — a brand-new project has no events, so the
    // command comes first and its run events flip the session to live.
    await byId(page, 'lab-command-input').fill(
      'Reply with a short greeting and finish.'
    );
    await byId(page, 'lab-command-submit').click();
    await expect(byId(page, 'lab-command-receipts')).toContainText('run ');
    await expect(byId(page, 'lab-session-status')).toHaveText('session: live');
    // The run must reach a terminal state through real streaming.
    await expect
      .poll(
        async () => (await byId(page, 'lab-runs').textContent()) ?? '',
        { timeout: 120_000 }
      )
      .toMatch(/(succeeded|failed|cancelled)/);
    const liveCursor = await cursorValue(page);
    expect(liveCursor).toBeGreaterThan(0n);
    const liveRuns = ((await byId(page, 'lab-runs').textContent()) ?? '').trim();
    const liveTimelineCount = await page
      .getByTestId('lab-timeline-entry')
      .count();
    expect(liveTimelineCount).toBeGreaterThan(0);
    summary.live_cursor = liveCursor.toString();
    summary.live_timeline_entries = liveTimelineCount;
    summary.run_terminal = /succeeded/.test(liveRuns)
      ? 'succeeded'
      : /cancelled/.test(liveRuns)
        ? 'cancelled'
        : 'failed';
    await screenshot(page, 'run-terminal');

    // --- sanitized evidence export ---------------------------------------
    await byId(page, 'lab-export').click();
    const evidenceJson =
      (await byId(page, 'lab-evidence-json').textContent()) ?? '';
    expect(evidenceJson).toContain(projectId);
    expect(evidenceJson).not.toContain(bootstrap!.api_key);
    expect(evidenceJson).not.toContain('apiKey');

    // --- reconnect: restart the edge under the live session --------------
    const restarted = restartEdgeContainer();
    summary.edge_restarted = restarted;
    let finalCursor = liveCursor;
    let finalRuns = liveRuns;
    let finalTimelineCount = liveTimelineCount;
    if (restarted) {
      // Liveness is only observable through applied frames, so the proof the
      // bounded-reconnect session survived the restart is a SECOND command
      // whose run streams to terminal over the re-established subscription —
      // with the acknowledged cursor moving strictly forward, never back.
      await byId(page, 'lab-command-input').fill(
        'Reply with a short farewell and finish.'
      );
      await byId(page, 'lab-command-submit').click();
      await expect
        .poll(
          async () => {
            const runs = (await byId(page, 'lab-runs').textContent()) ?? '';
            return (runs.match(/succeeded|failed|cancelled/g) ?? []).length;
          },
          { timeout: 120_000 }
        )
        .toBeGreaterThanOrEqual(2);
      await expect(byId(page, 'lab-session-status')).toHaveText('session: live');
      finalCursor = await cursorValue(page);
      expect(finalCursor > liveCursor).toBe(true);
      finalRuns = ((await byId(page, 'lab-runs').textContent()) ?? '').trim();
      finalTimelineCount = await page.getByTestId('lab-timeline-entry').count();
      summary.cursor_after_reconnect = finalCursor.toString();
      await screenshot(page, 'reconnected');
    }

    // --- replay equivalence: detach, attach, re-reduce from cursor 0 ------
    await byId(page, 'lab-detach').click();
    await byId(page, 'lab-project-attach-input').fill(projectId);
    await byId(page, 'lab-project-attach').click();
    await expect
      .poll(async () => (await cursorValue(page)).toString(), {
        timeout: 60_000,
      })
      .toBe(finalCursor.toString());
    const replayRuns = ((await byId(page, 'lab-runs').textContent()) ?? '').trim();
    const replayTimelineCount = await page
      .getByTestId('lab-timeline-entry')
      .count();
    // Live tail and cold replay of the same event window must reduce to the
    // same view (the reducer determinism invariant, proven on the real wire).
    expect(replayRuns).toBe(finalRuns);
    expect(replayTimelineCount).toBe(finalTimelineCount);
    summary.replay_equivalent = true;
    await screenshot(page, 'replay');

    // --- edge-only network capture ----------------------------------------
    // The Amplitude telemetry tag was deleted at M5; nothing off-edge is
    // allowlisted anymore.
    const edgeOrigin = new URL(edgeBaseUrl!).origin;
    const httpRequests = networkUrls.filter((u) => /^https?:/.test(u));
    const offEdge = httpRequests.filter((u) => !u.startsWith(edgeOrigin));
    expect(offEdge).toEqual([]);
    // The loop itself must actually have run over the edge.
    expect(httpRequests.length).toBeGreaterThan(0);
    summary.http_requests = httpRequests.length;
    summary.edge_requests = httpRequests.length;
    summary.off_edge_requests = offEdge;

    if (EVIDENCE_DIR) {
      fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
      const payload = JSON.stringify(summary, null, 2);
      if (payload.includes(bootstrap!.api_key)) {
        throw new Error('evidence summary would leak the API key');
      }
      fs.writeFileSync(
        path.join(EVIDENCE_DIR, 'eigent-m4i-e2e-summary.json'),
        payload
      );
    }
  } finally {
    await app.close();
  }
});

// M6 browser train (doc 10 §12): against a stack whose managed cell has a
// browser workspace template (AION_BROWSER_TEMPLATE set, browser image
// built), the deterministic aion-browser fixture drives the full loop —
// write_file test.html → browser_visit_page file:///workspace/test.html →
// snapshot → click → screenshot — inside the sandbox pod, and the harvested
// screenshot artifact surfaces in the Lab with a presigned download link.
// Bring the stack up with the template and opt this test in:
//   AION_BROWSER_TEMPLATE=<browser image ref> bazel run //dev/eigent_local:up
//   EIGENT_E2E_BROWSER_MODE=1 npx playwright test --config e2e/playwright.config.ts aion-lab
test('browser fixture: sandbox browser run publishes a screenshot artifact', async () => {
  test.skip(
    !bootstrap || !edgeReady || !APP_BUILT,
    'eigent-local stack not running or app not built'
  );
  test.skip(
    process.env.EIGENT_E2E_BROWSER_MODE !== '1',
    'stack not in browser mode (set AION_BROWSER_TEMPLATE on the stack and EIGENT_E2E_BROWSER_MODE=1 here)'
  );

  const { app, page } = await launchLab({
    EIGENT_REMOTE_BACKEND_URL: edgeBaseUrl!,
    EIGENT_REMOTE_BACKEND_API_KEY_FILE: keyFile,
    EIGENT_REMOTE_BACKEND_API_KEY: '',
  });
  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
    browser_mode: true,
  };
  try {
    await expect(byId(page, 'lab-health')).toHaveText('health: ok');
    // The fixture alias must come from the served catalog, not be typed in.
    await expect(byId(page, 'lab-model-row-aion-browser')).toBeVisible();
    await byId(page, 'lab-project-alias').selectOption('aion-browser');
    await byId(page, 'lab-project-create').click();
    await expect(byId(page, 'lab-project-id')).toBeVisible();
    summary.project_id = ((await byId(page, 'lab-project-id').textContent()) ?? '')
      .replace('project:', '')
      .trim();

    // The command text is free-form — the fixture script is deterministic.
    await byId(page, 'lab-command-input').fill('Drive the browser fixture.');
    await byId(page, 'lab-command-submit').click();
    await expect(byId(page, 'lab-command-receipts')).toContainText('run ');

    // Pod provisioning + Chrome startup ride the first browser call, so the
    // terminal poll gets the long leash.
    await expect
      .poll(
        async () => (await byId(page, 'lab-runs').textContent()) ?? '',
        { timeout: 300_000 }
      )
      .toMatch(/succeeded/);
    summary.run_terminal = 'succeeded';

    // The timeline must carry the whole browser sequence as settled tools.
    const timeline =
      (await byId(page, 'lab-timeline').textContent()) ?? '';
    for (const tool of [
      'write_file',
      'browser_visit_page',
      'browser_get_page_snapshot',
      'browser_click',
      'browser_get_screenshot',
    ]) {
      expect(timeline).toContain(`${tool} (done)`);
    }
    // Browser action failures are reported IN-BAND (exit-0 tool results the
    // model can react to), so "(done)" alone can mask a broken pod — the
    // fixture's final message echoes the last result, which must be a real
    // screenshot save, not an error body.
    expect(timeline).not.toContain('browser tool failed');
    expect(timeline).not.toContain('browser error:');
    summary.browser_tools_settled = true;

    // The screenshot harvested from the pod workspace is a published product
    // artifact: listed, and resolvable to a presigned download link.
    const artifactUrlButton = page.locator(
      '[data-testid^="lab-artifact-url-"]'
    );
    await expect(artifactUrlButton.first()).toBeVisible({ timeout: 60_000 });
    summary.artifact_count = await artifactUrlButton.count();
    await artifactUrlButton.first().click();
    const artifactLink = page.locator('[data-testid^="lab-artifact-link-"]');
    await expect(artifactLink.first()).toBeVisible({ timeout: 30_000 });
    const href = await artifactLink.first().getAttribute('href');
    expect(href).toBeTruthy();
    summary.artifact_presigned = true;
    await screenshot(page, 'browser-artifact');

    if (EVIDENCE_DIR) {
      fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
      const payload = JSON.stringify(summary, null, 2);
      if (payload.includes(bootstrap!.api_key)) {
        throw new Error('evidence summary would leak the API key');
      }
      fs.writeFileSync(
        path.join(EVIDENCE_DIR, 'eigent-m6-browser-summary.json'),
        payload
      );
    }
  } finally {
    await app.close();
  }
});

// M6 approvals train (doc 10 §12): with the stack's durable human gate on
// (AION_APPROVAL_REQUIRED=write_file), a command that writes a file parks its
// run awaiting approval; the Lab surfaces the pending approval; Allow
// delivers the verdict (respond-once on the backend) and the run resumes to
// a succeeded terminal whose timeline carries the resolved approval. Bring
// the stack up gated and opt this test in:
//   AION_APPROVAL_REQUIRED=write_file bazel run //dev/eigent_local:up
//   EIGENT_E2E_APPROVAL_MODE=1 npx playwright test --config e2e/playwright.config.ts aion-lab
test('approval gate: gated write suspends, allow resumes to completion', async () => {
  test.skip(
    !bootstrap || !edgeReady || !APP_BUILT,
    'eigent-local stack not running or app not built'
  );
  test.skip(
    process.env.EIGENT_E2E_APPROVAL_MODE !== '1',
    'stack not in approval mode (set AION_APPROVAL_REQUIRED=write_file on the stack and EIGENT_E2E_APPROVAL_MODE=1 here)'
  );

  const { app, page } = await launchLab({
    EIGENT_REMOTE_BACKEND_URL: edgeBaseUrl!,
    EIGENT_REMOTE_BACKEND_API_KEY_FILE: keyFile,
    EIGENT_REMOTE_BACKEND_API_KEY: '',
  });
  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
    approval_mode: true,
  };
  try {
    await expect(byId(page, 'lab-health')).toHaveText('health: ok');
    await byId(page, 'lab-project-create').click();
    await expect(byId(page, 'lab-project-id')).toBeVisible();
    summary.project_id = ((await byId(page, 'lab-project-id').textContent()) ?? '')
      .replace('project:', '')
      .trim();

    await byId(page, 'lab-command-input').fill(
      'Use the write_file tool to create approval-note.txt containing exactly "approved-path", then reply done.'
    );
    await byId(page, 'lab-command-submit').click();
    await expect(byId(page, 'lab-command-receipts')).toContainText('run ');

    // The gated tool parks the run: a pending approval surfaces with the
    // tool it gates, streamed from the edge (approval_required).
    const allowButton = page.locator('[data-testid^="lab-approval-allow-"]');
    await expect(allowButton).toBeVisible({ timeout: 120_000 });
    await expect(byId(page, 'lab-approvals')).toContainText('write_file');
    summary.approval_surfaced = true;
    await screenshot(page, 'approval-pending');

    // Allow → the backend records the verdict once and resumes the run.
    await allowButton.click();
    await expect
      .poll(
        async () => (await byId(page, 'lab-runs').textContent()) ?? '',
        { timeout: 180_000 }
      )
      .toMatch(/succeeded/);
    // The pending list drains when approval_resolved streams back.
    await expect(allowButton).toHaveCount(0, { timeout: 30_000 });
    summary.run_terminal = 'succeeded';
    await screenshot(page, 'approval-resumed');

    if (EVIDENCE_DIR) {
      fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
      const payload = JSON.stringify(summary, null, 2);
      if (payload.includes(bootstrap!.api_key)) {
        throw new Error('evidence summary would leak the API key');
      }
      fs.writeFileSync(
        path.join(EVIDENCE_DIR, 'eigent-m6-approval-summary.json'),
        payload
      );
    }
  } finally {
    await app.close();
  }
});
