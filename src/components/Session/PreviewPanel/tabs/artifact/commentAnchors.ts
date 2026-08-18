// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

// Pure anchor arithmetic for artifact comments. A comment is anchored by the
// text it quotes plus a bounded excerpt of what surrounds it, never by an
// offset alone: offsets do not survive a revision, but a quoted sentence
// usually does, and when it does not the comment must read as stale rather
// than point somewhere wrong. Nothing here touches the DOM or the store, so
// every branch is unit-testable on plain strings.

/** How many characters of surrounding text each side of the quote carries. */
export const ANCHOR_CONTEXT_CHARS = 48;

/**
 * The wire cap on each anchor string (`maxCommentAnchorBytes` on the edge).
 * Quotes are excerpts, not documents; a selection past this cap is trimmed to
 * its head rather than refused, because the head is what relocation searches.
 */
export const MAX_ANCHOR_CHARS = 2000;

export interface CommentAnchor {
  /** The selected text. Empty means a document-level comment. */
  quotedText: string;
  prefixContext: string;
  suffixContext: string;
  /** Where the quote started in the version it was made against. */
  startOffset: number;
}

/**
 * Where a comment's quote lives in the text on screen now.
 * - `located`: found; `index` is where the quote starts in this text.
 * - `document`: the comment quotes nothing — it is about the whole artifact.
 * - `stale`: the quoted text no longer exists in this text; the comment
 *   renders against its original version rather than mis-anchored.
 */
export type CommentRelocation =
  | { kind: 'located'; index: number }
  | { kind: 'document' }
  | { kind: 'stale' };

/** Builds an anchor from exact offsets into the source text (the Monaco path). */
export function captureAnchor(
  source: string,
  start: number,
  end: number
): CommentAnchor | null {
  const from = Math.max(0, Math.min(start, source.length));
  const to = Math.max(from, Math.min(end, source.length));
  if (to === from) return null;
  return {
    quotedText: source.slice(from, Math.min(to, from + MAX_ANCHOR_CHARS)),
    prefixContext: source.slice(Math.max(0, from - ANCHOR_CONTEXT_CHARS), from),
    suffixContext: source.slice(to, to + ANCHOR_CONTEXT_CHARS),
    startOffset: from,
  };
}

/**
 * Builds an anchor from selected TEXT whose offsets are unknown (the rendered
 * markdown path, where the DOM selection's text usually appears verbatim in
 * the source but its rendered position does not map to a source offset). The
 * selection is located by search; when the source does not contain it — the
 * renderer transformed it — the anchor keeps the quote with no contexts, so
 * relocation still works by quote alone.
 */
export function captureSelectionAnchor(
  source: string,
  selectedText: string
): CommentAnchor | null {
  const quoted = selectedText.slice(0, MAX_ANCHOR_CHARS);
  if (!quoted) return null;
  const index = source.indexOf(quoted);
  if (index < 0) {
    return { quotedText: quoted, prefixContext: '', suffixContext: '', startOffset: 0 };
  }
  return captureAnchor(source, index, index + quoted.length);
}

/**
 * Finds where an anchor's quote lives in `text` — typically a NEWER version
 * of the artifact it was made against. Every occurrence of the quote is
 * scored by how much of the recorded prefix/suffix context matches around it;
 * the best score wins, and a tie goes to the occurrence nearest the original
 * offset, which is the deterministic reading of "the same place moved".
 * Computed at read time, never persisted per version.
 */
export function relocateComment(
  anchor: CommentAnchor,
  text: string
): CommentRelocation {
  if (!anchor.quotedText) return { kind: 'document' };
  let best: { index: number; score: number } | null = null;
  let from = 0;
  for (;;) {
    const index = text.indexOf(anchor.quotedText, from);
    if (index < 0) break;
    const score = contextScore(anchor, text, index);
    if (
      !best ||
      score > best.score ||
      (score === best.score &&
        Math.abs(index - anchor.startOffset) <
          Math.abs(best.index - anchor.startOffset))
    ) {
      best = { index, score };
    }
    from = index + 1;
  }
  if (!best) return { kind: 'stale' };
  return { kind: 'located', index: best.index };
}

/**
 * How many characters of the recorded contexts survive around an occurrence,
 * measured from the quote outward — the direction a revision erodes them.
 */
function contextScore(
  anchor: CommentAnchor,
  text: string,
  index: number
): number {
  let score = 0;
  const prefix = anchor.prefixContext;
  for (let i = 0; i < prefix.length; i++) {
    const at = index - 1 - i;
    if (at < 0 || text[at] !== prefix[prefix.length - 1 - i]) break;
    score++;
  }
  const suffix = anchor.suffixContext;
  const end = index + anchor.quotedText.length;
  for (let i = 0; i < suffix.length; i++) {
    const at = end + i;
    if (at >= text.length || text[at] !== suffix[i]) break;
    score++;
  }
  return score;
}

/** What a revision request names about one comment. */
export interface RevisionComment {
  quotedText: string;
  body: string;
}

const REVISION_QUOTE_CHARS = 120;

/**
 * The user-visible text of a revision turn. The worker inlines each comment's
 * full anchor server-side; this text exists so the request reads as a real
 * message in the conversation — what was asked, in the user's bubble — not so
 * the model can act on it alone.
 */
export function buildRevisionText(
  artifactName: string,
  comments: RevisionComment[]
): string {
  const lines = [
    `Please revise the artifact "${artifactName}" to address ${
      comments.length === 1 ? 'this comment' : `these ${comments.length} comments`
    }:`,
  ];
  comments.forEach((comment, i) => {
    const where = comment.quotedText
      ? `"${excerpt(comment.quotedText)}"`
      : '(whole document)';
    lines.push(`${i + 1}. ${where} — ${comment.body}`);
  });
  return lines.join('\n');
}

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > REVISION_QUOTE_CHARS
    ? `${flat.slice(0, REVISION_QUOTE_CHARS)}…`
    : flat;
}
