// Workforce evaluation: one question that no single agent can answer, because two
// of the three skills it needs are invisible to the orchestrator. The REAL desktop
// app in remote-backend mode, the live eigent-local stack, a REAL model, one
// archive uploaded through the Skills screen, scope flipped through the Skills
// screen's own agent-access selector — and the whole run recorded to video.
//
// The scope tag is what forces the fan-out. A stored skill scoped to a workforce
// agent is served to the cell's worker role and withheld from the orchestrator
// chat, so the two regional staffing policies can only be read by a spawned
// worker. The orchestrator can run the shared cost basis itself, but it cannot
// see either policy, cannot search them up, and cannot invent one — so the only
// route to the answer is: run the basis, delegate one worker per region, and
// merge what the workers report.
//
// That asymmetry is also the proof. Each policy prompt carries an unguessable
// token, and a policy token in the final answer can only have arrived through a
// worker's reply. The counters make it concrete: both policies must gain a LOAD
// and gain NO execution (a child gets the skill loader but never run_skill),
// while the global basis skill gains both. The project event stream is read back
// independently for the orchestrator's own tool calls — spawn_subagent must
// appear at least twice, and no `skill` call from the orchestrator may name a
// policy the scope tag hid from it.
//
// The decoy is the base cost: EMEA has the larger cost basis and loses anyway
// once both policies are applied, so an answer that skips a policy names the
// wrong region.
//
// Run: npx playwright test --config e2e/eval.config.ts skills-workforce
// Output: EIGENT_EVAL_DIR (default ../skills-workforce-eval next to the repo).

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
  path.resolve(REPO_ROOT, '..', 'skills-workforce-eval');

// A fan-out turn is the orchestrator's own turns plus two child sessions running
// inside them, so it is longer than a single-agent chain.
const ANSWER_TIMEOUT_MS = 20 * 60_000;
// The usage sink records outside the request path, so counters trail the answer.
const COUNTER_TIMEOUT_MS = 120_000;
// Before asserting an execution counter DID NOT move, give the queue that
// already delivered the loads a further window to deliver anything else.
const COUNTER_SETTLE_MS = 20_000;
// A scope PUT lands a new version; the read-back polls for it.
const SCOPE_TIMEOUT_MS = 60_000;
// Replay of a finished project's events: stop on the first quiet gap, and never
// hold the tail open longer than the cap.
const EVENT_QUIET_MS = 5_000;
const EVENT_READ_MAX_MS = 90_000;
// Recorded at the app's own window size, scaled to this frame.
const VIDEO_SIZE = { width: 1280, height: 800 };
// A recording of a multi-minute run is megabytes; anything tiny is a stub file
// from a window that never painted.
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

interface SkillUsage {
  activations: number;
  loads: number;
  executions: number;
  last_used_at?: string;
}

interface WorkforceSkill {
  name: string;
  /** The `<LABEL>_TOKEN=<value>` line whose value the answer must carry. */
  token: string;
  description: string;
  prompt: string;
  entrypoint: string;
  script: string;
  /**
   * The agent-access selection to make on this skill's row. An empty id leaves
   * the row on "All Agents", which stores no scope tag at all — the cell reads
   * that as every surface.
   */
  scopeAgent: string;
  /** The selector button to click for scopeAgent. */
  scopeLabel: string;
}

/**
 * The shared cost basis: headcount and base monthly cost per region, global so
 * the orchestrator can both load and execute it. pandas aggregates the country
 * lines, which the pod can only satisfy from the workspace image.
 */
const BASIS: WorkforceSkill = {
  name: 'regional-cost-basis',
  token: 'BASIS_TOKEN=7c3e9a41d5b0682f',
  description:
    'Regional cost basis for the rollout review: headcount and base monthly cost in USD per region, before any regional staffing policy is applied.',
  scopeAgent: '',
  scopeLabel: 'All Agents',
  entrypoint: 'basis.py',
  prompt: [
    'Skill: regional-cost-basis',
    '',
    'Headcount and base monthly cost for every region in the rollout. The country',
    'lines are NOT in this prompt — they ship inside the skill. Execute basis.py',
    'with run_skill and use the per-region figures it prints. Never estimate them.',
    '',
    'These are BASE figures only. This skill holds no employer loading, no',
    'allowances and no regional retainers, so the numbers it prints are not the',
    'cost of running a region — a regional staffing policy has to be applied to',
    'them, and this skill does not contain one.',
  ].join('\n'),
  script: [
    '#!/usr/bin/env python3',
    '"""Regional cost basis for the rollout review. Country lines live here."""',
    '',
    'import io',
    '',
    'import pandas as pd',
    '',
    'COUNTRY_LINES = """region,country,headcount,base_monthly_usd_per_head',
    'emea,de,18,9400',
    'emea,pl,16,5200',
    'emea,ie,12,8600',
    'apac,sg,14,8800',
    'apac,jp,15,9100',
    'apac,in,22,3900',
    '"""',
    '',
    'lines = pd.read_csv(io.StringIO(COUNTRY_LINES))',
    'lines["base_monthly_usd"] = lines.headcount * lines.base_monthly_usd_per_head',
    '',
    'basis = (',
    '    lines.groupby("region", as_index=False)',
    '    .agg(headcount=("headcount", "sum"), base_monthly_usd=("base_monthly_usd", "sum"))',
    '    .sort_values("region")',
    ')',
    '',
    'for row in basis.itertuples(index=False):',
    '    print(',
    '        f"region={row.region} headcount={row.headcount} "',
    '        f"base_monthly_usd={row.base_monthly_usd:.2f}"',
    '    )',
    '',
    'print("BASIS_TOKEN=7c3e9a41d5b0682f")',
    '',
  ].join('\n'),
};

/**
 * EMEA's staffing policy, scoped away from the orchestrator. The formula lives in
 * the PROMPT because a child's skill load is prompt-only: stage-on-load rides the
 * same owner-only posture as run_skill, so a worker never gets the files. The
 * script ships anyway, as the thing that must stay unexecuted.
 */
const EMEA: WorkforceSkill = {
  name: 'emea-staffing-policy',
  token: 'EMEA_TOKEN=d41c8f60ba537e29',
  description:
    'EMEA staffing policy: the employer loading, per-head allowance and compliance retainer that turn an EMEA base monthly cost into a fully loaded one.',
  scopeAgent: 'developer_agent',
  scopeLabel: 'Developer Agent',
  entrypoint: 'policy.py',
  prompt: [
    'Skill: emea-staffing-policy',
    '',
    'The EMEA staffing policy. It covers EMEA and no other region, and it holds no',
    'headcount and no base cost of its own — apply it to the figures you were',
    'given.',
    '',
    'fully_loaded_monthly_usd =',
    '      base_monthly_usd * 1.2150   (EMEA employer loading)',
    '    + headcount * 210             (per-head monthly allowance, USD)',
    '    + 18500                       (EMEA compliance retainer, USD per month)',
    '',
    'Report the fully loaded monthly cost you computed back to whoever delegated',
    'the task, together with this token, verbatim: EMEA_TOKEN=d41c8f60ba537e29',
  ].join('\n'),
  script: [
    '#!/usr/bin/env python3',
    '"""EMEA staffing policy, as data. Nothing in this run may execute it."""',
    '',
    'print("region=emea employer_loading=1.2150 allowance_per_head_usd=210 retainer_usd=18500")',
    'print("EMEA_TOKEN=d41c8f60ba537e29")',
    '',
  ].join('\n'),
};

/** APAC's staffing policy, scoped to a different workforce agent. */
const APAC: WorkforceSkill = {
  name: 'apac-staffing-policy',
  token: 'APAC_TOKEN=5b90e2a7c1f4368d',
  description:
    'APAC staffing policy: the employer loading, per-head allowance and compliance retainer that turn an APAC base monthly cost into a fully loaded one.',
  scopeAgent: 'document_agent',
  scopeLabel: 'Document Agent',
  entrypoint: 'policy.py',
  prompt: [
    'Skill: apac-staffing-policy',
    '',
    'The APAC staffing policy. It covers APAC and no other region, and it holds no',
    'headcount and no base cost of its own — apply it to the figures you were',
    'given.',
    '',
    'fully_loaded_monthly_usd =',
    '      base_monthly_usd * 1.3075   (APAC employer loading)',
    '    + headcount * 340             (per-head monthly allowance, USD)',
    '    + 27750                       (APAC compliance retainer, USD per month)',
    '',
    'Report the fully loaded monthly cost you computed back to whoever delegated',
    'the task, together with this token, verbatim: APAC_TOKEN=5b90e2a7c1f4368d',
  ].join('\n'),
  script: [
    '#!/usr/bin/env python3',
    '"""APAC staffing policy, as data. Nothing in this run may execute it."""',
    '',
    'print("region=apac employer_loading=1.3075 allowance_per_head_usd=340 retainer_usd=27750")',
    'print("APAC_TOKEN=5b90e2a7c1f4368d")',
    '',
  ].join('\n'),
};

const SKILLS = [BASIS, EMEA, APAC];
/** The two the orchestrator must never see, and must delegate to reach. */
const WORKER_SKILLS = [EMEA, APAC];
const tokenValue = (skill: WorkforceSkill) => skill.token.split('=')[1];

/**
 * APAC wins at a 36617 USD gap:
 *   emea  355600.00 × 1.2150 = 432054.00 + 46×210 =  9660 + 18500 = 460214.00
 *   apac  345500.00 × 1.3075 = 451741.25 + 51×340 = 17340 + 27750 = 496831.25
 * EMEA is the decoy: it has the LARGER base cost (355600 vs 345500) and still
 * loses, so an answer that skips a policy names the wrong region.
 */
const EXPECTED = [
  `BASIS=${tokenValue(BASIS)}`,
  `EMEA=${tokenValue(EMEA)}`,
  `APAC=${tokenValue(APAC)}`,
  'REGION=apac',
  'GAP=36617',
];

const QUERY = [
  'Q4 rollout review, two regions in scope: emea and apac. Which region has the',
  'HIGHER fully loaded monthly cost, and what is the gap between the two in USD?',
  '',
  'You cannot answer this alone. The regional cost basis is a skill you can run',
  'yourself. The two staffing policies are NOT in your own catalog — they belong',
  'to your worker agents, one policy per region:',
  '  emea-staffing-policy',
  '  apac-staffing-policy',
  '',
  'Work it this way:',
  '1. Run the regional cost basis skill and note each region headcount and base',
  '   monthly cost in USD.',
  '2. Delegate one worker agent per region — two workers, one for emea and one',
  '   for apac. Give each worker its region name, its headcount and its base',
  '   monthly cost, and tell it to load the policy skill named above for that',
  '   region and apply that policy to the figures you gave it. Require each',
  '   worker to report back the fully loaded monthly cost AND the policy token,',
  '   verbatim.',
  '3. Do not compute a loaded cost yourself and do not guess a policy: only the',
  '   worker that can read the policy may supply it.',
  '',
  'Finish your reply with exactly one line in this form:',
  'ANSWER: BASIS=<basis token> EMEA=<emea token> APAC=<apac token> REGION=<region> GAP=<gap>',
  'Report GAP in whole US dollars, rounded to the nearest dollar: digits only, no',
  'currency symbol, no thousands separators, no decimals.',
].join('\n');

/**
 * Lowercase phrases that mean an entrypoint did not run: run_skill's own error
 * when the pod has no interpreter, a shell that found none, an image missing the
 * library a script imports, and the arithmetic-it-myself narration a model
 * produces when it falls back to reading a staged script. Answering correctly
 * that way is still a failure — the skills are what is under test.
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

/**
 * Lowercase phrases that mean the run died on the environment rather than on the
 * skills: a real provider under load returns 429, and the turn ends mid-fan-out
 * with whatever the orchestrator had. Reported as its own signal and asserted
 * before the answer, so a capacity failure reads as one instead of arriving as
 * "the answer is missing a token".
 */
const RUN_FAILURE_MARKERS = [
  'run failed:',
  'provider capacity exhausted',
  'http 429',
  'currently overloaded',
];

/** One archive, three skill folders — the importer PUTs each in turn. */
function archive(): Buffer {
  const encoder = new TextEncoder();
  const entries: Record<string, Uint8Array> = {};
  for (const skill of SKILLS) {
    const skillMd = `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n${skill.prompt}\n`;
    entries[`${skill.name}/SKILL.md`] = encoder.encode(skillMd);
    entries[`${skill.name}/${skill.entrypoint}`] = encoder.encode(skill.script);
  }
  return Buffer.from(zipSync(entries));
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

interface StoredSkill {
  status?: string;
  version?: number;
  usage?: SkillUsage;
  document?: {
    Files?: Array<{ Path?: string; path?: string }>;
    Metadata?: Record<string, string> | null;
  };
}

async function storedSkill(name: string): Promise<StoredSkill | null> {
  const response = await edgeFetch(
    `/skills/${encodeURIComponent(name)}?usage=true`
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`skill read failed: ${response.status}`);
  return response.json();
}

const storedScope = (row: StoredSkill | null) =>
  row?.document?.Metadata?.scope ?? '';

const storedFiles = (row: StoredSkill | null) =>
  (row?.document?.Files ?? []).map((f) => f.Path ?? f.path ?? '');

/** Counters are per name and survive delete, so every claim here is a delta. */
function delta(before: SkillUsage | null, after: SkillUsage | null) {
  return {
    loads: (after?.loads ?? 0) - (before?.loads ?? 0),
    executions: (after?.executions ?? 0) - (before?.executions ?? 0),
    activations: (after?.activations ?? 0) - (before?.activations ?? 0),
  };
}

type UsageMap = Record<string, SkillUsage | null>;

async function usageOfAll(): Promise<UsageMap> {
  const map: UsageMap = {};
  for (const skill of SKILLS) {
    map[skill.name] = (await storedSkill(skill.name))?.usage ?? null;
  }
  return map;
}

function deltas(before: UsageMap, after: UsageMap) {
  const moved: Record<string, ReturnType<typeof delta>> = {};
  for (const skill of SKILLS) {
    moved[skill.name] = delta(before[skill.name], after[skill.name]);
  }
  return moved;
}

/**
 * Waits for the movement this run claims: the basis loaded AND executed, both
 * policies loaded. Then waits out a further settle window before returning, so
 * the two execution counters that must read zero are asserted against a queue
 * that has been given the chance to deliver more than the loads it already did.
 * A partial result is returned at the deadline rather than thrown, so the
 * assertions below can name which skill fell short.
 */
async function awaitCounters(
  before: UsageMap
): Promise<{ usage: UsageMap; moved: ReturnType<typeof deltas> }> {
  const deadline = Date.now() + COUNTER_TIMEOUT_MS;
  for (;;) {
    const moved = deltas(before, await usageOfAll());
    const complete =
      moved[BASIS.name].loads >= 1 &&
      moved[BASIS.name].executions >= 1 &&
      WORKER_SKILLS.every((s) => moved[s.name].loads >= 1);
    if (complete || Date.now() > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  await new Promise((resolve) => setTimeout(resolve, COUNTER_SETTLE_MS));
  const usage = await usageOfAll();
  return { usage, moved: deltas(before, usage) };
}

interface ProjectEvent {
  kind: string;
  sequence: string;
  data?: Record<string, unknown>;
}

/**
 * Replays a finished project's events from the edge, independently of anything
 * the desktop rendered. Only the ORCHESTRATOR's own tool calls land here — a
 * child runs as its own session and is not projected onto the Project — which is
 * exactly what makes this the right place to look for the spawns, and for the
 * absence of any orchestrator load of a worker-scoped skill.
 */
async function projectEvents(projectId: string): Promise<ProjectEvent[]> {
  const events: ProjectEvent[] = [];
  const controller = new AbortController();
  const hardStop = setTimeout(() => controller.abort(), EVENT_READ_MAX_MS);
  let quiet: ReturnType<typeof setTimeout> | undefined;
  const bumpQuiet = () => {
    if (quiet) clearTimeout(quiet);
    quiet = setTimeout(() => controller.abort(), EVENT_QUIET_MS);
  };
  try {
    const response = await edgeFetch(
      `/projects/${encodeURIComponent(projectId)}/events?after=0`,
      { signal: controller.signal }
    );
    if (!response.ok || !response.body) {
      throw new Error(`event replay failed: ${response.status}`);
    }
    bumpQuiet();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      bumpQuiet();
      for (;;) {
        const cut = buffer.indexOf('\n\n');
        if (cut < 0) break;
        const frame = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          try {
            events.push(JSON.parse(line.slice(5).trim()) as ProjectEvent);
          } catch {
            // A partial frame is a read artefact, not a contract violation.
          }
        }
      }
    }
  } catch (error) {
    // An abort is how a replay ends here: the stream is a live tail with no
    // end-of-replay marker, so quiet is the signal.
    if (!controller.signal.aborted) throw error;
  } finally {
    clearTimeout(hardStop);
    if (quiet) clearTimeout(quiet);
  }
  return events;
}

const toolCalls = (events: ProjectEvent[]) =>
  events
    .filter((e) => e.kind === 'tool_call')
    .map((e) => ({
      name: String(e.data?.tool_name ?? ''),
      args: String(e.data?.arguments_json ?? ''),
    }));

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
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

/**
 * Thousands separators removed, because a model may well write 36,617 and the
 * assertion is about the value. Kept apart from the transcript that gets written
 * out, which stays as the screen actually read.
 */
const forValues = (text: string) => text.replace(/,/g, '');

async function openSkillsPage(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = '#/history?tab=agents&section=skills';
  });
  await page.reload();
}

// The agent-access chips render selection as an opacity class. Anchored so the
// base `hover:opacity-100` never matches.
const SELECTED_ON = /(^|\s)opacity-100(\s|$)/;
const SELECTED_OFF = /(^|\s)opacity-(60|50)(\s|$)/;

/**
 * Restricts one skill to one workforce agent the way a user does: open the row's
 * agent-access section, drop "All Agents", then pick the agent. Dropping the
 * global selection first matters — clicking an agent while "All Agents" is on
 * means "every agent EXCEPT this one", which would leave the orchestrator in
 * scope.
 */
async function scopeToAgent(page: Page, skill: WorkforceSkill): Promise<void> {
  const row = byId(page, `skill-row-${skill.name}`);
  // Wait on the panel rather than on the click: the chips below are unfindable
  // until it is open, and a missing chip reads as a scoping failure.
  const panel = byId(page, `skill-scope-${skill.name}`);
  await expect(async () => {
    if (!(await panel.isVisible())) {
      await row.getByRole('button', { name: 'Select agent access' }).click();
    }
    await expect(panel).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  const allAgents = row.getByRole('button', {
    name: 'All Agents',
    exact: true,
  });
  const agent = row.getByRole('button', {
    name: skill.scopeLabel,
    exact: true,
  });
  await allAgents.click();
  // Selection is carried by the opacity class, and the next click branches on it:
  // clicking an agent while "All Agents" is still on means "every agent EXCEPT
  // this one", which would leave the orchestrator in scope. So wait for the
  // deselect to render before picking the agent.
  await expect(allAgents).toHaveClass(SELECTED_OFF);
  await agent.click();
  await expect(agent).toHaveClass(SELECTED_ON);
  const deadline = Date.now() + SCOPE_TIMEOUT_MS;
  for (;;) {
    if (storedScope(await storedSkill(skill.name)) === skill.scopeAgent) return;
    if (Date.now() > deadline) {
      throw new Error(
        `${skill.name} scope never became ${skill.scopeAgent} (stored ${storedScope(
          await storedSkill(skill.name)
        )})`
      );
    }
    await page.waitForTimeout(1_000);
  }
}

/**
 * A fresh Space, so the run builds its own session registry — with the scope tags
 * now in place. The switcher button carries the active space's own name, so it is
 * clicked by id rather than by label.
 */
async function newSpace(page: Page): Promise<ReturnType<Page['locator']>> {
  await page.evaluate(() => {
    window.location.hash = '#/';
  });
  await page.reload();
  await page.locator('#active-space-title-btn').click();
  await page.getByText('Create a new space', { exact: true }).first().click();
  await page.getByText('Start from scratch', { exact: true }).first().click();
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
 * The composer is not editable while the task is busy, so the turn is over when
 * it becomes editable again. Screenshots along the way are the only record of a
 * fan-out in flight. Returns false when the turn was still running at the
 * deadline, which the caller records rather than hides.
 */
async function awaitTurnSettled(page: Page): Promise<boolean> {
  const busy = page.locator('[role="textbox"][contenteditable="false"]');
  await busy
    .first()
    .waitFor({ state: 'attached', timeout: 60_000 })
    .catch(() => {});
  const deadline = Date.now() + ANSWER_TIMEOUT_MS;
  let shots = 0;
  for (;;) {
    if ((await busy.count()) === 0) return true;
    if (Date.now() > deadline) return false;
    if (shots < 10) await screenshot(page, `04-progress-${shots++}`);
    await page.waitForTimeout(20_000);
  }
}

test('one question, two spawned workers, and skills only they can read', async () => {
  test.setTimeout(ANSWER_TIMEOUT_MS + 12 * 60_000);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Start from no such skills: the run must prove its own upload, and leftovers
  // from an earlier run would already carry counters and a scope tag.
  for (const skill of SKILLS) {
    const removed = await edgeFetch(
      `/skills/${encodeURIComponent(skill.name)}`,
      { method: 'DELETE' }
    );
    expect([204, 404]).toContain(removed.status);
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-skw-'));
  const keyFile = path.join(workDir, 'edge-api-key');
  fs.writeFileSync(keyFile, bootstrap.api_key, { mode: 0o600 });
  const archivePath = path.join(workDir, 'rollout-review-skills.zip');
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

  const videoDir = path.join(OUT_DIR, 'video');
  fs.rmSync(videoDir, { recursive: true, force: true });

  const summary: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    edge_base_url: edgeBaseUrl,
    skills: SKILLS.map((s) => ({
      name: s.name,
      entrypoint: s.entrypoint,
      scope: s.scopeAgent || 'global',
    })),
    query: QUERY,
    expected: EXPECTED,
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

    // 1. Upload the archive the way a user does: the Skills screen's add dialog,
    //    through its file picker. One archive, three skills, all global.
    await openSkillsPage(page);
    await byId(page, 'skills-add').click();
    const picker = page.locator('[role="dialog"] input[type="file"]');
    await picker.waitFor({ state: 'attached', timeout: 30_000 });
    await picker.setInputFiles(archivePath);
    for (const skill of SKILLS) {
      await expect(byId(page, `skill-row-${skill.name}`)).toBeVisible({
        timeout: 60_000,
      });
    }
    await screenshot(page, '01-uploaded');

    // The store must hold each script, not just each prompt, and all three must
    // be ACTIVE — this run is about scope, not about the enable gate.
    for (const skill of SKILLS) {
      const row = await storedSkill(skill.name);
      expect(
        storedFiles(row),
        `${skill.name} stored without its entrypoint`
      ).toContain(skill.entrypoint);
      expect(row?.status, `${skill.name} is not active`).toBe('active');
      expect(
        storedScope(row),
        `${skill.name} arrived from the archive already scoped`
      ).toBe('');
      await expect(byId(page, `skill-toggle-${skill.name}`)).toHaveAttribute(
        'aria-checked',
        'true'
      );
    }

    // 2. Restrict the two policies to workforce agents, through the row's own
    //    agent-access selector. This is the step that hides them from the
    //    orchestrator chat and hands them to the worker role.
    for (const skill of WORKER_SKILLS) {
      await scopeToAgent(page, skill);
    }
    await screenshot(page, '02-scoped');

    const stored: Record<string, unknown> = {};
    for (const skill of SKILLS) {
      const row = await storedSkill(skill.name);
      stored[skill.name] = {
        version: row?.version,
        status: row?.status,
        scope: storedScope(row),
        files: storedFiles(row),
      };
      // A scope PUT rewrites the document, and a policy with its files dropped
      // would make the unexecuted-script claim vacuous.
      expect(
        storedFiles(row),
        `${skill.name} lost its entrypoint when scoped`
      ).toContain(skill.entrypoint);
    }
    summary.stored = stored;

    // Brand-new skills have no usage at all, so the run reads against zero.
    const baseline = await usageOfAll();
    summary.usage_baseline = baseline;

    // 3. One query, one fresh Space. The orchestrator is told the policies are
    //    its workers' and that it must delegate — it cannot see them to check.
    const composer = await newSpace(page);
    await typeIntoComposer(page, composer, QUERY);
    await screenshot(page, '03-composed');
    await composer.press('Enter');
    const started = Date.now();

    const settled = await awaitTurnSettled(page);
    summary.answer_elapsed_ms = Date.now() - started;
    summary.turn_settled = settled;
    await screenshot(page, '05-answer');
    const transcript = await pageText(page);
    writeOut('05-transcript.txt', transcript);
    const values = forValues(transcript);
    const lowered = transcript.toLowerCase();
    summary.fallback_markers = FALLBACK_MARKERS.filter((m) =>
      lowered.includes(m)
    );
    summary.run_failure_markers = RUN_FAILURE_MARKERS.filter((m) =>
      lowered.includes(m)
    );
    summary.tokens_seen = SKILLS.filter((s) =>
      values.includes(tokenValue(s))
    ).map((s) => s.name);
    summary.missing_expected = EXPECTED.filter(
      (fragment) => !values.includes(fragment)
    );

    // 4. The orchestrator's own tool calls, read back from the edge rather than
    //    from the screen: the spawns that fanned the work out, and the skills it
    //    named — which must never include a policy.
    // Read the id off the command submission rather than the first project URL
    // the app touched: a Space that was never asked anything also has a project.
    const projectId = requests
      .filter((r) => r.method === 'POST')
      .map((r) => /\/projects\/([^/?]+)\/commands/.exec(r.url)?.[1])
      .filter((id): id is string => Boolean(id))
      .pop();
    expect(
      projectId,
      'no submitted command in the app own requests'
    ).toBeTruthy();
    const events = await projectEvents(projectId!);
    const calls = toolCalls(events);
    const spawns = calls
      .filter((c) => c.name === 'spawn_subagent')
      .map((c) => {
        const args = parseArgs(c.args);
        return {
          role: String(args.role ?? ''),
          name: String(args.name ?? ''),
          profile: String(args.profile ?? ''),
          prompt: String(args.prompt ?? '').slice(0, 400),
        };
      });
    const skillLoads = calls
      .filter((c) => c.name === 'skill')
      .map((c) => String(parseArgs(c.args).name ?? ''))
      .filter(Boolean);
    summary.project_id = projectId;
    summary.event_count = events.length;
    summary.orchestrator_tool_calls = calls.reduce<Record<string, number>>(
      (acc, c) => ({ ...acc, [c.name]: (acc[c.name] ?? 0) + 1 }),
      {}
    );
    summary.spawns = spawns;
    summary.orchestrator_skill_loads = skillLoads;
    writeOut(
      '06-tool-calls.json',
      JSON.stringify(
        calls.map((c) => ({ name: c.name, args: c.args.slice(0, 2_000) })),
        null,
        2
      )
    );

    // 5. The tenant's own accounting: the basis loaded and executed by the
    //    orchestrator, each policy loaded by a worker and executed by nobody.
    const { usage, moved } = await awaitCounters(baseline);
    summary.usage_after_run = usage;
    summary.usage_delta = moved;

    // 6. And the counters as a user reads them, on the Skills screen.
    await openSkillsPage(page);
    const screenUsage: Record<string, string> = {};
    for (const skill of SKILLS) {
      const usageLine = byId(page, `skill-usage-${skill.name}`);
      await usageLine.waitFor({ state: 'attached', timeout: 60_000 });
      screenUsage[skill.name] = (await usageLine.innerText()).replace(
        /\s+/g,
        ' '
      );
    }
    summary.skills_screen_usage = screenUsage;
    await screenshot(page, '07-usage');

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

    expect(settled, 'the turn never finished').toBe(true);
    expect(
      summary.run_failure_markers,
      'the run aborted on the environment (provider capacity), not on the skills — re-run'
    ).toEqual([]);
    for (const fragment of EXPECTED) {
      expect(values, `answer is missing ${fragment}`).toContain(fragment);
    }
    expect(
      summary.fallback_markers,
      'an entrypoint did not run — the model worked around a skill'
    ).toEqual([]);

    // The work was fanned out, to the cell's worker role.
    expect(
      spawns.length,
      'the orchestrator answered without delegating to workers'
    ).toBeGreaterThanOrEqual(2);
    // The cell declares exactly one roster entry, and the roster gate rejects any
    // other selector — so an on-roster profile on every spawn is what proves the
    // fan-out reached the worker role rather than being refused before dispatch.
    for (const spawn of spawns) {
      expect(
        spawn.profile,
        `a spawn named profile "${spawn.profile}", which is off the cell roster`
      ).toBe('eigent-worker');
    }

    // The basis is the orchestrator's own: loaded and executed.
    expect(
      moved[BASIS.name].loads,
      'the cost basis prompt was never loaded'
    ).toBeGreaterThanOrEqual(1);
    expect(
      moved[BASIS.name].executions,
      'the cost basis never reached the sandbox'
    ).toBeGreaterThanOrEqual(1);
    expect(screenUsage[BASIS.name]).toMatch(/Runs: [1-9]/);

    // The policies are the workers': loaded, never executed, and never named by
    // the orchestrator — so a policy token in the answer came back from a child.
    for (const skill of WORKER_SKILLS) {
      expect(
        moved[skill.name].loads,
        `${skill.name} was never loaded — no worker read the policy`
      ).toBeGreaterThanOrEqual(1);
      expect(
        moved[skill.name].executions,
        `${skill.name} was executed — a child reached run_skill`
      ).toBe(0);
      expect(
        skillLoads,
        `the orchestrator loaded ${skill.name} itself — the scope tag did not hide it`
      ).not.toContain(skill.name);
      expect(screenUsage[skill.name]).toMatch(/Loaded: [1-9]/);
      expect(screenUsage[skill.name]).toMatch(/Runs: 0/);
    }

    expect(summary.off_edge_requests).toEqual([]);
  } catch (error) {
    bodyFailed = true;
    throw error;
  } finally {
    // The recording is only flushed to disk when the app closes, so the video is
    // resolved after teardown and before the summary that reports it.
    await app.close();
    let videoBytes = 0;
    let videoName: string | null = null;
    const recorded = await video?.path().catch(() => undefined);
    if (recorded && fs.existsSync(recorded)) {
      videoName = 'workforce-run.webm';
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
