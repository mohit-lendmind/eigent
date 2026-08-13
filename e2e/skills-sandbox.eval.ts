// Skills-in-the-sandbox evaluation: the REAL desktop app in remote-backend
// mode against the live eigent-local stack on a REAL model, driving the whole
// chain a user actually walks — author a skill archive, upload it through the
// product Skills screen, ask a task that needs it, and let the model discover
// it, load its prompt, and execute its script in the cell sandbox.
//
// Each case is built so a shortcut cannot pass it:
//   - The answer depends on a token that exists ONLY in the skill's own files.
//     Nothing in the query or the catalog carries it, so a model that never
//     opened the skill cannot produce it.
//   - The numbers are computed by the script from data the prompt never
//     carries, so a plausible guess is a wrong guess.
//   - The clause-triage case keeps its decision rule in the SKILL.md prompt
//     and out of the query: a correct answer proves progressive disclosure
//     actually delivered the prompt, not just that the script ran.
//   - The store already holds a 50-skill haystack (with a same-domain decoy,
//     d33-capacity-forecast), so discovery is a real retrieval problem.
//
// EXECUTION is a separate claim from the answer, and the answer does not carry
// it: staged files are readable in the pod, so a model can open the script and
// do the work itself — which is exactly what one did when the pod image turned
// out to have no python3. So execution is asserted against the edge's own usage
// counters (executions counts runs that reached the sandbox and started, and a
// pod that cannot run the entrypoint records none), read back off the Skills
// screen where a user sees them, plus a scan for the phrases that accompany the
// read-it-instead path.
//
// Run: npx playwright test --config e2e/eval.config.ts skills-sandbox
// Output: EIGENT_EVAL_DIR (default ../skills-sandbox-eval next to the repo).

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
  path.resolve(REPO_ROOT, '..', 'skills-sandbox-eval');

// A real-model turn that has to search the catalog, load a prompt, run a
// script in a freshly leased pod and then reason over its output.
const ANSWER_TIMEOUT_MS = 10 * 60_000;
// The usage sink records outside the request path, so the counters trail the
// answer by a moment.
const COUNTER_TIMEOUT_MS = 90_000;

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

interface EvalCase {
  /** Skill name, which is also the archive folder and the store key. */
  name: string;
  description: string;
  /** SKILL.md body — everything the model learns before executing anything. */
  prompt: string;
  entrypoint: string;
  script: string;
  /** The user's ask. Never names the skill's files or its numbers. */
  query: string;
  /**
   * Every key=value the final line must carry. Asserted individually so a
   * model that bolds or reflows its answer still passes on the values, and
   * only on the values.
   */
  expected: string[];
  /**
   * Lives only in the script. Its presence proves the model reached the skill's
   * files; execution itself is proved by the sandbox's execution counter, since
   * a staged file can also just be read.
   */
  token: string;
}

/**
 * Lowercase phrases that mean the entrypoint did not run: run_skill's own error
 * when the pod has no interpreter for it, a shell that found none, and the
 * arithmetic-it-myself path a model narrates when it falls back to reading the
 * staged script. A case that answers correctly this way is still a failure —
 * the skill is what was under test.
 */
const FALLBACK_MARKERS = [
  'interpreter not found',
  'does not provide it',
  'no python3',
  'python3: not found',
  'exit=127',
];

const CASES: EvalCase[] = [
  {
    name: 'q3-invoice-reconciler',
    description:
      'Reconciles the Q3 invoice batch: sums debits and credits and names the mismatched invoice.',
    prompt: [
      'Skill: q3-invoice-reconciler',
      '',
      'Reconciles the quarterly invoice batch. The ledger is NOT in this',
      'prompt — it ships inside the skill. Execute reconcile.sh with run_skill',
      'and report the values it prints verbatim; never estimate them.',
    ].join('\n'),
    entrypoint: 'reconcile.sh',
    script: [
      '#!/bin/sh',
      '# The Q3 ledger lives here, not in the skill prompt: debits, credits and',
      '# the mismatched invoice are only obtainable by running this script.',
      'set -eu',
      'echo "RECONCILE_TOKEN=4f1c9ba27de35081"',
      "printf '%s\\n' \\",
      "  'INV-3021 82400 82400' \\",
      "  'INV-3044 51950 51950' \\",
      "  'INV-3097 74300 66850' \\",
      "  'INV-3120 96500 96500' \\",
      "  'INV-3163 113500 113500' |",
      "awk '{d+=$2; c+=$3; if ($2!=$3) m=$1}",
      '     END {printf "DEBITS=%d\\nCREDITS=%d\\nVARIANCE=%d\\nMISMATCH=%s\\n", d, c, d-c, m}\'',
      '',
    ].join('\n'),
    query: [
      "Our Q3 invoice batch doesn't balance and finance needs the numbers before close.",
      'Reconcile the batch, then finish your reply with exactly one line in this form:',
      'ANSWER: TOKEN=<token> DEBITS=<n> CREDITS=<n> VARIANCE=<n> MISMATCH=<invoice id>',
    ].join('\n'),
    token: 'RECONCILE_TOKEN=4f1c9ba27de35081',
    expected: [
      'TOKEN=4f1c9ba27de35081',
      'DEBITS=418650',
      'CREDITS=411200',
      'VARIANCE=7450',
      'MISMATCH=INV-3097',
    ],
  },
  {
    name: 'fleet-capacity-forecast',
    description:
      'Reports live per-region fleet utilisation and weekly growth for capacity forecasting.',
    prompt: [
      'Skill: fleet-capacity-forecast',
      '',
      'Reports the current per-region fleet utilisation. The figures are NOT in',
      'this prompt — execute forecast.py with run_skill to obtain them, then do',
      'the forecasting arithmetic on the real numbers it prints.',
    ].join('\n'),
    entrypoint: 'forecast.py',
    script: [
      '#!/usr/bin/env python3',
      '"""Fleet utilisation snapshot. The figures live here, not in the prompt."""',
      '',
      'REGIONS = [',
      '    ("us-east", 612, 900, 31),',
      '    ("eu-west", 488, 700, 12),',
      '    ("ap-south", 331, 520, 10),',
      ']',
      '',
      'print("FORECAST_TOKEN=8b26d40f7ac91e53")',
      'for name, current, capacity, growth in REGIONS:',
      '    print(',
      '        f"region={name} current={current} capacity={capacity} "',
      '        f"weekly_growth={growth}"',
      '    )',
      '',
    ].join('\n'),
    query: [
      'Capacity planning question: across our fleet regions, which one crosses 80% of its',
      'own capacity first, and in how many whole weeks (round any fraction up)?',
      'Use the live utilisation figures, not assumptions. Finish your reply with exactly',
      'one line in this form:',
      'ANSWER: TOKEN=<token> REGION=<region> WEEKS=<whole weeks>',
    ].join('\n'),
    token: 'FORECAST_TOKEN=8b26d40f7ac91e53',
    expected: ['TOKEN=8b26d40f7ac91e53', 'REGION=us-east', 'WEEKS=4'],
  },
  {
    name: 'contract-clause-triage',
    description:
      'Triages the pending MSA contract clauses and reports each clause risk and negotiability.',
    prompt: [
      'Skill: contract-clause-triage',
      '',
      'Triages the pending MSA. Execute triage.sh with run_skill to list the',
      'clauses; the script prints one line per clause with its risk score and',
      'whether it is negotiable.',
      '',
      'Decision rule: a clause BLOCKS signature when its risk is 7 or higher AND',
      'it is not negotiable. A high-risk clause that is negotiable is advisory,',
      'never blocking.',
    ].join('\n'),
    entrypoint: 'triage.sh',
    script: [
      '#!/bin/sh',
      '# The clause table lives here, not in the skill prompt.',
      'set -eu',
      'echo "CLAUSE_TOKEN=c73a5e19b0d84f26"',
      "printf '%s\\n' \\",
      "  'CL-14 risk=8 negotiable=yes' \\",
      "  'CL-22 risk=9 negotiable=no' \\",
      "  'CL-31 risk=6 negotiable=no' \\",
      "  'CL-40 risk=7 negotiable=no' \\",
      "  'CL-58 risk=9 negotiable=yes'",
      '',
    ].join('\n'),
    // The rule stays out of the query on purpose: answering correctly needs the
    // skill's own prompt, so a right answer proves the prompt was delivered.
    query: [
      'Legal is waiting on the pending MSA. Triage its clauses and tell me which ones',
      'block signature, and why each one does. Finish your reply with exactly one line',
      'in this form (ids ascending, comma-separated, no spaces):',
      'ANSWER: TOKEN=<token> BLOCKING=<ids>',
    ].join('\n'),
    token: 'CLAUSE_TOKEN=c73a5e19b0d84f26',
    expected: ['TOKEN=c73a5e19b0d84f26', 'BLOCKING=CL-22,CL-40'],
  },
];

const skillMd = (c: EvalCase) =>
  `---\nname: ${c.name}\ndescription: ${c.description}\n---\n\n${c.prompt}\n`;

/** The archive a user would drag onto the Skills screen: one folder, two files. */
function archiveFor(c: EvalCase): Buffer {
  const encoder = new TextEncoder();
  return Buffer.from(
    zipSync({
      [`${c.name}/SKILL.md`]: encoder.encode(skillMd(c)),
      [`${c.name}/${c.entrypoint}`]: encoder.encode(c.script),
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

async function usageOf(name: string): Promise<SkillUsage | null> {
  const response = await edgeFetch(
    `/skills/${encodeURIComponent(name)}?usage=true`
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`usage read failed: ${response.status}`);
  const skill = (await response.json()) as { usage?: SkillUsage };
  return skill.usage ?? null;
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
  name: string,
  before: SkillUsage | null
): Promise<{ usage: SkillUsage | null; moved: ReturnType<typeof delta> }> {
  const deadline = Date.now() + COUNTER_TIMEOUT_MS;
  for (;;) {
    const usage = await usageOf(name);
    const moved = delta(before, usage);
    if (moved.executions >= 1 && moved.loads >= 1) return { usage, moved };
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

async function openSkillsPage(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = '#/history?tab=agents&section=skills';
  });
  await page.reload();
}

const byId = (page: Page, id: string) => page.getByTestId(id);

/** Whole-page text, whitespace-collapsed: answers are asserted on values. */
async function pageText(page: Page): Promise<string> {
  return (await page.locator('body').innerText()).replace(/\s+/g, ' ');
}

for (const [index, evalCase] of CASES.entries()) {
  const step = String(index + 1).padStart(2, '0');

  test(`${evalCase.name}: authored, uploaded, then executed in the sandbox`, async () => {
    test.setTimeout(ANSWER_TIMEOUT_MS + 5 * 60_000);
    fs.mkdirSync(OUT_DIR, { recursive: true });

    // Start from no such skill: the run must prove its own upload, and a
    // leftover from an earlier run would otherwise satisfy the assertions.
    const removed = await edgeFetch(
      `/skills/${encodeURIComponent(evalCase.name)}`,
      { method: 'DELETE' }
    );
    expect([204, 404]).toContain(removed.status);

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-skx-'));
    const keyFile = path.join(workDir, 'edge-api-key');
    fs.writeFileSync(keyFile, bootstrap.api_key, { mode: 0o600 });
    const archivePath = path.join(workDir, `${evalCase.name}.zip`);
    fs.writeFileSync(archivePath, archiveFor(evalCase));

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
      skill: evalCase.name,
      entrypoint: evalCase.entrypoint,
      query: evalCase.query,
      expected: evalCase.expected,
    };

    const app = await electron.launch({
      args: [REPO_ROOT],
      cwd: REPO_ROOT,
      env,
    });
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
      await expect(byId(page, `skill-row-${evalCase.name}`)).toBeVisible({
        timeout: 60_000,
      });
      await screenshot(page, `${step}-${evalCase.name}-uploaded`);

      // The store must hold the script, not just the prompt — otherwise there
      // is nothing for the sandbox to stage.
      const stored = (await (
        await edgeFetch(`/skills/${encodeURIComponent(evalCase.name)}`)
      ).json()) as {
        version: number;
        document?: { Files?: Array<{ Path?: string; path?: string }> };
      };
      const storedFiles = (stored.document?.Files ?? []).map(
        (f) => f.Path ?? f.path
      );
      expect(storedFiles).toContain(evalCase.entrypoint);
      summary.stored_version = stored.version;
      summary.stored_files = storedFiles;

      // A brand-new skill has no usage at all: the counters below are read
      // against this, so "it ran" can never be inherited from an earlier run.
      const before = await usageOf(evalCase.name);
      summary.usage_before = before;

      // 2. Ask the task. A fresh profile boots into the read-only legacy
      //    Space, so create a real one first, exactly as a user would.
      await page.evaluate(() => {
        window.location.hash = '#/';
      });
      await page.reload();
      await page.getByText('Legacy Space', { exact: true }).first().click();
      await page
        .getByText('Create a new space', { exact: true })
        .first()
        .click();
      await page
        .getByText('Start from scratch', { exact: true })
        .first()
        .click();
      const composer = page
        .locator('[role="textbox"][contenteditable="true"]')
        .first();
      await composer.waitFor({ state: 'visible', timeout: 30_000 });
      await page
        .getByText('Create a new space', { exact: true })
        .waitFor({ state: 'hidden', timeout: 10_000 })
        .catch(() => {});

      await typeIntoComposer(page, composer, evalCase.query);
      await screenshot(page, `${step}-${evalCase.name}-composed`);
      await composer.press('Enter');

      // 3. Terminal condition: the token the script prints. It is a completion
      //    signal, not proof of execution — the staged file is readable, so a
      //    model that opens it instead of running it can quote the token too.
      //    Step 4 is what proves the run.
      const tokenValue = evalCase.token.split('=')[1];
      const deadline = Date.now() + ANSWER_TIMEOUT_MS;
      let shots = 0;
      let answered = false;
      for (;;) {
        if ((await pageText(page)).includes(tokenValue)) {
          answered = true;
          break;
        }
        if (Date.now() > deadline) break;
        if (shots < 8) {
          await screenshot(page, `${step}-${evalCase.name}-progress-${shots++}`);
        }
        await page.waitForTimeout(10_000);
      }
      await screenshot(page, `${step}-${evalCase.name}-answer`);
      const transcript = await pageText(page);
      writeOut(`${step}-${evalCase.name}-transcript.txt`, transcript);
      summary.answered = answered;
      const lowered = transcript.toLowerCase();
      summary.fallback_markers = FALLBACK_MARKERS.filter((m) =>
        lowered.includes(m)
      );

      // 4. The sandbox's own accounting, independent of anything the model
      //    said: executions counts runs that reached the pod and started.
      const { usage, moved } = await awaitCounters(evalCase.name, before);
      summary.usage_after = usage;
      summary.usage_delta = moved;

      // 5. And the counters as a user reads them, on the Skills screen.
      await openSkillsPage(page);
      const usageLine = byId(page, `skill-usage-${evalCase.name}`);
      await usageLine.waitFor({ state: 'attached', timeout: 60_000 });
      const usageText = (await usageLine.innerText()).replace(/\s+/g, ' ');
      summary.skills_screen_usage = usageText;
      await screenshot(page, `${step}-${evalCase.name}-usage`);

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
      writeOut(
        `${step}-${evalCase.name}-summary.json`,
        JSON.stringify(summary, null, 2)
      );

      expect(answered, 'the script token never reached the answer').toBe(true);
      for (const fragment of evalCase.expected) {
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
      writeOut(
        `${step}-${evalCase.name}-summary.json`,
        JSON.stringify(summary, null, 2)
      );
      await app.close();
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
}
