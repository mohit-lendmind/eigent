// The desktop's only backend is a remotely configured aion edge. This module
// is the pure policy — endpoint validation and config resolution — kept free
// of Electron imports so it is unit-testable.
//
// Configuration is resolved ONCE at main-process startup from the
// environment. Absent or invalid configuration is `remote-invalid`: there is
// no other backend to fall back to, so it must fail visibly.

export const REMOTE_BACKEND_URL_ENV = 'EIGENT_REMOTE_BACKEND_URL';
export const REMOTE_BACKEND_API_KEY_ENV = 'EIGENT_REMOTE_BACKEND_API_KEY';
export const REMOTE_BACKEND_API_KEY_FILE_ENV =
  'EIGENT_REMOTE_BACKEND_API_KEY_FILE';

/**
 * Where the resolved key came from, and therefore whether this app may change
 * it. An `env` key is the operator's: onboarding must not offer to replace a
 * credential that a restart would silently restore.
 */
export type ApiKeySource = 'env' | 'file';

export type RemoteBackendResolution =
  | {
      mode: 'remote';
      edgeBaseUrl: string;
      apiKey: string;
      keySource: ApiKeySource;
      /** Where a replacement key is written; empty when the key is env-pinned. */
      keyFilePath: string;
    }
  /** Endpoint known, credential absent — the onboarding state, not a failure. */
  | { mode: 'remote-needs-key'; edgeBaseUrl: string; keyFilePath: string }
  | { mode: 'remote-invalid'; error: string };

/**
 * The minimum authenticated transport configuration the renderer receives.
 * Nothing else about the main-process environment crosses the bridge — the
 * key file's path stays here, because the renderer never writes it.
 */
export type RendererTransportConfig =
  | {
      mode: 'remote';
      edgeBaseUrl: string;
      apiKey: string;
      keySource: ApiKeySource;
    }
  | { mode: 'remote'; edgeBaseUrl: string; needsKey: true }
  | { mode: 'remote'; error: string };

const LOOPBACK_IPV4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '[::1]' ||
    LOOPBACK_IPV4.test(hostname)
  );
}

/**
 * Validates an edge endpoint against the allowed set — HTTPS anywhere, or
 * plain HTTP strictly on loopback (the local Compose edge). Returns the
 * normalized base URL; throws with the reason otherwise.
 */
export function validateEdgeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`edge URL is not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'https:') {
    if (url.protocol !== 'http:') {
      throw new Error(
        `edge URL must use https (or http on loopback), got ${url.protocol.replace(/:$/, '')}`
      );
    }
    if (!isLoopbackHost(url.hostname)) {
      throw new Error(
        `plain http is only allowed for loopback endpoints, got host ${url.hostname}`
      );
    }
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('edge URL must not embed credentials');
  }
  if (url.search !== '' || url.hash !== '') {
    throw new Error('edge URL must not carry a query or fragment');
  }
  return url.origin + url.pathname.replace(/\/+$/, '');
}

/**
 * Trims a pasted API key and refuses one that could not be a credential.
 * Whitespace inside is rejected rather than stripped: a key that arrived
 * wrapped across two lines is a truncated paste, and silently repairing it
 * would authenticate as something the user did not paste.
 */
export function normalizeApiKey(raw: string): string {
  const key = raw.trim();
  if (key === '') {
    throw new Error('API key is empty');
  }
  if (/\s/.test(key)) {
    throw new Error('API key contains whitespace; paste it as one line');
  }
  return key;
}

/** True when the read failed because nothing is there yet. */
function isMissingFile(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * Resolves the edge configuration from the environment. `readFile` is
 * injected so the key-file path stays testable; the caller passes
 * fs.readFileSync.
 *
 * Key precedence is operator-first: the direct env key wins, then the file —
 * `storedKeyPath` (where onboarding writes) is used only when the environment
 * names no file of its own, so an operator-provisioned deployment cannot be
 * re-pointed by whatever a previous user pasted, and the harness path stays
 * the one path in play when it is set.
 *
 * An ABSENT credential resolves to `remote-needs-key`, not an error: the
 * endpoint is known and the app can ask for a key. A key file that exists but
 * cannot be read, or is empty, stays invalid — absence and failure are
 * different, and only absence is something onboarding can fix.
 */
export function resolveRemoteBackend(
  env: Record<string, string | undefined>,
  readFile: (path: string) => string,
  storedKeyPath = ''
): RemoteBackendResolution {
  const rawUrl = env[REMOTE_BACKEND_URL_ENV]?.trim();
  if (!rawUrl) {
    return {
      mode: 'remote-invalid',
      error: `no backend configured: set ${REMOTE_BACKEND_URL_ENV} and an API key via ${REMOTE_BACKEND_API_KEY_ENV} or ${REMOTE_BACKEND_API_KEY_FILE_ENV}`,
    };
  }

  let edgeBaseUrl: string;
  try {
    edgeBaseUrl = validateEdgeBaseUrl(rawUrl);
  } catch (error) {
    return {
      mode: 'remote-invalid',
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const envKey = env[REMOTE_BACKEND_API_KEY_ENV]?.trim() ?? '';
  if (envKey !== '') {
    return {
      mode: 'remote',
      edgeBaseUrl,
      apiKey: envKey,
      keySource: 'env',
      keyFilePath: '',
    };
  }

  const keyFilePath =
    env[REMOTE_BACKEND_API_KEY_FILE_ENV]?.trim() || storedKeyPath;
  if (keyFilePath === '') {
    return {
      mode: 'remote-invalid',
      error: `${REMOTE_BACKEND_URL_ENV} is set but neither ${REMOTE_BACKEND_API_KEY_ENV} nor ${REMOTE_BACKEND_API_KEY_FILE_ENV} provides an API key, and this app has nowhere to store one`,
    };
  }

  let apiKey: string;
  try {
    apiKey = readFile(keyFilePath).trim();
  } catch (error) {
    if (isMissingFile(error)) {
      return { mode: 'remote-needs-key', edgeBaseUrl, keyFilePath };
    }
    return {
      mode: 'remote-invalid',
      error: `failed to read the API key file (${keyFilePath}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  if (apiKey === '') {
    // A key file emptied rather than deleted is how signing out leaves the
    // profile, so it means the same thing as an absent one.
    return { mode: 'remote-needs-key', edgeBaseUrl, keyFilePath };
  }

  return {
    mode: 'remote',
    edgeBaseUrl,
    apiKey,
    keySource: 'file',
    keyFilePath,
  };
}

export function rendererTransportConfig(
  resolution: RemoteBackendResolution
): RendererTransportConfig {
  switch (resolution.mode) {
    case 'remote':
      return {
        mode: 'remote',
        edgeBaseUrl: resolution.edgeBaseUrl,
        apiKey: resolution.apiKey,
        keySource: resolution.keySource,
      };
    case 'remote-needs-key':
      return {
        mode: 'remote',
        edgeBaseUrl: resolution.edgeBaseUrl,
        needsKey: true,
      };
    case 'remote-invalid':
      return { mode: 'remote', error: resolution.error };
  }
}
