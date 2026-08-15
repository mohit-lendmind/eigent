// Connectors desktop E2E: the REAL desktop app in remote-backend mode against
// the eigent-local Compose edge, driving the Connections screen through a whole
// OAuth round trip.
//
// The point of this suite is that the desktop never learns a grant from its own
// request. Connect hands a consent URL to the user's browser and stops; the
// grant is written by the cell's callback listener, on the far side of a hop
// this renderer cannot see. So the test asserts the row is STILL disconnected
// immediately after the click, completes the browser leg out-of-band the way a
// browser would, and only then expects the row to flip — from the catalog the
// edge serves, not from anything the click returned.
//
// The system-browser hop is intercepted at the `open-external` IPC handler in
// the main process rather than stubbed in the renderer: everything up to the
// point where the desktop hands the URL to the OS stays the real code path, and
// no browser window opens on the machine running the suite.
//
// Preconditions match aion-lab.e2e.ts (skipped cleanly when absent): the
// Compose stack up in the sibling aion-v1 checkout WITH the connectors overlay
// (`EIGENT_LOCAL_CONNECTORS=1`), and `npx vite build` here. The desktop API key
// comes from the gitignored run manifest and rides ONLY the env of the launched
// app — never a committed file or evidence output.

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

// The catalog row the connectors overlay seeds, pointing at cmd/connectorstub.
const CONNECTOR_ID = 'tickets';
// How long the screen's own poll may take to notice the grant (its interval is
// 2s), plus room for one slow catalog read.
const FLIP_TIMEOUT_MS = 30_000;

interface Bootstrap {
  api_key: string;
  edge_url: string;
  tenant_id: string;
}

interface EdgeConnector {
  connector_id: string;
  display_name: string;
  auth_kind: string;
  status: string;
  connected?: boolean;
  connectable?: boolean;
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
// Separate from edgeReady: the base stack serves the routes but answers 501
// connectors_not_configured without the overlay, which is a legitimate stack to
// be running and not a failure of this suite.
let connectorsConfigured = false;
let workDir: string;
let keyFile: string;

test.beforeAll(async () => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-connectors-'));
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
  if (edgeReady) {
    const catalog = await fetchCatalog();
    connectorsConfigured =
      catalog !== null && catalog.some((c) => c.connector_id === CONNECTOR_ID);
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

/**
 * Replaces the main process's `open-external` handler so the consent URL is
 * recorded instead of handed to the OS. The renderer, preload and IPC hop are
 * untouched — only `shell.openExternal` itself is displaced, which is the one
 * step a headless suite cannot let run.
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
    path: path.join(EVIDENCE_DIR, `eigent-connectors-${name}.png`),
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

async function edgeFetch(
  method: string,
  pathname: string
): Promise<Response> {
  return fetch(`${edgeBaseUrl}${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${bootstrap!.api_key}` },
  });
}

/** The catalog as the edge serves it, or null when connectors are not armed. */
async function fetchCatalog(): Promise<EdgeConnector[] | null> {
  const response = await edgeFetch('GET', '/connectors');
  if (response.status === 501) return null;
  if (!response.ok) {
    throw new Error(
      `listConnectors: ${response.status} ${await response.text()}`
    );
  }
  return ((await response.json()) as { connectors: EdgeConnector[] })
    .connectors;
}

async function servedRow(connectorId: string): Promise<EdgeConnector> {
  const catalog = await fetchCatalog();
  const row = catalog?.find((c) => c.connector_id === connectorId);
  if (!row) throw new Error(`connector ${connectorId} absent from the catalog`);
  return row;
}

/** Soft revoke, idempotent — used to normalize the starting state. */
async function revoke(connectorId: string): Promise<void> {
  const response = await edgeFetch(
    'DELETE',
    `/connectors/${encodeURIComponent(connectorId)}/grant`
  );
  if (response.status !== 204) {
    throw new Error(
      `disconnect: ${response.status} ${await response.text()}`
    );
  }
}

/**
 * Does what the user's browser would: follows the consent URL to the auto-
 * approving stub and on through the redirect to the edge's callback. Nothing
 * about the result is read back into the desktop — the grant is a server-side
 * effect, and the only thing the caller learns is where the browser ended up.
 */
async function completeConsent(authorizationUrl: string): Promise<string> {
  const response = await fetch(authorizationUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(
      `consent leg: ${response.status} at ${response.url} — ${await response.text()}`
    );
  }
  return response.url;
}

/** URL minus its query: a flow state is single-use, but it is still a secret. */
function withoutQuery(raw: string): string {
  const url = new URL(raw);
  return `${url.origin}${url.pathname}`;
}

test('a grant is earned in the browser, not claimed by the click', async () => {
  test.skip(
    !bootstrap || !edgeReady || !APP_BUILT,
    'eigent-local stack not running or app not built'
  );
  test.skip(
    !connectorsConfigured,
    `connectors overlay not armed (no "${CONNECTOR_ID}" row) — bring the stack up with EIGENT_LOCAL_CONNECTORS=1`
  );
  test.setTimeout(300_000);
  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
    connector_id: CONNECTOR_ID,
  };

  // Start from no grant whatever an earlier run left behind.
  await revoke(CONNECTOR_ID);
  const before = await servedRow(CONNECTOR_ID);
  expect(before.connected ?? false).toBe(false);
  // The row is connectABLE — without the vault this is the unavailable state and
  // there would be no Connect button to click, so the suite would prove nothing.
  expect(before.connectable).toBe(true);
  summary.served_before = before;

  const { app, page } = await launchApp();
  const networkUrls: string[] = [];
  page.on('request', (request) => networkUrls.push(request.url()));

  try {
    await captureExternalOpens(app);
    await openSection(page, 'tab=connectors');
    await expect(byId(page, 'aion-connectors')).toBeVisible({ timeout: 60_000 });

    const row = page.locator(
      `[data-testid="aion-connector-row"][data-connector-id="${CONNECTOR_ID}"]`
    );
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute('data-connected', 'false');
    await expect(row.getByTestId('aion-connector-state-disconnected')).toHaveCount(
      1
    );
    await expect(row.getByTestId('aion-connector-connect')).toHaveCount(1);
    await screenshot(page, 'disconnected');

    await row.getByTestId('aion-connector-connect').click();

    // The screen is waiting on a browser it cannot see, and says so.
    await expect(row.getByTestId('aion-connector-awaiting')).toHaveCount(1);
    // The negative control, and the reason this suite exists: the request has
    // been made and answered, and the row is still not connected. A surface that
    // treated the authorization response as the grant fails here.
    await expect(row).toHaveAttribute('data-connected', 'false');
    await expect(row.getByTestId('aion-connector-state-connected')).toHaveCount(
      0
    );
    expect((await servedRow(CONNECTOR_ID)).connected ?? false).toBe(false);
    await screenshot(page, 'awaiting');

    const opens = await externalOpens(app);
    expect(opens).toHaveLength(1);
    const authorizationUrl = opens[0];
    // The consent URL is the PROVIDER's, not the edge's — the desktop is handing
    // the user off, not fetching a grant itself.
    expect(new URL(authorizationUrl).origin).not.toBe(
      new URL(edgeBaseUrl!).origin
    );
    expect(new URL(authorizationUrl).searchParams.get('state')).toBeTruthy();
    summary.authorization_endpoint = withoutQuery(authorizationUrl);

    // The browser leg, run out-of-band exactly as a browser would run it.
    const landedOn = await completeConsent(authorizationUrl);
    summary.callback_landed_on = withoutQuery(landedOn);
    // It came back to the edge's own callback, which is what proxies the grant
    // to the cell's listener.
    expect(withoutQuery(landedOn)).toContain(new URL(edgeBaseUrl!).origin);

    // No reload: the screen's own poll has to notice, because in production
    // nothing tells the renderer the flow finished.
    await expect(row).toHaveAttribute('data-connected', 'true', {
      timeout: FLIP_TIMEOUT_MS,
    });
    await expect(row.getByTestId('aion-connector-state-connected')).toHaveCount(
      1
    );
    await expect(row.getByTestId('aion-connector-awaiting')).toHaveCount(0);
    const afterConnect = await servedRow(CONNECTOR_ID);
    expect(afterConnect.connected).toBe(true);
    summary.served_after_connect = afterConnect;
    await screenshot(page, 'connected');

    // Disconnect is a soft revoke: the row stays in the catalog, connectable
    // again, rather than disappearing as an uninstall would make it.
    await row.getByTestId('aion-connector-disconnect').click();
    await expect(row).toHaveAttribute('data-connected', 'false', {
      timeout: FLIP_TIMEOUT_MS,
    });
    await expect(row.getByTestId('aion-connector-connect')).toHaveCount(1);
    const afterDisconnect = await servedRow(CONNECTOR_ID);
    expect(afterDisconnect.connected ?? false).toBe(false);
    expect(afterDisconnect.connectable).toBe(true);
    summary.served_after_disconnect = afterDisconnect;
    await screenshot(page, 'revoked');

    // Still exactly one hand-off: neither the poll nor the disconnect reopened
    // a consent window behind the user's back.
    expect(await externalOpens(app)).toHaveLength(1);

    const offEdge = auditEdgeOnly(networkUrls, new URL(edgeBaseUrl!).origin);
    expect(offEdge).toEqual([]);
    // An empty off-edge set is vacuous unless the renderer made requests.
    expect(
      networkUrls.filter((u) => /^https?:/.test(u)).length
    ).toBeGreaterThan(0);
    summary.off_edge_requests = offEdge;
    writeEvidence('eigent-connectors-summary.json', summary);
  } finally {
    await app.close();
  }
});
