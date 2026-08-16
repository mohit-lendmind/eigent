// Enable-gate evaluation: the product path a user actually walks when a skill
// arrives — upload it, turn it ON on the Skills screen, and only then does the
// aion orchestrator have it. The REAL desktop app in remote-backend mode, the
// live eigent-local stack, a REAL model, one skill, two runs of the SAME query.
//
// The enable switch is a wire operation, not a local preference: it writes
// SetSkillStatus through the edge, and the cell merges only ACTIVE stored skills
// into a session's registry. So the disabled run is a negative control with
// teeth — the orchestrator is not choosing to skip the skill, it cannot see it.
// Both runs are asserted:
//
//   disabled → the script's token never appears, and the tenant's usage
//              counters do not move at all (nothing loaded, nothing executed).
//   enabled  → the same query gets the token, the values only the script can
//              produce, and counters that move by at least one load and one
//              execution — read back off the Skills screen where a user sees
//              them.
//
// The skill leans on the workspace image on purpose: its entrypoint aggregates a
// dock log with pandas, which the pod can only satisfy from the image (pods have
// no network egress, so a runtime pip install is not an option). A bare-Python
// image fails it on import, and the fallback-marker scan below catches the
// read-the-staged-file-and-do-it-myself path a model reaches for when it does.
//
// Run: npx playwright test --config e2e/eval.config.ts skills-enable-gate
// Output: EIGENT_EVAL_DIR (default ../skills-enable-gate-eval next to the repo).

import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { zipSync } from 'fflate';
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
  path.resolve(REPO_ROOT, '..', 'skills-enable-gate-eval');

// A real-model turn that searches the catalog, loads a prompt, runs a script in
// a freshly leased pod and reasons over its output.
const ANSWER_TIMEOUT_MS = 10 * 60_000;
// The disabled run ends when the model gives up, which is far quicker — but it
// is bounded rather than open, and the summary records whether the turn had
// actually settled when the assertions ran.
const DISABLED_TIMEOUT_MS = 5 * 60_000;
// The usage sink records outside the request path, so counters trail the answer.
const COUNTER_TIMEOUT_MS = 90_000;
// How long the disabled run's counters are watched before calling them still.
const COUNTER_QUIET_MS = 30_000;
// A status write is one edge round trip, but it lands through the store.
const STATUS_TIMEOUT_MS = 30_000;

interface Bootstrap {
  api_key: string;
  edge_url: string;
  tenant_id: string;
}

const bootstrap: Bootstrap = JSON.parse(
  fs.readFileSync(BOOTSTRAP_PATH, 'utf-8')
);
const edgeBaseUrl = `${bootstrap.edge_url.replace(/\/+$/, '')}/eigent/v1`;

interface SkillUsage {
  activations: number;
  loads: number;
  executions: number;
  last_used_at?: string;
}

const SKILL_NAME = 'warehouse-throughput-audit';
const ENTRYPOINT = 'audit.py';
const TOKEN = 'AUDIT_TOKEN=6d0e5b4c17a92f83';
const TOKEN_VALUE = TOKEN.split('=')[1];

/** Every key=value the final line must carry, asserted one value at a time. */
const EXPECTED = [
  `TOKEN=${TOKEN_VALUE}`,
  'SITE=ndx-274',
  'BACKLOG=760',
  'DAYS=17',
];

const DESCRIPTION =
  'Audits the weekly warehouse dock log: per-site inbound, outbound, backlog and best daily drawdown.';

const PROMPT = [
  `Skill: ${SKILL_NAME}`,
  '',
  'Audits the weekly dock log for every warehouse site. The log is NOT in this',
  `prompt — it ships inside the skill. Execute ${ENTRYPOINT} with run_skill and`,
  'use the aggregates it prints: per site inbound, outbound, backlog (inbound',
  'minus outbound) and best_drain_per_day (the largest single-day net outflow',
  'observed). Never estimate these — the log is too long to eyeball.',
].join('\n');

// pandas does the aggregation on purpose: the pod can only get it from the
// workspace image, so a run that reports the right backlogs proves the image
// carries what the skill declares it needs. The token prints last, after the
// aggregation it depends on.
const SCRIPT = [
  '#!/usr/bin/env python3',
  '"""Warehouse throughput audit. The dock log lives here, not in the prompt."""',
  '',
  'import io',
  '',
  'import pandas as pd',
  '',
  'DOCK_LOG = """site,day,units_in,units_out',
  'ndx-118,mon,1240,900',
  'ndx-118,tue,1310,1000',
  'ndx-118,wed,980,1160',
  'ndx-118,thu,1425,1100',
  'ndx-118,fri,1380,1060',
  'ndx-118,sat,760,905',
  'ndx-118,sun,540,610',
  'ndx-274,mon,890,700',
  'ndx-274,tue,935,720',
  'ndx-274,wed,1020,760',
  'ndx-274,thu,880,905',
  'ndx-274,fri,960,755',
  'ndx-274,sat,610,655',
  'ndx-274,sun,430,470',
  'ndx-395,mon,1580,1100',
  'ndx-395,tue,1640,1130',
  'ndx-395,wed,1490,1610',
  'ndx-395,thu,1720,1200',
  'ndx-395,fri,1660,1180',
  'ndx-395,sat,1130,1290',
  'ndx-395,sun,820,930',
  '"""',
  '',
  'log = pd.read_csv(io.StringIO(DOCK_LOG))',
  'log["net_out"] = log.units_out - log.units_in',
  '',
  'audit = (',
  '    log.groupby("site", as_index=False)',
  '    .agg(',
  '        inbound=("units_in", "sum"),',
  '        outbound=("units_out", "sum"),',
  '        best_drain=("net_out", "max"),',
  '    )',
  '    .assign(backlog=lambda f: f.inbound - f.outbound)',
  '    .sort_values("site")',
  ')',
  '',
  'for row in audit.itertuples(index=False):',
  '    print(',
  '        f"site={row.site} inbound={row.inbound} outbound={row.outbound} "',
  '        f"backlog={row.backlog} best_drain_per_day={row.best_drain}"',
  '    )',
  '',
  `print("${TOKEN}")`,
  '',
].join('\n');

const QUERY = [
  'Warehouse ops needs a backlog plan. Across our sites, which one takes the LONGEST',
  'to clear its accumulated backlog if it sustains its best observed daily drawdown,',
  'and how many whole days is that (round any fraction up)? Use the dock log, not',
  'assumptions. Finish your reply with exactly one line in this form:',
  'ANSWER: TOKEN=<token> SITE=<site> BACKLOG=<units> DAYS=<whole days>',
].join('\n');

/**
 * Lowercase phrases that mean the entrypoint did not run: run_skill's own error
 * when the pod has no interpreter, a shell that found none, an image missing the
 * library the script imports, and the arithmetic-it-myself narration a model
 * produces when it falls back to reading the staged script. Answering correctly
 * this way is still a failure — the skill is what is under test.
 */
const FALLBACK_MARKERS = [
  'interpreter not found',
  'does not provide it',
  'no python3',
  'python3: not found',
  'modulenotfounderror',
  'no module named',
  'exit=127',
];

/** The archive a user would drag onto the Skills screen: one folder, two files. */
function archive(): Buffer {
  const encoder = new TextEncoder();
  const skillMd = `---\nname: ${SKILL_NAME}\ndescription: ${DESCRIPTION}\n---\n\n${PROMPT}\n`;
  return Buffer.from(
    zipSync({
      [`${SKILL_NAME}/SKILL.md`]: encoder.encode(skillMd),
      [`${SKILL_NAME}/${ENTRYPOINT}`]: encoder.encode(SCRIPT),
    })
  );
}

async function edgeFetch(
  suffix: string,
  init: RequestInit = {}
): Promise<Response> {
  return fetch(`${edgeBaseUrl}${suffix}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${bootstrap.api_key}`,
    },
  });
}

async function storedSkill(): Promise<{
  status?: string;
  version?: number;
  usage?: SkillUsage;
  document?: { Files?: Array<{ Path?: string; path?: string }> };
} | null> {
  const response = await edgeFetch(
    `/skills/${encodeURIComponent(SKILL_NAME)}?usage=true`
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`skill read failed: ${response.status}`);
  return response.json();
}

async function usageOf(): Promise<SkillUsage | null> {
  return (await storedSkill())?.usage ?? null;
}

/** Counters are per name and survive delete, so every claim here is a delta. */
function delta(before: SkillUsage | null, after: SkillUsage | null) {
  return {
    loads: (after?.loads ?? 0) - (before?.loads ?? 0),
    executions: (after?.executions ?? 0) - (before?.executions ?? 0),
    activations: (after?.activations ?? 0) - (before?.activations ?? 0),
  };
}

async function awaitCounters(
  before: SkillUsage | null
): Promise<{ usage: SkillUsage | null; moved: ReturnType<typeof delta> }> {
  const deadline = Date.now() + COUNTER_TIMEOUT_MS;
  for (;;) {
    const usage = await usageOf();
    const moved = delta(before, usage);
    if (moved.executions >= 1 && moved.loads >= 1) return { usage, moved };
    if (Date.now() > deadline) return { usage, moved };
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
}

/**
 * The disabled run's counter claim is an absence, so it is watched rather than
 * waited on: any movement at all inside the window is the failure, and the last
 * reading is what gets asserted.
 */
async function counterQuiet(
  before: SkillUsage | null
): Promise<{ usage: SkillUsage | null; moved: ReturnType<typeof delta> }> {
  const deadline = Date.now() + COUNTER_QUIET_MS;
  let last = { usage: before, moved: delta(before, before) };
  for (;;) {
    const usage = await usageOf();
    last = { usage, moved: delta(before, usage) };
    if (last.moved.loads !== 0 || last.moved.executions !== 0) return last;
    if (Date.now() > deadline) return last;
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
}

async function awaitStatus(want: string): Promise<string | undefined> {
  const deadline = Date.now() + STATUS_TIMEOUT_MS;
  for (;;) {
    const status = (await storedSkill())?.status;
    if (status === want || Date.now() > deadline) return status;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

function writeOut(name: string, payload: string): void {
  if (payload.includes(bootstrap.api_key)) {
    throw new Error(`output ${name} would leak the API key`);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, name), payload);
}

async function screenshot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
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
// reclaim focus mid-typing, so typing is verify-and-retry. Multi-line text
// arrives as Shift+Enter between lines because a bare Enter sends.
async function typeIntoComposer(
  page: Page,
  composer: ReturnType<Page['locator']>,
  text: string
): Promise<void> {
  const lines = text.split('\n');
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.keyboard.press('Escape').catch(() => {});
    await composer.click();
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) await page.keyboard.press('Shift+Enter');
      if (lines[i]) await page.keyboard.insertText(lines[i]);
    }
    const got = (await composer.innerText()).replace(/\s+/g, ' ').trim();
    if (got === text.replace(/\s+/g, ' ').trim()) return;
    await composer.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
  }
  throw new Error('composer never captured the full query');
}

const byId = (page: Page, id: string) => page.getByTestId(id);

/** Whole-page text, whitespace-collapsed: answers are asserted on values. */
async function pageText(page: Page): Promise<string> {
  return (await page.locator('body').innerText()).replace(/\s+/g, ' ');
}

async function openSkillsPage(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = '#/history?tab=agents&section=skills';
  });
  await page.reload();
}

/**
 * A fresh Space, so each run builds its own session registry — the enabled run
 * must not be able to inherit a registry from the disabled one, in either
 * direction. The switcher button carries the active space's own name, so it is
 * clicked by id rather than by label.
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
  await composer.waitFor({ state: 'visible', timeout: 30_000 });
  await page
    .getByText('Create a new space', { exact: true })
    .waitFor({ state: 'hidden', timeout: 10_000 })
    .catch(() => {});
  return composer;
}

/**
 * The composer is not editable for as long as the task is busy, so a turn is
 * over when it becomes editable again. Returns false when the turn was still
 * running at the deadline — the caller records that rather than hiding it,
 * because "nothing happened yet" and "nothing will happen" are different
 * claims about a negative control.
 */
async function awaitTurnSettled(
  page: Page,
  timeoutMs: number
): Promise<boolean> {
  const busy = page.locator('[role="textbox"][contenteditable="false"]');
  await busy.first().waitFor({ state: 'attached', timeout: 60_000 }).catch(() => {});
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if ((await busy.count()) === 0) return true;
    if (Date.now() > deadline) return false;
    await page.waitForTimeout(2_000);
  }
}

test(`${SKILL_NAME}: unreachable while disabled, then enabled and executed`, async () => {
  test.setTimeout(ANSWER_TIMEOUT_MS + DISABLED_TIMEOUT_MS + 8 * 60_000);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Start from no such skill: the run must prove its own upload, and a leftover
  // from an earlier run would already be enabled with counters on it.
  const removed = await edgeFetch(`/skills/${encodeURIComponent(SKILL_NAME)}`, {
    method: 'DELETE',
  });
  expect([204, 404]).toContain(removed.status);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-skg-'));
  const keyFile = path.join(workDir, 'edge-api-key');
  fs.writeFileSync(keyFile, bootstrap.api_key, { mode: 0o600 });
  const archivePath = path.join(workDir, `${SKILL_NAME}.zip`);
  fs.writeFileSync(archivePath, archive());

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value;
  }
  delete env.VITE_DEV_SERVER_URL;
  env.EIGENT_E2E_USER_DATA = fs.mkdtempSync(path.join(workDir, 'user-data-'));
  env.EIGENT_REMOTE_BACKEND_URL = edgeBaseUrl;
  env.EIGENT_REMOTE_BACKEND_API_KEY_FILE = keyFile;
  env.EIGENT_REMOTE_BACKEND_API_KEY = '';

  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
    skill: SKILL_NAME,
    entrypoint: ENTRYPOINT,
    query: QUERY,
    expected: EXPECTED,
  };

  const app = await electron.launch({ args: [REPO_ROOT], cwd: REPO_ROOT, env });
  try {
    const page = await findMainWindow(app);
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

    // 1. Upload the archive the way a user does: the Skills screen's add
    //    dialog, through its file picker.
    await openSkillsPage(page);
    await byId(page, 'skills-add').click();
    const picker = page.locator('[role="dialog"] input[type="file"]');
    await picker.waitFor({ state: 'attached', timeout: 30_000 });
    await picker.setInputFiles(archivePath);
    await expect(byId(page, `skill-row-${SKILL_NAME}`)).toBeVisible({
      timeout: 60_000,
    });
    await screenshot(page, '01-uploaded');

    // The store must hold the script, not just the prompt — otherwise there is
    // nothing for the sandbox to stage.
    const stored = await storedSkill();
    const storedFiles = (stored?.document?.Files ?? []).map(
      (f) => f.Path ?? f.path
    );
    expect(storedFiles).toContain(ENTRYPOINT);
    summary.stored_version = stored?.version;
    summary.stored_files = storedFiles;
    summary.status_on_upload = stored?.status;

    // 2. Turn it OFF through the product switch, and confirm the write landed
    //    in the tenant's store — a local-only flip would prove nothing about
    //    what the orchestrator can see.
    const toggle = byId(page, `skill-toggle-${SKILL_NAME}`);
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    summary.status_after_disable = await awaitStatus('disabled');
    await screenshot(page, '02-disabled');
    expect(summary.status_after_disable, 'the switch did not disable the stored skill').toBe(
      'disabled'
    );

    // A brand-new skill has no usage at all, so both runs below are read
    // against a zero baseline.
    const baseline = await usageOf();
    summary.usage_baseline = baseline;

    // 3. The disabled run: same query, and the orchestrator has no such skill.
    const disabledComposer = await newSpace(page);
    await typeIntoComposer(page, disabledComposer, QUERY);
    await disabledComposer.press('Enter');
    const disabledStarted = Date.now();
    summary.disabled_settled = await awaitTurnSettled(page, DISABLED_TIMEOUT_MS);
    summary.disabled_elapsed_ms = Date.now() - disabledStarted;
    await screenshot(page, '03-disabled-answer');
    const disabledTranscript = await pageText(page);
    writeOut('03-disabled-transcript.txt', disabledTranscript);
    const quiet = await counterQuiet(baseline);
    summary.usage_after_disabled_run = quiet.usage;
    summary.disabled_usage_delta = quiet.moved;
    summary.disabled_leaked = EXPECTED.filter((fragment) =>
      disabledTranscript.includes(fragment)
    );

    expect(
      disabledTranscript,
      'a disabled skill produced its token — it was reachable after all'
    ).not.toContain(TOKEN_VALUE);
    expect(
      summary.disabled_leaked,
      'the disabled run produced values only the skill script can compute'
    ).toEqual([]);
    expect(quiet.moved.loads, 'a disabled skill was loaded').toBe(0);
    expect(quiet.moved.executions, 'a disabled skill was executed').toBe(0);

    // 4. Enable it, again through the product switch.
    await openSkillsPage(page);
    const enableToggle = byId(page, `skill-toggle-${SKILL_NAME}`);
    await expect(enableToggle).toHaveAttribute('aria-checked', 'false');
    await enableToggle.click();
    await expect(enableToggle).toHaveAttribute('aria-checked', 'true');
    summary.status_after_enable = await awaitStatus('active');
    await screenshot(page, '04-enabled');
    expect(summary.status_after_enable, 'the switch did not enable the stored skill').toBe(
      'active'
    );

    // 5. The enabled run: the same query, a fresh session, nothing else changed.
    const enabledComposer = await newSpace(page);
    await typeIntoComposer(page, enabledComposer, QUERY);
    await screenshot(page, '05-enabled-composed');
    await enabledComposer.press('Enter');

    const deadline = Date.now() + ANSWER_TIMEOUT_MS;
    let shots = 0;
    let answered = false;
    for (;;) {
      if ((await pageText(page)).includes(TOKEN_VALUE)) {
        answered = true;
        break;
      }
      if (Date.now() > deadline) break;
      if (shots < 8) {
        await screenshot(page, `06-enabled-progress-${shots++}`);
      }
      await page.waitForTimeout(10_000);
    }
    await screenshot(page, '07-enabled-answer');
    const transcript = await pageText(page);
    writeOut('07-enabled-transcript.txt', transcript);
    summary.answered = answered;
    const lowered = transcript.toLowerCase();
    summary.fallback_markers = FALLBACK_MARKERS.filter((m) =>
      lowered.includes(m)
    );

    // 6. The sandbox's own accounting, independent of anything the model said:
    //    executions counts runs that reached the pod and started.
    const { usage, moved } = await awaitCounters(baseline);
    summary.usage_after_enabled_run = usage;
    summary.enabled_usage_delta = moved;

    // 7. And the counters as a user reads them, on the Skills screen.
    await openSkillsPage(page);
    const usageLine = byId(page, `skill-usage-${SKILL_NAME}`);
    await usageLine.waitFor({ state: 'attached', timeout: 60_000 });
    const usageText = (await usageLine.innerText()).replace(/\s+/g, ' ');
    summary.skills_screen_usage = usageText;
    await screenshot(page, '08-usage');

    const modelSubmit = requests.find(
      (r) => r.method === 'POST' && /\/projects$/.test(r.url)
    );
    summary.model_alias = modelSubmit?.body
      ? (JSON.parse(modelSubmit.body) as { model_alias?: string }).model_alias
      : null;
    summary.request_count = requests.length;
    summary.off_edge_requests = requests
      .filter((r) => /^https?:/.test(r.url))
      .filter((r) => !r.url.startsWith(edgeBaseUrl))
      .map((r) => r.url);

    expect(answered, 'the script token never reached the answer').toBe(true);
    for (const fragment of EXPECTED) {
      expect(transcript, `answer is missing ${fragment}`).toContain(fragment);
    }
    expect(
      summary.fallback_markers,
      'the entrypoint did not run — the model worked around the skill'
    ).toEqual([]);
    expect(moved.executions, 'no sandbox execution was counted').toBeGreaterThanOrEqual(1);
    expect(moved.loads, 'the skill prompt was never loaded').toBeGreaterThanOrEqual(1);
    // Not "Never used": the screen must be showing real counters now.
    expect(usageText).toMatch(/Runs: [1-9]/);
    expect(summary.off_edge_requests).toEqual([]);
  } finally {
    writeOut('summary.json', JSON.stringify(summary, null, 2));
    await app.close();
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});
