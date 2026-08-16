// Real-model evaluation of the hardest thing this product does end to end:
// the model AUTHORS code, EXECUTES it in the remote sandbox, then loads a
// stored skill and executes THAT to fingerprint what its own code produced.
//
// What makes the result unfakeable: the answer is a SHA-256 over 4000 rows the
// run generates. No model can produce it by reasoning, and this spec derives
// the expectation from the same arithmetic it puts in the prompt — so the
// oracle cannot drift away from the task. The decisive assertion is not that
// the digest appears in the reply; it is that the digest appears inside a
// run_skill TOOL RESULT read back from the edge. A hallucinated digest reaches
// the prose and never the trajectory.
//
// Run: npx playwright test --config e2e/eval.config.ts skills-codegen
// Output: EIGENT_EVAL_DIR.

import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installPackagedApp, type PackagedInstall } from './packaged';

const REPO_ROOT =
  process.env.EIGENT_E2E_APP_DIR ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGED_SOURCE = process.env.EIGENT_E2E_PACKAGED_APP;
const BOOTSTRAP_PATH =
  process.env.EIGENT_E2E_BOOTSTRAP ??
  path.resolve(REPO_ROOT, '../aion-v1/deploy/eigent-local/run/bootstrap.json');
const OUT_DIR =
  process.env.EIGENT_EVAL_DIR ??
  path.resolve(REPO_ROOT, '..', 'skills-codegen');

const RUN_TIMEOUT_MS = 15 * 60_000;
const MIN_VIDEO_BYTES = 200 * 1024;
const VIDEO_SIZE = { width: 1280, height: 800 };
const SKILL_NAME = 'dataset-digest';
const ROW_COUNT = 4000;

interface Bootstrap {
  api_key: string;
  edge_url: string;
  tenant_id: string;
}

const bootstrap: Bootstrap = JSON.parse(
  fs.readFileSync(BOOTSTRAP_PATH, 'utf-8')
);
const edgeBaseUrl = `${bootstrap.edge_url.replace(/\/+$/, '')}/eigent/v1`;

// The skill's entrypoint. run_skill forwards no arguments — it cd's into the
// staged directory and runs the entrypoint — so the dataset is addressed by a
// fixed path. It digests a NORMALIZED rendering of the parsed rows, so line
// endings and a trailing newline cannot move the answer; only the data can.
const DIGEST_PY = `#!/usr/bin/env python3
"""Canonical digest of the generated dataset at /workspace/dataset.csv."""
import hashlib

PATH = "/workspace/dataset.csv"

rows = []
with open(PATH, "r", encoding="utf-8") as fh:
    for raw in fh:
        line = raw.strip()
        if not line or line.lower().startswith("idx,"):
            continue
        idx, val = line.split(",")[:2]
        rows.append((int(idx.strip()), int(val.strip())))

canon = "\\n".join("%d,%d" % (i, v) for i, v in rows)
print("ROWS", len(rows))
print("SUM", sum(v for _, v in rows))
print("DIGEST", hashlib.sha256(canon.encode("utf-8")).hexdigest())
`;

// The oracle, derived from the SAME rule the prompt states, so the two can
// never drift apart.
function expectedAnswer(): { rows: number; sum: number; digest: string } {
  const pairs: [number, number][] = [];
  for (let i = 1; i <= ROW_COUNT; i++) {
    pairs.push([i, (i * i * 7 + 13 * i + 5) % 100003]);
  }
  const canon = pairs.map(([i, v]) => `${i},${v}`).join('\n');
  return {
    rows: pairs.length,
    sum: pairs.reduce((acc, [, v]) => acc + v, 0),
    digest: crypto.createHash('sha256').update(canon, 'utf8').digest('hex'),
  };
}

const EXPECTED = expectedAnswer();

const PROMPT = [
  `Use the ${SKILL_NAME} skill for this. Do every computation inside the sandbox — never by hand.`,
  '',
  `1. Write a Python program to /workspace/gen.py that creates /workspace/dataset.csv: a header line \`idx,val\`, then exactly ${ROW_COUNT} data rows. For row i (i = 1..${ROW_COUNT}) the value is ((i*i*7 + 13*i + 5) mod 100003).`,
  '2. Run gen.py with bash, then confirm the file has 4001 lines.',
  `3. Load the ${SKILL_NAME} skill and execute its digest.py entrypoint to obtain the canonical ROWS, SUM and DIGEST.`,
  '4. Report the three values exactly as the skill printed them.',
].join('\n');

interface EdgeEvent {
  sequence?: string;
  kind?: string;
  data?: Record<string, unknown>;
}

function writeOut(name: string, payload: string): void {
  if (payload.includes(bootstrap.api_key)) {
    throw new Error(`output ${name} would leak the API key`);
  }
  fs.writeFileSync(path.join(OUT_DIR, name), payload);
}

async function screenshot(page: Page, name: string): Promise<void> {
  await page
    .screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: true })
    .catch(() => {});
}

async function edge(
  method: string,
  route: string,
  body?: unknown
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${bootstrap.api_key}`,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`${edgeBaseUrl}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// Author the skill the run will load. PUT is naturally idempotent here: an
// unchanged document dedups against the latest active version rather than
// writing a second one, so re-running the eval does not grow the store.
async function publishSkill(): Promise<Record<string, unknown>> {
  const response = await edge('PUT', `/skills/${SKILL_NAME}`, {
    origin: 'cloud_eval',
    document: {
      Name: SKILL_NAME,
      Version: '1.0.0',
      Description:
        'Canonical ROWS/SUM/DIGEST of the generated dataset at /workspace/dataset.csv.',
      PromptText: [
        `Skill: ${SKILL_NAME}`,
        '',
        'Reports the canonical fingerprint of a generated dataset.',
        '',
        'Preconditions: /workspace/dataset.csv must already exist, with a header',
        'line `idx,val` followed by one `<idx>,<val>` row per record.',
        '',
        "Usage: run this skill's `digest.py` entrypoint via run_skill. It takes no",
        'arguments and reads /workspace/dataset.csv directly. It prints exactly',
        'three lines:',
        '',
        '    ROWS <n>',
        '    SUM <n>',
        '    DIGEST <64 hex chars>',
        '',
        'The digest is taken over a NORMALIZED rendering of the parsed rows, so',
        'line endings and trailing whitespace cannot change it. Report the three',
        'values exactly as printed; never estimate or reconstruct them by hand.',
      ].join('\n'),
      Files: [
        {
          Path: 'digest.py',
          Content: Buffer.from(DIGEST_PY, 'utf-8').toString('base64'),
          Mode: 493,
        },
      ],
    },
  });
  if (response.status !== 200 && response.status !== 201) {
    throw new Error(
      `authoring ${SKILL_NAME} failed: ${response.status} ${await response.text()}`
    );
  }
  return (await response.json()) as Record<string, unknown>;
}

// The product's own record of the run, independent of anything the renderer
// chose to draw.
async function readTrajectory(projectId: string): Promise<EdgeEvent[]> {
  const response = await edge('GET', `/projects/${projectId}/events?after=0`);
  if (!response.ok || !response.body) {
    throw new Error(`events read failed: ${response.status}`);
  }
  const events: EdgeEvent[] = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let sawTerminal = false;
  const deadline = Date.now() + 60_000;
  while (!sawTerminal && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    const frames = buffered.split('\n\n');
    buffered = frames.pop() ?? '';
    for (const frame of frames) {
      const payload = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n');
      if (!payload) continue;
      try {
        const parsed = JSON.parse(payload) as EdgeEvent;
        events.push(parsed);
        if (
          parsed.kind === 'run_completed' ||
          parsed.kind === 'run_failed' ||
          parsed.kind === 'run_cancelled'
        ) {
          sawTerminal = true;
        }
      } catch {
        // A frame the contract added since this spec was written is not a
        // reason to fail the read — the assertions below name what they need.
      }
    }
  }
  await reader.cancel().catch(() => {});
  return events;
}

function toolCalls(events: EdgeEvent[]): { name: string; args: string }[] {
  return events
    .filter((event) => event.kind === 'tool_call')
    .map((event) => ({
      name: String(event.data?.tool_name ?? ''),
      args: String(event.data?.arguments_json ?? ''),
    }));
}

// Results carry the call id, not the tool name, so pair them back up: which
// tool produced a body is exactly what the anti-cheat assertion turns on.
function toolResults(
  events: EdgeEvent[]
): { tool: string; body: string; isError: boolean }[] {
  const nameByCallId = new Map<string, string>();
  for (const event of events) {
    if (event.kind !== 'tool_call') continue;
    nameByCallId.set(
      String(event.data?.tool_call_id ?? ''),
      String(event.data?.tool_name ?? '')
    );
  }
  return events
    .filter((event) => event.kind === 'tool_result')
    .map((event) => ({
      tool: nameByCallId.get(String(event.data?.tool_call_id ?? '')) ?? '',
      body: String(event.data?.content ?? ''),
      isError: Boolean(event.data?.is_error),
    }));
}

// Two hazards, both of which end with the composer detaching mid-type. The
// space-switch dropdown's focus trap can outlive its dismiss animation and
// reclaim focus, so typing is verify-and-retry rather than fire-and-forget.
// And Enter SUBMITS: pressing a multi-line prompt through pressSequentially
// sends the task off after its first line and remounts the composer under the
// locator. A newline is Shift+Enter here, the same key a user reaches for.
async function typeIntoComposer(
  page: Page,
  composer: ReturnType<Page['locator']>,
  text: string
): Promise<void> {
  const lines = text.split('\n');
  const normalize = (value: string) =>
    value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n');
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.keyboard.press('Escape').catch(() => {});
    await composer.click();
    for (const [index, line] of lines.entries()) {
      if (index > 0) await page.keyboard.press('Shift+Enter');
      if (line) await composer.pressSequentially(line, { delay: 3 });
    }
    const got = await composer.innerText().catch(() => '');
    if (normalize(got) === normalize(text)) return;
    await composer.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
  }
  throw new Error('composer never captured the full prompt');
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

test('the model writes code, runs it in the sandbox, and fingerprints it with a stored skill', async () => {
  test.setTimeout(RUN_TIMEOUT_MS + 180_000);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const published = await publishSkill();

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-codegen-'));
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

  const packaged: PackagedInstall | null = PACKAGED_SOURCE
    ? installPackagedApp(PACKAGED_SOURCE)
    : null;
  const videoDir = path.join(OUT_DIR, 'video');
  const app = await electron.launch({
    ...(packaged
      ? { executablePath: packaged.executablePath, args: [] }
      : { args: [REPO_ROOT], cwd: REPO_ROOT }),
    env,
    recordVideo: { dir: videoDir, size: VIDEO_SIZE },
  });

  let video: ReturnType<Page['video']> = null;
  let bodyFailed = false;
  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
    skill: SKILL_NAME,
    skill_version: (published.skill as Record<string, unknown> | undefined)
      ?.version,
    skill_changed: published.changed,
    packaged: packaged !== null,
    prompt: PROMPT,
    expected: EXPECTED,
  };

  try {
    const page = await findMainWindow(app);
    video = page.video();

    const requests: { method: string; url: string }[] = [];
    page.on('request', (request) => {
      requests.push({ method: request.method(), url: request.url() });
    });
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await page.waitForTimeout(4_000);
    await screenshot(page, '01-boot');
    await page
      .locator('[role="textbox"]')
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 });

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
    await screenshot(page, '02-new-space');

    await typeIntoComposer(page, composer, PROMPT);
    await screenshot(page, '03-composed');
    await composer.press('Enter');
    await page.waitForTimeout(2_000);
    await screenshot(page, '04-sent');

    // Terminal condition: the digest itself rendered in the chat pane. The
    // trajectory assertions below are what decide whether it was EARNED.
    const answer = page.getByText(EXPECTED.digest, { exact: false }).first();
    const deadline = Date.now() + RUN_TIMEOUT_MS;
    let shots = 0;
    for (;;) {
      if (await answer.isVisible().catch(() => false)) break;
      if (Date.now() > deadline) {
        await screenshot(page, 'timeout-final');
        throw new Error('run did not surface the expected digest in time');
      }
      if (shots < 8 && requests.length > 0) {
        await screenshot(page, `05-progress-${shots++}`);
      }
      await page.waitForTimeout(5_000);
    }
    await screenshot(page, '06-answer');

    // Re-read the run from the edge. The project id comes off the outgoing
    // command, not the screen.
    const commandUrl = requests
      .map((request) => request.url)
      .find((url) => /\/projects\/[^/]+\/commands$/.test(url));
    expect(commandUrl, 'no command was submitted to the edge').toBeTruthy();
    const projectId = /\/projects\/([^/]+)\/commands$/.exec(commandUrl!)![1];
    summary.project_id = projectId;

    const events = await readTrajectory(projectId);
    writeOut('trajectory.json', JSON.stringify(events, null, 2));
    const calls = toolCalls(events);
    const results = toolResults(events);
    summary.tool_calls = calls.map((call) => call.name);
    summary.event_count = events.length;

    // The four stages the task cannot be completed without.
    const wroteCode = calls.some(
      (call) =>
        (call.name === 'write_file' || call.name === 'bash') &&
        call.args.includes('gen.py')
    );
    const ranCode = calls.some(
      (call) => call.name === 'bash' && call.args.includes('gen.py')
    );
    const loadedSkill = calls.some(
      (call) => call.name === 'skill' && call.args.includes(SKILL_NAME)
    );
    const ranSkill = calls.some(
      (call) =>
        call.name === 'run_skill' &&
        call.args.includes(SKILL_NAME) &&
        call.args.includes('digest.py')
    );
    Object.assign(summary, {
      wrote_code: wroteCode,
      ran_code: ranCode,
      loaded_skill: loadedSkill,
      ran_skill: ranSkill,
    });
    expect(wroteCode, 'the run never authored gen.py').toBe(true);
    expect(ranCode, 'the run never executed gen.py in the sandbox').toBe(true);
    expect(
      loadedSkill,
      'the stored skill is manual-activation, so it must be explicitly loaded'
    ).toBe(true);
    expect(ranSkill, 'the run never executed the skill entrypoint').toBe(true);

    // The anti-cheat assertion. A digest that was reasoned about reaches the
    // prose only; one that was COMPUTED comes back in the body of the run_skill
    // result — which is why this pins the producing tool rather than scanning
    // every result: the skill's own prompt describes the output format, so a
    // name-blind scan could be satisfied by a description of the answer.
    const digestResult = results.find(
      (result) =>
        result.tool === 'run_skill' && result.body.includes(EXPECTED.digest)
    );
    expect(
      digestResult,
      'the digest never came back from run_skill — it was not computed in the sandbox'
    ).toBeTruthy();
    expect(digestResult!.body).toContain('exit=0');
    expect(digestResult!.body).toContain(`ROWS ${EXPECTED.rows}`);
    expect(digestResult!.body).toContain(`SUM ${EXPECTED.sum}`);

    // Settlement green is not result green: scan the bodies of results that
    // reported success for failures they carried anyway.
    const inBandFailures = results
      .filter((result) => !result.isError)
      .filter((result) =>
        /(^|\n)exit=[1-9]|Traceback \(most recent call last\)|command not found|No such file or directory/.test(
          result.body
        )
      )
      .map((result) => result.body.slice(0, 400));
    writeOut('in-band-failures.json', JSON.stringify(inBandFailures, null, 2));
    expect(
      inBandFailures,
      'a settled tool result carried a failure in its body'
    ).toEqual([]);

    // Edge-only network audit — both halves, because an empty off-edge set is
    // vacuous unless the set was populated at all.
    const offEdge = requests.filter((request) => {
      const url = new URL(request.url);
      if (url.protocol === 'file:' || url.protocol === 'devtools:')
        return false;
      return !request.url.startsWith(edgeBaseUrl);
    });
    writeOut(
      'network-log.json',
      JSON.stringify({ total: requests.length, off_edge: offEdge }, null, 2)
    );
    writeOut('console-errors.json', JSON.stringify(consoleErrors, null, 2));
    expect(requests.length).toBeGreaterThan(0);
    expect(offEdge).toEqual([]);
    await screenshot(page, '07-final');
  } catch (error) {
    bodyFailed = true;
    summary.error = String(error);
    throw error;
  } finally {
    // The recording only flushes on close, so resolve the path afterwards.
    await app.close();
    let videoBytes = 0;
    const recorded = await video?.path().catch(() => undefined);
    const videoName = 'skills-codegen-run.webm';
    if (recorded && fs.existsSync(recorded)) {
      fs.copyFileSync(recorded, path.join(OUT_DIR, videoName));
      videoBytes = fs.statSync(recorded).size;
    }
    summary.video = videoName;
    summary.video_bytes = videoBytes;
    writeOut('summary.json', JSON.stringify(summary, null, 2));
    if (!bodyFailed) {
      expect(videoBytes, 'the run was not recorded').toBeGreaterThan(
        MIN_VIDEO_BYTES
      );
    }
  }

  if (packaged) {
    fs.rmSync(packaged.installDir, { recursive: true, force: true });
  }
});
