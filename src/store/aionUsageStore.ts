// What the tenant's settled runs cost, read from the aion edge. Cost is
// recorded when a run settles, not per token, so this surface is a bill and
// not a live meter — a run still in flight has no figure yet and must say so
// rather than show $0.00. The three states the edge distinguishes on the wire
// (no figure recorded, a figure of zero beside real provider calls, a real
// amount) survive intact through this module; collapsing any two of them
// would bill an unmetered run as free.

import { supportsUsage } from '@/api/aion/v1/compat';
import {
  EdgeTransport,
  type RunSpend,
  type TokenUsage,
} from '@/api/aion/v1/transport';
import { getAionRemoteConfig } from './aionChatBridge';

/**
 * How the usage surface should behave this renderer lifetime. `local` is a
 * desktop with no aion backend at all; `unsupported` is a compatible edge
 * below the 1.7 usage floor, shown as such because "this backend cannot report
 * spend" and "you spent nothing" are opposite facts; `error` is remote mode
 * that cannot serve the bill — shown, never silently degraded to a zero.
 */
export type AionUsageMode =
  | { kind: 'local' }
  | { kind: 'remote' }
  | { kind: 'unsupported'; edgeApiVersion: string }
  | { kind: 'error'; message: string };

/**
 * Window totals. These cover the whole window on every page — only the run
 * list pages — so a caller that reads one page still reads a true total.
 * `runsUnrecorded` counts settled runs that carry no figure: while it is
 * non-zero the sums are a FLOOR, not the bill.
 */
export interface AionUsageTotals {
  costMicroUsd: bigint;
  providerCalls: bigint;
  runsSettled: bigint;
  runsUnrecorded: bigint;
  /**
   * Settled runs that recorded no TOKEN figure — a second, independent floor.
   * Cost comes from the inference ledger and tokens from the engine's own
   * outcome, so the two counts are routinely different and one cannot stand
   * in for the other.
   */
  runsWithoutTokens: bigint;
  /** Absent when no run in the window recorded tokens. */
  tokens?: AionTokenUsage;
}

/**
 * Tokens consumed. `promptTokens` is the TOTAL effective prompt and already
 * includes both cache dimensions, so adding them double-counts;
 * `billableInputTokens` is the subtraction the edge already did, and
 * `reasoningTokens` is a split of `completionTokens`, never an addend.
 */
export interface AionTokenUsage {
  promptTokens: bigint;
  completionTokens: bigint;
  reasoningTokens: bigint;
  cacheReadTokens: bigint;
  cacheCreationTokens: bigint;
  billableInputTokens: bigint;
  totalTokens: bigint;
}

/** One settled run's contribution, with the cost pair absent when unrecorded. */
export interface AionRunSpend {
  runId: string;
  projectId: string;
  /** The contract's terminal run status, an open set. */
  status: string;
  /** Settlement time in epoch millis; 0 when the edge omitted it. */
  endedAt: number;
  /** Absent when nothing was recorded for this run — render pending, not zero. */
  spend?: { costMicroUsd: bigint; providerCalls: bigint };
  /** Absent on the same rule but INDEPENDENTLY of `spend`. */
  tokens?: AionTokenUsage;
}

export interface AionUsagePage {
  totals: AionUsageTotals;
  runs: AionRunSpend[];
  /** Absent on the last page; pass it back to load the next one. */
  nextPageToken?: string;
}

/**
 * What a row's cost cell should say. `unpriced` is the case worth naming: the
 * run really did call a provider and the plane recorded a cost of zero, which
 * means no price list covered the model, not that the calls were free. A
 * settled run that made no provider calls at all is a genuine zero and stays
 * an `amount`.
 */
export type AionRunCost =
  | { kind: 'amount'; microUsd: bigint }
  | { kind: 'unpriced'; providerCalls: bigint }
  | { kind: 'pending' };

export function runCost(run: AionRunSpend): AionRunCost {
  if (!run.spend) {
    return { kind: 'pending' };
  }
  if (run.spend.costMicroUsd === 0n && run.spend.providerCalls > 0n) {
    return { kind: 'unpriced', providerCalls: run.spend.providerCalls };
  }
  return { kind: 'amount', microUsd: run.spend.costMicroUsd };
}

/**
 * Micro-USD as money. Sub-dollar amounts keep four decimals because a run
 * costing a tenth of a cent is common and rounding it to `$0.00` would print
 * the one string this surface must never print for a real charge; anything
 * that still rounds away is shown as a bound instead.
 */
export function formatMicroUsd(microUsd: bigint): string {
  const decimals = microUsd < 1_000_000n ? 4 : 2;
  const scale = 10n ** BigInt(6 - decimals);
  const units = (microUsd + scale / 2n) / scale;
  if (units === 0n && microUsd > 0n) {
    return `<$0.${'0'.repeat(decimals - 1)}1`;
  }
  const divisor = 10n ** BigInt(decimals);
  const whole = units / divisor;
  const fraction = (units % divisor).toString().padStart(decimals, '0');
  return `$${whole.toLocaleString('en-US')}.${fraction}`;
}

interface RemoteContext {
  mode: AionUsageMode;
  transport: EdgeTransport | null;
}

// Mode is negotiated once per renderer lifetime (matching the projects and
// skills stores); any error-mode resolution clears the cache so reopening the
// surface retries.
let contextPromise: Promise<RemoteContext> | null = null;

function getContext(): Promise<RemoteContext> {
  contextPromise ??= resolveContext();
  return contextPromise;
}

async function resolveContext(): Promise<RemoteContext> {
  try {
    const config = await getAionRemoteConfig();
    if (!config) {
      return { mode: { kind: 'local' }, transport: null };
    }
    if ('error' in config) {
      contextPromise = null;
      return { mode: { kind: 'error', message: config.error }, transport: null };
    }
    const transport = new EdgeTransport({
      baseUrl: config.edgeBaseUrl,
      apiKey: config.apiKey,
    });
    const status = await transport.getIntegrationStatus();
    if (!supportsUsage(status)) {
      return {
        mode: { kind: 'unsupported', edgeApiVersion: status.edge_api_version },
        transport: null,
      };
    }
    return { mode: { kind: 'remote' }, transport };
  } catch (error) {
    // A failed handshake is retryable: drop the cache so the next open
    // renegotiates instead of pinning the error forever.
    contextPromise = null;
    const message = error instanceof Error ? error.message : String(error);
    return { mode: { kind: 'error', message }, transport: null };
  }
}

export async function getAionUsageMode(): Promise<AionUsageMode> {
  return (await getContext()).mode;
}

async function remoteTransport(): Promise<EdgeTransport> {
  const { mode, transport } = await getContext();
  if (!transport) {
    throw new Error(
      mode.kind === 'error'
        ? mode.message
        : 'The aion backend does not report usage.'
    );
  }
  return transport;
}

// First-page promise-cache with explicit invalidation, so concurrent opens
// share one fetch. Later pages are never cached: they are only ever fetched in
// response to the user asking for more.
let firstPagePromise: Promise<AionUsagePage> | null = null;

export function invalidateAionUsage(): void {
  firstPagePromise = null;
}

export interface AionUsageQuery {
  pageToken?: string;
  pageSize?: number;
  projectId?: string;
  since?: string;
  until?: string;
}

/**
 * The newest page of settled runs plus the window totals. Called without a
 * token it serves (and caches) the first page; with a token from a prior page
 * it walks forward. Only the unfiltered first page is cached — a narrowed
 * window is a different question and always goes to the edge.
 */
export function loadAionUsage(query: AionUsageQuery = {}): Promise<AionUsagePage> {
  const narrowed =
    Boolean(query.pageToken) ||
    Boolean(query.projectId) ||
    Boolean(query.since) ||
    Boolean(query.until);
  if (narrowed) {
    return fetchPage(query);
  }
  firstPagePromise ??= fetchPage(query).catch((error) => {
    firstPagePromise = null;
    throw error;
  });
  return firstPagePromise;
}

async function fetchPage(query: AionUsageQuery): Promise<AionUsagePage> {
  const transport = await remoteTransport();
  const summary = await transport.getUsage(query);
  return {
    totals: {
      costMicroUsd: decimal(summary.totals?.cost_micro_usd),
      providerCalls: decimal(summary.totals?.provider_calls),
      runsSettled: decimal(summary.totals?.runs_settled),
      runsUnrecorded: decimal(summary.totals?.runs_unrecorded),
      runsWithoutTokens: decimal(summary.totals?.runs_without_tokens),
      ...(tokenUsage(summary.totals?.tokens)
        ? { tokens: tokenUsage(summary.totals?.tokens) }
        : {}),
    },
    runs: (summary.runs ?? []).map(toRunSpend),
    ...(summary.next_page_token
      ? { nextPageToken: summary.next_page_token }
      : {}),
  };
}

function toRunSpend(run: RunSpend): AionRunSpend {
  // Both halves of the cost pair or neither. The edge writes them together, so
  // half a figure is a malformed body — treating it as pending refuses to
  // invent the missing half.
  const recorded =
    run.cost_micro_usd !== undefined && run.provider_calls !== undefined;
  const tokens = tokenUsage(run.tokens);
  return {
    runId: run.run_id,
    projectId: run.project_id,
    status: run.status,
    endedAt: epochMillis(run.ended_at),
    ...(recorded
      ? {
          spend: {
            costMicroUsd: decimal(run.cost_micro_usd),
            providerCalls: decimal(run.provider_calls),
          },
        }
      : {}),
    ...(tokens ? { tokens } : {}),
  };
}

/**
 * Every dimension or none. `decimal` floors a malformed figure to zero, which
 * is the right default for a total that is already advertised as a floor but
 * the wrong one inside a token block: a run's own breakdown would silently
 * stop adding up, and the arithmetic the edge serves precisely so two surfaces
 * cannot disagree would be broken here instead.
 */
function tokenUsage(raw: TokenUsage | undefined): AionTokenUsage | undefined {
  if (!raw) return undefined;
  const fields = [
    'prompt_tokens',
    'completion_tokens',
    'reasoning_tokens',
    'cache_read_tokens',
    'cache_creation_tokens',
    'billable_input_tokens',
    'total_tokens',
  ] as const;
  if (fields.some((name) => !/^[0-9]+$/.test(String(raw[name] ?? '')))) {
    return undefined;
  }
  return {
    promptTokens: decimal(raw.prompt_tokens),
    completionTokens: decimal(raw.completion_tokens),
    reasoningTokens: decimal(raw.reasoning_tokens),
    cacheReadTokens: decimal(raw.cache_read_tokens),
    cacheCreationTokens: decimal(raw.cache_creation_tokens),
    billableInputTokens: decimal(raw.billable_input_tokens),
    totalTokens: decimal(raw.total_tokens),
  };
}

// uint64 terms cross the wire as decimal strings and are parsed as BigInt, not
// Number: a tenant's lifetime micro-USD total can exceed the safe integer
// range, and a silently rounded bill is worse than none.
function decimal(value: string | undefined): bigint {
  if (value === undefined || !/^[0-9]+$/.test(value)) {
    return 0n;
  }
  return BigInt(value);
}

function epochMillis(timestamp: string | undefined): number {
  const parsed = Date.parse(String(timestamp ?? ''));
  return Number.isNaN(parsed) ? 0 : parsed;
}
