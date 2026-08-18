import { describe, expect, it } from 'vitest';
import {
  ANCHOR_CONTEXT_CHARS,
  MAX_ANCHOR_CHARS,
  buildRevisionText,
  captureAnchor,
  captureSelectionAnchor,
  relocateComment,
  type CommentAnchor,
} from '@/components/Session/PreviewPanel/tabs/artifact/commentAnchors';

function anchor(over: Partial<CommentAnchor> = {}): CommentAnchor {
  return {
    quotedText: 'the moon is made of cheese',
    prefixContext: 'Mars has two moons. ',
    suffixContext: ' Their orbits differ.',
    startOffset: 20,
    ...over,
  };
}

describe('captureAnchor', () => {
  const source = 'Mars has two moons. the moon is made of cheese Their orbits differ.';

  it('captures the quote with bounded contexts', () => {
    const start = source.indexOf('the moon');
    const end = start + 'the moon is made of cheese'.length;
    const got = captureAnchor(source, start, end);
    expect(got).toEqual({
      quotedText: 'the moon is made of cheese',
      prefixContext: 'Mars has two moons. ',
      suffixContext: ' Their orbits differ.',
      startOffset: start,
    });
  });

  it('bounds each context to the context window', () => {
    const long = 'x'.repeat(500);
    const src = `${long}QUOTE${long}`;
    const got = captureAnchor(src, 500, 505);
    expect(got?.prefixContext).toHaveLength(ANCHOR_CONTEXT_CHARS);
    expect(got?.suffixContext).toHaveLength(ANCHOR_CONTEXT_CHARS);
  });

  it('trims an oversized quote to the wire cap head', () => {
    const src = 'y'.repeat(MAX_ANCHOR_CHARS + 100);
    const got = captureAnchor(src, 0, src.length);
    expect(got?.quotedText).toHaveLength(MAX_ANCHOR_CHARS);
  });

  it('returns null for an empty or inverted range', () => {
    expect(captureAnchor(source, 5, 5)).toBeNull();
    expect(captureAnchor(source, 9, 4)).toBeNull();
  });

  it('clamps offsets past the end of the source', () => {
    const got = captureAnchor('abc', 1, 99);
    expect(got?.quotedText).toBe('bc');
    expect(got?.startOffset).toBe(1);
  });
});

describe('captureSelectionAnchor', () => {
  it('locates the selected text and builds contexts around it', () => {
    const source = 'alpha beta gamma delta';
    const got = captureSelectionAnchor(source, 'gamma');
    expect(got?.startOffset).toBe(source.indexOf('gamma'));
    expect(got?.prefixContext).toBe('alpha beta ');
    expect(got?.suffixContext).toBe(' delta');
  });

  it('keeps the quote with no contexts when the source lacks it', () => {
    // The rendered markdown showed "bold" where the source says "**bold**",
    // so a rendered selection may not appear verbatim in the source.
    const got = captureSelectionAnchor('plain text only', 'rendered words');
    expect(got).toEqual({
      quotedText: 'rendered words',
      prefixContext: '',
      suffixContext: '',
      startOffset: 0,
    });
  });

  it('returns null for an empty selection', () => {
    expect(captureSelectionAnchor('anything', '')).toBeNull();
  });
});

describe('relocateComment', () => {
  it('reports a document-level comment as document', () => {
    expect(relocateComment(anchor({ quotedText: '' }), 'whatever')).toEqual({
      kind: 'document',
    });
  });

  it('finds a quote that moved', () => {
    const revised = `A new opening paragraph pushed everything down.\nMars has two moons. the moon is made of cheese Their orbits differ.`;
    const got = relocateComment(anchor(), revised);
    expect(got).toEqual({
      kind: 'located',
      index: revised.indexOf('the moon is made of cheese'),
    });
  });

  it('reports a deleted quote as stale, never a near miss', () => {
    const revised = 'Mars has two moons. Their orbits differ.';
    expect(relocateComment(anchor(), revised)).toEqual({ kind: 'stale' });
  });

  it('disambiguates repeated quotes by surviving context', () => {
    const quoted = 'the result';
    const text = `First we compute the result quickly. Later, before: the result :after.`;
    const got = relocateComment(
      anchor({
        quotedText: quoted,
        prefixContext: 'before: ',
        suffixContext: ' :after',
        startOffset: 0,
      }),
      text
    );
    expect(got).toEqual({
      kind: 'located',
      index: text.lastIndexOf(quoted),
    });
  });

  it('breaks a context tie toward the original offset', () => {
    const text = 'aaa X bbb X ccc';
    const secondX = text.lastIndexOf('X');
    const got = relocateComment(
      anchor({
        quotedText: 'X',
        prefixContext: 'zz ',
        suffixContext: ' zz',
        startOffset: secondX,
      }),
      text
    );
    expect(got).toEqual({ kind: 'located', index: secondX });
  });
});

describe('buildRevisionText', () => {
  it('lists each comment with its quoted excerpt', () => {
    const got = buildRevisionText('report.md', [
      { quotedText: 'the moon is made of cheese', body: 'Fix this claim.' },
      { quotedText: '', body: 'Add a summary section.' },
    ]);
    expect(got).toContain('revise the artifact "report.md"');
    expect(got).toContain('these 2 comments');
    expect(got).toContain('1. "the moon is made of cheese" — Fix this claim.');
    expect(got).toContain('2. (whole document) — Add a summary section.');
  });

  it('flattens and truncates a long quote', () => {
    const got = buildRevisionText('report.md', [
      { quotedText: `line one\nline two ${'x'.repeat(300)}`, body: 'Trim.' },
    ]);
    expect(got).toContain('line one line two');
    expect(got).toContain('…');
    expect(got).not.toContain('\nline two');
  });

  it('uses the singular for one comment', () => {
    expect(buildRevisionText('a.md', [{ quotedText: 'q', body: 'b' }])).toContain(
      'this comment'
    );
  });
});
