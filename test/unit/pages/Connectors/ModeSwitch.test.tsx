// Which Connectors screen each plane gets. The gateway registers MCP servers
// through the hosted cloud and validates them against the backend this fork
// removed, so on an aion stack it must never mount — a screen whose every write
// goes nowhere is worse than no screen.
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Connectors from '@/pages/Connectors';

const mocks = vi.hoisted(() => ({ config: null as unknown }));

vi.mock('@/store/aionChatBridge', () => ({
  getAionRemoteConfig: () => Promise.resolve(mocks.config),
}));

// Stubs, not the real screens: the gateway alone pulls in thousands of lines of
// hosted-cloud form code that has nothing to do with which screen is chosen.
vi.mock('@/pages/Connectors/ConnectorGateway', () => ({
  default: () => <div data-testid="screen-gateway" />,
}));
vi.mock('@/pages/Connectors/AionConnectors', () => ({
  default: () => <div data-testid="screen-aion" />,
}));

beforeEach(() => {
  mocks.config = null;
});

describe('Connectors plane switch', () => {
  it('serves the aion catalog when the desktop is pointed at an edge', async () => {
    mocks.config = { edgeBaseUrl: 'http://edge.test', apiKey: 'k' };
    render(<Connectors />);
    await waitFor(() => expect(screen.getByTestId('screen-aion')).toBeTruthy());
    expect(screen.queryByTestId('screen-gateway')).toBeNull();
  });

  it('keeps the gateway on the legacy plane', async () => {
    render(<Connectors />);
    await waitFor(() =>
      expect(screen.getByTestId('screen-gateway')).toBeTruthy()
    );
    expect(screen.queryByTestId('screen-aion')).toBeNull();
  });

  it('serves the aion catalog even when the remote config is broken', async () => {
    // The desktop was still pointed at an edge, so the gateway is just as dead
    // here — falling back to it at the moment the user is already looking for
    // something that works would be the worst time to show a dead screen.
    mocks.config = { error: 'EIGENT_REMOTE_BACKEND_URL is not a valid URL' };
    render(<Connectors />);
    await waitFor(() => expect(screen.getByTestId('screen-aion')).toBeTruthy());
  });

  it('renders neither screen before the mode is known', async () => {
    render(<Connectors />);
    // Assert on the first paint, BEFORE the config promise settles — waitFor
    // would flush it and test the resolved state instead of the pending one.
    expect(screen.queryByTestId('screen-gateway')).toBeNull();
    expect(screen.queryByTestId('screen-aion')).toBeNull();
    await act(async () => {});
  });
});
