// Remote-backend Electron mode (doc 10 §10 WP3): the desktop talks to a
// remotely configured aion edge instead of supervising a local Python
// backend. This module is the pure policy — endpoint validation and config
// resolution — kept free of Electron imports so it is unit-testable.
//
// Mode is decided ONCE at main-process startup from the environment. A set
// but invalid configuration is `remote-invalid`, never a silent fallback to
// legacy local mode: half-configured remote intent must fail visibly, not
// spawn uvicorn.

export const REMOTE_BACKEND_URL_ENV = 'EIGENT_REMOTE_BACKEND_URL';
export const REMOTE_BACKEND_API_KEY_ENV = 'EIGENT_REMOTE_BACKEND_API_KEY';
export const REMOTE_BACKEND_API_KEY_FILE_ENV =
  'EIGENT_REMOTE_BACKEND_API_KEY_FILE';

export type RemoteBackendResolution =
  | { mode: 'local' }
  | { mode: 'remote'; edgeBaseUrl: string; apiKey: string }
  | { mode: 'remote-invalid'; error: string };

/**
 * The minimum authenticated transport configuration the renderer receives.
 * Nothing else about the main-process environment crosses the bridge.
 */
export type RendererTransportConfig =
  | { mode: 'local' }
  | { mode: 'remote'; edgeBaseUrl: string; apiKey: string }
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
 * Resolves the backend mode from the environment. `readFile` is injected so
 * the key-file path stays testable; the caller passes fs.readFileSync.
 * When both key sources are set, the direct key wins.
 *
 * A thin build carries no local Brain, so `local` is not a mode it can run:
 * absent remote configuration resolves to `remote-invalid` with an
 * actionable error instead of a backend that can never start.
 */
export function resolveRemoteBackend(
  env: Record<string, string | undefined>,
  readFile: (path: string) => string,
  { thinBuild = false }: { thinBuild?: boolean } = {}
): RemoteBackendResolution {
  const rawUrl = env[REMOTE_BACKEND_URL_ENV]?.trim();
  if (!rawUrl) {
    if (thinBuild) {
      return {
        mode: 'remote-invalid',
        error: `this build has no local backend: set ${REMOTE_BACKEND_URL_ENV} and an API key via ${REMOTE_BACKEND_API_KEY_ENV} or ${REMOTE_BACKEND_API_KEY_FILE_ENV}`,
      };
    }
    return { mode: 'local' };
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

  let apiKey = env[REMOTE_BACKEND_API_KEY_ENV]?.trim() ?? '';
  if (apiKey === '') {
    const keyFile = env[REMOTE_BACKEND_API_KEY_FILE_ENV]?.trim();
    if (!keyFile) {
      return {
        mode: 'remote-invalid',
        error: `${REMOTE_BACKEND_URL_ENV} is set but neither ${REMOTE_BACKEND_API_KEY_ENV} nor ${REMOTE_BACKEND_API_KEY_FILE_ENV} provides an API key`,
      };
    }
    try {
      apiKey = readFile(keyFile).trim();
    } catch (error) {
      return {
        mode: 'remote-invalid',
        error: `failed to read ${REMOTE_BACKEND_API_KEY_FILE_ENV} (${keyFile}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
    if (apiKey === '') {
      return {
        mode: 'remote-invalid',
        error: `API key file ${keyFile} is empty`,
      };
    }
  }

  return { mode: 'remote', edgeBaseUrl, apiKey };
}

export function rendererTransportConfig(
  resolution: RemoteBackendResolution
): RendererTransportConfig {
  switch (resolution.mode) {
    case 'local':
      return { mode: 'local' };
    case 'remote':
      return {
        mode: 'remote',
        edgeBaseUrl: resolution.edgeBaseUrl,
        apiKey: resolution.apiKey,
      };
    case 'remote-invalid':
      return { mode: 'remote', error: resolution.error };
  }
}
