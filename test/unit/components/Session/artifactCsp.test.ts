import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_CDN_HOSTS,
  artifactCsp,
  withArtifactCsp,
} from '@/components/Session/PreviewPanel/tabs/artifact/artifactCsp';

function directives(policy: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const part of policy.split(';')) {
    const [name, ...rest] = part.trim().split(/\s+/);
    if (name) map[name] = rest.join(' ');
  }
  return map;
}

describe('artifactCsp', () => {
  it('isolates the page by default', () => {
    const d = directives(artifactCsp(false));
    expect(d['default-src']).toBe("'none'");
    // Inline scripts still run — an agent-authored page is one file, and a
    // page whose own script is blocked is not a preview of anything.
    expect(d['script-src']).toBe("'unsafe-inline' 'unsafe-eval'");
    expect(d['img-src']).toBe('data: blob:');
    expect(d['style-src']).toBe("'unsafe-inline'");
    expect(d['font-src']).toBe('data:');
    for (const host of ARTIFACT_CDN_HOSTS) {
      expect(artifactCsp(false)).not.toContain(host);
    }
  });

  it('opts subresources in without opening the network', () => {
    const d = directives(artifactCsp(true));
    expect(d['script-src']).toContain('https://cdn.jsdelivr.net');
    expect(d['style-src']).toContain('https://cdn.jsdelivr.net');
    expect(d['img-src']).toContain('https://cdn.jsdelivr.net');
    expect(d['font-src']).toContain('https://cdn.jsdelivr.net');
    // The whole point of the toggle: a CDN dashboard renders, and the page
    // still has no way to send anything anywhere.
    expect(d['connect-src']).toBe("'none'");
  });

  it('keeps connect-src, form-action and base-uri closed in both states', () => {
    for (const allow of [false, true]) {
      const d = directives(artifactCsp(allow));
      expect(d['connect-src']).toBe("'none'");
      expect(d['form-action']).toBe("'none'");
      expect(d['base-uri']).toBe("'none'");
    }
  });
});

describe('withArtifactCsp', () => {
  it('injects the policy ahead of the page content', () => {
    const out = withArtifactCsp('<p>hi</p>', false);
    expect(out.indexOf('Content-Security-Policy')).toBeLessThan(
      out.indexOf('<p>hi</p>')
    );
  });

  it('keeps the doctype first', () => {
    // A meta placed before the doctype would drop the document into quirks
    // mode, which silently changes how every page lays out.
    const out = withArtifactCsp('<!DOCTYPE html>\n<html><body>x</body></html>', false);
    expect(out.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(out.indexOf('Content-Security-Policy')).toBeLessThan(
      out.indexOf('<html>')
    );
  });

  it('injects into a fragment with no doctype at all', () => {
    expect(withArtifactCsp('<h1>x</h1>', false)).toMatch(
      /^<meta http-equiv="Content-Security-Policy"/
    );
  });

  it('carries the relaxed policy when external resources are allowed', () => {
    expect(withArtifactCsp('<p>x</p>', true)).toContain(
      'https://cdn.jsdelivr.net'
    );
  });
});

describe('the CDN allowlist', () => {
  it('matches the app shell exactly', () => {
    // index.html is not importable, so the list is duplicated. A host added
    // there and missed here renders as a dashboard that silently draws
    // nothing, which is the failure this test exists to make loud.
    const indexHtml = readFileSync(
      resolve(process.cwd(), 'index.html'),
      'utf8'
    );
    const scriptSrc = indexHtml.split('script-src')[1]?.split(';')[0] ?? '';
    const shellHosts = scriptSrc.match(/https:\/\/[a-zA-Z0-9.-]+/g) ?? [];
    expect(shellHosts.length).toBeGreaterThan(0);
    expect([...ARTIFACT_CDN_HOSTS]).toEqual(shellHosts);
  });
});
