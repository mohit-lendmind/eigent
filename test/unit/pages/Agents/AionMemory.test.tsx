// The Memory screen in aion mode. Its whole job is to say what the agent
// remembers without ever implying it remembers nothing: a backend below the
// memory floor gets a banner rather than an empty list, a cap of zero is drawn
// as uncapped rather than as a full meter, and a listing row is metadata — its
// text arrives only when the document is opened or matched by a search.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Memory from '@/pages/Agents/Memory';
import type {
  AionMemoryCatalog,
  AionMemoryDoc,
  AionMemoryHit,
  AionMemoryMode,
} from '@/store/aionMemoryStore';

const mocks = vi.hoisted(() => ({
  mode: { kind: 'remote' } as unknown,
  catalog: null as unknown,
  doc: null as unknown,
  hits: [] as unknown[],
  write: vi.fn(),
  forget: vi.fn(),
  clear: vi.fn(),
  search: vi.fn(),
}));

vi.mock('@/store/aionMemoryStore', () => ({
  getAionMemoryMode: async () => mocks.mode,
  loadAionMemory: async () => mocks.catalog,
  invalidateAionMemory: () => {},
  readAionMemory: async (key: string) => {
    mocks.doc = key;
    return (mocks.hits as AionMemoryHit[]).find((hit) => hit.doc.key === key)
      ?.doc ?? {
      scope: 'profile:eigent-managed',
      key,
      bytes: 12,
      content: `content of ${key}`,
    };
  },
  searchAionMemory: async (query: string) => {
    mocks.search(query);
    return mocks.hits;
  },
  writeAionMemory: async (key: string, content: string) => {
    mocks.write(key, content);
    return mocks.catalog;
  },
  forgetAionMemory: async (key: string) => {
    mocks.forget(key);
    return mocks.catalog;
  },
  clearAionMemory: async () => {
    mocks.clear();
    return { deleted: 3, catalog: mocks.catalog };
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function doc(over: Partial<AionMemoryDoc> = {}): AionMemoryDoc {
  return {
    scope: 'profile:eigent-managed',
    key: 'deploy-runbook',
    bytes: 1841,
    createdAt: '2026-08-02T09:14:07.221Z',
    updatedAt: '2026-08-12T16:02:44.918Z',
    ...over,
  };
}

function catalog(over: Partial<AionMemoryCatalog> = {}): AionMemoryCatalog {
  return {
    scope: 'profile:eigent-managed',
    scopes: ['profile:eigent-managed'],
    docs: [
      doc(),
      doc({
        key: 'user-preferences',
        bytes: 312,
        createdAt: '2026-08-11T11:47:30.004Z',
        updatedAt: undefined,
      }),
    ],
    usage: {
      docCount: 2,
      totalBytes: 2153,
      capDocBytes: 262144,
      capDocsPerScope: 256,
      capScopeBytes: 8388608,
    },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mode = { kind: 'remote' } as AionMemoryMode;
  mocks.catalog = catalog();
  mocks.hits = [];
});

async function renderScreen() {
  render(<Memory />);
  await waitFor(() => expect(screen.getByTestId('aion-memory')).toBeTruthy());
}

describe('Memory screen mode gating', () => {
  it('names a backend below the memory floor instead of showing an empty memory', async () => {
    mocks.mode = { kind: 'unsupported', edgeApiVersion: '1.11.0' };
    await renderScreen();
    await screen.findByTestId('aion-memory-banner');
    expect(screen.queryByTestId('aion-memory-empty')).toBeNull();
    expect(screen.queryByTestId('aion-memory-row')).toBeNull();
  });

  it('surfaces a remote error as an error, not as nothing remembered', async () => {
    mocks.mode = { kind: 'error', message: 'edge unreachable' };
    await renderScreen();
    await screen.findByTestId('aion-memory-banner');
    expect(screen.queryByTestId('aion-memory-row')).toBeNull();
  });

  it('keeps the placeholder on the legacy plane, which stores no memory', async () => {
    mocks.mode = { kind: 'local' };
    await renderScreen();
    await waitFor(() =>
      expect(screen.getByText('agents.memory-coming-soon-description')).toBeTruthy()
    );
    expect(screen.queryByTestId('aion-memory-usage')).toBeNull();
  });
});

describe('Memory screen usage', () => {
  it('draws a capped scope against its cap', async () => {
    await renderScreen();
    const usage = await screen.findByTestId('aion-memory-usage');
    expect(usage.getAttribute('data-doc-count')).toBe('2');
    expect(usage.getAttribute('data-cap-docs')).toBe('256');
    expect(
      within(usage).getByTestId('aion-memory-usage-documents').textContent
    ).toBe('agents.memory-usage-documents');
    expect(within(usage).getByTestId('aion-memory-usage-stored').textContent).toBe(
      'agents.memory-usage-stored'
    );
  });

  it('reads a zero cap as uncapped rather than as no room left', async () => {
    mocks.catalog = catalog({
      usage: {
        docCount: 2,
        totalBytes: 2153,
        capDocBytes: 0,
        capDocsPerScope: 0,
        capScopeBytes: 0,
      },
    });
    await renderScreen();
    const usage = await screen.findByTestId('aion-memory-usage');
    // A meter against a zero cap would render full, which reads as a scope
    // with no room left — the opposite of what a zero cap means.
    expect(
      within(usage).getByTestId('aion-memory-usage-documents').textContent
    ).toBe('agents.memory-usage-documents-uncapped');
    expect(within(usage).getByTestId('aion-memory-usage-stored').textContent).toBe(
      'agents.memory-usage-stored-uncapped'
    );
    expect(usage.querySelectorAll('[role="progressbar"]').length).toBe(0);
  });

  it('still shows an empty scope its caps', async () => {
    mocks.catalog = catalog({
      docs: [],
      usage: {
        docCount: 0,
        totalBytes: 0,
        capDocBytes: 262144,
        capDocsPerScope: 256,
        capScopeBytes: 8388608,
      },
    });
    await renderScreen();
    await screen.findByTestId('aion-memory-empty');
    const usage = screen.getByTestId('aion-memory-usage');
    expect(usage.getAttribute('data-doc-count')).toBe('0');
    expect(
      within(usage).getByTestId('aion-memory-usage-documents').textContent
    ).toBe('agents.memory-usage-documents');
  });
});

describe('Memory screen listing', () => {
  it('lists rows without text and tells a rewritten document from a never-rewritten one', async () => {
    await renderScreen();
    const rows = await screen.findAllByTestId('aion-memory-row');
    expect(rows.map((row) => row.getAttribute('data-key'))).toEqual([
      'deploy-runbook',
      'user-preferences',
    ]);
    expect(within(rows[0]).getByText('agents.memory-updated')).toBeTruthy();
    // No `updated_at` on the wire means written once and never since, which is
    // a different sentence from "updated at the moment it was created".
    expect(within(rows[1]).getByText('agents.memory-created')).toBeTruthy();
    expect(rows[0].textContent).not.toContain('content of');
  });

  it('opens one document to read its text', async () => {
    await renderScreen();
    const rows = await screen.findAllByTestId('aion-memory-row');
    await userEvent.click(within(rows[0]).getByTestId('aion-memory-open'));
    await waitFor(() =>
      expect(
        screen.getByTestId('aion-memory-reader').getAttribute('data-key')
      ).toBe('deploy-runbook')
    );
    expect(
      (screen.getByTestId('aion-memory-reader-content') as HTMLTextAreaElement)
        .value
    ).toBe('content of deploy-runbook');
  });
});

describe('Memory screen search', () => {
  beforeEach(() => {
    mocks.hits = [
      {
        doc: doc({ content: 'Deploys go out behind the digest-only gate.' }),
        score: 8.4213,
      },
    ] satisfies AionMemoryHit[];
  });

  it('replaces the listing with ranked hits that carry their own text', async () => {
    await renderScreen();
    await userEvent.type(screen.getByTestId('aion-memory-search'), 'cutover');
    await userEvent.click(screen.getByTestId('aion-memory-search-run'));

    const hits = await screen.findAllByTestId('aion-memory-hit');
    expect(mocks.search).toHaveBeenCalledWith('cutover');
    expect(hits[0].getAttribute('data-key')).toBe('deploy-runbook');
    expect(hits[0].textContent).toContain('digest-only gate');
    expect(screen.queryByTestId('aion-memory-row')).toBeNull();
  });

  it('reports a hitless search as no matches, never as an empty memory', async () => {
    mocks.hits = [];
    await renderScreen();
    await userEvent.type(screen.getByTestId('aion-memory-search'), 'nothing');
    await userEvent.click(screen.getByTestId('aion-memory-search-run'));

    await screen.findByTestId('aion-memory-no-matches');
    // "nothing matched that search" and "the agent remembers nothing" are
    // different facts and must not share a message.
    expect(screen.queryByTestId('aion-memory-empty')).toBeNull();
  });

  it('returns to the listing when the search is cleared', async () => {
    await renderScreen();
    await userEvent.type(screen.getByTestId('aion-memory-search'), 'cutover');
    await userEvent.click(screen.getByTestId('aion-memory-search-run'));
    await screen.findAllByTestId('aion-memory-hit');

    await userEvent.click(screen.getByTestId('aion-memory-search-clear'));
    expect(await screen.findAllByTestId('aion-memory-row')).toHaveLength(2);
  });
});

describe('Memory screen writes', () => {
  it('sends the composed key and text, then closes the composer', async () => {
    await renderScreen();
    await userEvent.click(screen.getByTestId('aion-memory-new'));
    await userEvent.type(
      screen.getByTestId('aion-memory-key-input'),
      'user-preferences'
    );
    await userEvent.type(
      screen.getByTestId('aion-memory-content-input'),
      'Prefers concise answers.'
    );
    await userEvent.click(screen.getByTestId('aion-memory-save'));

    await waitFor(() =>
      expect(mocks.write).toHaveBeenCalledWith(
        'user-preferences',
        'Prefers concise answers.'
      )
    );
    await waitFor(() =>
      expect(screen.queryByTestId('aion-memory-key-input')).toBeNull()
    );
  });

  it('refuses to send an empty document, which cannot be stored', async () => {
    await renderScreen();
    await userEvent.click(screen.getByTestId('aion-memory-new'));
    await userEvent.type(screen.getByTestId('aion-memory-key-input'), 'blank');
    expect(
      (screen.getByTestId('aion-memory-save') as HTMLButtonElement).disabled
    ).toBe(true);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it('asks before forgetting a document', async () => {
    await renderScreen();
    const rows = await screen.findAllByTestId('aion-memory-row');
    await userEvent.click(within(rows[0]).getByTestId('aion-memory-forget'));
    expect(mocks.forget).not.toHaveBeenCalled();

    const dialog = document.querySelector('.alert-dialog-wrapper');
    expect(dialog).toBeTruthy();
    await userEvent.click(
      within(dialog as HTMLElement).getByText('agents.memory-forget')
    );
    await waitFor(() =>
      expect(mocks.forget).toHaveBeenCalledWith('deploy-runbook')
    );
  });

  it('reports what a scope-wide forget removed, from the server count', async () => {
    await renderScreen();
    await userEvent.click(await screen.findByTestId('aion-memory-forget-all'));
    const dialog = document.querySelector('.alert-dialog-wrapper');
    await userEvent.click(
      within(dialog as HTMLElement).getByText('agents.memory-forget')
    );
    await waitFor(() => expect(mocks.clear).toHaveBeenCalled());
    const cleared = await screen.findByTestId('aion-memory-cleared');
    expect(cleared.getAttribute('data-deleted')).toBe('3');
  });
});
