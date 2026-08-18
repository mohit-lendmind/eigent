// Real-model driver for artifact truth: one live provider run that writes a
// deliverable, revises it with edit_file, grows it with a shell append, and
// publishes it — so the artifact registry must hold every revision, and each
// version must hold the bytes that were published rather than whatever the file
// held when the harvester got around to reading it.
//
// The claim under test is the one the 2026-08-18 deep-research run failed: that
// run's 61 KB dashboard survived as an 18 KB first draft, because only
// write_file published and the harvest read late. So the assertion that matters
// is not "three rows exist" — it is that the OLDEST version does NOT contain
// the shell's appendix and the NEWEST does. Rows alone would pass against a
// registry holding three identical copies of the final file.
//
// The negative control is a second pass whose run creates a file with the shell
// and reads it back, and publishes nothing: the registry mirrors what a
// publishing tool published, never the workspace. Without it, a plane that
// swept the workspace at run end would pass the first pass and be wrong about
// why.
//
// Run: npx playwright test --config e2e/eval.config.ts artifact-truth
//      (the stack must be booted with REAL provider keys — the deterministic
//      fixtures are what layer 2 covers.)
// Env: EIGENT_EVAL_MODEL / EIGENT_EVAL_MODEL_LABEL pick the catalog row.
// Output: EIGENT_EVAL_DIR (default ../a1-evidence/playwright/real-model).

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
  path.resolve(REPO_ROOT, '..', 'a1-evidence', 'playwright', 'real-model');

const MODEL_ALIAS = process.env.EIGENT_EVAL_MODEL ?? 'kimi-k3';
const MODEL_LABEL = process.env.EIGENT_EVAL_MODEL_LABEL ?? 'Kimi K3';

const TURN_TIMEOUT_MS = 15 * 60_000;
const TRAJECTORY_TIMEOUT_MS = 60_000;
// The artifact plane settles just after the run's terminal event — the harvest
// runs in the ops worker, not in the turn — so the registry is polled rather
// than read once, and a slow CAS write reads as latency instead of a loss.
const ARTIFACT_SETTLE_MS = 120_000;
const VIDEO_SIZE = { width: 1280, height: 800 };
// A recording that never started is a few KB of container; a recorded run is
// megabytes. The floor separates the two without pinning a duration.
const MIN_VIDEO_BYTES = 200 * 1024;

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
const RUN_TAG = `a1-${Date.now().toString(36)}`;

const DELIVERABLE = 'findings.md';
const DELIVERABLE_PATH = `/workspace/${DELIVERABLE}`;
// The two markers that make a version's bytes attributable to the tool that
// published them: one only edit_file can have written, one only the shell can.
const EDIT_MARKER = 'status: final';
const SHELL_MARKER = '## Data';

const ARTIFACT_PROMPT = [
  `[${RUN_TAG}] Do these four steps in order, each exactly once, using exactly the tool named:`,
  `1. Use the write_file tool to create ${DELIVERABLE_PATH} containing exactly two lines: the line "# Findings" followed by the line "status: draft".`,
  `2. Use the edit_file tool on ${DELIVERABLE_PATH} to change the line "status: draft" to "${EDIT_MARKER}".`,
  `3. Use the shell to run exactly this command, verbatim: printf '\\n${SHELL_MARKER}\\n\\n42\\n' >> ${DELIVERABLE_PATH}`,
  `4. Use the publish_artifact tool on ${DELIVERABLE_PATH}.`,
  'Do not use any other tools and do not retry. Then finish your reply with exactly one line:',
  'ANSWER: ARTIFACT_DONE',
].join('\n\n');
const ARTIFACT_ANSWER = 'ARTIFACT_DONE';

// The control run touches the workspace with the shell and reads it back — it
// just never calls a publishing tool. A registry that mirrored the workspace
// would list this file; the product only lists what was published.
const CONTROL_PROMPT = [
  `[${RUN_TAG}] Do these two steps in order, each exactly once:`,
  "1. Use the shell to run exactly this command, verbatim: printf 'hello\\n' > /workspace/note.txt",
  '2. Use the read_file tool on /workspace/note.txt and report what it holds.',
  'Do not use write_file, edit_file or publish_artifact. Then finish your reply with exactly one line:',
  'ANSWER: CONTROL_OK',
].join('\n\n');
const CONTROL_ANSWER = 'CONTROL_OK';

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

interface PassRecord {
  name: string;
  prompt: string;
  project_id?: string;
  terminal?: string | null;
  event_kinds?: Record<string, number>;
  tool_calls?: string[];
  artifacts?: unknown[];
  answered?: boolean;
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

/** A fresh Space, so each pass becomes its own aion Project. */
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

/** Polls until the harvest has landed at least `want` versions of one name. */
async function settledVersions(
  projectId: string,
  name: string,
  want: number
): Promise<ArtifactRow[]> {
  let rows: ArtifactRow[] = [];
  await expect(async () => {
    rows = await listArtifacts(projectId, name);
    expect(rows.length).toBeGreaterThanOrEqual(want);
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

test('a real run publishes every revision, and each version holds the bytes it published', async () => {
  test.setTimeout(45 * 60_000);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-a1-'));
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

  const artifactPass: PassRecord = {
    name: 'artifact',
    prompt: ARTIFACT_PROMPT,
  };
  const controlPass: PassRecord = { name: 'control', prompt: CONTROL_PROMPT };
  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
    model_alias: MODEL_ALIAS,
    run_tag: RUN_TAG,
    deliverable: DELIVERABLE,
    passes: [artifactPass, controlPass],
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
    /** Each pass admits its own Project; the id is taken off the renderer's own
     * submit, so the trajectory read back is the one the UI drew from. */
    const projectIds = (): string[] => [
      ...new Set(
        requests
          .map((r) => /\/projects\/([^/?]+)\/commands/.exec(r.url)?.[1])
          .filter((id): id is string => Boolean(id))
      ),
    ];

    await page
      .locator('[role="textbox"]')
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 });

    // ---- Pass 1: write, revise, grow, publish. ---------------------------
    const composerA = await newSpace(page);
    await selectModel(page, MODEL_LABEL);
    const createA = page
      .waitForRequest(
        (request) =>
          request.method() === 'POST' &&
          request.url() === `${edgeBaseUrl}/projects`,
        { timeout: 60_000 }
      )
      .then((request) => request.postData() ?? '')
      .catch(() => '');
    await typeIntoComposer(page, composerA, ARTIFACT_PROMPT);
    await composerA.press('Enter');
    const postedA = JSON.parse((await createA) || '{}') as {
      model_alias?: string;
    };
    // Which provider actually served the run, read off the wire rather than
    // off the picker that was clicked.
    expect(
      postedA.model_alias,
      "the picker's choice never reached the create"
    ).toBe(MODEL_ALIAS);

    await awaitTurnSettled(page);
    await page.waitForTimeout(1_000);
    await screenshot(page, '01-artifact-run-settled');

    artifactPass.answered = normalize(
      await page.locator('body').innerText()
    ).includes(ARTIFACT_ANSWER);
    expect(
      artifactPass.answered,
      `the run never reported ${ARTIFACT_ANSWER}`
    ).toBe(true);

    const projectA = projectIds()[0];
    expect(
      projectA,
      'no command was submitted for the artifact pass'
    ).toBeTruthy();
    artifactPass.project_id = projectA;
    const trajectoryA = await collectTrajectory(projectA);
    artifactPass.terminal = trajectoryA.terminal;
    artifactPass.event_kinds = countKinds(trajectoryA.events);
    expect(trajectoryA.terminal, 'the artifact run did not complete').toBe(
      'run_completed'
    );

    const calls = trajectoryA.events
      .filter((e) => e.kind === 'tool_call')
      .map((e) => String(e.data?.tool_name ?? ''));
    artifactPass.tool_calls = calls;
    for (const tool of [
      'write_file',
      'edit_file',
      'bash',
      'publish_artifact',
    ]) {
      expect(calls, `the run never called ${tool}`).toContain(tool);
    }

    // The registry, once the harvest has settled. Every publishing call is its
    // own version of the one deliverable.
    const rows = (await settledVersions(projectA, DELIVERABLE, 3)).sort(
      (a, b) => a.version - b.version
    );
    artifactPass.artifacts = rows.map((a) => ({
      version: a.version,
      size_bytes: a.size_bytes,
      sha256: a.sha256,
      media_type: a.media_type,
    }));
    expect(rows.every((a) => a.name === DELIVERABLE)).toBe(true);
    expect(rows.map((a) => a.version)).toEqual(
      rows.map((_, i) => rows[0].version + i)
    );
    expect(rows[0].media_type).toBe('text/markdown');

    const first = await inlineContent(projectA, rows[0].artifact_id);
    const last = await inlineContent(
      projectA,
      rows[rows.length - 1].artifact_id
    );
    summary.first_version_bytes = Buffer.byteLength(first.content ?? '');
    summary.last_version_bytes = Buffer.byteLength(last.content ?? '');

    // The regression this milestone exists for: before the publish-time freeze,
    // every version resolved to whatever the file held when the harvester read
    // it, so v1 carried the shell's appendix too. A version's content is the
    // content that was published.
    expect(
      first.content ?? '',
      'the first version already carried the appendix the shell added later'
    ).not.toContain(SHELL_MARKER);
    // ...and the other half: bytes only the shell wrote reached the registry at
    // all, which nothing but publish_artifact could have carried.
    expect(
      last.content ?? '',
      'the shell-appended bytes never reached the registry'
    ).toContain(SHELL_MARKER);
    expect(
      last.content ?? '',
      'the edit_file revision never reached the registry'
    ).toContain(EDIT_MARKER);
    expect(
      rows[0].sha256 === rows[rows.length - 1].sha256,
      'the draft and the finished deliverable hash the same'
    ).toBe(false);

    // The recorded size is the real file's size, not the draft's.
    expect(last.content_truncated ?? false).toBe(false);
    expect(String(Buffer.byteLength(last.content ?? ''))).toBe(
      rows[rows.length - 1].size_bytes
    );

    // ---- Pass 2: the negative control — the workspace is not the registry.
    const composerB = await newSpace(page);
    await selectModel(page, MODEL_LABEL);
    await typeIntoComposer(page, composerB, CONTROL_PROMPT);
    await composerB.press('Enter');
    await awaitTurnSettled(page);
    await page.waitForTimeout(1_000);
    await screenshot(page, '02-control-settled');

    const projectB = projectIds().find((id) => id !== projectA);
    expect(
      projectB,
      'no command was submitted for the control pass'
    ).toBeTruthy();
    controlPass.project_id = projectB;
    const trajectoryB = await collectTrajectory(projectB!);
    controlPass.terminal = trajectoryB.terminal;
    controlPass.event_kinds = countKinds(trajectoryB.events);
    expect(trajectoryB.terminal, 'the control run did not complete').toBe(
      'run_completed'
    );
    controlPass.tool_calls = trajectoryB.events
      .filter((e) => e.kind === 'tool_call')
      .map((e) => String(e.data?.tool_name ?? ''));
    // The control has to have TOUCHED the workspace, or "nothing published" is
    // vacuous — it would just be a run that did nothing.
    expect(
      controlPass.tool_calls,
      'the control run never ran the shell, so publishing nothing proves nothing'
    ).toContain('bash');

    controlPass.answered = normalize(
      await page.locator('body').innerText()
    ).includes(CONTROL_ANSWER);
    expect(
      controlPass.answered,
      `the run never reported ${CONTROL_ANSWER}`
    ).toBe(true);

    // Give the harvest the same window pass 1 got before claiming nothing came.
    await page.waitForTimeout(15_000);
    const controlArtifacts = await listArtifacts(projectB!);
    controlPass.artifacts = controlArtifacts.map((a) => a.name);
    expect(
      controlArtifacts.map((a) => a.name),
      'a run that published nothing still minted artifacts'
    ).toEqual([]);

    // In-band failure scan: a run can report an answer and still have failed a
    // tool along the way.
    const errored = trajectoryA.events
      .filter((e) => e.kind === 'tool_result')
      .filter((e) => e.data?.is_error === true)
      .map((e) => String(e.data?.tool_name ?? ''));
    summary.errored_tools = errored;
    expect(errored, 'a tool failed inside the artifact run').toEqual([]);

    // Both halves of the network audit: everything HTTP stayed on the edge —
    // except the presigned object-store GETs the artifact plane mints by design
    // (the edge signs; it does not proxy the bytes) — and the set is non-vacuous
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
      .filter((u) => !isPresignedFetch(u));
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
      videoName = 'artifact-truth-run.webm';
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
