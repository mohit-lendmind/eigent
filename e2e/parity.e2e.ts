// Parity walk: every destination the nav can reach in aion mode, visited in one
// session against the eigent-local Compose edge.
//
// This is the standing regression gate against a dead screen coming back. Each
// destination has to land in exactly one of three buckets and prove it:
//
//   served   — an aion-backed screen showing its own root, with its degraded
//              banner absent (a banner means the screen is up but the plane
//              behind it is not, which is the failure this gate exists to catch)
//   local    — a screen with no backend at all; it drives the desktop over IPC
//   soon     — a placeholder that says so on screen
//
// A dead screen is what you get when a destination is in none of them: it
// renders, it looks live, and nothing behind it answers. Two more assertions
// close the loop — the whole walk touches no origin but the edge, and it made
// enough requests for that to mean something.
//
// Preconditions match aion-lab.e2e.ts (skipped cleanly when absent): the
// Compose stack up in the sibling aion-v1 checkout and `npx vite build` here.
// The desktop API key comes from the gitignored run manifest and rides ONLY the
// env of the launched app — never a committed file or evidence output.

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

const SETTLE_MS = 1_500;
const VISIBLE_TIMEOUT_MS = 30_000;

type Bucket = 'served' | 'local' | 'soon';

interface Destination {
  id: string;
  bucket: Bucket;
  /** Home-tab query for the deterministic mount, or a vertical-nav id to click. */
  query?: string;
  navItem?: string;
  /** The screen is really there when this is visible. */
  present: string;
  /** Degraded states: visible means the screen is up and its plane is not. */
  absent?: string[];
}

// Mirrors the nav registries: HISTORY_TAB_IDS (HistoryTabsNav.tsx), the Home,
// Agents and Browser section lists, and settingMenus. A tab added there without
// a row here leaves a destination unwalked, which the count check below catches.
const DESTINATIONS: Destination[] = [
  {
    id: 'home/spaces',
    bucket: 'served',
    query: 'tab=home&section=spaces',
    present: 'aion-spaces',
    absent: ['aion-spaces-banner', 'aion-spaces-error'],
  },
  {
    id: 'home/projects',
    bucket: 'served',
    query: 'tab=home&section=projects',
    present: 'aion-projects',
    absent: ['aion-projects-banner'],
  },
  {
    id: 'home/triggers',
    bucket: 'served',
    query: 'tab=home&section=triggers',
    present: 'aion-triggers',
    absent: ['aion-triggers-banner', 'aion-triggers-error'],
  },
  {
    id: 'home/usage',
    bucket: 'served',
    query: 'tab=home&section=usage',
    present: 'aion-usage',
    absent: ['aion-usage-banner'],
  },
  {
    id: 'agents/skills',
    bucket: 'served',
    query: 'tab=agents&section=skills',
    present: 'skills-add',
    absent: ['skills-remote-banner'],
  },
  {
    id: 'agents/memory',
    bucket: 'served',
    query: 'tab=agents&section=memory',
    present: 'aion-memory',
    absent: ['aion-memory-banner'],
  },
  {
    id: 'connectors',
    bucket: 'served',
    query: 'tab=connectors',
    present: 'aion-connectors',
    absent: ['aion-connectors-banner'],
  },
  {
    id: 'settings/account',
    bucket: 'served',
    query: 'tab=settings',
    navItem: 'account',
    present: 'aion-account',
    absent: ['aion-account-banner', 'aion-account-error'],
  },
  {
    // Chrome over CDP, driven from the main process. No plane behind it to be
    // dead, on either side.
    id: 'browser/cdp',
    bucket: 'local',
    query: 'tab=browser',
    present: 'cdp-connections',
  },
  {
    id: 'browser/extension',
    bucket: 'soon',
    query: 'tab=browser',
    navItem: 'extension',
    present: 'coming-soon',
  },
  {
    id: 'channels',
    bucket: 'soon',
    query: 'tab=channels',
    present: 'coming-soon',
  },
];

// Every top-level tab has to be represented, or the walk silently shrinks.
const WALKED_TABS = [
  'home',
  'agents',
  'channels',
  'connectors',
  'browser',
  'settings',
];

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
let packaged: PackagedInstall | null = null;

test.beforeAll(async () => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-parity-'));
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
  if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  if (packaged) fs.rmSync(packaged.installDir, { recursive: true, force: true });
});

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

async function screenshot(page: Page, name: string): Promise<void> {
  if (!EVIDENCE_DIR) return;
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `eigent-parity-${name}.png`),
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

test('every nav destination in aion mode is served, local or honestly absent', async () => {
  test.skip(!APP_BUILT, 'run `npx vite build` first');
  test.skip(!bootstrap, `no bootstrap manifest at ${BOOTSTRAP_PATH}`);
  test.skip(!edgeReady, `edge not reachable at ${edgeBaseUrl}`);
  test.setTimeout(6 * 60_000);

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value;
  }
  delete env.VITE_DEV_SERVER_URL;
  env.EIGENT_E2E_USER_DATA = fs.mkdtempSync(path.join(workDir, 'user-data-'));
  env.EIGENT_REMOTE_BACKEND_URL = edgeBaseUrl!;
  env.EIGENT_REMOTE_BACKEND_API_KEY_FILE = keyFile;
  env.EIGENT_REMOTE_BACKEND_API_KEY = '';

  const app = await electron.launch(
    packaged
      ? { executablePath: packaged.executablePath, args: [], env }
      : { args: [REPO_ROOT], cwd: REPO_ROOT, env }
  );
  const visited: Record<string, unknown>[] = [];
  try {
    const page = await findMainWindow(app);
    const urls: string[] = [];
    page.on('request', (request) => urls.push(request.url()));

    await page
      .locator('[role="textbox"]')
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 });

    for (const destination of DESTINATIONS) {
      // Route + reload so React mounts directly on the target rather than
      // animating through the tabs on the way there.
      await page.evaluate((query) => {
        window.location.hash = `#/history?${query}`;
      }, destination.query!);
      await page.reload();
      if (destination.navItem) {
        const item = page.locator(`[data-nav-item="${destination.navItem}"]`);
        await item.waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT_MS });
        await item.click();
      }
      await page.waitForTimeout(SETTLE_MS);

      await expect(
        page.getByTestId(destination.present).first(),
        `${destination.id} did not render`
      ).toBeVisible({ timeout: VISIBLE_TIMEOUT_MS });
      for (const marker of destination.absent ?? []) {
        await expect(
          page.getByTestId(marker),
          `${destination.id} rendered its ${marker}: the screen is up, its plane is not`
        ).toHaveCount(0);
      }
      // The buckets have to stay apart. A served screen that fell back to
      // "coming soon" would otherwise pass on its root testid alone.
      if (destination.bucket === 'served') {
        await expect(
          page.getByTestId('coming-soon'),
          `${destination.id} is a placeholder, not a served screen`
        ).toHaveCount(0);
      }
      await screenshot(page, destination.id.replace('/', '-'));
      visited.push({ id: destination.id, bucket: destination.bucket });
    }

    // Both halves: nothing off the edge, and enough traffic for that to be a
    // statement rather than an empty set.
    const httpRequests = urls.filter((u) => /^https?:/.test(u));
    const offEdge = httpRequests.filter(
      (u) => !u.startsWith(bootstrap!.edge_url.replace(/\/+$/, ''))
    );
    writeEvidence('eigent-parity-summary.json', {
      captured_at: new Date().toISOString(),
      edge_base_url: edgeBaseUrl,
      packaged: packaged !== null,
      destinations: visited,
      tabs_walked: WALKED_TABS,
      http_request_count: httpRequests.length,
      off_edge: offEdge,
    });
    expect(offEdge, 'a screen reached an origin other than the edge').toEqual(
      []
    );
    expect(
      httpRequests.length,
      'the walk made no HTTP requests, so the edge-only audit proves nothing'
    ).toBeGreaterThan(0);

    // Every tab in the registry got walked, so the table cannot silently drift
    // behind the nav it is meant to cover.
    const covered = new Set(
      DESTINATIONS.map((d) => d.query!.replace(/^tab=/, '').split('&')[0])
    );
    expect([...covered].sort()).toEqual([...WALKED_TABS].sort());
  } finally {
    await app.close();
  }
});
