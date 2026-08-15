import { describe, expect, it } from 'vitest';

import {
  normalizeApiKey,
  REMOTE_BACKEND_API_KEY_ENV,
  REMOTE_BACKEND_API_KEY_FILE_ENV,
  REMOTE_BACKEND_URL_ENV,
  rendererTransportConfig,
  resolveRemoteBackend,
  validateEdgeBaseUrl,
} from '../../../electron/main/remoteBackend';

/** A read that fails the way an absent file does — code, not message. */
const failsWith = (code: string, message: string) => (): string => {
  const error: NodeJS.ErrnoException = new Error(message);
  error.code = code;
  throw error;
};

const enoent = failsWith('ENOENT', 'ENOENT: no such file');

const noFile = (): string => {
  throw new Error('no file expected');
};

describe('validateEdgeBaseUrl', () => {
  it('accepts https anywhere and normalizes the trailing slash', () => {
    expect(validateEdgeBaseUrl('https://edge.example.com/eigent/v1/')).toBe(
      'https://edge.example.com/eigent/v1'
    );
    expect(validateEdgeBaseUrl('https://edge.example.com')).toBe(
      'https://edge.example.com'
    );
  });

  it('accepts plain http strictly on loopback', () => {
    expect(validateEdgeBaseUrl('http://127.0.0.1:8106/eigent/v1')).toBe(
      'http://127.0.0.1:8106/eigent/v1'
    );
    expect(validateEdgeBaseUrl('http://localhost:8106')).toBe(
      'http://localhost:8106'
    );
    expect(validateEdgeBaseUrl('http://[::1]:8106')).toBe('http://[::1]:8106');
    // Anything in 127/8 is loopback, not just .0.0.1.
    expect(validateEdgeBaseUrl('http://127.10.0.3:8106')).toBe(
      'http://127.10.0.3:8106'
    );
  });

  it('rejects plain http on non-loopback hosts', () => {
    expect(() => validateEdgeBaseUrl('http://edge.example.com')).toThrow(
      /loopback/
    );
    expect(() => validateEdgeBaseUrl('http://192.168.1.20:8106')).toThrow(
      /loopback/
    );
    // A name that merely resolves to loopback is not statically verifiable.
    expect(() => validateEdgeBaseUrl('http://myhost.localdomain')).toThrow(
      /loopback/
    );
  });

  it('rejects non-http(s) schemes, credentials, query, and fragment', () => {
    expect(() => validateEdgeBaseUrl('ws://127.0.0.1:8106')).toThrow(/https/);
    expect(() => validateEdgeBaseUrl('file:///etc/passwd')).toThrow(/https/);
    expect(() =>
      validateEdgeBaseUrl('https://user:pass@edge.example.com')
    ).toThrow(/credentials/);
    expect(() => validateEdgeBaseUrl('https://edge.example.com/?x=1')).toThrow(
      /query or fragment/
    );
    expect(() => validateEdgeBaseUrl('https://edge.example.com/#frag')).toThrow(
      /query or fragment/
    );
    expect(() => validateEdgeBaseUrl('not a url')).toThrow(/not a valid URL/);
  });
});

describe('resolveRemoteBackend', () => {
  it('refuses to resolve when the URL is unset or blank', () => {
    for (const env of [{}, { [REMOTE_BACKEND_URL_ENV]: '   ' }]) {
      const result = resolveRemoteBackend(env, noFile);
      expect(result.mode).toBe('remote-invalid');
      expect(result).toMatchObject({
        error: expect.stringContaining('no backend configured'),
      });
    }
  });

  it('resolves remote mode from a direct API key', () => {
    expect(
      resolveRemoteBackend(
        {
          [REMOTE_BACKEND_URL_ENV]: 'http://127.0.0.1:8106/eigent/v1/',
          [REMOTE_BACKEND_API_KEY_ENV]: '  sk-desktop-key  ',
        },
        noFile
      )
    ).toEqual({
      mode: 'remote',
      edgeBaseUrl: 'http://127.0.0.1:8106/eigent/v1',
      apiKey: 'sk-desktop-key',
      keySource: 'env',
      // No write target: a file written here would be shadowed by the
      // environment on the next restart.
      keyFilePath: '',
    });
  });

  it('resolves remote mode from a key file, trimming its contents', () => {
    const reads: string[] = [];
    const result = resolveRemoteBackend(
      {
        [REMOTE_BACKEND_URL_ENV]: 'https://edge.example.com',
        [REMOTE_BACKEND_API_KEY_FILE_ENV]: '/run/edge-api-key',
      },
      (file) => {
        reads.push(file);
        return 'sk-from-file\n';
      }
    );
    expect(result).toEqual({
      mode: 'remote',
      edgeBaseUrl: 'https://edge.example.com',
      apiKey: 'sk-from-file',
      keySource: 'file',
      keyFilePath: '/run/edge-api-key',
    });
    expect(reads).toEqual(['/run/edge-api-key']);
  });

  it('uses the app-stored key path only when the environment names none', () => {
    const env = { [REMOTE_BACKEND_URL_ENV]: 'https://edge.example.com' };
    expect(
      resolveRemoteBackend(env, () => 'sk-stored', '/userData/aion-key')
    ).toMatchObject({
      mode: 'remote',
      apiKey: 'sk-stored',
      keySource: 'file',
      keyFilePath: '/userData/aion-key',
    });
    // An operator-provisioned path outranks it, so a pasted key can never
    // re-point a deployment that was configured for one.
    const reads: string[] = [];
    expect(
      resolveRemoteBackend(
        { ...env, [REMOTE_BACKEND_API_KEY_FILE_ENV]: '/run/edge-api-key' },
        (file) => {
          reads.push(file);
          return 'sk-operator';
        },
        '/userData/aion-key'
      )
    ).toMatchObject({ apiKey: 'sk-operator', keyFilePath: '/run/edge-api-key' });
    expect(reads).toEqual(['/run/edge-api-key']);
  });

  it('treats an absent credential as onboarding, not failure', () => {
    const env = {
      [REMOTE_BACKEND_URL_ENV]: 'https://edge.example.com',
      [REMOTE_BACKEND_API_KEY_FILE_ENV]: '/run/edge-api-key',
    };
    // Nothing written yet.
    expect(resolveRemoteBackend(env, enoent)).toEqual({
      mode: 'remote-needs-key',
      edgeBaseUrl: 'https://edge.example.com',
      keyFilePath: '/run/edge-api-key',
    });
    // Truncated rather than deleted — how signing out leaves the profile.
    expect(resolveRemoteBackend(env, () => '\n')).toEqual({
      mode: 'remote-needs-key',
      edgeBaseUrl: 'https://edge.example.com',
      keyFilePath: '/run/edge-api-key',
    });
    // And with no env file at all, the app's own path is the one to fill.
    expect(
      resolveRemoteBackend(
        { [REMOTE_BACKEND_URL_ENV]: 'https://edge.example.com' },
        enoent,
        '/userData/aion-key'
      )
    ).toEqual({
      mode: 'remote-needs-key',
      edgeBaseUrl: 'https://edge.example.com',
      keyFilePath: '/userData/aion-key',
    });
  });

  it('keeps a key file that exists but cannot be read an error', () => {
    // Absence is fixable from the app; a permission failure is not, and
    // reporting it as onboarding would send the user to paste a key into a
    // file the app still cannot write.
    expect(
      resolveRemoteBackend(
        {
          [REMOTE_BACKEND_URL_ENV]: 'https://edge.example.com',
          [REMOTE_BACKEND_API_KEY_FILE_ENV]: '/run/edge-api-key',
        },
        failsWith('EACCES', 'EACCES: permission denied')
      )
    ).toMatchObject({
      mode: 'remote-invalid',
      error: expect.stringContaining('EACCES'),
    });
  });

  it('prefers the direct key over the key file', () => {
    const result = resolveRemoteBackend(
      {
        [REMOTE_BACKEND_URL_ENV]: 'https://edge.example.com',
        [REMOTE_BACKEND_API_KEY_ENV]: 'sk-direct',
        [REMOTE_BACKEND_API_KEY_FILE_ENV]: '/run/edge-api-key',
      },
      noFile
    );
    expect(result).toEqual({
      mode: 'remote',
      edgeBaseUrl: 'https://edge.example.com',
      apiKey: 'sk-direct',
      keySource: 'env',
      keyFilePath: '',
    });
  });

  it('never falls back to local mode once the URL is set', () => {
    // Invalid URL.
    expect(
      resolveRemoteBackend(
        {
          [REMOTE_BACKEND_URL_ENV]: 'http://edge.example.com',
          [REMOTE_BACKEND_API_KEY_ENV]: 'sk',
        },
        noFile
      )
    ).toMatchObject({
      mode: 'remote-invalid',
      error: expect.stringContaining('loopback'),
    });
    // No key and nowhere to put one: onboarding has no target, so this is a
    // misconfiguration rather than a screen the user can clear.
    expect(
      resolveRemoteBackend(
        { [REMOTE_BACKEND_URL_ENV]: 'https://edge.example.com' },
        noFile
      )
    ).toMatchObject({
      mode: 'remote-invalid',
      error: expect.stringContaining(REMOTE_BACKEND_API_KEY_ENV),
    });
  });
});

describe('normalizeApiKey', () => {
  it('trims a pasted key', () => {
    expect(normalizeApiKey('  sk-pasted\n')).toBe('sk-pasted');
  });

  it('refuses what cannot be a credential', () => {
    expect(() => normalizeApiKey('   ')).toThrow(/empty/);
    // A key wrapped across two lines is a truncated paste. Stripping the break
    // would store — and authenticate as — something nobody pasted.
    expect(() => normalizeApiKey('sk-first\nsk-second')).toThrow(/whitespace/);
    expect(() => normalizeApiKey('sk with space')).toThrow(/whitespace/);
  });
});

describe('rendererTransportConfig', () => {
  it('passes a valid remote configuration through', () => {
    expect(
      rendererTransportConfig({
        mode: 'remote',
        edgeBaseUrl: 'https://edge.example.com',
        apiKey: 'sk',
        keySource: 'file',
        keyFilePath: '/run/edge-api-key',
      })
    ).toEqual({
      mode: 'remote',
      edgeBaseUrl: 'https://edge.example.com',
      apiKey: 'sk',
      // The renderer learns whether the key is replaceable, never where it
      // lives — it has no business writing that path.
      keySource: 'file',
    });
  });

  it('offers the endpoint, and no key, when onboarding is pending', () => {
    const config = rendererTransportConfig({
      mode: 'remote-needs-key',
      edgeBaseUrl: 'https://edge.example.com',
      keyFilePath: '/run/edge-api-key',
    });
    expect(config).toEqual({
      mode: 'remote',
      edgeBaseUrl: 'https://edge.example.com',
      needsKey: true,
    });
    // Onboarding verifies against this endpoint before storing anything, so
    // the URL crosses the bridge; the key-file path does not.
    expect(JSON.stringify(config)).not.toContain('/run/edge-api-key');
  });

  it('maps an invalid remote configuration to an error without secrets', () => {
    const config = rendererTransportConfig({
      mode: 'remote-invalid',
      error: 'bad endpoint',
    });
    expect(config).toEqual({ mode: 'remote', error: 'bad endpoint' });
    expect(JSON.stringify(config)).not.toContain('apiKey');
  });
});
