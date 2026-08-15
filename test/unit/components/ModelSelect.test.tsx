// The in-chat model picker. It has exactly one source — the edge's alias
// catalog — so the two things worth pinning are that it never offers a model
// the backend would refuse (internal fixture aliases, or the retired provider
// menus that used to send the user off to configure a key), and that a pick
// made with a Project open pins that Project without moving the global default.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listModelAliases } = vi.hoisted(() => ({
  listModelAliases: vi.fn(),
}));

vi.mock('@/api/aion/v1/transport', () => ({
  EdgeTransport: class {
    listModelAliases = listModelAliases;
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// The menu is Radix; what this file asserts is what the menu is asked to show,
// so the primitives collapse to plain nodes and every item renders at once.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="model-menu">{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
    disabled,
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" disabled={disabled} onClick={onSelect}>
      {children}
    </button>
  ),
}));

const CATALOG = {
  aliases: [
    {
      alias: 'kimi-k2',
      display_name: 'Kimi K2',
      description: 'Reasoning',
      is_default: true,
    },
    { alias: 'gemini-flash', display_name: 'Gemini Flash' },
    { alias: 'ci-echo', display_name: 'CI Echo', internal: true },
  ],
};

async function freshPicker() {
  vi.resetModules();
  const { ModelSelect } = await import(
    '@/components/ChatBox/BottomBox/ModelSelect'
  );
  const { useAionModelStore } = await import('@/store/aionModelStore');
  return { ModelSelect, useAionModelStore };
}

beforeEach(() => {
  vi.clearAllMocks();
  // The alias store persists, so a pick reaches Web Storage. Give it one that
  // starts empty for each test instead of whichever implementation the host
  // runtime happens to put on the global.
  const stored = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => {
        stored.set(key, value);
      },
      removeItem: (key: string) => {
        stored.delete(key);
      },
      clear: () => stored.clear(),
    },
  });
  listModelAliases.mockResolvedValue(CATALOG);
  (globalThis as Record<string, any>).electronAPI = {
    getAionTransportConfig: async () => ({
      mode: 'remote',
      edgeBaseUrl: 'http://edge.test',
      apiKey: 'test-key',
    }),
  };
});

describe('ModelSelect', () => {
  it('offers the aliases the edge serves, and no rung this build cannot honour', async () => {
    const { ModelSelect } = await freshPicker();
    render(<ModelSelect />);

    const menu = await screen.findByTestId('model-menu');
    await waitFor(() => expect(menu.textContent).toContain('Kimi K2'));
    expect(menu.textContent).toContain('Gemini Flash');
    // Diagnostic aliases are API-selectable and never offered.
    expect(menu.textContent).not.toContain('CI Echo');
    // The provider menus that used to send the user off to paste a key.
    expect(menu.textContent).not.toContain('setting.eigent-cloud');
    expect(menu.textContent).not.toContain('setting.custom-model');
    expect(menu.textContent).not.toContain('setting.local-model');
  });

  it('names the resolved alias on the trigger', async () => {
    const { ModelSelect } = await freshPicker();
    render(<ModelSelect />);

    await waitFor(() =>
      expect(
        screen.getByTestId('aion-model-select').getAttribute('aria-label')
      ).toBe('Kimi K2')
    );
  });

  it('pins the Project a pick was made in, leaving the global default alone', async () => {
    const { ModelSelect, useAionModelStore } = await freshPicker();
    render(<ModelSelect projectId="proj-1" />);

    await userEvent.click(await screen.findByText('Gemini Flash'));

    expect(useAionModelStore.getState().projectAlias['proj-1']).toBe(
      'gemini-flash'
    );
    expect(useAionModelStore.getState().selectedAlias).toBeNull();
  });

  it('moves the global default when no Project is open', async () => {
    const { ModelSelect, useAionModelStore } = await freshPicker();
    render(<ModelSelect />);

    await userEvent.click(await screen.findByText('Gemini Flash'));

    expect(useAionModelStore.getState().selectedAlias).toBe('gemini-flash');
    expect(useAionModelStore.getState().projectAlias).toEqual({});
  });

  it('says the catalog could not be read rather than offering an empty menu', async () => {
    listModelAliases.mockRejectedValue(new Error('edge unreachable'));
    const { ModelSelect } = await freshPicker();
    render(<ModelSelect />);

    expect(await screen.findByText('setting.aion-models-error')).toBeTruthy();
    expect(screen.queryByText('Kimi K2')).toBeNull();
  });

  it('shows the bound model without a picker once the session has fixed it', async () => {
    const { ModelSelect } = await freshPicker();
    render(<ModelSelect readOnly />);

    await screen.findByText('Kimi K2');
    expect(screen.queryByTestId('aion-model-select')).toBeNull();
    expect(screen.queryByTestId('model-menu')).toBeNull();
  });
});
