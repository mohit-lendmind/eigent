// The onboarding screen is where every not-connected backend state lands, so
// what it must get right is telling apart the state a key resolves from the
// states a key cannot touch.
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Onboarding from '@/pages/Onboarding';
import type { AionBackendState } from '@/store/aionChatBridge';

// Resolved against the shipped en-us bundle with {{token}} interpolation, so a
// key nobody translated renders as its own key and fails the assertion.
vi.mock('react-i18next', async () => {
  const onboarding = (await import('@/i18n/locales/en-us/onboarding.json'))
    .default as Record<string, string>;
  return {
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) => {
        const value = onboarding[key.replace(/^onboarding\./, '')];
        if (typeof value !== 'string') return key;
        return value.replace(/\{\{(\w+)\}\}/g, (_match, token: string) =>
          String(options?.[token] ?? '')
        );
      },
    }),
  };
});

const mocks = vi.hoisted(() => ({
  state: { kind: 'needs-key', edgeBaseUrl: '' } as AionBackendState,
  navigate: vi.fn(),
}));

vi.mock('@/store/aionChatBridge', () => ({
  getAionBackendState: () => Promise.resolve(mocks.state),
}));

vi.mock('@/store/aionAccountStore', () => ({
  verifyAndStoreAionApiKey: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
}));

function renderWith(state: AionBackendState) {
  mocks.state = state;
  return render(<Onboarding />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Onboarding', () => {
  it('asks for a key when the endpoint is configured and uncredentialed', async () => {
    renderWith({ kind: 'needs-key', edgeBaseUrl: 'https://edge.example/v1' });
    await waitFor(() =>
      expect(screen.getByTestId('aion-onboarding-endpoint').textContent).toBe(
        'https://edge.example/v1'
      )
    );
    expect(screen.getByTestId('aion-onboarding-key')).toBeTruthy();
    expect(screen.queryByTestId('aion-onboarding-unreachable')).toBeNull();
  });

  it('does not offer a key field when there is no endpoint to use it on', async () => {
    renderWith({ kind: 'local' });
    await waitFor(() =>
      expect(
        screen.getByTestId('aion-onboarding-unreachable').textContent
      ).toContain('no aion endpoint configured')
    );
    // Accepting a key here would send the user round a loop that cannot end.
    expect(screen.queryByTestId('aion-onboarding-key')).toBeNull();
    expect(screen.queryByTestId('aion-onboarding-submit')).toBeNull();
  });

  it('repeats the resolution failure rather than asking for a key', async () => {
    renderWith({ kind: 'error', message: 'edge base url is not a URL' });
    await waitFor(() =>
      expect(
        screen.getByTestId('aion-onboarding-unreachable').textContent
      ).toContain('edge base url is not a URL')
    );
    expect(screen.queryByTestId('aion-onboarding-key')).toBeNull();
  });

  it('leaves for the app when the profile already holds a key', async () => {
    renderWith({
      kind: 'ready',
      edgeBaseUrl: 'https://edge.example/v1',
      apiKey: 'sk-test',
      keySource: 'file',
    });
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith('/', { replace: true })
    );
  });
});
