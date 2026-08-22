// What a run cost is the one figure a user cannot recover after the fact, so
// the line that reports it has to be honest about what was never recorded.
// The two halves come from different planes — tokens from the engine's own
// outcome, cost from the inference ledger — and either can be missing alone.
import { describe, expect, it } from 'vitest';

import { runConsumptionMessage } from '@/store/aionChatBridge';

const tokens = {
  promptTokens: '1533139',
  completionTokens: '26268',
  reasoningTokens: '2617',
  cacheReadTokens: '1458944',
  cacheCreationTokens: '0',
  billableInputTokens: '74195',
  totalTokens: '1559407',
};

describe('runConsumptionMessage', () => {
  it('reports tokens, turns and cost from a fully recorded run', () => {
    const msg = runConsumptionMessage({
      tokens,
      cost: { costMicroUSD: '329028', providerCalls: '31' },
      turnCount: 31,
    });
    expect(msg).toBe(
      '📊 1,559,407 tokens (74,195 billable in · 26,268 out · 1,458,944 cached) · ' +
        '31 turns · $0.3290 over 31 provider calls'
    );
  });

  // prompt_tokens is cache-inclusive. Reporting it beside the cached figure
  // would invite exactly the addition that double-counts, so the line shows
  // the billable subtraction the server already did.
  it('never shows the cache-inclusive prompt total beside the cached read', () => {
    const msg = runConsumptionMessage({ tokens }) ?? '';
    expect(msg).toContain('74,195 billable in');
    expect(msg).not.toContain('1,533,139');
  });

  it('says nothing about cost when the ledger recorded none', () => {
    const msg = runConsumptionMessage({ tokens, turnCount: 4 }) ?? '';
    expect(msg).toContain('tokens');
    expect(msg).toContain('4 turns');
    expect(msg).not.toContain('$');
    expect(msg).not.toContain('provider call');
  });

  // Calls with no price is an alias carrying no price list. A bare $0.0000
  // there would tell the user the run was free, which is a different claim.
  it('calls a priced-at-zero run unpriced rather than free', () => {
    const msg = runConsumptionMessage({
      cost: { costMicroUSD: '0', providerCalls: '3' },
    });
    expect(msg).toBe('📊 3 provider calls, unpriced');
  });

  it('reports cost alone when the engine recorded no tokens', () => {
    expect(
      runConsumptionMessage({ cost: { costMicroUSD: '12000', providerCalls: '1' } })
    ).toBe('📊 $0.0120 over 1 provider call');
  });

  it('renders nothing at all rather than an empty badge', () => {
    expect(runConsumptionMessage(undefined)).toBeUndefined();
    expect(runConsumptionMessage({})).toBeUndefined();
  });

  // Micro-USD is a 64-bit integer and a long run reaches figures a float
  // divide would round. The cents have to survive.
  it('keeps the cents on a figure past float precision', () => {
    expect(
      runConsumptionMessage({
        cost: { costMicroUSD: '9007199254740993', providerCalls: '1' },
      })
    ).toBe('📊 $9,007,199,254.7409 over 1 provider call');
  });
});
