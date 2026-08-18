import { describe, expect, it } from 'vitest';
import {
  baseMediaType,
  formatArtifactSize,
  groupArtifacts,
  isBrowserFrame,
  laneForArtifact,
  languageForArtifact,
} from '@/components/Session/PreviewPanel/tabs/artifact/artifactLanes';
import type { AionArtifact } from '@/store/aionArtifactsStore';

function artifact(over: Partial<AionArtifact> = {}): AionArtifact {
  return {
    artifactId: 'art-1',
    projectId: 'prj-1',
    name: 'report.md',
    version: 1,
    mediaType: 'text/markdown',
    sizeBytes: 100,
    sha256: 'a'.repeat(64),
    createdAt: '2026-08-18T00:00:00Z',
    ...over,
  };
}

describe('baseMediaType', () => {
  it('drops parameters and case', () => {
    expect(baseMediaType('Text/HTML; charset=utf-8')).toBe('text/html');
  });

  it('survives an empty media type', () => {
    expect(baseMediaType('')).toBe('');
  });
});

describe('laneForArtifact', () => {
  it.each([
    ['text/markdown', 'markdown'],
    ['text/html', 'html'],
    ['text/html; charset=utf-8', 'html'],
    ['application/pdf', 'pdf'],
    ['image/png', 'image'],
    ['image/svg+xml', 'image'],
    ['text/plain', 'code'],
    ['text/x-python', 'code'],
    ['text/csv', 'code'],
    ['application/json', 'code'],
    ['application/typescript', 'code'],
    ['application/x-ndjson', 'code'],
    ['application/yaml', 'code'],
  ] as const)('routes %s to the %s lane', (mediaType, lane) => {
    expect(laneForArtifact(mediaType)).toBe(lane);
  });

  it('offers a download for a type the edge will not inline', () => {
    // Nothing renders these and asking for them inline comes back empty, so a
    // viewer lane would be a permanently blank pane.
    expect(laneForArtifact('application/zip')).toBe('download');
    expect(laneForArtifact('application/octet-stream')).toBe('download');
    expect(laneForArtifact('video/webm')).toBe('download');
  });
});

describe('languageForArtifact', () => {
  it('prefers the media type over the name', () => {
    // A publisher that identified the content outranks an extension: the
    // extension is what it fell back to when it could not.
    expect(languageForArtifact('application/typescript', 'notes.txt')).toBe(
      'typescript'
    );
  });

  it('falls through to the name for text/plain', () => {
    // Every unknown extension publishes as text/plain, so the name is the one
    // signal left — mapping text/plain to plaintext would throw it away.
    expect(languageForArtifact('text/plain', 'main.rs')).toBe('rust');
  });

  it('falls back to plaintext when neither signal names a language', () => {
    expect(languageForArtifact('text/plain', 'LICENSE')).toBe('plaintext');
  });
});

describe('isBrowserFrame', () => {
  it('recognizes a viewfinder frame', () => {
    expect(isBrowserFrame('aion-browser-frame-000012.png')).toBe(true);
  });

  it('leaves a deliberate screenshot alone', () => {
    expect(isBrowserFrame('checkout-page.png')).toBe(false);
  });
});

describe('groupArtifacts', () => {
  it('groups versions of one name newest first', () => {
    const { documents } = groupArtifacts([
      artifact({ artifactId: 'a3', version: 3, sizeBytes: 300 }),
      artifact({ artifactId: 'a1', version: 1, sizeBytes: 100 }),
      artifact({ artifactId: 'a2', version: 2, sizeBytes: 200 }),
    ]);
    expect(documents).toHaveLength(1);
    expect(documents[0].versions.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(documents[0].latest.artifactId).toBe('a3');
  });

  it('splits captures out of documents', () => {
    const { documents, captures } = groupArtifacts([
      artifact({ artifactId: 'd', name: 'report.md' }),
      artifact({
        artifactId: 'c',
        name: 'chart.png',
        mediaType: 'image/png',
      }),
    ]);
    expect(documents.map((g) => g.name)).toEqual(['report.md']);
    expect(captures.map((g) => g.name)).toEqual(['chart.png']);
  });

  it('drops viewfinder frames entirely', () => {
    // A browsing run publishes one per action; leaving them in buries the
    // deliverable under the evidence of how it was produced.
    const grouped = groupArtifacts([
      artifact({ artifactId: 'd', name: 'report.md' }),
      ...Array.from({ length: 20 }, (_, i) =>
        artifact({
          artifactId: `f${i}`,
          name: `aion-browser-frame-${i}.png`,
          mediaType: 'image/png',
        })
      ),
    ]);
    expect(grouped.documents.map((g) => g.name)).toEqual(['report.md']);
    expect(grouped.captures).toEqual([]);
  });

  it('keeps the listing order across names', () => {
    const { documents } = groupArtifacts([
      artifact({ artifactId: 'b', name: 'second.md' }),
      artifact({ artifactId: 'a', name: 'first.md' }),
    ]);
    expect(documents.map((g) => g.name)).toEqual(['second.md', 'first.md']);
  });

  it('derives the lane from the newest version', () => {
    const { documents } = groupArtifacts([
      artifact({ artifactId: 'a2', version: 2, mediaType: 'text/html' }),
      artifact({ artifactId: 'a1', version: 1, mediaType: 'text/markdown' }),
    ]);
    expect(documents[0].lane).toBe('html');
  });
});

describe('formatArtifactSize', () => {
  it('keeps small sizes exact', () => {
    expect(formatArtifactSize(0)).toBe('0 B');
    expect(formatArtifactSize(1023)).toBe('1023 B');
  });

  it('scales past a kilobyte', () => {
    expect(formatArtifactSize(1024)).toBe('1.0 KB');
    expect(formatArtifactSize(60941)).toBe('59.5 KB');
    expect(formatArtifactSize(2 * 1024 * 1024)).toBe('2.0 MB');
  });
});
