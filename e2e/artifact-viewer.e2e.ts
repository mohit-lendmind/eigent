// Artifact-viewer desktop E2E: the REAL desktop app in remote-backend mode
// against the eigent-local Compose edge, asserting the A2 claim — a deliverable
// the agent published is readable inside the app, in the form it was written
// in, without leaving for a browser or a download.
//
// The driver is the `aion-viewer` fixture (viewer-sequence): a markdown
// document written then revised (two versions of one name), an HTML dashboard
// that reaches for a CDN, a Python file, and a 1.2 MiB CSV that is past the
// edge's inline cap. Those are the four lanes the viewer routes, and the last
// is the negative control: an artifact it CANNOT render must offer a download
// rather than paint an empty pane.
//
// The load-bearing assertion is the HTML preview's policy. A `srcdoc` iframe
// inherits the embedder's CSP, and this app's CSP has no `default-src` and no
// `connect-src` — so without an injected policy an agent-authored page could
// fetch anywhere the renderer can. The spec reads the policy the frame
// actually carries in both toggle states, and pins `connect-src 'none'` in
// both: opting in buys subresources from a known list, never a way out.
//
// Needs the stack in fixture-picker mode:
//   EIGENT_LOCAL_FIXTURE_PICKER=1 bazel run //dev/eigent_local:up   (in aion-v1)
//   EIGENT_E2E_FIXTURE_PICKER=1 npx playwright test --config e2e/playwright.config.ts artifact-viewer
//
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

/** fakeroute viewer-sequence: markdown + html + code + an over-cap CSV. */
const VIEWER_ALIAS = 'aion-viewer';

const DOC = 'findings.md';
const PAGE_DOC = 'dashboard.html';
const CODE_DOC = 'analyze.py';
const BULK_DOC = 'bulk.csv';
/** The one host the fixture's page references — blocked until opted in. */
const CDN_HOST = 'cdn.jsdelivr.net';

const TURN_TIMEOUT_MS = 240_000;

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
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-viewer-'));
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
  return { app, page: await findMainWindow(app) };
}

async function screenshot(page: Page, name: string): Promise<void> {
  if (!EVIDENCE_DIR) return;
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `eigent-viewer-${name}.png`),
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

async function pinAlias(page: Page, alias: string): Promise<void> {
  await page.evaluate((selectedAlias) => {
    localStorage.setItem(
      'aion-model-store',
      JSON.stringify({ state: { selectedAlias }, version: 0 })
    );
  }, alias);
  await page.reload();
}

/** A fresh Space, so the turn is its own project and its own trajectory. */
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

async function runTurn(page: Page, prompt: string): Promise<void> {
  const composer = await newSpace(page);
  await composer.click();
  await page.keyboard.insertText(prompt);
  await composer.press('Enter');
  const busy = page.locator('[role="textbox"][contenteditable="false"]');
  await busy
    .first()
    .waitFor({ state: 'attached', timeout: 120_000 })
    .catch(() => {});
  await expect(busy).toHaveCount(0, { timeout: TURN_TIMEOUT_MS });
}

/** The policy the preview frame actually carries, read out of its srcdoc. */
async function framePolicy(page: Page): Promise<string> {
  const srcdoc = await page
    .locator('[data-artifact-html-frame="1"]')
    .getAttribute('srcdoc');
  const match = /content="([^"]*)"/.exec(srcdoc ?? '');
  return match?.[1] ?? '';
}

/** Selects an artifact in the open viewer by its rail row. */
async function selectArtifact(page: Page, name: string): Promise<void> {
  await page.locator(`[data-artifact-row="${name}"]`).click();
  await expect(
    page.locator('[data-artifact-ready="1"]').first()
  ).toBeVisible({ timeout: 60_000 });
}

test('every published lane is readable in the app, and an HTML preview is sealed until it is opened', async () => {
  test.skip(
    process.env.EIGENT_E2E_FIXTURE_PICKER !== '1',
    'needs the fixture-picker stack (EIGENT_LOCAL_FIXTURE_PICKER=1 up + EIGENT_E2E_FIXTURE_PICKER=1)'
  );
  test.skip(
    !bootstrap || !edgeReady || !APP_BUILT,
    'eigent-local stack not running or app not built'
  );
  test.setTimeout(600_000);

  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
    viewer_alias: VIEWER_ALIAS,
  };
  const { app, page } = await launchApp();
  const networkUrls: string[] = [];
  page.on('request', (request) => networkUrls.push(request.url()));
  // Chromium reports a policy-blocked subresource as a request that FAILED,
  // not as a request that never happened — so "no request event" is the wrong
  // assertion. What the policy has to prove is that the attempt was refused.
  const failures: { url: string; error: string }[] = [];
  page.on('requestfailed', (request) =>
    failures.push({
      url: request.url(),
      error: request.failure()?.errorText ?? '',
    })
  );

  try {
    await page
      .locator('[role="textbox"]')
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 });

    await pinAlias(page, VIEWER_ALIAS);
    await runTurn(page, 'viewer fixture payload');
    await screenshot(page, '01-run-settled');

    // ---- The chat announces the deliverables. ----------------------------
    // This is what makes the panel reachable at all: before A2 an artifact
    // existed only as a row on a hub page in another part of the app.
    const cards = page.locator('[data-artifact-card]');
    await expect(cards.first()).toBeVisible({ timeout: 60_000 });
    const announced = await cards.evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute('data-artifact-card') ?? '')
    );
    summary.announced_artifacts = announced;
    expect(announced).toContain(DOC);
    expect(announced).toContain(PAGE_DOC);
    expect(announced).toContain(BULK_DOC);

    // ---- Opening one from the chat opens the viewer. ---------------------
    await page
      .locator(`[data-artifact-card="${DOC}"]`)
      .getByRole('button', { name: 'Open' })
      .click();
    await expect(page.locator('[data-artifact-lane]')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('[data-artifact-ready="1"]')).toBeVisible({
      timeout: 60_000,
    });

    // ---- Markdown renders as a document, not as its source. --------------
    await expect(page.locator('[data-artifact-lane="markdown"]')).toBeVisible();
    const heading = page.locator('[data-artifact-markdown="1"] h1');
    await expect(heading).toHaveText('Findings', { timeout: 30_000 });
    // v2's revision, so the viewer opened the NEWEST version rather than the
    // first one the listing happened to hold.
    await expect(page.locator('[data-artifact-lane]')).toHaveAttribute(
      'data-artifact-version',
      '2'
    );
    await expect(page.locator('[data-artifact-markdown="1"]')).toContainText(
      'status: final'
    );
    await screenshot(page, '02-markdown');

    // ---- The name's version history is addressable. ----------------------
    const versionSelect = page.locator('[data-artifact-version-select="1"]');
    await expect(versionSelect).toBeVisible();
    const versionLabels = await versionSelect
      .locator('option')
      .evaluateAll((nodes) => nodes.map((n) => n.textContent ?? ''));
    summary.version_options = versionLabels;
    expect(versionLabels.length).toBe(2);
    expect(versionLabels[0]).toContain('v2');
    expect(versionLabels[1]).toContain('v1');

    // ---- The same document as source mounts the editor. ------------------
    await page.getByRole('button', { name: 'Source', exact: true }).click();
    await expect(page.locator('[data-artifact-lane] [data-monaco-ready="1"]')).toBeVisible({
      timeout: 60_000,
    });
    await page.getByRole('button', { name: 'Rendered', exact: true }).click();

    // ---- Two versions of one name diff against each other. ---------------
    // The revision this fixture makes is a single word, which is exactly the
    // case a version list cannot show and a diff can.
    await page
      .getByRole('button', { name: 'Compare with the previous version' })
      .click();
    const diff = page.locator('[data-artifact-compare]');
    await expect(diff).toHaveAttribute('data-artifact-compare', 'v1');
    await expect(diff).toHaveAttribute('data-monaco-ready', '1', {
      timeout: 60_000,
    });
    summary.compare_label = await diff.getAttribute('data-artifact-compare');
    await screenshot(page, '02b-compare');
    await page
      .getByRole('button', { name: 'Compare with the previous version' })
      .click();
    await expect(diff).toHaveCount(0);

    // ---- The HTML page is sealed by default. -----------------------------
    await selectArtifact(page, PAGE_DOC);
    await expect(page.locator('[data-artifact-lane="html"]')).toBeVisible();
    const frame = page.locator('[data-artifact-html-frame="1"]');
    await expect(frame).toHaveAttribute('data-allow-external', '0');
    const sealed = await framePolicy(page);
    summary.policy_sealed = sealed;
    expect(sealed).toContain("default-src 'none'");
    expect(sealed).toContain("connect-src 'none'");
    expect(sealed).not.toContain(CDN_HOST);
    // The frame is an opaque origin: no `allow-same-origin`, so the page has
    // no access to this app's storage or DOM even with scripts enabled.
    const sandbox = await frame.getAttribute('sandbox');
    summary.frame_sandbox = sandbox;
    expect(sandbox).toBe('allow-scripts');

    // The page's own inline script still runs — a preview whose script is
    // blocked is not a preview of what the agent built.
    const inner = page.frameLocator('[data-artifact-html-frame="1"]');
    await expect(inner.locator('#marker')).toHaveText('inline-script-ran', {
      timeout: 30_000,
    });
    await expect(inner.locator('#headline')).toBeVisible();
    await screenshot(page, '03-html-sealed');

    // The page reports its own reach, because a blocked subresource is not
    // reliably observable from out here: Chromium sometimes refuses it at the
    // loader and never opens a network event, so counting attempts is a coin
    // flip. What the page can always answer is whether the script RAN.
    await expect(inner.locator('#cdn')).toHaveText('cdn-absent', {
      timeout: 30_000,
    });
    // And the claim the whole injected policy exists to make: the page cannot
    // reach the network. `sandbox` alone would not have stopped this.
    await expect(inner.locator('#net')).toHaveText('fetch-refused', {
      timeout: 30_000,
    });
    // Whatever the browser DID surface must be a refusal — never a load that
    // succeeded while the frame was sealed.
    const refused = failures.filter((f) => f.url.includes(CDN_HOST));
    summary.sealed_cdn_refusals = refused.map((f) => f.error);
    const surfaced = networkUrls.filter((u) => u.includes(CDN_HOST));
    summary.sealed_cdn_surfaced = surfaced;
    expect(surfaced.filter((u) => !refused.some((f) => f.url === u))).toEqual(
      []
    );
    // Chromium spells this refusal either `csp` or `net::ERR_BLOCKED_BY_CSP`
    // depending on which layer stopped the load; both name the policy.
    for (const failure of refused) {
      expect(failure.error.toLowerCase()).toContain('csp');
    }
    const beforeOptIn = networkUrls.length;

    // ---- Opting in relaxes subresources and nothing else. ----------------
    await page.getByRole('button', { name: 'Allow', exact: true }).click();
    await expect(frame).toHaveAttribute('data-allow-external', '1');
    const opened = await framePolicy(page);
    summary.policy_opened = opened;
    const refusedBefore = failures.length;
    expect(opened).toContain(CDN_HOST);
    // The whole point of the toggle: a CDN dashboard renders, and the page
    // still has no way to send anything out.
    expect(opened).toContain("connect-src 'none'");
    await expect(inner.locator('#marker')).toHaveText('inline-script-ran', {
      timeout: 30_000,
    });
    // The toggle buys subresources and nothing else: the page still cannot
    // reach out, which is what keeps a run's findings from leaving with it.
    // (Whether the CDN script itself loaded is not asserted — it depends on
    // this machine having internet, which a fixture run must not.)
    await expect(inner.locator('#net')).toHaveText('fetch-refused', {
      timeout: 30_000,
    });
    await screenshot(page, '04-html-opened');

    // Every off-edge request the opt-in produced is on the allowlist — the
    // toggle widened the door to a known list, not to the internet.
    const afterOptIn = auditEdgeOnly(
      networkUrls.slice(beforeOptIn),
      new URL(edgeBaseUrl!).origin
    );
    summary.opt_in_requests = afterOptIn;
    expect(
      afterOptIn.filter((u) => !u.startsWith(`https://${CDN_HOST}`))
    ).toEqual([]);
    // And the CDN request is no longer refused by policy — the toggle is what
    // changed, so a still-blocked load would mean the relaxed policy never
    // reached the frame.
    summary.opt_in_refusals = failures
      .slice(refusedBefore)
      .filter((f) => f.error.toLowerCase().includes('csp'))
      .map((f) => f.url);
    expect(summary.opt_in_refusals).toEqual([]);

    // ---- Code routes to the editor. --------------------------------------
    await selectArtifact(page, CODE_DOC);
    await expect(page.locator('[data-artifact-lane="code"]')).toBeVisible();
    await expect(page.locator('[data-artifact-lane] [data-monaco-ready="1"]')).toBeVisible({
      timeout: 60_000,
    });

    // ---- Negative control: over the inline cap, offer the download. ------
    // A blank pane here would read as "the agent produced nothing", which is
    // the exact misreading this milestone exists to prevent.
    await selectArtifact(page, BULK_DOC);
    await expect(
      page.getByText('too large to preview', { exact: false })
    ).toBeVisible({ timeout: 60_000 });
    // Scoped to the viewer pane: the tab header carries its own Download
    // affordance, and the claim here is about the pane offering one.
    await expect(
      page
        .locator('[data-artifact-lane]')
        .getByRole('button', { name: 'Download', exact: true })
    ).toBeVisible();
    summary.over_cap_shows_download = true;
    await screenshot(page, '05-over-cap');

    // ---- The app talked to nothing but its own edge and that CDN. --------
    const offEdge = auditEdgeOnly(
      networkUrls,
      new URL(edgeBaseUrl!).origin
    ).filter((u) => !u.startsWith(`https://${CDN_HOST}`));
    summary.off_edge_requests = offEdge;
    expect(offEdge).toEqual([]);
  } finally {
    writeEvidence('artifact-viewer-summary.json', summary);
    await app.close();
  }
});
