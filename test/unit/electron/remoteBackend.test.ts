import { describe, expect, it } from 'vitest';

import {
  REMOTE_BACKEND_API_KEY_ENV,
  REMOTE_BACKEND_API_KEY_FILE_ENV,
  REMOTE_BACKEND_URL_ENV,
  rendererTransportConfig,
  resolveRemoteBackend,
  validateEdgeBaseUrl,
} from '../../../electron/main/remoteBackend';

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
  it('resolves local mode when the URL is unset or blank', () => {
    expect(resolveRemoteBackend({}, noFile)).toEqual({ mode: 'local' });
    expect(
      resolveRemoteBackend({ [REMOTE_BACKEND_URL_ENV]: '   ' }, noFile)
    ).toEqual({ mode: 'local' });
  });

  it('never resolves local mode in a thin build', () => {
    const result = resolveRemoteBackend({}, noFile, { thinBuild: true });
    expect(result.mode).toBe('remote-invalid');
    expect(result).toMatchObject({
      error: expect.stringContaining('no local backend'),
    });
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
    });
    expect(reads).toEqual(['/run/edge-api-key']);
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
    ).toMatchObject({ mode: 'remote-invalid', error: expect.stringContaining('loopback') });
    // Missing key.
    expect(
      resolveRemoteBackend(
        { [REMOTE_BACKEND_URL_ENV]: 'https://edge.example.com' },
        noFile
      )
    ).toMatchObject({
      mode: 'remote-invalid',
      error: expect.stringContaining(REMOTE_BACKEND_API_KEY_ENV),
    });
    // Unreadable key file.
    expect(
      resolveRemoteBackend(
        {
          [REMOTE_BACKEND_URL_ENV]: 'https://edge.example.com',
          [REMOTE_BACKEND_API_KEY_FILE_ENV]: '/missing',
        },
        () => {
          throw new Error('ENOENT');
        }
      )
    ).toMatchObject({ mode: 'remote-invalid', error: expect.stringContaining('ENOENT') });
    // Empty key file.
    expect(
      resolveRemoteBackend(
        {
          [REMOTE_BACKEND_URL_ENV]: 'https://edge.example.com',
          [REMOTE_BACKEND_API_KEY_FILE_ENV]: '/run/empty',
        },
        () => '\n'
      )
    ).toMatchObject({ mode: 'remote-invalid', error: expect.stringContaining('empty') });
  });
});

describe('rendererTransportConfig', () => {
  it('passes through local and valid remote configurations', () => {
    expect(rendererTransportConfig({ mode: 'local' })).toEqual({
      mode: 'local',
    });
    expect(
      rendererTransportConfig({
        mode: 'remote',
        edgeBaseUrl: 'https://edge.example.com',
        apiKey: 'sk',
      })
    ).toEqual({
      mode: 'remote',
      edgeBaseUrl: 'https://edge.example.com',
      apiKey: 'sk',
    });
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
