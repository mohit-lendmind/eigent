// Real-model driver for run metering: the same task run twice through the REAL
// product chat UI against the live eigent-local stack — once with no ceiling,
// then once under a deliberately tiny one.
//
// The two passes are what make each other meaningful. The first proves a real
// provider run settles a real figure and that the number the Usage screen shows
// is the number the edge settled. The second proves the ceiling BINDS rather
// than merely being stored: the run stops, the desktop says why in its own
// words, and — the sharpest control available — that run made FEWER provider
// calls than the uncapped one did on the identical prompt.
//
// Both passes also carry the consumption claim end to end (aion #225, #226).
// Three surfaces report one run: the terminal event on the stream, the chat
// line the user actually reads when the run ends, and the Usage screen. They
// are asserted to AGREE, because a settled run writes its spend and its
// terminal event in one transaction and a disagreement would mean one of them
// is inventing a figure. The token block is checked for internal arithmetic on
// every surface: total is prompt+completion, billable is prompt minus both
// cache dimensions floored at zero, reasoning is inside completion. The edge
// serves those derived figures precisely so two clients cannot disagree, which
// is only worth something if something checks.
//
// The ceiling is stamped at mint time from the ops worker's boot config, so the
// only way to change it is to recreate that service between the passes. That is
// what //dev/eigent_local:ceiling does, and why this is one recording of two
// passes rather than two independent runs.
//
// Run: npx playwright test --config e2e/eval.config.ts usage
// Env: EIGENT_EVAL_MODEL / EIGENT_EVAL_MODEL_LABEL pick the catalog row (it
//      must be a PRICED one, or the first pass settles zero and proves
//      nothing); EIGENT_EVAL_AION_ROOT locates the stack checkout.
// Output: EIGENT_EVAL_DIR (default ../n2-evidence/playwright/real-model).

import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { execFileSync } from 'node:child_process';
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
const AION_ROOT =
  process.env.EIGENT_EVAL_AION_ROOT ??
  path.resolve(path.dirname(BOOTSTRAP_PATH), '../../..');
const OUT_DIR =
  process.env.EIGENT_EVAL_DIR ??
  path.resolve(REPO_ROOT, '..', 'n2-evidence', 'playwright', 'real-model');

const MODEL_ALIAS = process.env.EIGENT_EVAL_MODEL ?? 'kimi-k3';
const MODEL_LABEL = process.env.EIGENT_EVAL_MODEL_LABEL ?? 'Kimi K3';
/** Provider calls the capped pass is allowed. The prompt needs more. */
const CAP_PROVIDER_CALLS = 2;

const ANSWER_TIMEOUT_MS = 8 * 60_000;
const STOP_TIMEOUT_MS = 8 * 60_000;
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
 * A per-invocation tag on every prompt, so a stack that has served this eval
 * before cannot supply the Project this run is looking for.
 */
const RUN_TAG = `n2-${Date.now().toString(36)}`;
/**
 * Three cubes, one shell command each, summed. The arithmetic is incidental;
 * the sequence is the point — a run that must take several provider turns is
 * the only kind a two-call ceiling can visibly cut short.
 */
const PROMPT =
  `[${RUN_TAG}] Use the shell three times, one command per turn and never more ` +
  `than one at a time: compute 12^3, then 13^3, then 14^3. Do not compute them ` +
  `yourself and do not batch them into one command. When you have all three, ` +
  `reply with exactly one line: RESULT=<their sum>`;
const EXPECTED_ANSWER = 'RESULT=6669';
/** What the desktop says, in its own words, when a ceiling stops a run. */
const STOPPED_TEXT = 'budget exhausted';

interface EdgeEvent {
  kind: string;
  sequence: string;
  data?: Record<string, unknown>;
}

/** The seven figures, every one a decimal string. */
type RunTokens = Record<string, string | undefined>;

interface EdgeRun {
  run_id: string;
  project_id: string;
  status: string;
  ended_at?: string;
  cost_micro_usd?: string;
  provider_calls?: string;
  tokens?: RunTokens;
}

interface UsageTotals {
  cost_micro_usd?: string;
  provider_calls?: string;
  runs_settled?: string;
  runs_unrecorded?: string;
  runs_without_tokens?: string;
  tokens?: RunTokens;
}

interface PassRecord {
  name: string;
  ceiling_provider_calls: number;
  project_id?: string;
  run_id?: string;
  terminal?: string | null;
  event_kinds?: Record<string, number>;
  cost_micro_usd?: string;
  provider_calls?: string;
  rendered_cost?: string;
  ui_said?: string;
  /** What the terminal event itself put on the wire. */
  terminal_data?: Record<string, unknown>;
  /** What /usage says the same run consumed. */
  usage_tokens?: RunTokens;
  /** The window totals, scoped to this Project's one run. */
  usage_totals?: UsageTotals;
  /** The line the chat printed when the run settled. */
  chat_said?: string;
  rendered_tokens?: string;
  rendered_total_tokens?: string;
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

/**
 * Recreates the ops worker with the given per-run ceiling. Zero is uncapped,
 * which is the state the stack is left in — a leftover ceiling would silently
 * cut short every later run on this stack.
 */
function setCeiling(providerCalls: number): void {
  execFileSync(
    'bash',
    [path.join(AION_ROOT, 'dev', 'eigent_local', 'ceiling.sh'), String(providerCalls)],
    {
      cwd: AION_ROOT,
      env: { ...process.env, BUILD_WORKSPACE_DIRECTORY: AION_ROOT },
      stdio: 'pipe',
    }
  );
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

/**
 * The durable trajectory, straight from the edge's SSE replay: the run as the
 * product recorded it, independent of anything the renderer displayed.
 */
async function collectTrajectory(
  projectId: string
): Promise<{
  events: EdgeEvent[];
  terminal: string | null;
  terminalEvent: EdgeEvent | null;
}> {
  const events: EdgeEvent[] = [];
  let terminal: string | null = null;
  let terminalEvent: EdgeEvent | null = null;
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
          terminalEvent = event;
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
  return { events, terminal, terminalEvent };
}

/** Thousands separators, matching what both the chat line and the screen do. */
function grouped(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * The seven token figures, checked against each other. `total_tokens` and
 * `billable_input_tokens` are derived server-side so that two clients cannot
 * disagree about one run — which is only a guarantee if the derivation is
 * actually right. `prompt_tokens` is cache-INCLUSIVE, so billable is it minus
 * both cache dimensions (floored at zero); `reasoning_tokens` is a split of
 * `completion_tokens`, never an addend. Returns the total for cross-surface
 * comparison.
 */
function assertTokensCohere(where: string, tokens: RunTokens | undefined): bigint {
  expect(tokens, `${where}: recorded no token figure`).toBeTruthy();
  const read = (name: string): bigint => {
    expect(tokens![name], `${where}: ${name} is not a decimal string`).toMatch(
      /^[0-9]+$/
    );
    return BigInt(tokens![name]!);
  };
  const prompt = read('prompt_tokens');
  const completion = read('completion_tokens');
  const reasoning = read('reasoning_tokens');
  const cacheRead = read('cache_read_tokens');
  const cacheCreation = read('cache_creation_tokens');
  const billable = read('billable_input_tokens');
  const total = read('total_tokens');
  expect(total, `${where}: total is not prompt+completion`).toBe(
    prompt + completion
  );
  const uncached = prompt - cacheRead - cacheCreation;
  expect(billable, `${where}: billable is not the cache subtraction`).toBe(
    uncached > 0n ? uncached : 0n
  );
  expect(
    reasoning,
    `${where}: reasoning exceeds completion, so it is not a split of it`
  ).toBeLessThanOrEqual(completion);
  expect(total, `${where}: a real provider run consumed no tokens`).toBeGreaterThan(
    0n
  );
  return total;
}

function countKinds(events: EdgeEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    counts[event.kind] = (counts[event.kind] ?? 0) + 1;
  }
  return counts;
}

/**
 * What the tenant's own bill says this Project's single run cost and consumed.
 * The totals come back beside the row: scoped to one Project with one run they
 * ARE that run, which makes the aggregate query checkable against the row it
 * aggregated.
 */
async function projectSpend(
  projectId: string
): Promise<{ run: EdgeRun; totals: UsageTotals }> {
  const response = await fetch(
    `${edgeBaseUrl}/usage?project_id=${encodeURIComponent(projectId)}`,
    { headers: { Authorization: `Bearer ${bootstrap.api_key}` } }
  );
  if (!response.ok) {
    throw new Error(`getUsage: ${response.status} ${await response.text()}`);
  }
  const page = (await response.json()) as {
    runs: EdgeRun[];
    totals?: UsageTotals;
  };
  expect(page.runs.length, `${projectId}: expected exactly one settled run`).toBe(
    1
  );
  return { run: page.runs[0], totals: page.totals ?? {} };
}

/**
 * The whole tenant's window, unscoped. The Usage screen's header is this, not
 * the Project's — the row is filtered and the totals above it are not — so it
 * is what the rendered figure has to be compared against.
 */
async function tenantTotals(): Promise<UsageTotals> {
  const response = await fetch(`${edgeBaseUrl}/usage?page_size=1`, {
    headers: { Authorization: `Bearer ${bootstrap.api_key}` },
  });
  if (!response.ok) {
    throw new Error(`getUsage: ${response.status} ${await response.text()}`);
  }
  return ((await response.json()) as { totals?: UsageTotals }).totals ?? {};
}

/**
 * The displayed dollar figure has to be the settled micro-USD, allowing for the
 * rounding the display does at its own precision (4 decimals under a dollar,
 * 2 above) and the below-the-smallest-unit bound it shows instead of a zero.
 */
function amountMatches(text: string, microUsd: bigint): boolean {
  if (text.startsWith('<$')) return microUsd > 0n && microUsd < 50n;
  const parsed = Number(text.replace(/[$,]/g, ''));
  if (!Number.isFinite(parsed)) return false;
  const halfUnit = microUsd < 1_000_000n ? 50 : 5_000;
  return Math.abs(Math.round(parsed * 1e6) - Number(microUsd)) <= halfUnit;
}

/** Opens the Usage screen and returns what the given run's row shows. */
async function readUsageRow(
  page: Page,
  runId: string
): Promise<{ cost: string; tokens: string; totalTokens: string }> {
  await page.evaluate(() => {
    window.location.hash = '#/history?tab=home&section=usage';
  });
  await page.reload();
  await expect(page.getByTestId('aion-usage')).toBeVisible({ timeout: 60_000 });
  const row = page.locator(
    `[data-testid="aion-usage-row"][data-run-id="${runId}"]`
  );
  await expect(row, `${runId}: no row on the Usage screen`).toHaveCount(1);
  return {
    cost: await row.getByTestId('aion-usage-cost-amount').innerText(),
    tokens: await row.getByTestId('aion-usage-tokens').innerText(),
    totalTokens: await page.getByTestId('aion-usage-total-tokens').innerText(),
  };
}

/**
 * The chat's own settlement line, and what it must and must not contain. This
 * is the surface a user actually meets — the run they just watched ends with
 * one line saying what it consumed — so it is asserted against the settled
 * figures rather than merely being present.
 */
async function readConsumptionLine(
  page: Page,
  tokens: RunTokens
): Promise<string> {
  const line = page.getByText(/📊\s[\d,]+\stokens/).first();
  await line.waitFor({ state: 'visible', timeout: 120_000 });
  // The chat does not follow its own tail once a run settles, and a figure
  // below the fold is not a figure the user was shown — the screenshot taken
  // straight after this has to contain it.
  await line.scrollIntoViewIfNeeded();
  const said = (await line.innerText()).trim();
  expect(said).toContain(`${grouped(tokens.total_tokens!)} tokens`);
  expect(said).toContain(`${grouped(tokens.billable_input_tokens!)} billable in`);
  // prompt_tokens is cache-inclusive, so printing it beside the cached read is
  // exactly the addition that double-counts. Only checkable when caching
  // actually happened — with both cache dimensions at zero the two are equal.
  const cached =
    BigInt(tokens.cache_read_tokens!) + BigInt(tokens.cache_creation_tokens!);
  if (cached > 0n) {
    expect(
      said,
      'the line shows the cache-inclusive prompt total'
    ).not.toContain(grouped(tokens.prompt_tokens!));
  }
  return said;
}

test('a real run reports what it cost and consumed, and a ceiling stops one short', async () => {
  test.setTimeout(40 * 60_000);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-n2-'));
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

  const uncapped: PassRecord = { name: 'uncapped', ceiling_provider_calls: 0 };
  const capped: PassRecord = {
    name: 'capped',
    ceiling_provider_calls: CAP_PROVIDER_CALLS,
  };
  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
    run_tag: RUN_TAG,
    model_alias: MODEL_ALIAS,
    prompt: PROMPT,
    passes: [uncapped, capped],
  };

  // A ceiling left behind by an earlier run would make the first pass the
  // capped one without saying so.
  setCeiling(0);

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

    // ---- Pass 1: no ceiling. The run finishes and costs something. --------
    const composerA = await newSpace(page);
    await selectModel(page, MODEL_LABEL);
    const createA = page
      .waitForRequest(
        (request) =>
          request.method() === 'POST' &&
          request.url() === `${edgeBaseUrl}/projects`,
        { timeout: 60_000 }
      )
      .then((request) => request.postData() ?? '');
    await typeIntoComposer(page, composerA, PROMPT);
    await composerA.press('Enter');
    const postedA = JSON.parse((await createA) || '{}') as {
      model_alias?: string;
    };
    expect(
      postedA.model_alias,
      "the picker's choice never reached the create"
    ).toBe(MODEL_ALIAS);
    await screenshot(page, '01-uncapped-sent');

    await page
      .getByText(EXPECTED_ANSWER, { exact: false })
      .first()
      .waitFor({ state: 'visible', timeout: ANSWER_TIMEOUT_MS });
    await screenshot(page, '02-uncapped-answered');

    const projectA = /\/projects\/([^/?]+)\/commands/.exec(
      requests.find((r) => /\/projects\/[^/]+\/commands$/.test(r.url))?.url ?? ''
    )?.[1];
    expect(projectA, 'no command was submitted for the uncapped pass').toBeTruthy();
    uncapped.project_id = projectA;
    const trajectoryA = await collectTrajectory(projectA!);
    uncapped.terminal = trajectoryA.terminal;
    uncapped.event_kinds = countKinds(trajectoryA.events);
    expect(trajectoryA.terminal, 'the uncapped run did not complete').toBe(
      'run_completed'
    );

    // The terminal event has to carry the consumption itself. A consumer
    // watching the stream sees the run end here and makes no second request.
    const terminalA = trajectoryA.terminalEvent?.data ?? {};
    uncapped.terminal_data = terminalA;
    const terminalTokensA = assertTokensCohere(
      'uncapped run_completed',
      terminalA.tokens as RunTokens | undefined
    );
    const terminalCostA = terminalA.cost as
      | { cost_micro_usd?: string; provider_calls?: string }
      | undefined;
    expect(
      terminalCostA?.cost_micro_usd,
      'the terminal event carried no cost'
    ).toMatch(/^[0-9]+$/);
    expect(
      Number(terminalA.turn_count),
      'the terminal event reported no turns'
    ).toBeGreaterThan(0);

    const { run: spendA, totals: totalsA } = await projectSpend(projectA!);
    uncapped.run_id = spendA.run_id;
    uncapped.cost_micro_usd = spendA.cost_micro_usd;
    uncapped.provider_calls = spendA.provider_calls;
    uncapped.usage_tokens = spendA.tokens;
    uncapped.usage_totals = totalsA;
    // A real provider run has to settle a real figure: an absent pair would be
    // an unmetered run, and a zero beside real calls an unpriced catalog row.
    expect(
      spendA.cost_micro_usd,
      `${MODEL_ALIAS} settled no cost — is the catalog row priced?`
    ).toBeTruthy();
    expect(BigInt(spendA.cost_micro_usd!)).toBeGreaterThan(0n);
    // The cap has to be a real constraint on this prompt, or the second pass
    // would prove nothing by stopping.
    expect(
      Number(spendA.provider_calls),
      'the uncapped run fit inside the ceiling, so the ceiling cannot bind'
    ).toBeGreaterThan(CAP_PROVIDER_CALLS);

    // Spend and terminal event are written in one transaction, so the stream
    // can never claim a figure the bill does not have. Two reads, one row.
    expect(terminalCostA!.cost_micro_usd).toBe(spendA.cost_micro_usd);
    expect(terminalCostA!.provider_calls).toBe(spendA.provider_calls);
    expect(
      assertTokensCohere('uncapped /usage row', spendA.tokens),
      'the bill and the stream disagree about the same run'
    ).toBe(terminalTokensA);
    // Window totals over a one-run window are that run, which is what makes
    // the aggregate query checkable against the row it aggregated.
    expect(assertTokensCohere('uncapped /usage totals', totalsA.tokens)).toBe(
      terminalTokensA
    );
    expect(
      totalsA.runs_without_tokens,
      'a settled run with tokens was counted as missing them'
    ).toBe('0');

    uncapped.chat_said = await readConsumptionLine(page, spendA.tokens!);
    await screenshot(page, '03-uncapped-consumption');

    const renderedA = await readUsageRow(page, spendA.run_id);
    uncapped.rendered_cost = renderedA.cost;
    uncapped.rendered_tokens = renderedA.tokens;
    uncapped.rendered_total_tokens = renderedA.totalTokens;
    expect(
      amountMatches(renderedA.cost, BigInt(spendA.cost_micro_usd!)),
      `the screen shows ${renderedA.cost} for ${spendA.cost_micro_usd} micro-USD`
    ).toBe(true);
    expect(renderedA.tokens.replace(/,/g, '')).toBe(spendA.tokens!.total_tokens);
    const windowA = await tenantTotals();
    assertTokensCohere('tenant window', windowA.tokens);
    expect(renderedA.totalTokens.replace(/,/g, '')).toBe(
      windowA.tokens!.total_tokens
    );
    // A window containing this run cannot total less than it does. Reading
    // both figures is what makes the header a sum rather than a coincidence.
    expect(BigInt(windowA.tokens!.total_tokens!)).toBeGreaterThanOrEqual(
      terminalTokensA
    );
    await screenshot(page, '04-uncapped-usage');

    // ---- Pass 2: the same prompt under a ceiling that cannot hold it. -----
    setCeiling(CAP_PROVIDER_CALLS);
    const composerB = await newSpace(page);
    await selectModel(page, MODEL_LABEL);
    await typeIntoComposer(page, composerB, PROMPT);
    await composerB.press('Enter');
    await screenshot(page, '05-capped-sent');

    // The desktop names the ceiling rather than reporting a provider error, so
    // this text is the product-level claim under test.
    const stopped = page.getByText(STOPPED_TEXT, { exact: false }).first();
    await stopped.waitFor({ state: 'visible', timeout: STOP_TIMEOUT_MS });
    capped.ui_said = (await stopped.innerText()).trim();
    await screenshot(page, '06-capped-stopped');
    // The answer is what the run never got to produce.
    await expect(
      page.getByText(EXPECTED_ANSWER, { exact: false })
    ).toHaveCount(0);

    const projectB = [
      ...new Set(
        requests
          .map((r) => /\/projects\/([^/?]+)\/commands/.exec(r.url)?.[1])
          .filter(Boolean)
      ),
    ].filter((id) => id !== projectA)[0];
    expect(projectB, 'no command was submitted for the capped pass').toBeTruthy();
    capped.project_id = projectB;
    const trajectoryB = await collectTrajectory(projectB!);
    capped.terminal = trajectoryB.terminal;
    capped.event_kinds = countKinds(trajectoryB.events);
    expect(trajectoryB.terminal, 'the capped run did not stop').toBe(
      'run_failed'
    );

    // A stopped run consumed real tokens and has to say so. Reporting only on
    // the happy path would leave the runs a user most wants explained — the
    // ones that ended early — as the ones with no figure.
    const terminalB = trajectoryB.terminalEvent?.data ?? {};
    capped.terminal_data = terminalB;
    const terminalTokensB = assertTokensCohere(
      'capped run_failed',
      terminalB.tokens as RunTokens | undefined
    );

    const { run: spendB, totals: totalsB } = await projectSpend(projectB!);
    capped.run_id = spendB.run_id;
    capped.cost_micro_usd = spendB.cost_micro_usd;
    capped.provider_calls = spendB.provider_calls;
    capped.usage_tokens = spendB.tokens;
    capped.usage_totals = totalsB;
    expect(
      spendB.provider_calls,
      'the capped run settled without a recorded figure'
    ).toBeTruthy();
    expect(assertTokensCohere('capped /usage row', spendB.tokens)).toBe(
      terminalTokensB
    );
    // The token control, independent of the provider-call one below: the run
    // the ceiling cut short consumed strictly less than the one it did not.
    expect(
      terminalTokensB,
      'the capped run consumed as many tokens as the uncapped one'
    ).toBeLessThan(terminalTokensA);
    // The control: the ceiling BOUND. Same prompt, same model, fewer calls —
    // and never more than the ceiling allowed.
    expect(Number(spendB.provider_calls)).toBeLessThanOrEqual(
      CAP_PROVIDER_CALLS
    );
    expect(
      Number(spendB.provider_calls),
      'the capped run made as many provider calls as the uncapped one'
    ).toBeLessThan(Number(spendA.provider_calls));

    capped.chat_said = await readConsumptionLine(page, spendB.tokens!);
    await screenshot(page, '07-capped-consumption');

    const renderedB = await readUsageRow(page, spendB.run_id);
    capped.rendered_cost = renderedB.cost;
    capped.rendered_tokens = renderedB.tokens;
    capped.rendered_total_tokens = renderedB.totalTokens;
    expect(
      amountMatches(renderedB.cost, BigInt(spendB.cost_micro_usd ?? '0')),
      `the screen shows ${renderedB.cost} for ${spendB.cost_micro_usd} micro-USD`
    ).toBe(true);
    expect(renderedB.tokens.replace(/,/g, '')).toBe(spendB.tokens!.total_tokens);
    const windowB = await tenantTotals();
    expect(renderedB.totalTokens.replace(/,/g, '')).toBe(
      windowB.tokens!.total_tokens
    );
    // The window grew by exactly the second run: two settlements, one sum.
    expect(BigInt(windowB.tokens!.total_tokens!)).toBe(
      BigInt(windowA.tokens!.total_tokens!) + terminalTokensB
    );
    await screenshot(page, '08-capped-usage');

    // Everything the renderer touched stayed on the edge.
    const offEdge = requests.filter((request) => {
      const url = new URL(request.url);
      if (url.protocol === 'file:' || url.protocol === 'devtools:') return false;
      return !request.url.startsWith(edgeBaseUrl);
    });
    summary.off_edge_requests = offEdge.map((request) => request.url);
    summary.request_count = requests.length;
    expect(offEdge.map((request) => request.url)).toEqual([]);
    expect(
      requests.filter((request) => /^https?:/.test(request.url)).length,
      'an empty off-edge set is vacuous unless the renderer made requests'
    ).toBeGreaterThan(0);
  } catch (error) {
    bodyFailed = true;
    throw error;
  } finally {
    // Uncapped is the stack's documented default; leaving a ceiling behind
    // would quietly cut short every later run on it.
    try {
      setCeiling(0);
      summary.ceiling_restored = true;
    } catch (error) {
      summary.ceiling_restored = false;
      summary.ceiling_restore_error = String(error);
    }
    // The recording only flushes on close, so the video is resolved after
    // teardown and before the summary that reports it.
    await app.close();
    let videoBytes = 0;
    let videoName: string | null = null;
    const recorded = await video?.path().catch(() => undefined);
    if (recorded && fs.existsSync(recorded)) {
      videoName = 'usage-run.webm';
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
