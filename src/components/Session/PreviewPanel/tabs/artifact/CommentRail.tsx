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

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { AionComment } from '@/store/aionCommentsStore';
import { Send } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ViewerSelection } from './ArtifactViewer';
import type { CommentRelocation } from './commentAnchors';

export interface CommentRailProps {
  /** Every comment on the selected name, across versions, oldest first. */
  comments: AionComment[];
  /**
   * Where each comment's quote lives in the text on screen, keyed by
   * commentId. A comment absent from the map has nothing to relocate against
   * (an image, a pdf, an unreadable version) and renders without an anchor
   * verdict.
   */
  relocations: ReadonlyMap<string, CommentRelocation>;
  /** Version labels by artifactId, so a cross-version comment says where. */
  versionLabels: ReadonlyMap<string, number>;
  /** The version on screen; comments made against it carry no version tag. */
  selectedArtifactId: string | null;
  pendingSelection: ViewerSelection | null;
  loading: boolean;
  error: string | null;
  /** True while a create or status change is in flight. */
  busy: boolean;
  onCreate: (body: string) => void;
  onSetStatus: (comment: AionComment, status: 'open' | 'dismissed') => void;
  onRequestRevision: () => void;
  /** True while the revision turn is being submitted. */
  revisionBusy: boolean;
  /** False when no conversation exists to carry a revision turn. */
  canRequestRevision: boolean;
}

/**
 * The comment rail beside the artifact viewer: the conversation about the
 * document, oldest first, with a composer bound to whatever is selected in
 * the viewer. `addressed` is earned by the run that republished the name —
 * those rows are the loop's receipts and take no actions; open and dismissed
 * are the caller's two reversible states.
 */
export function CommentRail({
  comments,
  relocations,
  versionLabels,
  selectedArtifactId,
  pendingSelection,
  loading,
  error,
  busy,
  onCreate,
  onSetStatus,
  onRequestRevision,
  revisionBusy,
  canRequestRevision,
}: CommentRailProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const openCount = comments.filter((c) => c.status === 'open').length;

  const submit = () => {
    const body = draft.trim();
    if (!body || busy) return;
    onCreate(body);
    setDraft('');
  };

  return (
    <div
      data-comment-rail="1"
      data-comment-open-count={openCount}
      className="flex w-[260px] shrink-0 flex-col overflow-hidden border-l border-solid border-ds-border-neutral-subtle-disabled"
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-solid border-ds-border-neutral-subtle-disabled px-3">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-ds-text-neutral-default-default">
          {t('artifact.comments-title', { defaultValue: 'Comments' })}
        </span>
        {openCount > 0 ? (
          <span className="shrink-0 rounded-full bg-ds-bg-neutral-muted-default px-1.5 !text-label-xs text-ds-text-neutral-muted-default">
            {t('artifact.comments-open-count', {
              defaultValue: '{{count}} open',
              count: openCount,
            })}
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <p className="px-3 py-3 text-xs text-ds-text-error-default-default">
            {error}
          </p>
        ) : null}
        {!loading && !error && comments.length === 0 ? (
          <p className="px-3 py-3 text-xs text-ds-text-neutral-muted-default">
            {t('artifact.comments-empty', {
              defaultValue:
                'No comments yet. Select text in the document to comment on it, or comment on the whole document.',
            })}
          </p>
        ) : null}
        {comments.map((comment) => (
          <CommentRow
            key={comment.commentId}
            comment={comment}
            relocation={relocations.get(comment.commentId)}
            versionLabel={
              comment.artifactId !== selectedArtifactId
                ? versionLabels.get(comment.artifactId)
                : undefined
            }
            busy={busy}
            onSetStatus={onSetStatus}
          />
        ))}
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-t border-solid border-ds-border-neutral-subtle-disabled p-2">
        <p
          data-comment-target="1"
          className="truncate !text-label-xs text-ds-text-neutral-muted-default"
        >
          {pendingSelection
            ? t('artifact.comment-on-selection', {
                defaultValue: 'On: “{{excerpt}}”',
                excerpt: flatExcerpt(pendingSelection.text, 60),
              })
            : t('artifact.comment-on-document', {
                defaultValue: 'On: whole document',
              })}
        </p>
        <textarea
          data-comment-composer="1"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder={t('artifact.comment-placeholder', {
            defaultValue: 'Leave a comment…',
          })}
          className="w-full resize-none rounded-md border border-solid border-ds-border-neutral-subtle-disabled bg-ds-bg-neutral-default-default px-2 py-1.5 text-xs text-ds-text-neutral-default-default placeholder:text-ds-text-neutral-muted-default"
        />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="xs"
            data-comment-submit="1"
            disabled={busy || draft.trim().length === 0}
            onClick={submit}
            className="shrink-0"
          >
            {t('artifact.comment-submit', { defaultValue: 'Comment' })}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="xs"
            data-request-revision="1"
            disabled={
              revisionBusy || openCount === 0 || busy || !canRequestRevision
            }
            onClick={onRequestRevision}
            className="min-w-0 flex-1"
          >
            <Send className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">
              {t('artifact.request-revision', {
                defaultValue: 'Request revision',
              })}
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}

function CommentRow({
  comment,
  relocation,
  versionLabel,
  busy,
  onSetStatus,
}: {
  comment: AionComment;
  relocation: CommentRelocation | undefined;
  versionLabel: number | undefined;
  busy: boolean;
  onSetStatus: (comment: AionComment, status: 'open' | 'dismissed') => void;
}) {
  const { t } = useTranslation();
  const anchorKind =
    comment.status === 'open' && relocation ? relocation.kind : undefined;
  return (
    <div
      data-comment-row={comment.commentId}
      data-comment-status={comment.status}
      data-comment-anchor={anchorKind ?? ''}
      className="flex flex-col gap-1 border-b border-solid border-ds-border-neutral-subtle-disabled px-3 py-2"
    >
      <div className="flex items-center gap-1.5">
        <StatusChip status={comment.status} anchorKind={anchorKind} />
        {versionLabel !== undefined ? (
          <span className="!text-label-xs text-ds-text-neutral-muted-default">
            v{versionLabel}
          </span>
        ) : null}
        <span className="min-w-0 flex-1" />
        {comment.status === 'open' ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            data-comment-dismiss="1"
            disabled={busy}
            onClick={() => onSetStatus(comment, 'dismissed')}
            className="shrink-0"
          >
            {t('artifact.comment-dismiss', { defaultValue: 'Dismiss' })}
          </Button>
        ) : comment.status === 'dismissed' ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            data-comment-reopen="1"
            disabled={busy}
            onClick={() => onSetStatus(comment, 'open')}
            className="shrink-0"
          >
            {t('artifact.comment-reopen', { defaultValue: 'Reopen' })}
          </Button>
        ) : null}
      </div>
      {comment.quotedText ? (
        <p className="truncate border-0 border-l-2 border-solid border-ds-border-neutral-subtle-disabled pl-1.5 !text-label-xs italic text-ds-text-neutral-muted-default">
          {flatExcerpt(comment.quotedText, 80)}
        </p>
      ) : null}
      <p className="whitespace-pre-wrap text-xs text-ds-text-neutral-default-default">
        {comment.body}
      </p>
    </div>
  );
}

/**
 * One glanceable state per row. An open comment whose quote survived reads as
 * open; one whose quote the shown text no longer contains reads as stale —
 * still open, but its anchor points at its original version, not here.
 */
function StatusChip({
  status,
  anchorKind,
}: {
  status: string;
  anchorKind: CommentRelocation['kind'] | undefined;
}) {
  const { t } = useTranslation();
  if (status === 'addressed') {
    return (
      <span className="rounded-full bg-ds-bg-success-subtle-default px-1.5 !text-label-xs text-ds-text-success-default-default">
        {t('artifact.comment-addressed', { defaultValue: 'Addressed' })}
      </span>
    );
  }
  if (status === 'dismissed') {
    return (
      <span className="rounded-full bg-ds-bg-neutral-muted-default px-1.5 !text-label-xs text-ds-text-neutral-muted-default">
        {t('artifact.comment-dismissed', { defaultValue: 'Dismissed' })}
      </span>
    );
  }
  const stale = anchorKind === 'stale';
  return (
    <span
      className={cn(
        'rounded-full px-1.5 !text-label-xs',
        stale
          ? 'bg-ds-bg-warning-subtle-default text-ds-text-warning-default-default'
          : 'bg-ds-bg-information-subtle-default text-ds-text-information-default-default'
      )}
    >
      {stale
        ? t('artifact.comment-stale', { defaultValue: 'Open · stale' })
        : t('artifact.comment-open', { defaultValue: 'Open' })}
    </span>
  );
}

function flatExcerpt(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
