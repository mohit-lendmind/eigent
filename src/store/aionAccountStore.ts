// Who this desktop is authenticated as, and the keys the tenant holds. Two
// facts on the wire keep surfaces honest here and neither can be derived from
// the credential this app is holding:
//
//   `key_management` is whether this deployment serves the /keys routes at all
//   — false means an operator provisions keys elsewhere, and a key manager
//   rendered against it would 501 on every action.
//
//   `current` marks the row this request authenticated with. Revoking it is
//   permitted and signs this client out on its next request, so it is the one
//   row that needs saying so before it is clicked.
//
// The credential itself never lives here. Onboarding hands a candidate key to
// the main process, which writes it 0600 outside renderer storage; this module
// only ever sees the transport config that comes back.

import {
  negotiateCompatibility,
  supportsAccount,
} from '@/api/aion/v1/compat';
import {
  EdgeTransport,
  type APIKeySummary,
  type Account,
} from '@/api/aion/v1/transport';
import {
  getAionBackendState,
  resetAionBackendState,
  type AionKeySource,
} from './aionChatBridge';

/**
 * How the Account surface should behave this renderer lifetime. `needs-key` is
 * the onboarding state — a configured endpoint with no credential yet, which
 * is the one mode that is not a failure and not yet usable; `unsupported` is a
 * compatible edge below the 1.11 account floor, where the key in hand works
 * for everything else and simply cannot be described.
 */
export type AionAccountMode =
  | { kind: 'local' }
  | { kind: 'needs-key'; edgeBaseUrl: string }
  | { kind: 'remote'; edgeBaseUrl: string; keySource: AionKeySource }
  | { kind: 'unsupported'; edgeApiVersion: string }
  | { kind: 'error'; message: string };

export interface AionAccount {
  tenantId: string;
  keyId: string;
  /** Absent for a tenant-wide key that names nobody — not an unnamed user. */
  userId?: string;
  /** An EMPTY array means unrestricted, not powerless. */
  scopes: string[];
  cellId?: string;
  edgeApiVersion: string;
  /** Whether this deployment serves /keys; false hides key management. */
  keyManagement: boolean;
}

export interface AionApiKey {
  keyId: string;
  /** Absent for an unnamed key, which a surface renders by keyId. */
  label?: string;
  /** active | revoked */
  status: string;
  scopes: string[];
  userId?: string;
  createdAt: string;
  /** Absent when the key has never authenticated — never a zero timestamp. */
  lastUsedAt?: string;
  /** This client's own key. Revoking it is allowed and signs this app out. */
  current: boolean;
}

interface RemoteContext {
  mode: AionAccountMode;
  transport: EdgeTransport | null;
}

// Negotiated once per renderer lifetime, like every other aion surface; any
// error resolution drops the cache so reopening the panel retries.
let contextPromise: Promise<RemoteContext> | null = null;

function getContext(): Promise<RemoteContext> {
  contextPromise ??= resolveContext();
  return contextPromise;
}

async function resolveContext(): Promise<RemoteContext> {
  try {
    const state = await getAionBackendState();
    switch (state.kind) {
      case 'local':
        return { mode: { kind: 'local' }, transport: null };
      case 'error':
        contextPromise = null;
        return {
          mode: { kind: 'error', message: state.message },
          transport: null,
        };
      case 'needs-key':
        // Deliberately not cached as final: onboarding stores a key and resets
        // this module, and until then there is nothing to negotiate against.
        contextPromise = null;
        return {
          mode: { kind: 'needs-key', edgeBaseUrl: state.edgeBaseUrl },
          transport: null,
        };
      case 'ready':
        break;
    }
    const transport = new EdgeTransport({
      baseUrl: state.edgeBaseUrl,
      apiKey: state.apiKey,
    });
    const status = await transport.getIntegrationStatus();
    if (!supportsAccount(status)) {
      return {
        mode: { kind: 'unsupported', edgeApiVersion: status.edge_api_version },
        transport: null,
      };
    }
    return {
      mode: {
        kind: 'remote',
        edgeBaseUrl: state.edgeBaseUrl,
        keySource: state.keySource,
      },
      transport,
    };
  } catch (error) {
    contextPromise = null;
    const message = error instanceof Error ? error.message : String(error);
    return { mode: { kind: 'error', message }, transport: null };
  }
}

export async function getAionAccountMode(): Promise<AionAccountMode> {
  return (await getContext()).mode;
}

async function remoteTransport(): Promise<EdgeTransport> {
  const { mode, transport } = await getContext();
  if (!transport) {
    throw new Error(
      mode.kind === 'error'
        ? mode.message
        : 'The aion backend does not serve account information.'
    );
  }
  return transport;
}

function toAccount(account: Account): AionAccount {
  return {
    tenantId: account.tenant_id,
    keyId: account.key_id,
    userId: account.user_id,
    scopes: account.scopes ?? [],
    cellId: account.cell_id,
    edgeApiVersion: account.edge_api_version,
    keyManagement: account.key_management === true,
  };
}

function toApiKey(key: APIKeySummary): AionApiKey {
  return {
    keyId: key.key_id,
    label: key.label,
    status: key.status,
    scopes: key.scopes ?? [],
    userId: key.user_id,
    createdAt: key.created_at,
    lastUsedAt: key.last_used_at,
    current: key.current === true,
  };
}

// Promise-caches with explicit invalidation so concurrent opens share one
// fetch. The key list is invalidated by every mutation below; the account is
// not, because nothing this app can do changes who it is authenticated as —
// except revoking its own key, which ends the session anyway.
let accountPromise: Promise<AionAccount> | null = null;
let keysPromise: Promise<AionApiKey[]> | null = null;

export function invalidateAionAccount(): void {
  accountPromise = null;
  keysPromise = null;
}

export function loadAionAccount(): Promise<AionAccount> {
  accountPromise ??= fetchAccount().catch((error) => {
    accountPromise = null;
    throw error;
  });
  return accountPromise;
}

async function fetchAccount(): Promise<AionAccount> {
  const transport = await remoteTransport();
  return toAccount(await transport.getAccount());
}

export function loadAionApiKeys(): Promise<AionApiKey[]> {
  keysPromise ??= fetchKeys().catch((error) => {
    keysPromise = null;
    throw error;
  });
  return keysPromise;
}

async function fetchKeys(): Promise<AionApiKey[]> {
  const transport = await remoteTransport();
  const list = await transport.listKeys();
  return (list.keys ?? []).map(toApiKey);
}

/**
 * Mints a key carrying this caller's own grant. The secret comes back exactly
 * once, so it is returned to the caller rather than stored: a surface that
 * dropped it would be showing a key nobody can ever read again.
 *
 * A replay of the same request answers 200 with no secret. That is a success,
 * not an empty key, and the distinction is the caller's to render.
 */
export async function createAionApiKey(
  label?: string
): Promise<{ keyId: string; rawKey?: string; replayed: boolean }> {
  const transport = await remoteTransport();
  const trimmed = label?.trim();
  const created = await transport.createKey(
    trimmed ? { label: trimmed } : {}
  );
  invalidateAionAccount();
  return {
    keyId: created.key_id,
    rawKey: created.raw_key,
    replayed: created.idempotent_replay === true,
  };
}

/**
 * Revokes a key and returns the refreshed list. Revoking the `current` row is
 * permitted by the server and takes effect on this client's next request, so a
 * caller that offers it owes the user that warning first.
 */
export async function revokeAionApiKey(keyId: string): Promise<AionApiKey[]> {
  const transport = await remoteTransport();
  await transport.revokeKey(keyId);
  invalidateAionAccount();
  return loadAionApiKeys();
}

/**
 * Verifies a pasted key against whoami and, only if it answers, hands it to
 * the main process to store. Storing first would be the cheaper order and the
 * wrong one: a typo'd key would leave the app holding a credential that 401s
 * everywhere, on a profile whose only way back is the panel this key unlocks.
 *
 * Verification needs the account route, so a backend below the 1.11 floor
 * cannot be onboarded from here at all. It says so instead of storing a key it
 * cannot check.
 */
export async function verifyAndStoreAionApiKey(
  rawKey: string
): Promise<AionAccount> {
  const state = await getAionBackendState();
  if (state.kind === 'local') {
    throw new Error('This desktop has no aion backend configured.');
  }
  if (state.kind === 'error') {
    throw new Error(state.message);
  }
  if (state.kind === 'ready' && state.keySource === 'env') {
    throw new Error(
      'This backend’s API key is set in the environment, so it cannot be changed from the app.'
    );
  }

  const candidate = rawKey.trim();
  if (candidate === '') {
    throw new Error('Paste an API key first.');
  }

  const transport = new EdgeTransport({
    baseUrl: state.edgeBaseUrl,
    apiKey: candidate,
  });
  // /status is unauthenticated by design, so this only settles what the
  // backend can do — the key is proven by getAccount below.
  const status = await transport.getIntegrationStatus();
  const verdict = negotiateCompatibility(status);
  if (!verdict.compatible) {
    throw new Error(verdict.reason);
  }
  if (!supportsAccount(status)) {
    throw new Error(
      `This backend (edge API ${status.edge_api_version}) cannot verify an API key. ` +
        'Provide one through EIGENT_REMOTE_BACKEND_API_KEY_FILE instead.'
    );
  }
  const account = toAccount(await transport.getAccount());

  const stored = await (
    globalThis as {
      electronAPI?: {
        setAionApiKey?: (
          key: string
        ) => Promise<{ ok: true } | { ok: false; error: string }>;
      };
    }
  ).electronAPI?.setAionApiKey?.(candidate);
  if (!stored) {
    throw new Error('This build cannot store an API key.');
  }
  if (!stored.ok) {
    throw new Error(stored.error);
  }

  // The stored key is now the one in force; everything negotiated against the
  // old state is stale, including this module's own context.
  resetAionBackendState();
  contextPromise = null;
  invalidateAionAccount();
  return account;
}

/**
 * Clears the stored key, returning the app to onboarding. The key itself stays
 * valid on the server — signing out of a device is not revoking a credential,
 * and conflating them would revoke a key other devices may be holding.
 */
export async function clearStoredAionApiKey(): Promise<void> {
  const cleared = await (
    globalThis as {
      electronAPI?: {
        clearAionApiKey?: () => Promise<
          { ok: true } | { ok: false; error: string }
        >;
      };
    }
  ).electronAPI?.clearAionApiKey?.();
  if (!cleared) {
    throw new Error('This build cannot clear the stored API key.');
  }
  if (!cleared.ok) {
    throw new Error(cleared.error);
  }
  resetAionBackendState();
  contextPromise = null;
  invalidateAionAccount();
}
