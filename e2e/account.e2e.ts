// Account desktop E2E: the REAL desktop app onboarding from a cold profile
// against the eigent-local Compose edge, then losing the credential under it.
//
// Three properties, in the order a user meets them:
//
//   A key the edge refuses is NOT stored. The check is on disk, not on the
//   screen: after a bad paste the profile must hold no key file at all, because
//   storing first would strand the profile behind the very panel that key
//   unlocks — every screen 401ing with no way back.
//
//   A key the edge accepts reaches the app in the same session, with no
//   restart, and the identity the Account panel then shows is the one the edge
//   itself reports for that key.
//
//   A revoked key stops working. Read from both sides: the edge refuses it
//   directly, and the panel in the running app says so rather than rendering a
//   stale identity it fetched before the revoke.
//
// The revoked key does NOT bounce the app back to onboarding, and that is the
// desktop's rule rather than an omission: absence is onboarding, a refusal is
// an error. Degrading a rejected credential into "no credential" would turn
// every backend outage into a demand for a new key. Sign out is the way back,
// and this suite drives it to prove the profile can recover.
//
// The suite mints its own key rather than onboarding with the stack's: the
// third act revokes it, and revoking the bootstrap key would take the stack
// down for every other suite. Both keys are treated as secrets — the evidence
// tripwire below scans for each of them on every write.
//
// Preconditions match aion-lab.e2e.ts (skipped cleanly when absent): the
// Compose stack up in the sibling aion-v1 checkout, and `npx vite build` here.

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

// Every key this suite mints carries the marker, so a run that died half-way
// can be swept without touching a key a human provisioned.
const PROBE_LABEL = 'aion-e2e-account-probe';
// Shaped like a credential and belonging to nobody. The edge answers 401 for
// it exactly as it would for a revoked one — which is the point: a client
// cannot tell "never existed" from "no longer valid", and must not need to.
const BOGUS_KEY = 'ak_e2e_0000000000000000000000000000';
// The main process writes onboarding's key here, under the profile directory.
const STORED_KEY_FILE = 'aion-edge-api-key';

interface Bootstrap {
  api_key: string;
  edge_url: string;
  tenant_id: string;
}

interface EdgeAccount {
  tenant_id: string;
  key_id: string;
  user_id?: string;
  scopes?: string[];
  cell_id?: string;
  edge_api_version: string;
  key_management?: boolean;
}

interface EdgeKeySummary {
  key_id: string;
  label?: string;
  status: string;
  scopes?: string[];
  user_id?: string;
  created_at: string;
  last_used_at?: string;
  current?: boolean;
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
// The key this suite mints and then revokes. Held here so the evidence
// tripwire can refuse to write it, the same way it refuses the stack's key.
let probeKey = '';

test.beforeAll(async () => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-account-'));
  if (bootstrap && edgeBaseUrl) {
    try {
      const response = await fetch(`${edgeBaseUrl}/status`, {
        signal: AbortSignal.timeout(3_000),
      });
      edgeReady = response.ok;
    } catch {
      edgeReady = false;
    }
  }
  if (edgeReady) {
    await sweepProbes();
  }
  if (PACKAGED_SOURCE) {
    packaged = installPackagedApp(PACKAGED_SOURCE);
  }
});

test.afterAll(async () => {
  // A key left active is a live credential for this tenant, so the sweep runs
  // on the way out as well as on the way in.
  if (edgeReady) {
    await sweepProbes();
  }
  if (workDir) {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
  if (packaged) {
    fs.rmSync(packaged.installDir, { recursive: true, force: true });
  }
});

/**
 * A launch env holding the endpoint and NO credential of its own. Both key
 * variables are cleared rather than left alone: whatever ran this process may
 * have exported the harness key file, and an operator-provisioned key outranks
 * the app-stored one by design — which would leave nothing to onboard.
 */
function launchEnv(profileDir: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value;
  }
  delete env.VITE_DEV_SERVER_URL;
  return {
    ...env,
    EIGENT_E2E_USER_DATA: profileDir,
    EIGENT_REMOTE_BACKEND_URL: edgeBaseUrl!,
    EIGENT_REMOTE_BACKEND_API_KEY_FILE: '',
    EIGENT_REMOTE_BACKEND_API_KEY: '',
  };
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
  profileDir: string
): Promise<{ app: ElectronApplication; page: Page }> {
  const env = launchEnv(profileDir);
  const app = await electron.launch(
    packaged
      ? { executablePath: packaged.executablePath, args: [], env }
      : { args: [REPO_ROOT], cwd: REPO_ROOT, env }
  );
  const page = await findMainWindow(app);
  return { app, page };
}

const byId = (page: Page, id: string) => page.getByTestId(id);

async function screenshot(page: Page, name: string): Promise<void> {
  if (!EVIDENCE_DIR) return;
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `eigent-account-${name}.png`),
    fullPage: true,
  });
}

function writeEvidence(name: string, summary: Record<string, unknown>): void {
  if (!EVIDENCE_DIR) return;
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const payload = JSON.stringify(summary, null, 2);
  for (const secret of [bootstrap?.api_key, probeKey]) {
    if (secret && payload.includes(secret)) {
      throw new Error('evidence summary would leak an API key');
    }
  }
  fs.writeFileSync(path.join(EVIDENCE_DIR, name), payload);
}

/** Everything HTTP the renderer touched must stay on the edge origin. */
function auditEdgeOnly(urls: string[], origin: string): string[] {
  return urls
    .filter((u) => /^https?:/.test(u))
    .filter((u) => !u.startsWith(origin));
}

async function edgeFetch(
  method: string,
  pathname: string,
  options: { body?: unknown; key?: string } = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.key ?? bootstrap!.api_key}`,
  };
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    // A retried mint is a second live credential, not a spare row.
    headers['Idempotency-Key'] = `acct-e2e-${Math.random().toString(36).slice(2)}`;
  }
  return fetch(`${edgeBaseUrl}${pathname}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

/** Whoami as some particular key sees it — status included, so a refusal is
 * an answer rather than a thrown error. */
async function servedAccount(
  key: string
): Promise<{ status: number; account?: EdgeAccount; code?: string }> {
  const response = await edgeFetch('GET', '/account', { key });
  const body = (await response.json()) as EdgeAccount & { code?: string };
  return response.ok
    ? { status: response.status, account: body }
    : { status: response.status, code: body.code };
}

async function servedKeys(): Promise<EdgeKeySummary[]> {
  const response = await edgeFetch('GET', '/keys');
  if (!response.ok) {
    throw new Error(`listKeys: ${response.status} ${await response.text()}`);
  }
  return ((await response.json()) as { keys: EdgeKeySummary[] }).keys;
}

async function revokeKey(keyId: string): Promise<void> {
  const response = await edgeFetch(
    'DELETE',
    `/keys/${encodeURIComponent(keyId)}`
  );
  if (response.status !== 204) {
    throw new Error(`revokeKey: ${response.status} ${await response.text()}`);
  }
}

/** Revokes this suite's own leftovers, whenever it last stopped. */
async function sweepProbes(): Promise<number> {
  let removed = 0;
  for (const key of await servedKeys()) {
    if (key.status !== 'active') continue;
    if (!key.label?.startsWith(PROBE_LABEL)) continue;
    await revokeKey(key.key_id);
    removed += 1;
  }
  return removed;
}

test('a refused key is not stored, an accepted one reaches the app, and a revoked one stops working', async () => {
  test.skip(
    !bootstrap || !edgeReady || !APP_BUILT,
    'eigent-local stack not running or app not built'
  );
  test.setTimeout(300_000);
  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
  };

  const label = `${PROBE_LABEL}-${Date.now()}`;
  const minted = await edgeFetch('POST', '/keys', { body: { label } });
  expect(minted.status).toBe(201);
  const mintedBody = (await minted.json()) as {
    key_id: string;
    raw_key?: string;
    label?: string;
    user_id?: string;
  };
  expect(typeof mintedBody.raw_key).toBe('string');
  probeKey = mintedBody.raw_key!;
  const probeKeyId = mintedBody.key_id;
  summary.probe_key_id = probeKeyId;
  summary.probe_key_label = mintedBody.label;

  // The secret exists in that one response and nowhere else. A listing that
  // carried it would put a live credential into every screenshot of this
  // panel, so the assertion is on the serialized body, not on a parsed field.
  const listing = await edgeFetch('GET', '/keys');
  const listingText = await listing.text();
  expect(listing.status).toBe(200);
  expect(listingText).not.toContain(probeKey);
  expect(listingText).toContain(probeKeyId);

  const profileDir = fs.mkdtempSync(path.join(workDir, 'profile-'));
  const storedKeyPath = path.join(profileDir, STORED_KEY_FILE);
  expect(fs.existsSync(storedKeyPath)).toBe(false);

  const first = await launchApp(profileDir);
  const networkUrls: string[] = [];
  first.page.on('request', (request) => networkUrls.push(request.url()));

  try {
    // A configured endpoint with no credential is onboarding, not the legacy
    // login wall — the one aion state a user can actually resolve.
    await expect(byId(first.page, 'aion-onboarding')).toBeVisible({
      timeout: 60_000,
    });
    await expect(byId(first.page, 'aion-onboarding-endpoint')).toHaveText(
      edgeBaseUrl!
    );
    await screenshot(first.page, 'onboarding');

    await byId(first.page, 'aion-onboarding-key').fill(BOGUS_KEY);
    await byId(first.page, 'aion-onboarding-submit').click();
    const failure = byId(first.page, 'aion-onboarding-error');
    await expect(failure).toBeVisible({ timeout: 30_000 });
    // The edge's own typed refusal, carried through rather than flattened into
    // "something went wrong".
    await expect(failure).toContainText('invalid_credentials');
    summary.bad_key_error = (await failure.textContent())?.trim();
    // The assertion that matters, and it is not on the screen: nothing was
    // written. A key stored before it was checked would leave this profile
    // holding a credential that 401s on every screen.
    expect(fs.existsSync(storedKeyPath)).toBe(false);
    await expect(byId(first.page, 'aion-onboarding')).toBeVisible();
    await screenshot(first.page, 'bad-key');

    await byId(first.page, 'aion-onboarding-key').fill(probeKey);
    await byId(first.page, 'aion-onboarding-submit').click();
    // Same session, no restart: the stored key is re-resolved in place.
    await expect(byId(first.page, 'aion-onboarding')).toHaveCount(0, {
      timeout: 60_000,
    });
    expect(fs.existsSync(storedKeyPath)).toBe(true);
    // Readable by this user and nobody else — it is a bearer credential
    // sitting in a profile directory.
    expect(fs.statSync(storedKeyPath).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(storedKeyPath, 'utf-8').trim()).toBe(probeKey);
    summary.stored_key_mode = '0600';

    // Reaching the app means an authenticated aion surface renders, not merely
    // that the onboarding screen went away.
    await first.page.evaluate(() => {
      window.location.hash = '#/history?tab=home&section=projects';
    });
    await first.page.reload();
    await expect(byId(first.page, 'aion-projects')).toBeVisible({
      timeout: 60_000,
    });
    await screenshot(first.page, 'connected');

    await openAccountPanel(first.page);
    const served = await servedAccount(probeKey);
    expect(served.status).toBe(200);
    const account = served.account!;
    expect(account.tenant_id).toBe(bootstrap!.tenant_id);
    expect(account.key_id).toBe(probeKeyId);
    summary.account = {
      tenant_id: account.tenant_id,
      key_id: account.key_id,
      user_id: account.user_id ?? null,
      scopes: account.scopes ?? [],
      key_management: account.key_management === true,
      edge_api_version: account.edge_api_version,
    };

    // The panel reports the identity the edge reports for this key — not the
    // tenant the app was configured with, which would agree by accident.
    await expect(byId(first.page, 'aion-account')).toContainText(
      account.tenant_id
    );
    await expect(byId(first.page, 'aion-account')).toContainText(
      account.key_id
    );
    const ownRow = first.page.locator(
      `[data-testid="aion-account-key-row"][data-key-id="${probeKeyId}"]`
    );
    await expect(ownRow).toHaveCount(1);
    // The row this client authenticated with is marked, because revoking it is
    // permitted and signs this app out — the one row that needs saying so.
    await expect(ownRow).toHaveAttribute('data-current', 'true');
    await expect(ownRow).toHaveAttribute('data-status', 'active');
    await expect(ownRow.getByTestId('aion-account-key-current')).toBeVisible();
    // And no other row claims to be this client.
    expect(
      await first.page
        .locator('[data-testid="aion-account-key-row"][data-current="true"]')
        .count()
    ).toBe(1);
    await screenshot(first.page, 'account');

    // Nothing on this panel may render the secret. The stack's key is scanned
    // alongside the probe's, since either appearing here is the same defect.
    const panelText =
      (await byId(first.page, 'aion-account').textContent()) ?? '';
    expect(panelText).not.toContain(probeKey);
    expect(panelText).not.toContain(bootstrap!.api_key);

    // Third act: the credential is revoked out from under the running app.
    await revokeKey(probeKeyId);
    const refused = await servedAccount(probeKey);
    expect(refused.status).toBe(401);
    expect(refused.code).toBe('invalid_credentials');
    summary.revoked_key_status = refused.status;
    summary.revoked_key_code = refused.code;

    // The key stops authenticating; it does not stop existing. A listing that
    // dropped it would leave a user unable to see what they revoked.
    const afterRevoke = (await servedKeys()).find(
      (k) => k.key_id === probeKeyId
    );
    expect(afterRevoke?.status).toBe('revoked');
    // It authenticated at least once before it was revoked, so the timestamp
    // is present rather than a zero standing in for "never".
    expect(afterRevoke?.last_used_at).toBeTruthy();

    await byId(first.page, 'aion-account-refresh').click();
    // The panel says the credential failed rather than showing the identity it
    // fetched a moment ago.
    await expect(byId(first.page, 'aion-account-error')).toBeVisible({
      timeout: 30_000,
    });
    await expect(byId(first.page, 'aion-account-error')).toContainText(
      'invalid_credentials'
    );
    await screenshot(first.page, 'revoked');

    const offEdge = auditEdgeOnly(networkUrls, new URL(edgeBaseUrl!).origin);
    expect(offEdge).toEqual([]);
    // An empty off-edge set is vacuous unless the renderer made requests.
    expect(
      networkUrls.filter((u) => /^https?:/.test(u)).length
    ).toBeGreaterThan(0);
    summary.off_edge_requests = offEdge;
  } finally {
    await first.app.close();
  }

  // The way back. Signing out truncates the stored key rather than deleting
  // the file or revoking anything on the server — a device signs itself out,
  // it does not revoke a credential other devices may be holding.
  const second = await launchApp(profileDir);
  try {
    await openAccountPanel(second.page);
    await byId(second.page, 'aion-account-sign-out').click();
    await expect(byId(second.page, 'aion-onboarding')).toBeVisible({
      timeout: 60_000,
    });
    expect(fs.existsSync(storedKeyPath)).toBe(true);
    expect(fs.readFileSync(storedKeyPath, 'utf-8').trim()).toBe('');
    summary.sign_out_returns_to_onboarding = true;
    await screenshot(second.page, 'signed-out');
  } finally {
    await second.app.close();
  }

  writeEvidence('eigent-account-summary.json', summary);
});

/** Routes to Settings and selects the Account tab, which is present only in
 * aion mode — on the legacy plane there is no such credential to describe. */
async function openAccountPanel(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = '#/history?tab=settings';
  });
  await page.reload();
  const tab = page.getByRole('tab', { name: 'Account', exact: true });
  await expect(tab).toBeVisible({ timeout: 60_000 });
  await tab.click();
  await expect(page.getByTestId('aion-account')).toBeVisible({
    timeout: 60_000,
  });
}
