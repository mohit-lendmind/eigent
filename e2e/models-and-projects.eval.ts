// Real-model driver for the production inference routes: the same task run
// once per provider through the REAL product chat UI, each time on a different
// provider picked from the model picker, against the live eigent-local stack.
// Then the renderer is restarted and every Project must be listed by the aion
// edge with its own alias on its row.
//
// Why one spec and not one per provider: the claim is that the *catalog* is
// reachable — that switching providers in the picker changes which plane serves
// the run and nothing else. Consecutive runs in one recording is what shows it.
//
// Run: npx playwright test --config e2e/eval.config.ts models-and-projects
// Env: EIGENT_EVAL_PROVIDERS narrows the covered rows (default: all).
// Output: EIGENT_EVAL_DIR (default ../n1-evidence/playwright/real-model).

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
  path.resolve(REPO_ROOT, '..', 'n1-evidence', 'playwright', 'real-model');

const ANSWER_TIMEOUT_MS = 6 * 60_000;
const TRAJECTORY_TIMEOUT_MS = 60_000;
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

/**
 * One row of the stack's user-facing model catalog per production route kind,
 * each with its own arithmetic so the three runs cannot be confused for each
 * other: a distinct base means a distinct answer, a distinct Project title and
 * a distinct row in the list.
 *
 * `gemini-3-reasoning` is the row that matters most. Thinking is on, so the
 * provider requires its thought signatures echoed back on the turn after a
 * tool call — the cross-turn state that only survives because the route carries
 * it over the ProviderState seam. A tool-using prompt is therefore not
 * decoration here; it is the only way this passes.
 */
const PROVIDERS = [
  {
    alias: 'kimi-k3',
    label: 'Kimi K3',
    base: 17,
    expected: 4913,
    requireToolLoop: true,
  },
  {
    alias: 'gemini-3-reasoning',
    label: 'Gemini 3 Reasoning',
    base: 23,
    expected: 12167,
    // The route's whole reason for existing: prove the second provider turn
    // happened, which is where a missing thought signature would 400.
    requireToolLoop: true,
  },
  {
    alias: 'openrouter-auto',
    label: 'OpenRouter Auto',
    base: 31,
    expected: 29791,
    // Auto routing picks the serving model per request, so this catalog row
    // cannot promise tool support. The loop is recorded, never required.
    requireToolLoop: false,
  },
] as const;

/**
 * Which catalog rows this run covers. Defaults to all of them; narrowing it is
 * for the case where an operator credential is missing or rejected, and the
 * summary then names what was left out so a partial run can never read as a
 * full one.
 */
const SELECTED = (() => {
  const requested = (process.env.EIGENT_EVAL_PROVIDERS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (requested.length === 0) return [...PROVIDERS];
  const unknown = requested.filter(
    (alias) => !PROVIDERS.some((provider) => provider.alias === alias)
  );
  if (unknown.length > 0) {
    throw new Error(`EIGENT_EVAL_PROVIDERS names no such row: ${unknown}`);
  }
  return PROVIDERS.filter((provider) => requested.includes(provider.alias));
})();
const SKIPPED = PROVIDERS.filter((provider) => !SELECTED.includes(provider));

/**
 * A per-invocation tag on every prompt. The edge stores a Project's title as the
 * submitted text verbatim, so without it a re-run's rows are indistinguishable
 * from the previous run's and "exactly one row per provider" stops meaning
 * anything on a stack that has served this eval before.
 */
const RUN_TAG = `n1-${Date.now().toString(36)}`;

const promptFor = (base: number) =>
  `[${RUN_TAG}] Use the shell to compute ${base}^3 and reply with exactly one line: RESULT=<value>`;
const answerFor = (expected: number) => `RESULT=${expected}`;
/** Identifies this run's Project for one provider, among all runs ever served. */
const titleMatches = (title: string, base: number) =>
  title.includes(RUN_TAG) && title.includes(`${base}^3`);

interface EdgeEvent {
  kind: string;
  sequence: string;
  data?: Record<string, unknown>;
}

interface RunRecord {
  alias: string;
  label: string;
  prompt: string;
  expected: string;
  /** The alias on the renderer's own outgoing create — what the UI asked for. */
  posted_model_alias?: string;
  project_id?: string;
  terminal?: string | null;
  event_kinds?: Record<string, number>;
  tool_loop?: boolean;
  answered?: boolean;
  other_answers_absent?: boolean;
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

/** A fresh Space, so each provider's task becomes its own aion Project. */
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

function countKinds(events: EdgeEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    counts[event.kind] = (counts[event.kind] ?? 0) + 1;
  }
  return counts;
}

/**
 * True when the run took at least two provider turns: a tool call, its result,
 * and assistant text produced after that result. Sequence order is the proof —
 * text that only precedes the tool result could all be one turn.
 */
function hadToolLoop(events: EdgeEvent[]): boolean {
  const seqOf = (kind: string, last: boolean) => {
    const matches = events.filter((event) => event.kind === kind);
    const pick = last ? matches[matches.length - 1] : matches[0];
    return pick ? Number(pick.sequence) : null;
  };
  const call = seqOf('tool_call', false);
  const result = seqOf('tool_result', false);
  const text = seqOf('text_delta', true);
  return call !== null && result !== null && text !== null && text > result;
}

/** Every event body concatenated, for scanning what the run actually said. */
const trajectoryText = (events: EdgeEvent[]) =>
  events.map((event) => JSON.stringify(event.data ?? {})).join('\n');

test('every picked provider serves its own project', async () => {
  test.setTimeout(40 * 60_000);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-n1-'));
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

  const runs: RunRecord[] = SELECTED.map((provider) => ({
    alias: provider.alias,
    label: provider.label,
    prompt: promptFor(provider.base),
    expected: answerFor(provider.expected),
  }));
  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
    run_tag: RUN_TAG,
    providers_covered: SELECTED.map((provider) => provider.alias),
    providers_skipped: SKIPPED.map((provider) => provider.alias),
    runs,
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
    const requests: { method: string; url: string; body?: string }[] = [];
    page.on('request', (request) => {
      requests.push({
        method: request.method(),
        url: request.url(),
        body: request.postData() ?? undefined,
      });
    });

    await page
      .locator('[role="textbox"]')
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 });
    await screenshot(page, '01-workspace');

    for (const [index, provider] of SELECTED.entries()) {
      const record = runs[index];
      const prompt = record.prompt;
      const expected = record.expected;
      const step = `${index + 1}-${provider.alias}`;

      const composer = await newSpace(page);
      await selectModel(page, provider.label);
      await screenshot(page, `1${step}-picked`);

      // The create is watched rather than inferred: the alias in the outgoing
      // body is what the UI asked the edge for, which is the only place the
      // picker's choice becomes a fact about the run.
      const createBody = page
        .waitForRequest(
          (request) =>
            request.method() === 'POST' &&
            request.url() === `${edgeBaseUrl}/projects`,
          { timeout: 60_000 }
        )
        .then((request) => request.postData() ?? '');

      await typeIntoComposer(page, composer, prompt);
      await composer.press('Enter');

      const posted = JSON.parse((await createBody) || '{}') as {
        model_alias?: string;
        title?: string;
      };
      record.posted_model_alias = posted.model_alias;
      expect(
        posted.model_alias,
        `${provider.alias}: the picker's choice never reached the create`
      ).toBe(provider.alias);
      await screenshot(page, `2${step}-sent`);

      // Terminal condition: this provider's own answer line on screen. Each
      // base gives a different value, so one provider's answer can never
      // satisfy another's wait.
      const answer = page.getByText(expected, { exact: false }).first();
      try {
        await answer.waitFor({ state: 'visible', timeout: ANSWER_TIMEOUT_MS });
      } catch (error) {
        await screenshot(page, `timeout-${step}`);
        throw new Error(
          `${provider.alias} did not answer with ${expected}: ${String(error)}`
        );
      }
      record.answered = true;
      await screenshot(page, `3${step}-answered`);
    }

    // The Projects list after a renderer restart: the three runs are the
    // tenant's Projects as the edge lists them, each carrying the alias its own
    // run was created with — not the renderer's last selection.
    await page.evaluate(() => {
      window.location.hash = '#/history?tab=home&section=projects';
    });
    await page.reload();
    await expect(page.getByTestId('aion-projects')).toBeVisible({
      timeout: 60_000,
    });
    for (const provider of SELECTED) {
      const row = page
        .getByTestId('aion-project-row')
        .filter({ hasText: RUN_TAG })
        .filter({ hasText: `${provider.base}^3` });
      await expect(
        row,
        `${provider.alias}: its Project is not in the list`
      ).toHaveCount(1);
      await expect(row).toContainText(provider.alias);
    }
    await screenshot(page, '4-projects-listed');

    // Trajectories read back from the edge, matched to runs by the create
    // bodies the renderer sent — the product's own record of what ran.
    const creates = requests.filter(
      (request) =>
        request.method === 'POST' && request.url === `${edgeBaseUrl}/projects`
    );
    expect(creates.length, 'one create per provider').toBe(SELECTED.length);
    const listed = await fetch(`${edgeBaseUrl}/projects`, {
      headers: { Authorization: `Bearer ${bootstrap.api_key}` },
    }).then(
      (response) =>
        response.json() as Promise<{
          projects?: { project: { project_id: string; title: string } }[];
        }>
    );

    for (const [index, provider] of SELECTED.entries()) {
      const record = runs[index];
      const match = (listed.projects ?? []).find((entry) =>
        titleMatches(entry.project.title, provider.base)
      );
      expect(match, `${provider.alias}: no Project on the edge`).toBeTruthy();
      record.project_id = match!.project.project_id;

      const { events, terminal } = await collectTrajectory(record.project_id);
      record.terminal = terminal;
      record.event_kinds = countKinds(events);
      record.tool_loop = hadToolLoop(events);
      const text = trajectoryText(events);
      // Its own answer is in the durable record, and neither other provider's
      // is — so a screen that showed the right line cannot have been reading
      // another run's pane.
      record.other_answers_absent = SELECTED.filter(
        (other) => other.alias !== provider.alias
      ).every((other) => !text.includes(answerFor(other.expected)));

      expect(terminal, `${provider.alias}: run did not complete`).toBe(
        'run_completed'
      );
      expect(text, `${provider.alias}: answer absent from the edge`).toContain(
        record.expected
      );
      expect(
        record.other_answers_absent,
        `${provider.alias}: another run's answer is in this trajectory`
      ).toBe(true);
      if (provider.requireToolLoop) {
        expect(
          record.tool_loop,
          `${provider.alias}: no second provider turn — cross-turn provider state never survived`
        ).toBe(true);
      }
    }

    // Everything the renderer touched stayed on the edge.
    const offEdge = requests.filter((request) => {
      const url = new URL(request.url);
      if (url.protocol === 'file:' || url.protocol === 'devtools:') return false;
      return !request.url.startsWith(edgeBaseUrl);
    });
    summary.off_edge_requests = offEdge.map((request) => request.url);
    summary.request_count = requests.length;
    writeOut(
      'network-log.json',
      JSON.stringify({ total: requests.length, requests }, null, 2)
    );
    expect(offEdge.map((request) => request.url)).toEqual([]);
    expect(
      requests.filter((request) => /^https?:/.test(request.url)).length,
      'an empty off-edge set is vacuous unless the renderer made requests'
    ).toBeGreaterThan(0);
  } catch (error) {
    bodyFailed = true;
    throw error;
  } finally {
    // The recording only flushes on close, so the video is resolved after
    // teardown and before the summary that reports it.
    await app.close();
    let videoBytes = 0;
    let videoName: string | null = null;
    const recorded = await video?.path().catch(() => undefined);
    if (recorded && fs.existsSync(recorded)) {
      videoName = 'models-and-projects-run.webm';
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
