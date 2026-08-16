// Real-model driver for accounts: a cold profile with no credential onboards
// itself and then does real work in the same session.
//
// The claim is the one an account plane exists to make — that a pasted key is
// an identity the product runs as, not a string it stores. Nothing on the
// onboarding screen can show that, so the oracle is the edge's own answer to
// the credential the desktop is holding: `/account` presented with the pasted
// key names a key_id, and that id is NOT the operator's bootstrap key. The
// desktop launches with both key environment variables cleared, so the only
// credential it can be running as is the one that was typed in.
//
// The real-model run is what makes the identity load-bearing rather than
// decorative: the run is submitted through the composer, settles on the edge's
// own trajectory, and carries the model's own answer — a session that
// authenticated but could not work would pass a whoami and fail here.
//
// The negative control is the sign-out. Clearing a device returns it to
// onboarding and empties the key file, and the key it was holding must still
// authenticate afterwards: signing out of one device is not revoking a
// credential the tenant's other devices are using.
//
// Run: npx playwright test --config e2e/eval.config.ts account
// Env: EIGENT_EVAL_MODEL / EIGENT_EVAL_MODEL_LABEL pick the catalog row.
// Output: EIGENT_EVAL_DIR (default ../n6-evidence/playwright/real-model).

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
  path.resolve(REPO_ROOT, '..', 'n6-evidence', 'playwright', 'real-model');

const MODEL_ALIAS = process.env.EIGENT_EVAL_MODEL ?? 'kimi-k3';

// Where the main process stores an app-provisioned key inside a profile.
const STORED_KEY_FILE = 'aion-edge-api-key';
const VIDEO_SIZE = { width: 1280, height: 800 };
// A recording that never started is a few KB of container; a recorded run is
// megabytes. The floor separates the two without pinning a duration.
const MIN_VIDEO_BYTES = 200 * 1024;
const ANSWER_TIMEOUT_MS = 8 * 60_000;
const TRAJECTORY_WINDOW_MS = 120_000;

const TERMINAL_KINDS = ['run_completed', 'run_failed', 'run_cancelled'];

interface Bootstrap {
  api_key: string;
  edge_url: string;
  tenant_id: string;
}

interface EdgeEvent {
  kind: string;
  sequence: string;
  run_id?: string;
  data?: Record<string, unknown>;
}

interface EdgeAccount {
  tenant_id: string;
  key_id: string;
  user_id?: string;
  scopes?: string[];
  edge_api_version: string;
  key_management?: boolean;
}

const bootstrap: Bootstrap = JSON.parse(
  fs.readFileSync(BOOTSTRAP_PATH, 'utf-8')
);
const edgeBaseUrl = `${bootstrap.edge_url.replace(/\/+$/, '')}/eigent/v1`;

const RUN_TAG = `n6-${Date.now().toString(36)}`;
// Deliberately trivial: the model's job here is to be a real provider serving a
// real run authenticated by a freshly onboarded key, not to be tested.
//
// The answer is assembled by the model rather than quoted from the prompt, so
// the token never appears in what the user typed. Waiting for a string the
// prompt already contains would be satisfied by the echo of the submission
// itself — a run that never reached a provider would pass.
const TOKEN_STEM = `ACCOUNT_OK_${RUN_TAG.toUpperCase()}`;
const ANSWER = `${TOKEN_STEM}42`;
const PROMPT =
  `Reply with exactly one line containing only ${TOKEN_STEM} with the two ` +
  `digits 42 appended directly to it, and nothing else.`;

// Never a valid key: the refusal has to come from the edge, not from a local
// format check, so the eval proves the app verifies rather than merely parses.
const BOGUS_KEY = 'aion-not-a-real-key-000000000000';

let mintedKey = '';

function writeOut(name: string, body: string): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const secret of [bootstrap.api_key, mintedKey]) {
    if (secret && body.includes(secret)) {
      throw new Error(`${name} would leak an API key`);
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, name), body);
}

async function screenshot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(OUT_DIR, `${name}.png`),
    fullPage: true,
  });
}

async function edgeFetch(
  method: string,
  pathname: string,
  body?: unknown,
  key: string = bootstrap.api_key
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
  };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    headers['Idempotency-Key'] =
      `acct-eval-${Math.random().toString(36).slice(2)}`;
  }
  return fetch(`${edgeBaseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** whoami for a specific credential — the edge's answer, not the screen's. */
async function servedAccount(
  key: string
): Promise<{ status: number; account?: EdgeAccount }> {
  const response = await edgeFetch('GET', '/account', undefined, key);
  if (response.status !== 200) {
    await response.text();
    return { status: response.status };
  }
  return { status: 200, account: (await response.json()) as EdgeAccount };
}

/**
 * The durable trajectory, straight from the edge's SSE replay: the run as the
 * product recorded it, independent of anything the renderer displayed.
 */
async function collectTrajectory(projectId: string): Promise<EdgeEvent[]> {
  const events: EdgeEvent[] = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRAJECTORY_WINDOW_MS);
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
        if (TERMINAL_KINDS.includes(event.kind)) break outer;
      }
    }
  } catch (error) {
    if (!(error instanceof Error && error.name === 'AbortError')) throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return events;
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

/**
 * A fresh Space, so the task becomes its own aion Project. A profile that has
 * just onboarded opens on a legacy Space whose composer is read-only, which is
 * a correct state to land in and not one a Project can be started from.
 */
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
  await composer.waitFor({ state: 'visible', timeout: 60_000 });
  await page
    .getByText('Create a new space', { exact: true })
    .waitFor({ state: 'hidden', timeout: 10_000 })
    .catch(() => {});
  return composer;
}

async function openAccountPanel(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = '#/history?tab=settings';
  });
  await page.reload();
  await page.getByRole('tab', { name: 'Account', exact: true }).click();
  await expect(page.getByTestId('aion-account')).toBeVisible({
    timeout: 60_000,
  });
}

test('a cold profile onboards itself and then does real work as that identity', async () => {
  // The operator's own identity, so the assertion below that the desktop is
  // NOT running as it has something to compare against.
  const operator = await servedAccount(bootstrap.api_key);
  expect(operator.status).toBe(200);
  const operatorKeyId = operator.account!.key_id;

  // The mint carries the caller's own grant and reads no identity from the
  // request, so this key is as tenant-wide as the operator key that minted it.
  // Provisioning a key for a named subject is an operator action off this
  // route, which is why the whoami below asserts an ABSENT user_id rather than
  // a subject the desktop could have onboarded as.
  const minted = await edgeFetch('POST', '/keys', {
    label: `aion-eval-onboarding-${RUN_TAG}`,
  });
  expect(minted.status).toBe(201);
  const mintedBody = (await minted.json()) as {
    key_id: string;
    raw_key?: string;
  };
  expect(mintedBody.raw_key, 'a create must return the secret exactly once')
    .toBeTruthy();
  mintedKey = mintedBody.raw_key!;
  const mintedKeyId = mintedBody.key_id;
  expect(mintedKeyId).not.toBe(operatorKeyId);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-n6-'));
  const profileDir = fs.mkdtempSync(path.join(workDir, 'user-data-'));
  const storedKeyPath = path.join(profileDir, STORED_KEY_FILE);

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value;
  }
  delete env.VITE_DEV_SERVER_URL;
  env.EIGENT_E2E_USER_DATA = profileDir;
  env.EIGENT_REMOTE_BACKEND_URL = edgeBaseUrl;
  // Both cleared: an operator-provisioned key outranks the app-stored one by
  // design, so leaving either set would leave nothing to onboard and the run
  // would prove nothing about the key that was typed in.
  env.EIGENT_REMOTE_BACKEND_API_KEY_FILE = '';
  env.EIGENT_REMOTE_BACKEND_API_KEY = '';

  const videoDir = path.join(OUT_DIR, 'video');
  fs.rmSync(videoDir, { recursive: true, force: true });

  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
    run_tag: RUN_TAG,
    model_alias: MODEL_ALIAS,
    operator_key_id: operatorKeyId,
    onboarded_key_id: mintedKeyId,
    prompt: PROMPT,
  };

  // A cold profile: the credential does not exist anywhere yet.
  expect(fs.existsSync(storedKeyPath)).toBe(false);

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
    const requestUrls: string[] = [];
    page.on('request', (request) => requestUrls.push(request.url()));

    // ---- Onboarding: a configured endpoint with nothing to present. ----
    await expect(page.getByTestId('aion-onboarding')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId('aion-onboarding-endpoint')).toHaveText(
      edgeBaseUrl
    );
    await screenshot(page, '01-onboarding');

    // A key is checked before it is kept. Refusing a bad one on screen is half
    // the claim; the other half is on disk, and only the disk can show it.
    await page.getByTestId('aion-onboarding-key').fill(BOGUS_KEY);
    await page.getByTestId('aion-onboarding-submit').click();
    const failure = page.getByTestId('aion-onboarding-error');
    await expect(failure).toBeVisible({ timeout: 30_000 });
    await expect(failure).toContainText('invalid_credentials');
    summary.bad_key_error = (await failure.textContent())?.trim();
    expect(fs.existsSync(storedKeyPath)).toBe(false);
    await screenshot(page, '02-refused');

    await page.getByTestId('aion-onboarding-key').fill(mintedKey);
    await page.getByTestId('aion-onboarding-submit').click();
    // Same session, no restart.
    await expect(page.getByTestId('aion-onboarding')).toHaveCount(0, {
      timeout: 60_000,
    });
    expect(fs.existsSync(storedKeyPath)).toBe(true);
    // A bearer credential in a profile directory, readable by nobody else.
    expect(fs.statSync(storedKeyPath).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(storedKeyPath, 'utf-8').trim()).toBe(mintedKey);
    summary.stored_key_mode = '0600';
    await screenshot(page, '03-onboarded');

    // ---- The identity, from the edge rather than the screen. ----
    const served = await servedAccount(mintedKey);
    expect(served.status).toBe(200);
    const account = served.account!;
    expect(account.tenant_id).toBe(bootstrap.tenant_id);
    expect(account.key_id).toBe(mintedKeyId);
    // Absent, not empty. A tenant-wide key names nobody, and that is a
    // different fact from a user whose name happens to be blank — it is the
    // reason per-user resources are unavailable to this session.
    expect(account.user_id).toBeUndefined();
    summary.account = {
      tenant_id: account.tenant_id,
      key_id: account.key_id,
      user_id: account.user_id,
      edge_api_version: account.edge_api_version,
    };

    // ---- Real work, in the same session, as that identity. ----
    const composer = await newSpace(page);

    // The create is watched rather than inferred: it is the request the
    // onboarded credential authenticates, and it names the Project the
    // trajectory is then read from.
    const createRequest = page.waitForRequest(
      (request) =>
        request.method() === 'POST' &&
        request.url() === `${edgeBaseUrl}/projects`,
      { timeout: 60_000 }
    );

    await typeIntoComposer(page, composer, PROMPT);
    await composer.press('Enter');

    const request = await createRequest;
    // The desktop presents the key it was given, not one it inherited. The
    // comparison is reduced to a boolean before it reaches expect(): a failed
    // equality would print both sides, and one of them is a live credential.
    const authorization = (await request.allHeaders())['authorization'] ?? '';
    expect(
      authorization === `Bearer ${mintedKey}`,
      'the create was not authenticated by the onboarded key'
    ).toBe(true);
    const createResponse = await request.response();
    expect(createResponse?.status()).toBe(201);
    const projectId = (
      (await createResponse!.json()) as { project_id: string }
    ).project_id;
    summary.project_id = projectId;
    await screenshot(page, '04-submitted');

    const answered = page.getByText(ANSWER, { exact: false }).first();
    try {
      await answered.waitFor({ state: 'visible', timeout: ANSWER_TIMEOUT_MS });
    } catch (error) {
      await screenshot(page, 'timeout-answer');
      throw new Error(`the run never answered with ${ANSWER}: ${String(error)}`);
    }
    await screenshot(page, '05-answered');

    // The product's own record of what happened, read back independently.
    const events = await collectTrajectory(projectId);
    const terminal =
      events.find((event) => TERMINAL_KINDS.includes(event.kind))?.kind ?? null;
    const text = events
      .filter((event) => event.kind === 'text_delta')
      .map((event) => String(event.data?.text ?? ''))
      .join('');
    summary.run = {
      terminal,
      text,
      answered: text.includes(ANSWER),
      event_kinds: [...new Set(events.map((event) => event.kind))],
    };
    expect(terminal).toBe('run_completed');
    // Settlement green is not result green.
    expect(text).toContain(ANSWER);

    // ---- The panel the user manages this from, in the same session. ----
    await openAccountPanel(page);
    const ownRow = page.locator(
      `[data-testid="aion-account-key-row"][data-key-id="${mintedKeyId}"]`
    );
    await expect(ownRow).toHaveCount(1);
    // The row this client authenticated with is marked, because revoking it is
    // permitted and signs this app out.
    await expect(ownRow.getByTestId('aion-account-key-current')).toBeVisible();
    const panelText = (await page.getByTestId('aion-account').innerText()) ?? '';
    // A raw key is returned once and never again — including here.
    expect(panelText).not.toContain(mintedKey);
    expect(panelText).toContain(mintedKeyId);
    await screenshot(page, '06-account');

    // ---- The negative control: signing out is not revoking. ----
    await page.getByTestId('aion-account-sign-out').click();
    await expect(page.getByTestId('aion-onboarding')).toBeVisible({
      timeout: 60_000,
    });
    // Truncated, not unlinked: the profile still owns the file it created.
    expect(fs.existsSync(storedKeyPath)).toBe(true);
    expect(fs.readFileSync(storedKeyPath, 'utf-8').trim()).toBe('');
    // And the credential itself is untouched. A sign-out that revoked would
    // have logged out every other device holding this key.
    const afterSignOut = await servedAccount(mintedKey);
    expect(afterSignOut.status).toBe(200);
    expect(afterSignOut.account!.key_id).toBe(mintedKeyId);
    summary.sign_out = {
      returns_to_onboarding: true,
      key_file_truncated: true,
      key_still_authenticates: true,
    };
    await screenshot(page, '07-signed-out');

    const offEdge = requestUrls.filter((url) => {
      if (!/^https?:/.test(url)) return false;
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
    // Whatever happened above, the eval's key does not outlive it.
    if (mintedKeyId) {
      await edgeFetch(
        'DELETE',
        `/keys/${encodeURIComponent(mintedKeyId)}`
      ).catch(() => undefined);
    }
    let videoBytes = 0;
    let videoName: string | null = null;
    const recorded = await video?.path().catch(() => undefined);
    if (recorded && fs.existsSync(recorded)) {
      videoName = 'account-run.webm';
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
