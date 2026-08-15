// The Connections screen in aion mode. The three catalog states have to reach
// the user as three different rows, and Connect has to stop short of claiming
// success: the consent flow finishes in the browser and lands on the cell, so
// until the catalog says `connected` this renderer knows nothing.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AionConnectors from '@/pages/Connectors';

const mocks = vi.hoisted(() => ({
  mode: { kind: 'remote' } as unknown,
  catalog: [] as unknown[],
  authUrl: 'https://provider.test/consent?state=abc',
  openExternal: vi.fn(async (_url: string) => ({ success: true })),
  connect: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock('@/store/aionConnectorsStore', async () => {
  // The projection and the state machine are the real ones — only the edge
  // round-trip is replaced, so a wrong `connectable` reading would still fail.
  const actual = await vi.importActual<
    typeof import('@/store/aionConnectorsStore')
  >('@/store/aionConnectorsStore');
  return {
    ...actual,
    getAionConnectorsMode: async () => mocks.mode,
    loadAionConnectors: async () => mocks.catalog,
    invalidateAionConnectors: () => {},
    connectAionConnector: async (id: string) => {
      mocks.connect(id);
      return mocks.authUrl;
    },
    disconnectAionConnector: async (id: string) => {
      mocks.disconnect(id);
      return mocks.catalog;
    },
  };
});

vi.mock('@/host', () => ({
  useHost: () => ({ electronAPI: { openExternal: mocks.openExternal } }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/components/Dashboard/SearchInput', () => ({
  default: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (e: { target: { value: string } }) => void;
  }) => (
    <input
      data-testid="search"
      value={value}
      onChange={(e) => onChange({ target: { value: e.target.value } })}
    />
  ),
}));

function row(overrides: Record<string, unknown>) {
  return {
    connectorId: 'linear',
    displayName: 'Linear',
    authKind: 'oauth',
    status: 'active',
    connected: false,
    connectable: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mode = { kind: 'remote' };
  mocks.catalog = [];
  mocks.openExternal = vi.fn(async () => ({ success: true }));
});

describe('AionConnectors states', () => {
  it('renders connected, connectable and unavailable as different rows', async () => {
    mocks.catalog = [
      row({ connectorId: 'github', displayName: 'GitHub', connected: true }),
      row({}),
      row({ connectorId: 'notion', displayName: 'Notion', connectable: false }),
    ];
    render(<AionConnectors />);

    await waitFor(() =>
      expect(screen.getAllByTestId('aion-connector-row')).toHaveLength(3)
    );
    expect(screen.getByTestId('aion-connector-state-connected')).toBeTruthy();
    expect(screen.getByTestId('aion-connector-state-disconnected')).toBeTruthy();
    expect(screen.getByTestId('aion-connector-state-unavailable')).toBeTruthy();

    // Only the connectable row offers Connect, and only the connected row
    // offers Disconnect — the unavailable row offers neither, because no user
    // action can change it.
    expect(screen.getAllByTestId('aion-connector-connect')).toHaveLength(1);
    expect(screen.getAllByTestId('aion-connector-disconnect')).toHaveLength(1);
  });

  it('offers no disconnect for a connector that needs no grant', async () => {
    mocks.catalog = [
      row({
        connectorId: 'sandbox-echo',
        displayName: 'Sandbox Echo',
        authKind: 'none',
        connected: true,
      }),
    ];
    render(<AionConnectors />);

    await waitFor(() =>
      expect(screen.getByTestId('aion-connector-state-provisioned')).toBeTruthy()
    );
    expect(screen.queryByTestId('aion-connector-disconnect')).toBeNull();
  });

  it('names an empty catalog rather than showing nothing', async () => {
    render(<AionConnectors />);
    await waitFor(() =>
      expect(screen.getByTestId('aion-connectors-empty')).toBeTruthy()
    );
  });

  it('says the backend is too old instead of listing zero connectors', async () => {
    mocks.mode = { kind: 'unsupported', edgeApiVersion: '1.8.0' };
    render(<AionConnectors />);
    await waitFor(() =>
      expect(screen.getByTestId('aion-connectors-banner')).toBeTruthy()
    );
    expect(screen.queryByTestId('aion-connectors-empty')).toBeNull();
  });
});

describe('AionConnectors connect', () => {
  it('opens the consent URL and waits rather than claiming a connection', async () => {
    mocks.catalog = [row({})];
    render(<AionConnectors />);
    await waitFor(() =>
      expect(screen.getByTestId('aion-connector-connect')).toBeTruthy()
    );

    await userEvent.click(screen.getByTestId('aion-connector-connect'));

    await waitFor(() =>
      expect(screen.getByTestId('aion-connector-awaiting')).toBeTruthy()
    );
    expect(mocks.connect).toHaveBeenCalledWith('linear');
    expect(mocks.openExternal).toHaveBeenCalledWith(mocks.authUrl);
    // The negative control: the catalog still reports no grant, so the row must
    // not have flipped to connected on the strength of the request alone.
    expect(screen.queryByTestId('aion-connector-state-connected')).toBeNull();
    expect(screen.getByTestId('aion-connector-row').dataset.connected).toBe(
      'false'
    );
  });

  it('reports a refused open instead of waiting for a flow nobody started', async () => {
    mocks.catalog = [row({})];
    mocks.openExternal = vi.fn(async () => ({
      success: false,
      error: 'blocked',
    }));
    render(<AionConnectors />);
    await waitFor(() =>
      expect(screen.getByTestId('aion-connector-connect')).toBeTruthy()
    );

    await userEvent.click(screen.getByTestId('aion-connector-connect'));

    await waitFor(() =>
      expect(screen.getByTestId('aion-connectors-error')).toBeTruthy()
    );
    expect(screen.queryByTestId('aion-connector-awaiting')).toBeNull();
  });

  it('disconnects a connected row', async () => {
    mocks.catalog = [row({ connectorId: 'github', connected: true })];
    render(<AionConnectors />);
    await waitFor(() =>
      expect(screen.getByTestId('aion-connector-disconnect')).toBeTruthy()
    );

    await userEvent.click(screen.getByTestId('aion-connector-disconnect'));
    await waitFor(() => expect(mocks.disconnect).toHaveBeenCalledWith('github'));
  });
});
