// Multi-skill evaluation: one question, three skills, and no single one of them
// can answer it. The REAL desktop app in remote-backend mode, the live
// eigent-local stack, a REAL model, one archive uploaded through the Skills
// screen, one query in one fresh Space — and the whole run recorded to video.
//
// The chain is the point. The ledger skill knows what each depot shipped and in
// which currency, but no exchange rate. The rate book converts currencies, but
// has never heard of a depot. The band schedule prices duty off a USD value it
// cannot compute. A landed-cost ranking therefore needs all three executed and
// their outputs carried between them, which is work only the orchestrator can
// do — the skills never see each other.
//
// Every skill prints its own unguessable token, so the answer line names which
// ones were actually reached. A token alone is weak evidence (a staged script is
// readable in the pod, so the model could transcribe one without running it), so
// the load-bearing assertion is per-skill: the tenant's usage counters must move
// by at least one load AND one execution for EACH of the three. The
// fallback-marker scan catches the read-it-myself path a model reaches for when
// an entrypoint will not start.
//
// The final number is decoy-resistant on purpose: the depot with the most units
// and the largest local-currency subtotal is NOT the winner, so an answer that
// skips the conversion picks the wrong depot.
//
// Run: npx playwright test --config e2e/eval.config.ts skills-chain
// Output: EIGENT_EVAL_DIR (default ../skills-chain-eval next to the repo).

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
  path.resolve(REPO_ROOT, '..', 'skills-chain-eval');

// Three catalog searches, three prompt loads, three pod executions and the
// arithmetic that joins them — a longer turn than a single-skill run.
const ANSWER_TIMEOUT_MS = 15 * 60_000;
// The usage sink records outside the request path, so counters trail the answer.
const COUNTER_TIMEOUT_MS = 120_000;
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

interface ChainSkill {
  name: string;
  entrypoint: string;
  /** The line the script prints; its value is what the answer must carry. */
  token: string;
  description: string;
  prompt: string;
  script: string;
}

/**
 * Ledger: what each depot shipped, priced in the depot's own currency. pandas
 * aggregates the line items, which the pod can only satisfy from the workspace
 * image — a bare-Python image fails this on import.
 */
const LEDGER: ChainSkill = {
  name: 'depot-shipment-ledger',
  entrypoint: 'ledger.py',
  token: 'LEDGER_TOKEN=4b7fd9e21c60a835',
  description:
    'Q3 depot shipment ledger: per-depot units and shipment subtotal in the depot local currency — the local-currency input to a landed-cost calculation.',
  prompt: [
    'Skill: depot-shipment-ledger',
    '',
    'The Q3 shipment line items for every depot. They are NOT in this prompt —',
    'they ship inside the skill. Execute ledger.py with run_skill and use the',
    'per-depot units and subtotal it prints. Never estimate them.',
    '',
    'This skill carries line items ONLY. It holds no exchange rates and no duty',
    'rates, and every subtotal it prints is in that depot own currency, so the',
    'figures are not comparable across depots until something else converts them.',
  ].join('\n'),
  script: [
    '#!/usr/bin/env python3',
    '"""Q3 depot shipment ledger. The line items live here, not in the prompt."""',
    '',
    'import io',
    '',
    'import pandas as pd',
    '',
    'LINE_ITEMS = """depot,sku,units,unit_price_local,currency',
    'dpt-317,eu-4410,4100,45.00,EUR',
    'dpt-317,eu-4418,5300,40.00,EUR',
    'dpt-317,eu-4425,3000,29.50,EUR',
    'dpt-482,gb-8801,3250,60.00,GBP',
    'dpt-482,gb-8809,4100,55.00,GBP',
    'dpt-482,gb-8814,2500,36.60,GBP',
    'dpt-905,jp-2203,6200,4100,JPY',
    'dpt-905,jp-2210,5000,3800,JPY',
    'dpt-905,jp-2217,4000,4745,JPY',
    '"""',
    '',
    'items = pd.read_csv(io.StringIO(LINE_ITEMS))',
    'items["line_local"] = items.units * items.unit_price_local',
    '',
    'ledger = (',
    '    items.groupby(["depot", "currency"], as_index=False)',
    '    .agg(units=("units", "sum"), subtotal_local=("line_local", "sum"))',
    '    .sort_values("depot")',
    ')',
    '',
    'for row in ledger.itertuples(index=False):',
    '    print(',
    '        f"depot={row.depot} currency={row.currency} units={row.units} "',
    '        f"subtotal_local={row.subtotal_local:.2f}"',
    '    )',
    '',
    'print("LEDGER_TOKEN=4b7fd9e21c60a835")',
    '',
  ].join('\n'),
};

/** Rate book: converts currencies, and has never heard of a depot. */
const RATES: ChainSkill = {
  name: 'fx-quarter-ratebook',
  entrypoint: 'rates.sh',
  token: 'FX_TOKEN=e08c1a5f7b34d962',
  description:
    'Quarter-close FX rate book: USD per unit of each shipping currency, for converting local-currency subtotals to USD before duty is applied.',
  prompt: [
    'Skill: fx-quarter-ratebook',
    '',
    'The quarter-close exchange rates. Execute rates.sh with run_skill and use',
    'the usd_per_local_unit figure it prints for each currency — multiply a',
    'local-currency amount by it to get USD. Do not use rates from memory; the',
    'quarter-close book is the only one that applies here.',
    '',
    'This skill knows nothing about depots, shipments or duty. It converts',
    'currency and stops there.',
  ].join('\n'),
  script: [
    '#!/bin/sh',
    '# Quarter-close FX rate book. The rates live here, not in the prompt.',
    'set -eu',
    '',
    'RATES="EUR 1.0840',
    'GBP 1.2675',
    'JPY 0.006420"',
    '',
    'echo "$RATES" | awk \'{ printf "currency=%s usd_per_local_unit=%s local_units_per_usd=%.6f\\n", $1, $2, 1 / $2 }\'',
    '',
    'echo "FX_TOKEN=e08c1a5f7b34d962"',
    '',
  ].join('\n'),
};

/** Band schedule: prices duty off a USD value it cannot compute itself. */
const BANDS: ChainSkill = {
  name: 'tariff-band-schedule',
  entrypoint: 'bands.py',
  token: 'TARIFF_TOKEN=91af62d7c4e0b538',
  description:
    'Import duty band schedule: the duty percentage a shipment pays according to the USD-converted value band it falls into.',
  prompt: [
    'Skill: tariff-band-schedule',
    '',
    'The import duty bands. Execute bands.py with run_skill and apply the band',
    'whose range contains the shipment value. The bands are stated in USD and',
    'apply to the value AFTER conversion — applying one to a local-currency',
    'amount gives a meaningless number.',
    '',
    'This skill holds rates only. It has no shipment values and no exchange',
    'rates, so the band can only be chosen once something else supplies the USD',
    'value.',
  ].join('\n'),
  script: [
    '#!/usr/bin/env python3',
    '"""Import-duty band schedule. Bands apply to the USD-converted subtotal."""',
    '',
    'BANDS = (',
    '    (0.0, 450000.0, 3.5),',
    '    (450000.0, 600000.0, 6.25),',
    '    (600000.0, None, 11.0),',
    ')',
    '',
    'print("rule=duty applies to the subtotal AFTER conversion to USD; lower bound exclusive")',
    '',
    'for low, high, pct in BANDS:',
    '    ceiling = "none" if high is None else f"{high:.2f}"',
    '    print(f"band_over_usd={low:.2f} band_upto_usd={ceiling} duty_pct={pct}")',
    '',
    'print("TARIFF_TOKEN=91af62d7c4e0b538")',
    '',
  ].join('\n'),
};

const SKILLS = [LEDGER, RATES, BANDS];
const tokenValue = (skill: ChainSkill) => skill.token.split('=')[1];

/**
 * The winner is dpt-482 at 720346 USD:
 *   dpt-317  485000.00 EUR × 1.0840 = 525740.00 → 6.25% → 558598.75
 *   dpt-482  512000.00 GBP × 1.2675 = 648960.00 → 11.0% → 720345.60
 *   dpt-905  63400000  JPY × 0.006420 = 407028.00 → 3.5% → 421273.98
 * Note which depot the decoys point at: dpt-905 ships the most units and has by
 * far the largest local-currency subtotal, and it comes last once converted.
 */
const EXPECTED = [
  `LEDGER=${tokenValue(LEDGER)}`,
  `FX=${tokenValue(RATES)}`,
  `TARIFF=${tokenValue(BANDS)}`,
  'DEPOT=dpt-482',
  'LANDED=720346',
];

const QUERY = [
  'Finance needs the Q3 landed-cost ranking. Which depot has the HIGHEST landed',
  'cost in USD, where landed cost is that depot shipment subtotal converted to',
  'USD at the quarter-close rate, plus the import duty for the band its converted',
  'value falls into? Every input lives in a skill you already have — the shipment',
  'ledger, the exchange-rate book and the duty band schedule. Run them and use',
  'what they print; do not estimate any figure and do not use rates from memory.',
  'Finish your reply with exactly one line in this form:',
  'ANSWER: LEDGER=<ledger token> FX=<fx token> TARIFF=<tariff token> DEPOT=<depot> LANDED=<landed cost>',
  'Report LANDED in whole US dollars, rounded to the nearest dollar: digits only,',
  'no currency symbol, no thousands separators, no decimals.',
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

async function storedSkill(name: string): Promise<{
  status?: string;
  version?: number;
  usage?: SkillUsage;
  document?: { Files?: Array<{ Path?: string; path?: string }> };
} | null> {
  const response = await edgeFetch(
    `/skills/${encodeURIComponent(name)}?usage=true`
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`skill read failed: ${response.status}`);
  return response.json();
}

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
 * Waits until EVERY skill in the chain has been both loaded and executed at
 * least once. A partial result is returned at the deadline rather than thrown,
 * so the assertions below can name which skill fell short.
 */
async function awaitCounters(
  before: UsageMap
): Promise<{ usage: UsageMap; moved: ReturnType<typeof deltas> }> {
  const deadline = Date.now() + COUNTER_TIMEOUT_MS;
  for (;;) {
    const usage = await usageOfAll();
    const moved = deltas(before, usage);
    const complete = SKILLS.every(
      (s) => moved[s.name].loads >= 1 && moved[s.name].executions >= 1
    );
    if (complete) return { usage, moved };
    if (Date.now() > deadline) return { usage, moved };
    await new Promise((resolve) => setTimeout(resolve, 3_000));
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
 * Thousands separators removed, because a model may well write 720,346 and the
 * assertion is about the value. Kept apart from the transcript that gets
 * written out, which stays as the screen actually read.
 */
const forValues = (text: string) => text.replace(/,/g, '');

async function openSkillsPage(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = '#/history?tab=agents&section=skills';
  });
  await page.reload();
}

/**
 * A fresh Space, so the run builds its own session registry with all three
 * skills in it. The switcher button carries the active space's own name, so it
 * is clicked by id rather than by label.
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

test('one question, three chained skills, executed through the UI', async () => {
  test.setTimeout(ANSWER_TIMEOUT_MS + 10 * 60_000);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Start from no such skills: the run must prove its own upload, and leftovers
  // from an earlier run would already carry counters.
  for (const skill of SKILLS) {
    const removed = await edgeFetch(
      `/skills/${encodeURIComponent(skill.name)}`,
      { method: 'DELETE' }
    );
    expect([204, 404]).toContain(removed.status);
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-skc-'));
  const keyFile = path.join(workDir, 'edge-api-key');
  fs.writeFileSync(keyFile, bootstrap.api_key, { mode: 0o600 });
  const archivePath = path.join(workDir, 'landed-cost-skills.zip');
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
    skills: SKILLS.map((s) => ({ name: s.name, entrypoint: s.entrypoint })),
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

    // 1. Upload the archive the way a user does: the Skills screen's add
    //    dialog, through its file picker. One archive, three skills.
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

    // The store must hold each script, not just each prompt — otherwise there
    // is nothing for the sandbox to stage. And all three must be ACTIVE: this
    // run is about chaining, not about the enable gate.
    const stored: Record<string, unknown> = {};
    for (const skill of SKILLS) {
      const row = await storedSkill(skill.name);
      const files = (row?.document?.Files ?? []).map((f) => f.Path ?? f.path);
      stored[skill.name] = {
        version: row?.version,
        status: row?.status,
        files,
      };
      expect(files, `${skill.name} stored without its entrypoint`).toContain(
        skill.entrypoint
      );
      expect(row?.status, `${skill.name} is not active`).toBe('active');
      await expect(byId(page, `skill-toggle-${skill.name}`)).toHaveAttribute(
        'aria-checked',
        'true'
      );
    }
    summary.stored = stored;

    // Brand-new skills have no usage at all, so the run reads against zero.
    const baseline = await usageOfAll();
    summary.usage_baseline = baseline;

    // 2. One query, one fresh Space. Nothing tells the model which skills to
    //    use or in what order — only that its inputs live in skills.
    const composer = await newSpace(page);
    await typeIntoComposer(page, composer, QUERY);
    await screenshot(page, '02-composed');
    await composer.press('Enter');
    const started = Date.now();

    const deadline = Date.now() + ANSWER_TIMEOUT_MS;
    let shots = 0;
    let answered = false;
    for (;;) {
      const text = forValues(await pageText(page));
      if (SKILLS.every((s) => text.includes(tokenValue(s)))) {
        answered = true;
        break;
      }
      if (Date.now() > deadline) break;
      if (shots < 8) {
        await screenshot(page, `03-progress-${shots++}`);
      }
      await page.waitForTimeout(20_000);
    }
    summary.answer_elapsed_ms = Date.now() - started;
    await screenshot(page, '04-answer');
    const transcript = await pageText(page);
    writeOut('04-transcript.txt', transcript);
    const values = forValues(transcript);
    summary.answered = answered;
    const lowered = transcript.toLowerCase();
    summary.fallback_markers = FALLBACK_MARKERS.filter((m) =>
      lowered.includes(m)
    );
    summary.tokens_seen = SKILLS.filter((s) =>
      values.includes(tokenValue(s))
    ).map((s) => s.name);
    summary.missing_expected = EXPECTED.filter(
      (fragment) => !values.includes(fragment)
    );

    // 3. The sandbox's own accounting, independent of anything the model said:
    //    every skill in the chain must show a load and an execution.
    const { usage, moved } = await awaitCounters(baseline);
    summary.usage_after_run = usage;
    summary.usage_delta = moved;

    // 4. And the counters as a user reads them, on the Skills screen.
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
    await screenshot(page, '05-usage');

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

    expect(answered, 'not every skill token reached the answer').toBe(true);
    for (const fragment of EXPECTED) {
      expect(values, `answer is missing ${fragment}`).toContain(fragment);
    }
    expect(
      summary.fallback_markers,
      'an entrypoint did not run — the model worked around a skill'
    ).toEqual([]);
    for (const skill of SKILLS) {
      expect(
        moved[skill.name].loads,
        `${skill.name} prompt was never loaded`
      ).toBeGreaterThanOrEqual(1);
      expect(
        moved[skill.name].executions,
        `${skill.name} never reached the sandbox`
      ).toBeGreaterThanOrEqual(1);
      // Not "Never used": the screen must be showing real counters now.
      expect(screenUsage[skill.name]).toMatch(/Runs: [1-9]/);
    }
    expect(summary.off_edge_requests).toEqual([]);
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
      videoName = 'multi-skill-run.webm';
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
