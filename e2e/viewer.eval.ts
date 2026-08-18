// Real-model driver for the artifact viewer: one live provider run produces a
// revised markdown report, a CDN-backed HTML dashboard, and a file too large to
// inline — then the deliverables are read back INSIDE the app, which is the
// thing A1 could not do. A1 proved the registry holds the right bytes; this
// proves a person can see them without leaving the product.
//
// The claim that needs a real model rather than a fixture is the HTML one. A
// fixture page is a page someone wrote to be previewed; a model writing a
// dashboard reaches for a CDN chart library unprompted, and that page renders
// EMPTY under the default policy. So the assertion pair that matters is that
// the sealed policy names no CDN and still runs the page's own script, and that
// opting in names the CDN while `connect-src 'none'` survives — a run's
// findings must not be able to leave with the page that displays them.
//
// The negative control is the over-cap deliverable: a file past the inline read
// cap must offer a download, not a blank pane. A blank pane reads as "the agent
// produced nothing", which is the exact misreading this milestone exists to
// prevent.
//
// Run: npx playwright test --config e2e/eval.config.ts viewer
//      (the stack must be booted with REAL provider keys.)
// Env: EIGENT_EVAL_MODEL / EIGENT_EVAL_MODEL_LABEL pick the catalog row.
// Output: EIGENT_EVAL_DIR (default ../a2-evidence/playwright/real-model).

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
  path.resolve(REPO_ROOT, '..', 'a2-evidence', 'playwright', 'real-model');

const MODEL_ALIAS = process.env.EIGENT_EVAL_MODEL ?? 'kimi-k3';
const MODEL_LABEL = process.env.EIGENT_EVAL_MODEL_LABEL ?? 'Kimi K3';

const TURN_TIMEOUT_MS = 15 * 60_000;
const TRAJECTORY_TIMEOUT_MS = 60_000;
// The artifact plane settles just after the run's terminal event — the harvest
// runs in the ops worker, not in the turn — so the registry is polled rather
// than read once.
const ARTIFACT_SETTLE_MS = 120_000;
const VIDEO_SIZE = { width: 1280, height: 800 };
const MIN_VIDEO_BYTES = 200 * 1024;

/** The inline read cap the viewer refuses past (internal/ops MaxInlineArtifactBytes). */
const INLINE_CAP_BYTES = 1 << 20;

const REPORT = 'report.md';
const PAGE_DOC = 'dashboard.html';
const BULK = 'bulk.csv';
const CDN_HOST = 'cdn.jsdelivr.net';
const EDIT_MARKER = 'status: final';

interface Bootstrap {
  api_key: string;
  edge_url: string;
  tenant_id: string;
}

const bootstrap: Bootstrap = JSON.parse(
  fs.readFileSync(BOOTSTRAP_PATH, 'utf-8')
);
const edgeBaseUrl = `${bootstrap.edge_url.replace(/\/+$/, '')}/eigent/v1`;

/** A per-invocation tag, so a stack that has served this eval before cannot
 * supply the Project this run is looking for. */
const RUN_TAG = `a2-${Date.now().toString(36)}`;

const VIEWER_PROMPT = [
  `[${RUN_TAG}] Do these five steps in order, each exactly once, using exactly the tool named:`,
  `1. Use the write_file tool to create /workspace/${REPORT} containing exactly two lines: the line "# Market report" followed by the line "status: draft".`,
  `2. Use the edit_file tool on /workspace/${REPORT} to change the line "status: draft" to "${EDIT_MARKER}".`,
  `3. Use the write_file tool to create /workspace/${PAGE_DOC}: a complete standalone HTML page with a <title>, an <h1> heading, a <canvas> element, and — in the <head> — exactly this tag: <script src="https://${CDN_HOST}/npm/chart.js"></script>. Add your own inline <script> at the end of the body that draws a small bar chart on that canvas from three made-up numbers.`,
  `4. Use the shell to run exactly this command, verbatim: seq 1 200000 | sed 's/^/row,/' > /workspace/${BULK}`,
  `5. Use the publish_artifact tool on /workspace/${BULK}.`,
  'Do not use any other tools and do not retry. Then finish your reply with exactly one line:',
  'ANSWER: VIEWER_DONE',
].join('\n\n');
const VIEWER_ANSWER = 'VIEWER_DONE';

interface EdgeEvent {
  kind: string;
  sequence: string;
  data?: Record<string, unknown>;
}

interface ArtifactRow {
  artifact_id: string;
  name: string;
  version: number;
  media_type: string;
  size_bytes: string;
  sha256: string;
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
  const want = text.replace(/\s+/g, ' ').trim();
  let last = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.keyboard.press('Escape').catch(() => {});
    await composer.click();
    await page.keyboard.insertText(text);
    const got = (await composer.innerText()).replace(/\s+/g, ' ').trim();
    if (got === want) return;
    last = got;
    await composer.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
  }
  throw new Error(
    `composer never captured the full prompt\n  got:  ${last}\n  want: ${want}`
  );
}

/** A fresh Space, so the pass becomes its own aion Project. */
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

/** The composer is not editable while the turn is busy. */
async function awaitTurnSettled(page: Page): Promise<void> {
  const busy = page.locator('[role="textbox"][contenteditable="false"]');
  await busy
    .first()
    .waitFor({ state: 'attached', timeout: 120_000 })
    .catch(() => {});
  await expect(busy).toHaveCount(0, { timeout: TURN_TIMEOUT_MS });
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
  const timer = setTimeout(() => controller.abort(), TRAJECTORY_TIMEOUT_MS);
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

async function edgeJson<T>(query: string): Promise<T> {
  const response = await fetch(`${edgeBaseUrl}${query}`, {
    headers: { Authorization: `Bearer ${bootstrap.api_key}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${query} -> ${response.status}`);
  return (await response.json()) as T;
}

async function listArtifacts(
  projectId: string,
  name?: string
): Promise<ArtifactRow[]> {
  const suffix = name ? `?name=${encodeURIComponent(name)}` : '';
  const body = await edgeJson<{ artifacts?: ArtifactRow[] }>(
    `/projects/${encodeURIComponent(projectId)}/artifacts${suffix}`
  );
  return body.artifacts ?? [];
}

/** Polls until the harvest has landed every deliverable the viewer will open. */
async function settledArtifacts(projectId: string): Promise<ArtifactRow[]> {
  let rows: ArtifactRow[] = [];
  await expect(async () => {
    rows = await listArtifacts(projectId);
    const names = new Set(rows.map((r) => r.name));
    for (const want of [REPORT, PAGE_DOC, BULK]) {
      expect(names.has(want), `${want} has not been published yet`).toBe(true);
    }
    expect(rows.filter((r) => r.name === REPORT).length).toBeGreaterThanOrEqual(
      2
    );
  }).toPass({ timeout: ARTIFACT_SETTLE_MS });
  return rows;
}

async function inlineContent(
  projectId: string,
  artifactId: string
): Promise<{ content?: string; content_truncated?: boolean }> {
  return edgeJson(
    `/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifactId)}?inline=true`
  );
}

function countKinds(events: EdgeEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    counts[event.kind] = (counts[event.kind] ?? 0) + 1;
  }
  return counts;
}

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The policy the preview frame actually carries, read out of its srcdoc. */
async function framePolicy(page: Page): Promise<string> {
  const srcdoc = await page
    .locator('[data-artifact-html-frame="1"]')
    .getAttribute('srcdoc');
  const match = /content="([^"]*)"/.exec(srcdoc ?? '');
  return match?.[1] ?? '';
}

async function selectArtifact(page: Page, name: string): Promise<void> {
  await page.locator(`[data-artifact-row="${name}"]`).click();
  await expect(page.locator('[data-artifact-ready="1"]').first()).toBeVisible({
    timeout: 60_000,
  });
}

test('a real run’s deliverables are readable in the app, and its page stays sealed', async () => {
  test.setTimeout(45 * 60_000);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-a2-'));
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

  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
    model_alias: MODEL_ALIAS,
    run_tag: RUN_TAG,
    prompt: VIEWER_PROMPT,
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
    const requests: { method: string; url: string }[] = [];
    page.on('request', (request) => {
      requests.push({ method: request.method(), url: request.url() });
    });

    await page
      .locator('[role="textbox"]')
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 });

    // ---- The run. --------------------------------------------------------
    const composer = await newSpace(page);
    await selectModel(page, MODEL_LABEL);
    const created = page
      .waitForRequest(
        (request) =>
          request.method() === 'POST' &&
          request.url() === `${edgeBaseUrl}/projects`,
        { timeout: 60_000 }
      )
      .then((request) => request.postData() ?? '')
      .catch(() => '');
    await typeIntoComposer(page, composer, VIEWER_PROMPT);
    await composer.press('Enter');
    const posted = JSON.parse((await created) || '{}') as {
      model_alias?: string;
    };
    // Which provider actually served the run, read off the wire rather than
    // off the picker that was clicked.
    expect(
      posted.model_alias,
      "the picker's choice never reached the create"
    ).toBe(MODEL_ALIAS);

    await awaitTurnSettled(page);
    await page.waitForTimeout(1_000);
    await screenshot(page, '01-run-settled');

    const answered = normalize(await page.locator('body').innerText()).includes(
      VIEWER_ANSWER
    );
    summary.answered = answered;
    expect(answered, `the run never reported ${VIEWER_ANSWER}`).toBe(true);

    const projectId = [
      ...new Set(
        requests
          .map((r) => /\/projects\/([^/?]+)\/commands/.exec(r.url)?.[1])
          .filter((id): id is string => Boolean(id))
      ),
    ][0];
    expect(projectId, 'no command was submitted').toBeTruthy();
    summary.project_id = projectId;

    const trajectory = await collectTrajectory(projectId);
    summary.terminal = trajectory.terminal;
    summary.event_kinds = countKinds(trajectory.events);
    expect(trajectory.terminal, 'the run did not complete').toBe(
      'run_completed'
    );

    const calls = trajectory.events
      .filter((e) => e.kind === 'tool_call')
      .map((e) => String(e.data?.tool_name ?? ''));
    summary.tool_calls = calls;
    for (const tool of ['write_file', 'edit_file', 'bash', 'publish_artifact']) {
      expect(calls, `the run never called ${tool}`).toContain(tool);
    }

    // In-band failure scan: a run can report an answer and still have failed a
    // tool along the way.
    const errored = trajectory.events
      .filter((e) => e.kind === 'tool_result')
      .filter((e) => e.data?.is_error === true)
      .map((e) => String(e.data?.tool_name ?? ''));
    summary.errored_tools = errored;
    expect(errored, 'a tool failed inside the run').toEqual([]);

    // ---- What the registry holds, before opening any of it. --------------
    const rows = await settledArtifacts(projectId);
    summary.artifacts = rows.map((r) => ({
      name: r.name,
      version: r.version,
      media_type: r.media_type,
      size_bytes: r.size_bytes,
    }));
    const bulkRow = rows.find((r) => r.name === BULK);
    expect(Number(bulkRow?.size_bytes ?? 0)).toBeGreaterThan(INLINE_CAP_BYTES);
    const pageRow = rows.find((r) => r.name === PAGE_DOC);
    expect(pageRow?.media_type).toBe('text/html');
    // The page has to genuinely want the CDN, or sealing it proves nothing.
    const pageSource = await inlineContent(projectId, pageRow!.artifact_id);
    expect(
      pageSource.content ?? '',
      'the model wrote a page with no external subresource, so the seal is vacuous'
    ).toContain(CDN_HOST);

    // ---- The chat announces the deliverables; the panel opens from there.
    const card = page.locator(`[data-artifact-card="${REPORT}"]`);
    await expect(card).toBeVisible({ timeout: 60_000 });
    await card.getByRole('button', { name: 'Open', exact: true }).click();

    // ---- Markdown renders the REVISED version. ---------------------------
    const lane = page.locator('[data-artifact-lane]');
    await expect(page.locator('[data-artifact-ready="1"]').first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(lane).toHaveAttribute('data-artifact-name', REPORT);
    await expect(page.locator('[data-artifact-markdown="1"]')).toContainText(
      EDIT_MARKER
    );
    const shownVersion = await lane.getAttribute('data-artifact-version');
    summary.markdown_version_shown = shownVersion;
    // Newest-first: a viewer that opened the draft would be showing a document
    // the run already replaced.
    expect(Number(shownVersion)).toBe(
      Math.max(...rows.filter((r) => r.name === REPORT).map((r) => r.version))
    );
    await screenshot(page, '02-markdown');

    // ---- Two versions of one name diff against each other. ---------------
    await page
      .getByRole('button', { name: 'Compare with the previous version' })
      .click();
    const diff = page.locator('[data-artifact-compare]');
    await expect(diff).toHaveAttribute('data-monaco-ready', '1', {
      timeout: 60_000,
    });
    summary.compare_label = await diff.getAttribute('data-artifact-compare');
    await screenshot(page, '03-compare');
    await page
      .getByRole('button', { name: 'Compare with the previous version' })
      .click();

    // ---- The model's own page is sealed until it is opened. --------------
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
    expect(await frame.getAttribute('sandbox')).toBe('allow-scripts');
    await screenshot(page, '04-html-sealed');

    const beforeOptIn = requests.length;
    await page.getByRole('button', { name: 'Allow', exact: true }).click();
    await expect(frame).toHaveAttribute('data-allow-external', '1');
    const opened = await framePolicy(page);
    summary.policy_opened = opened;
    expect(opened).toContain(CDN_HOST);
    // The whole point of the toggle: a CDN dashboard renders, and the page
    // still has no way to send anything out.
    expect(opened).toContain("connect-src 'none'");
    await screenshot(page, '05-html-opened');

    // Every off-edge request the opt-in produced is on the allowlist — the
    // toggle widened the door to a known list, not to the internet.
    summary.opt_in_requests = requests
      .slice(beforeOptIn)
      .map((r) => r.url)
      .filter((u) => /^https?:/.test(u))
      .filter((u) => !u.startsWith(new URL(edgeBaseUrl).origin));
    expect(
      (summary.opt_in_requests as string[]).filter(
        (u) => !u.startsWith(`https://${CDN_HOST}`)
      )
    ).toEqual([]);

    // ---- Negative control: over the inline cap, offer the download. ------
    // A blank pane here would read as "the agent produced nothing", which is
    // the exact misreading this milestone exists to prevent.
    await selectArtifact(page, BULK);
    await expect(
      page.getByText('too large to preview', { exact: false })
    ).toBeVisible({ timeout: 60_000 });
    // Scoped to the viewer pane: the tab header carries its own Download
    // affordance, and the claim here is about the pane offering one.
    await expect(
      lane.getByRole('button', { name: 'Download', exact: true })
    ).toBeVisible();
    summary.over_cap_shows_download = true;
    await screenshot(page, '06-over-cap');

    // Both halves of the network audit: everything HTTP stayed on the edge —
    // except the presigned object-store GETs the artifact plane mints by design
    // and the CDN the user explicitly opted into — and the set is non-vacuous
    // because the renderer did make requests.
    const isPresignedFetch = (u: string): boolean => {
      try {
        const url = new URL(u);
        return [...url.searchParams.keys()].some((k) =>
          /^x-(amz|goog)-signature$/i.test(k)
        );
      } catch {
        return false;
      }
    };
    const offEdge = requests
      .map((r) => r.url)
      .filter((u) => /^https?:/.test(u))
      .filter((u) => !u.startsWith(new URL(edgeBaseUrl).origin))
      .filter((u) => !isPresignedFetch(u))
      .filter((u) => !u.startsWith(`https://${CDN_HOST}`));
    summary.off_edge_requests = offEdge;
    expect(offEdge).toEqual([]);
    expect(
      requests.filter((r) => /^https?:/.test(r.url)).length
    ).toBeGreaterThan(0);
  } catch (error) {
    bodyFailed = true;
    throw error;
  } finally {
    // The recording is only flushed to disk when the app closes, so the video
    // is resolved after teardown and before the summary that reports it.
    await app.close();
    let videoBytes = 0;
    let videoName: string | null = null;
    const recorded = await video?.path().catch(() => undefined);
    if (recorded && fs.existsSync(recorded)) {
      videoName = 'viewer-run.webm';
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
