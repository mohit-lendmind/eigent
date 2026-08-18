// Real-model driver for the A4 comment loop: a live provider run publishes a
// findings document, a person comments on two regions of it through the rail,
// and "Request revision" sends those comments — and only those — into a second
// run that must revise the document, republish it under the same name, and
// thereby settle the comments `addressed`.
//
// What needs a real model rather than the fixture is the loop's far side: the
// worker renders the quoted regions and notes into the revision command, and
// the model has to actually READ that block, make the demanded edits, and
// republish. The fixture e2e proves the ids travel; this proves the inlined
// block is legible enough that a real model acts on it correctly.
//
// The negative control is the anchor model under real revision pressure: a
// third comment quotes the exact text the revision deletes. Dismissed before
// the request (so it is not collected) and reopened after, it must render
// STALE against the new version — relocation refuses to guess rather than
// pointing the quote at the wrong text.
//
// Run: npx playwright test --config e2e/eval.config.ts comments
//      (the stack must be booted with REAL provider keys.)
// Env: EIGENT_EVAL_MODEL / EIGENT_EVAL_MODEL_LABEL pick the catalog row.
// Output: EIGENT_EVAL_DIR (default ../a4-evidence/playwright/real-model).

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
  path.resolve(REPO_ROOT, '..', 'a4-evidence', 'playwright', 'real-model');

const MODEL_ALIAS = process.env.EIGENT_EVAL_MODEL ?? 'kimi-k3';
const MODEL_LABEL = process.env.EIGENT_EVAL_MODEL_LABEL ?? 'Kimi K3';

const TURN_TIMEOUT_MS = 15 * 60_000;
const TRAJECTORY_TIMEOUT_MS = 120_000;
// Comment settlement happens inside the republish transaction during harvest,
// which runs after the run's terminal event — so both the registry and the
// rail are polled rather than read once.
const ARTIFACT_SETTLE_MS = 120_000;
const VIDEO_SIZE = { width: 1280, height: 800 };
const MIN_VIDEO_BYTES = 200 * 1024;

const DOC = 'findings.md';
/** The line the revision must delete; the stale control's quote lives in it. */
const DRAFT_MARKER = 'status: draft';

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
const RUN_TAG = `a4-${Date.now().toString(36)}`;

// Single-newline runs vanish inside the contenteditable composer, so the
// document is dictated line by line in prose rather than as a literal block.
const DRAFT_PROMPT = [
  `[${RUN_TAG}] Use the write_file tool exactly once to create /workspace/${DOC}. Its content is exactly six lines:`,
  `line 1 is '# Findings', line 2 is empty, line 3 is '${DRAFT_MARKER}', line 4 is empty, line 5 is '- The alpha finding holds under load.', and line 6 is '- The beta finding needs more evidence.'`,
  'Do not use any other tools and do not retry. Then finish your reply with exactly one line:',
  'ANSWER: FINDINGS_READY',
].join('\n\n');
const DRAFT_ANSWER = 'FINDINGS_READY';

/** Settles addressed; its demanded edit leaves its own quote intact. */
const COMMENT_ALPHA =
  'Append the citation "(source: internal benchmark, 2026)" to the end of the alpha bullet. Keep the words "alpha finding" unchanged.';
/** Settles addressed; its demanded edit deletes the stale control's quote. */
const COMMENT_STATUS = `Replace the line "${DRAFT_MARKER}" with the line "status: final". The phrase "${DRAFT_MARKER}" must not appear anywhere in the revised document.`;
/** Never reaches the model: dismissed before the request, reopened after. */
const COMMENT_STALE = 'Placeholder note pinned to the draft marker.';

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
 * Selects one word in the rendered markdown and fires the mouseup the viewer
 * listens on. A real double-click selects whatever word sits at the element's
 * geometric center, which is not necessarily the word under test — building
 * the Range and dispatching the bubbling mouseup is the deterministic way to
 * hand the viewer exactly this selection.
 */
async function selectWord(page: Page, word: string): Promise<void> {
  await page.evaluate((target) => {
    const container = document.querySelector('[data-artifact-markdown="1"]');
    if (!container) throw new Error('markdown container not rendered');
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let hit: { node: Text; index: number } | null = null;
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const index = (node.textContent ?? '').indexOf(target);
      if (index >= 0) {
        hit = { node, index };
        break;
      }
    }
    if (!hit) throw new Error(`word not rendered: ${target}`);
    const range = document.createRange();
    range.setStart(hit.node, hit.index);
    range.setEnd(hit.node, hit.index + target.length);
    const selection = window.getSelection();
    if (!selection) throw new Error('no selection API');
    selection.removeAllRanges();
    selection.addRange(range);
    container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, word);
}

async function createComment(
  page: Page,
  word: string,
  body: string
): Promise<void> {
  await selectWord(page, word);
  await expect(page.locator('[data-comment-target="1"]')).toContainText(word);
  const composer = page.locator('[data-comment-composer="1"]');
  await composer.fill(body);
  await page.locator('[data-comment-submit="1"]').click();
  await expect(
    page.locator('[data-comment-row]', { hasText: body.slice(0, 40) })
  ).toBeVisible({ timeout: 30_000 });
}

/**
 * The durable trajectory, straight from the edge's SSE replay. Everything this
 * eval asserts on is committed before the read begins (the DOM showed the
 * settled rows and the registry listed v2), so `done` names the shape the
 * replay must already contain and the reader stops as soon as it has it.
 */
async function collectTrajectory(
  projectId: string,
  done: (events: EdgeEvent[]) => boolean
): Promise<EdgeEvent[]> {
  const events: EdgeEvent[] = [];
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
      const { done: eof, value } = await reader.read();
      if (eof) break;
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
        events.push(JSON.parse(data) as EdgeEvent);
        if (done(events)) break outer;
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
  name: string
): Promise<ArtifactRow[]> {
  const body = await edgeJson<{ artifacts?: ArtifactRow[] }>(
    `/projects/${encodeURIComponent(projectId)}/artifacts?name=${encodeURIComponent(name)}`
  );
  return body.artifacts ?? [];
}

/** Polls until the revision's republish has landed in the registry. */
async function settledVersions(projectId: string): Promise<ArtifactRow[]> {
  let rows: ArtifactRow[] = [];
  await expect(async () => {
    rows = await listArtifacts(projectId, DOC);
    expect(
      rows.length,
      'the revision has not republished yet'
    ).toBeGreaterThanOrEqual(2);
  }).toPass({ timeout: ARTIFACT_SETTLE_MS });
  return rows;
}

async function inlineContent(
  projectId: string,
  artifactId: string
): Promise<{ content?: string }> {
  return edgeJson(
    `/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifactId)}?inline=true`
  );
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

function countKinds(events: EdgeEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    counts[event.kind] = (counts[event.kind] ?? 0) + 1;
  }
  return counts;
}

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

test('real-model revision: anchored comments settle addressed, a deleted quote goes stale', async () => {
  test.setTimeout(45 * 60_000);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-a4-'));
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
    prompt: DRAFT_PROMPT,
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

    // ---- Turn 1: a real run drafts and publishes the document. -----------
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
    await typeIntoComposer(page, composer, DRAFT_PROMPT);
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
    const answered = normalize(await page.locator('body').innerText()).includes(
      DRAFT_ANSWER
    );
    summary.answered = answered;
    expect(answered, `the run never reported ${DRAFT_ANSWER}`).toBe(true);

    const projectId = [
      ...new Set(
        requests
          .map((r) => /\/projects\/([^/?]+)\/commands/.exec(r.url)?.[1])
          .filter((id): id is string => Boolean(id))
      ),
    ][0];
    expect(projectId, 'no command was submitted').toBeTruthy();
    summary.project_id = projectId;
    await screenshot(page, '01-draft-settled');

    // ---- Open the published document and its comment rail. ---------------
    await page
      .locator(`[data-artifact-card="${DOC}"]`)
      .first()
      .getByRole('button', { name: 'Open', exact: true })
      .click();
    await expect(page.locator('[data-artifact-ready="1"]')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('[data-artifact-markdown="1"]')).toContainText(
      DRAFT_MARKER
    );
    // The toggle only renders when the mode probe cleared the 1.21 floor, so
    // its presence is itself the compat assertion.
    await page.locator('[data-comment-toggle="1"]').click();
    await expect(page.locator('[data-comment-rail="1"]')).toBeVisible();

    // ---- Three anchored comments on the real document. --------------------
    await createComment(page, 'alpha', COMMENT_ALPHA);
    await createComment(page, DRAFT_MARKER, COMMENT_STATUS);
    // The control quotes the exact line the revision is required to delete,
    // so the registry-level content assertion below is what guarantees its
    // staleness — not luck about the model's wording.
    await createComment(page, DRAFT_MARKER, COMMENT_STALE);
    const rowAlpha = page.locator('[data-comment-row]', {
      hasText: 'Append the citation',
    });
    const rowStatus = page.locator('[data-comment-row]', {
      hasText: 'must not appear anywhere',
    });
    const rowStale = page.locator('[data-comment-row]', {
      hasText: 'Placeholder note pinned',
    });
    for (const row of [rowAlpha, rowStatus, rowStale]) {
      await expect(row).toHaveAttribute('data-comment-status', 'open');
      await expect(row).toHaveAttribute('data-comment-anchor', 'located');
    }
    await expect(page.locator('[data-comment-rail="1"]')).toHaveAttribute(
      'data-comment-open-count',
      '3'
    );
    await screenshot(page, '02-three-open-comments');

    // ---- Dismiss the control so the revision never sees it. ---------------
    await rowStale.locator('[data-comment-dismiss="1"]').click();
    await expect(rowStale).toHaveAttribute('data-comment-status', 'dismissed', {
      timeout: 30_000,
    });

    // ---- Turn 2: request the revision. -------------------------------------
    // The turn rides the chat store, so the request is a visible user bubble;
    // "these 2 comments" pins that only the open pair was collected.
    await page.locator('[data-request-revision="1"]').click();
    await expect(
      page
        .getByText(`Please revise the artifact "${DOC}"`, { exact: false })
        .first()
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByText('these 2 comments', { exact: false }).first()
    ).toBeVisible();
    await awaitTurnSettled(page);
    await screenshot(page, '03-revision-settled');

    // ---- Both collected comments settled ADDRESSED. ------------------------
    // Settlement is earned by the run's republish inside the publish
    // transaction — the flip proves the real model read the inlined block,
    // revised the document, and republished it under the same name.
    for (const row of [rowAlpha, rowStatus]) {
      await expect(row).toHaveAttribute('data-comment-status', 'addressed', {
        timeout: ARTIFACT_SETTLE_MS,
      });
      // Terminal in both directions: an addressed row takes no actions.
      await expect(row.locator('[data-comment-dismiss="1"]')).toHaveCount(0);
      await expect(row.locator('[data-comment-reopen="1"]')).toHaveCount(0);
    }
    summary.settled_addressed = true;

    // ---- The registry holds the revision as a NEW version. -----------------
    const rows = await settledVersions(projectId);
    summary.versions = rows.map((r) => ({
      version: r.version,
      sha256: r.sha256,
    }));
    const newest = rows.reduce((a, b) => (a.version > b.version ? a : b));
    const first = rows.reduce((a, b) => (a.version < b.version ? a : b));
    expect(newest.version).toBeGreaterThan(first.version);
    expect(newest.sha256).not.toBe(first.sha256);
    const revised = await inlineContent(projectId, newest.artifact_id);
    // The demanded deletion actually happened — this is what makes the stale
    // control below a genuine control rather than a coincidence.
    expect(revised.content ?? '').not.toContain(DRAFT_MARKER);
    expect(revised.content ?? '').toContain('alpha');

    // ---- The viewer shows the revision. -------------------------------------
    const versionSelect = page.locator('[data-artifact-version-select="1"]');
    await expect(async () => {
      const count = await versionSelect.locator('option').count();
      expect(count).toBeGreaterThanOrEqual(2);
    }).toPass({ timeout: 60_000 });
    const newestOption = await versionSelect
      .locator('option')
      .first()
      .getAttribute('value');
    await versionSelect.selectOption(newestOption!);
    await expect(page.locator('[data-artifact-ready="1"]')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('[data-artifact-lane]')).toHaveAttribute(
      'data-artifact-version',
      String(newest.version)
    );
    await expect(
      page.locator('[data-artifact-markdown="1"]')
    ).not.toContainText(DRAFT_MARKER);
    await screenshot(page, '04-revised-version');

    // ---- Negative control: the reopened comment is STALE on the revision. --
    // Its quote was the line the revision deleted. Relocation must refuse to
    // guess — stale against its original version, never mis-anchored.
    await rowStale.locator('[data-comment-reopen="1"]').click();
    await expect(rowStale).toHaveAttribute('data-comment-status', 'open', {
      timeout: 30_000,
    });
    await expect(rowStale).toHaveAttribute('data-comment-anchor', 'stale');
    summary.stale_control = true;
    await screenshot(page, '05-stale-on-revision');

    // ---- The durable trajectory agrees with everything on screen. ----------
    // The comment rides nested in the event: data.comment.{status,...} with
    // data.prior_status beside it.
    const commentOf = (e: EdgeEvent) =>
      (e.data?.comment ?? {}) as Record<string, unknown>;
    const wanted = (events: EdgeEvent[]) => {
      const kinds = countKinds(events);
      const addressed = events.filter(
        (e) =>
          e.kind === 'artifact_comment' && commentOf(e).status === 'addressed'
      );
      return (kinds.run_completed ?? 0) >= 2 && addressed.length >= 2;
    };
    const events = await collectTrajectory(projectId, wanted);
    const kinds = countKinds(events);
    summary.event_kinds = kinds;
    expect(kinds.run_completed ?? 0).toBeGreaterThanOrEqual(2);
    expect(kinds.run_failed ?? 0).toBe(0);

    const commentEvents = events.filter((e) => e.kind === 'artifact_comment');
    // A create is an open comment with no prior state; the reopened control
    // is open too but carries prior_status dismissed, so it doesn't count.
    const creates = commentEvents.filter(
      (e) => commentOf(e).status === 'open' && !e.data?.prior_status
    );
    const settles = commentEvents.filter(
      (e) => commentOf(e).status === 'addressed'
    );
    summary.comment_creates = creates.length;
    summary.comment_settles = settles.length;
    expect(creates.length).toBe(3);
    expect(settles.length).toBe(2);
    for (const settle of settles) {
      expect(settle.data?.prior_status).toBe('open');
      expect(String(commentOf(settle).resolved_by_run_id ?? '')).not.toBe('');
    }
    // Both settles credit the same run: the one revision run did the work.
    expect(
      new Set(settles.map((e) => commentOf(e).resolved_by_run_id)).size
    ).toBe(1);

    // In-band failure scan: a run can flip the right states and still have
    // failed a tool along the way.
    const errored = events
      .filter((e) => e.kind === 'tool_result')
      .filter((e) => e.data?.is_error === true)
      .map((e) => String(e.data?.tool_name ?? ''));
    summary.errored_tools = errored;
    expect(errored, 'a tool failed inside the run').toEqual([]);

    // ---- The app talked to nothing but its own edge. ------------------------
    const offEdge = requests
      .map((r) => r.url)
      .filter((u) => /^https?:/.test(u))
      .filter((u) => !u.startsWith(new URL(edgeBaseUrl).origin))
      .filter((u) => !isPresignedFetch(u));
    summary.non_edge_requests = offEdge;
    expect(offEdge).toEqual([]);
  } catch (error) {
    bodyFailed = true;
    throw error;
  } finally {
    // The recording only flushes when the app closes, so the video resolves
    // after teardown and before the summary that reports it.
    await app.close();
    let videoBytes = 0;
    const recorded = await video?.path().catch(() => undefined);
    if (recorded && fs.existsSync(recorded)) {
      fs.copyFileSync(recorded, path.join(OUT_DIR, 'comments-run.webm'));
      videoBytes = fs.statSync(recorded).size;
    }
    summary.video = videoBytes > 0 ? 'comments-run.webm' : null;
    summary.video_bytes = videoBytes;
    writeOut('comments-eval-summary.json', JSON.stringify(summary, null, 2));
    if (!bodyFailed) {
      expect(videoBytes, 'the run was not recorded').toBeGreaterThan(
        MIN_VIDEO_BYTES
      );
    }
  }
});
