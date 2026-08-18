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
import { useHost } from '@/host';
import { cn } from '@/lib/utils';
import {
  getAionArtifactViewerMode,
  grantAionArtifact,
  invalidateAionArtifacts,
  loadAionArtifacts,
  loadAionArtifactVersions,
  readAionArtifact,
  subscribeAionArtifacts,
  type AionArtifact,
  type AionArtifactContent,
  type AionArtifactsMode,
} from '@/store/aionArtifactsStore';
import { boundAionProjectId } from '@/store/aionChatBridge';
import {
  createAionComment,
  getAionCommentsMode,
  loadAionComments,
  setAionCommentStatus,
  subscribeAionComments,
  type AionComment,
  type AionCommentsMode,
} from '@/store/aionCommentsStore';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { usePageTabStore, type SessionArtifactTab } from '@/store/pageTabStore';
import {
  Columns2,
  Download,
  FileBox,
  Image as ImageIcon,
  MessageSquare,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArtifactViewer, type ViewerSelection } from './ArtifactViewer';
import {
  buildRevisionText,
  captureAnchor,
  captureSelectionAnchor,
  relocateComment,
  type CommentAnchor,
  type CommentRelocation,
} from './commentAnchors';
import { CommentRail } from './CommentRail';
import {
  formatArtifactSize,
  groupArtifacts,
  laneForArtifact,
  type ArtifactNameGroup,
} from './artifactLanes';

export interface ArtifactTabProps {
  tab: SessionArtifactTab;
}

/** A comment made with nothing selected is about the whole artifact. */
const DOCUMENT_ANCHOR: CommentAnchor = {
  quotedText: '',
  prefixContext: '',
  suffixContext: '',
  startOffset: 0,
};

/**
 * How many versions of a name the rail reads comments across. A comment made
 * on v1 must stay visible while v4 is on screen — the loop's receipts are the
 * addressed rows on earlier versions — but a listing per version is a call
 * per version, so a pathological history is read to a bound.
 */
const MAX_COMMENT_VERSIONS = 20;

/**
 * The artifact surface for one session: a rail of everything this Project
 * published, grouped by name, and a viewer for whichever version is selected.
 *
 * The rail's split is not cosmetic. A run that browses publishes a viewfinder
 * frame per action and screenshots besides — the run this milestone exists
 * for listed 13 artifacts of which 11 were pictures — so documents and
 * captures are separated and frames are dropped entirely, or the deliverable
 * is buried under the evidence of how it was made.
 */
export function ArtifactTab({ tab }: ArtifactTabProps) {
  const { t } = useTranslation();
  const host = useHost();
  const electronAPI = host?.electronAPI;
  const eigentProjectId = usePageTabStore((s) => s.sessionPreviewProjectId);
  const selectPreviewArtifact = usePageTabStore(
    (s) => s.selectPreviewArtifact
  );

  const [projectId, setProjectId] = useState<string | null>(null);
  const [mode, setMode] = useState<AionArtifactsMode | null>(null);
  const [artifacts, setArtifacts] = useState<AionArtifact[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);

  const [versions, setVersions] = useState<AionArtifact[]>([]);
  const [content, setContent] = useState<AionArtifactContent | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [compare, setCompare] = useState<{
    label: string;
    text: string;
  } | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const { chatStore } = useChatStoreAdapter();
  const [commentsMode, setCommentsMode] = useState<AionCommentsMode | null>(
    null
  );
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<AionComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [commentReloads, setCommentReloads] = useState(0);
  const [pendingSelection, setPendingSelection] =
    useState<ViewerSelection | null>(null);
  const [commentBusy, setCommentBusy] = useState(false);
  const [revisionBusy, setRevisionBusy] = useState(false);

  // The panel is keyed by the desktop's project id; artifacts are keyed by
  // aion's. The binding is resolved rather than created — opening a viewer
  // must never mint a Project as a side effect of looking.
  useEffect(() => {
    let cancelled = false;
    if (!eigentProjectId) {
      setProjectId(null);
      setListLoading(false);
      return;
    }
    void (async () => {
      const [bound, viewerMode, commentMode] = await Promise.all([
        boundAionProjectId(eigentProjectId),
        getAionArtifactViewerMode(),
        getAionCommentsMode(),
      ]);
      if (cancelled) return;
      setMode(viewerMode);
      setCommentsMode(commentMode);
      setProjectId(bound);
      if (!bound) setListLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [eigentProjectId]);

  const [reloads, setReloads] = useState(0);
  useEffect(() => {
    if (!projectId) return;
    return subscribeAionArtifacts(projectId, () =>
      setReloads((count) => count + 1)
    );
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    return subscribeAionComments(projectId, () =>
      setCommentReloads((count) => count + 1)
    );
  }, [projectId]);

  useEffect(() => {
    if (!projectId || mode?.kind !== 'remote') return;
    let cancelled = false;
    setListLoading(true);
    void loadAionArtifacts(projectId)
      .then((page) => {
        if (cancelled) return;
        setArtifacts(page.artifacts);
        setListError(null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setListError(messageOf(cause));
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode?.kind, projectId, reloads]);

  const groups = useMemo(() => groupArtifacts(artifacts), [artifacts]);
  const allGroups = useMemo(
    () => [...groups.documents, ...groups.captures],
    [groups]
  );

  // Nothing selected yet: open the newest document, falling back to the
  // newest capture. A rail with an empty pane beside it looks broken.
  const autoSelected = useRef(false);
  useEffect(() => {
    if (tab.artifactId || autoSelected.current) return;
    const first = groups.documents[0] ?? groups.captures[0];
    if (!first) return;
    autoSelected.current = true;
    selectPreviewArtifact(tab.id, first.latest.artifactId, first.name);
  }, [groups, selectPreviewArtifact, tab.artifactId, tab.id]);

  const selectedName = tab.artifactName;
  useEffect(() => {
    if (!projectId || !selectedName) {
      setVersions([]);
      return;
    }
    let cancelled = false;
    void loadAionArtifactVersions(projectId, selectedName)
      .then((rows) => {
        if (!cancelled) setVersions(rows);
      })
      .catch(() => {
        // A failed history read is not a failed view: the listing already
        // holds every version this page saw, so fall back to it rather than
        // blanking the selector.
        if (!cancelled) {
          setVersions(
            allGroups.find((group) => group.name === selectedName)?.versions ??
              []
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [allGroups, projectId, reloads, selectedName]);

  const selectedId = tab.artifactId;
  useEffect(() => {
    setCompare(null);
    setShowSource(false);
    setPendingSelection(null);
    if (!projectId || !selectedId) {
      setContent(null);
      return;
    }
    let cancelled = false;
    setContentLoading(true);
    setContentError(null);
    void readAionArtifact(projectId, selectedId)
      .then((read) => {
        if (!cancelled) setContent(read);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setContent(null);
          setContentError(messageOf(cause));
        }
      })
      .finally(() => {
        if (!cancelled) setContentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, selectedId]);

  const openExternal = useCallback(
    async (url: string) => {
      if (electronAPI?.openExternal) {
        await electronAPI.openExternal(url);
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    [electronAPI]
  );

  const download = useCallback(async () => {
    if (!projectId || !selectedId) return;
    setDownloading(true);
    try {
      const grant = await grantAionArtifact(projectId, selectedId);
      await openExternal(grant.downloadUrl);
    } catch (cause) {
      setContentError(messageOf(cause));
    } finally {
      setDownloading(false);
    }
  }, [openExternal, projectId, selectedId]);

  const toggleCompare = useCallback(async () => {
    if (compare) {
      setCompare(null);
      return;
    }
    if (!projectId || versions.length < 2) return;
    // Diff against the version immediately before the one on screen, which is
    // the question a version list actually raises: what changed this time.
    const index = versions.findIndex((row) => row.artifactId === selectedId);
    const previous = versions[index + 1];
    if (!previous) return;
    try {
      const read = await readAionArtifact(projectId, previous.artifactId);
      if (read.content === undefined) return;
      setCompare({ label: `v${previous.version}`, text: read.content });
    } catch (cause) {
      setContentError(messageOf(cause));
    }
  }, [compare, projectId, selectedId, versions]);

  const reload = useCallback(() => {
    if (!projectId) return;
    invalidateAionArtifacts(projectId);
    setReloads((count) => count + 1);
  }, [projectId]);

  // Comments live on specific versions but the conversation is about the
  // NAME: a comment made on v1 is settled by the run that published v3, and
  // hiding it while v3 is on screen would hide the loop's receipt. So the
  // rail reads every version's list and relocation sorts out what still
  // anchors in the text being shown.
  useEffect(() => {
    if (!commentsOpen || !projectId || commentsMode?.kind !== 'remote') return;
    if (versions.length === 0) {
      setComments([]);
      return;
    }
    let cancelled = false;
    setCommentsLoading(true);
    void Promise.all(
      versions
        .slice(0, MAX_COMMENT_VERSIONS)
        .map((row) => loadAionComments(projectId, row.artifactId))
    )
      .then((pages) => {
        if (cancelled) return;
        setComments(
          pages
            .flat()
            .sort(
              (a, b) =>
                a.createdAt.localeCompare(b.createdAt) ||
                a.commentId.localeCompare(b.commentId)
            )
        );
        setCommentsError(null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setCommentsError(messageOf(cause));
      })
      .finally(() => {
        if (!cancelled) setCommentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [commentReloads, commentsMode?.kind, commentsOpen, projectId, versions]);

  // Where each comment's quote lives in the text on screen — recomputed per
  // version shown, never persisted (the A4 anchor rule).
  const relocations = useMemo(() => {
    const map = new Map<string, CommentRelocation>();
    const text = content?.content;
    if (text === undefined) return map;
    for (const comment of comments) {
      map.set(
        comment.commentId,
        relocateComment(
          {
            quotedText: comment.quotedText,
            prefixContext: comment.prefixContext,
            suffixContext: comment.suffixContext,
            startOffset: comment.startOffset,
          },
          text
        )
      );
    }
    return map;
  }, [comments, content]);

  const versionLabels = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of versions) map.set(row.artifactId, row.version);
    return map;
  }, [versions]);

  const handleSelect = useCallback((selection: ViewerSelection | null) => {
    setPendingSelection(selection);
  }, []);

  const createComment = useCallback(
    async (body: string) => {
      if (!projectId || !selectedId) return;
      const source = content?.content;
      // Editor selections carry exact offsets; a rendered-markdown selection
      // carries only its text and is located by search. No selection, or a
      // lane with no text, is a document-level comment.
      const anchor: CommentAnchor =
        (pendingSelection && source !== undefined
          ? pendingSelection.start >= 0
            ? captureAnchor(source, pendingSelection.start, pendingSelection.end)
            : captureSelectionAnchor(source, pendingSelection.text)
          : null) ?? DOCUMENT_ANCHOR;
      setCommentBusy(true);
      try {
        await createAionComment(projectId, selectedId, {
          quotedText: anchor.quotedText,
          prefixContext: anchor.prefixContext,
          suffixContext: anchor.suffixContext,
          startOffset: anchor.startOffset,
          body,
        });
        setPendingSelection(null);
        setCommentsError(null);
        setCommentReloads((count) => count + 1);
      } catch (cause) {
        setCommentsError(messageOf(cause));
      } finally {
        setCommentBusy(false);
      }
    },
    [content, pendingSelection, projectId, selectedId]
  );

  const setCommentStatus = useCallback(
    async (comment: AionComment, status: 'open' | 'dismissed') => {
      if (!projectId) return;
      setCommentBusy(true);
      try {
        await setAionCommentStatus(projectId, comment.commentId, status);
        setCommentsError(null);
        setCommentReloads((count) => count + 1);
      } catch (cause) {
        setCommentsError(messageOf(cause));
      } finally {
        setCommentBusy(false);
      }
    },
    [projectId]
  );

  const activeTaskId = chatStore?.activeTaskId ?? null;
  const requestRevision = useCallback(async () => {
    if (!eigentProjectId || !chatStore?.activeTaskId || !selectedName) return;
    const open = comments.filter((comment) => comment.status === 'open');
    if (open.length === 0) return;
    setRevisionBusy(true);
    try {
      // Through startTask, not the bridge directly: startTask renders the
      // user bubble, so the request is visible in the conversation instead
      // of arriving invisibly. The worker inlines each comment's anchor
      // server-side from comment_ids.
      await chatStore.startTask(
        chatStore.activeTaskId,
        buildRevisionText(
          selectedName,
          open.map((comment) => ({
            quotedText: comment.quotedText,
            body: comment.body,
          }))
        ),
        [],
        undefined,
        eigentProjectId,
        undefined,
        { commentIds: open.map((comment) => comment.commentId) }
      );
    } catch (cause) {
      setCommentsError(messageOf(cause));
    } finally {
      setRevisionBusy(false);
    }
  }, [chatStore, comments, eigentProjectId, selectedName]);

  if (!eigentProjectId || (!projectId && !listLoading)) {
    return (
      <EmptyState
        title={t('artifact.no-project-title', {
          defaultValue: 'No artifacts yet',
        })}
        detail={t('artifact.no-project-desc', {
          defaultValue:
            'Artifacts appear here once this project runs a task that publishes one.',
        })}
      />
    );
  }

  if (mode && mode.kind !== 'remote') {
    return (
      <EmptyState
        title={t('artifact.unavailable-title', {
          defaultValue: 'Artifacts are unavailable',
        })}
        detail={
          mode.kind === 'unsupported'
            ? t('artifact.unsupported-desc', {
                defaultValue:
                  'This backend is too old to serve artifact contents. It reports version {{version}}.',
                version: mode.edgeApiVersion,
              })
            : mode.kind === 'error'
              ? mode.message
              : t('artifact.local-desc', {
                  defaultValue:
                    'This desktop is not connected to an aion backend.',
                })
        }
      />
    );
  }

  const selectedGroup = allGroups.find((group) => group.name === selectedName);
  const lane = content ? laneForArtifact(content.artifact.mediaType) : null;
  const canToggleSource = lane === 'markdown' || lane === 'html';
  const canCompare = versions.length > 1 && lane !== 'image' && lane !== 'pdf';

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden">
      <div className="flex w-[220px] shrink-0 flex-col overflow-y-auto border-r border-solid border-ds-border-neutral-subtle-disabled">
        {listError ? (
          <p className="px-3 py-3 text-xs text-ds-text-error-default-default">
            {listError}
          </p>
        ) : null}
        {!listLoading && allGroups.length === 0 && !listError ? (
          <p className="px-3 py-3 text-xs text-ds-text-neutral-muted-default">
            {t('artifact.empty-list', {
              defaultValue: 'Nothing published yet.',
            })}
          </p>
        ) : null}
        <RailSection
          label={t('artifact.section-documents', { defaultValue: 'Documents' })}
          groups={groups.documents}
          selectedName={selectedName}
          onSelect={(group) =>
            selectPreviewArtifact(tab.id, group.latest.artifactId, group.name)
          }
        />
        <RailSection
          label={t('artifact.section-captures', { defaultValue: 'Captures' })}
          groups={groups.captures}
          selectedName={selectedName}
          onSelect={(group) =>
            selectPreviewArtifact(tab.id, group.latest.artifactId, group.name)
          }
          capture
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-solid border-ds-border-neutral-subtle-disabled px-3">
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-ds-text-neutral-default-default">
            {selectedName ??
              t('artifact.nothing-selected', {
                defaultValue: 'Select an artifact',
              })}
          </span>
          {versions.length > 0 ? (
            <select
              aria-label={t('artifact.version-label', {
                defaultValue: 'Version',
              })}
              data-artifact-version-select="1"
              value={selectedId ?? ''}
              onChange={(event) =>
                selectPreviewArtifact(
                  tab.id,
                  event.target.value,
                  selectedName ?? ''
                )
              }
              className="h-6 shrink-0 rounded-md border border-solid border-ds-border-neutral-subtle-disabled bg-ds-bg-neutral-default-default px-1.5 text-xs text-ds-text-neutral-default-default"
            >
              {versions.map((row) => (
                <option key={row.artifactId} value={row.artifactId}>
                  v{row.version} · {formatArtifactSize(row.sizeBytes)}
                </option>
              ))}
            </select>
          ) : null}
          {canToggleSource ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setShowSource((on) => !on)}
              className="shrink-0"
            >
              {showSource
                ? t('artifact.show-rendered', { defaultValue: 'Rendered' })
                : t('artifact.show-source', { defaultValue: 'Source' })}
            </Button>
          ) : null}
          {canCompare ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              buttonContent="icon-only"
              aria-label={t('artifact.compare', {
                defaultValue: 'Compare with the previous version',
              })}
              aria-pressed={compare !== null}
              onClick={() => void toggleCompare()}
              className="shrink-0"
            >
              <Columns2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          ) : null}
          {commentsMode?.kind === 'remote' ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              buttonContent="icon-only"
              data-comment-toggle="1"
              aria-label={t('artifact.comments-toggle', {
                defaultValue: 'Comments',
              })}
              aria-pressed={commentsOpen}
              onClick={() => setCommentsOpen((on) => !on)}
              className="shrink-0"
            >
              <MessageSquare className="h-3.5 w-3.5" aria-hidden />
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            buttonContent="icon-only"
            aria-label={t('artifact.download', { defaultValue: 'Download' })}
            disabled={!selectedId || downloading}
            onClick={() => void download()}
            className="shrink-0"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className="min-h-0 min-w-0 flex-1 overflow-hidden"
          data-artifact-lane={lane ?? 'none'}
          data-artifact-name={content?.artifact.name ?? ''}
          data-artifact-version={content?.artifact.version ?? ''}
          data-artifact-ready={content && !contentLoading ? '1' : '0'}
        >
          {contentError ? (
            <EmptyState
              title={t('artifact.read-failed', {
                defaultValue: 'Could not read this artifact',
              })}
              detail={contentError}
              action={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={reload}
                >
                  {t('artifact.retry', { defaultValue: 'Try again' })}
                </Button>
              }
            />
          ) : content ? (
            <ArtifactViewer
              content={content}
              showSource={showSource}
              compareWith={compare}
              onDownload={() => void download()}
              downloading={downloading}
              onSelect={commentsOpen ? handleSelect : undefined}
            />
          ) : contentLoading || listLoading ? (
            <EmptyState
              title={t('artifact.loading', { defaultValue: 'Loading…' })}
            />
          ) : (
            <EmptyState
              title={
                selectedGroup
                  ? t('artifact.nothing-selected', {
                      defaultValue: 'Select an artifact',
                    })
                  : t('artifact.empty-list', {
                      defaultValue: 'Nothing published yet.',
                    })
              }
              detail={t('artifact.empty-desc', {
                defaultValue:
                  'A file becomes an artifact when a task publishes it.',
              })}
            />
          )}
        </div>
        {commentsOpen && commentsMode?.kind === 'remote' ? (
          <CommentRail
            comments={comments}
            relocations={relocations}
            versionLabels={versionLabels}
            selectedArtifactId={selectedId ?? null}
            pendingSelection={pendingSelection}
            loading={commentsLoading}
            error={commentsError}
            busy={commentBusy}
            onCreate={(body) => void createComment(body)}
            onSetStatus={(comment, status) =>
              void setCommentStatus(comment, status)
            }
            onRequestRevision={() => void requestRevision()}
            revisionBusy={revisionBusy}
            canRequestRevision={Boolean(activeTaskId && selectedName)}
          />
        ) : null}
        </div>
      </div>
    </div>
  );
}

function RailSection({
  label,
  groups,
  selectedName,
  onSelect,
  capture,
}: {
  label: string;
  groups: ArtifactNameGroup[];
  selectedName: string | null;
  onSelect: (group: ArtifactNameGroup) => void;
  capture?: boolean;
}) {
  if (groups.length === 0) return null;
  const Icon = capture ? ImageIcon : FileBox;
  return (
    <div className="flex flex-col py-2">
      <p className="px-3 pb-1 !text-label-xs font-medium uppercase tracking-wide text-ds-text-neutral-muted-default">
        {label}
      </p>
      {groups.map((group) => (
        <button
          key={group.name}
          type="button"
          data-artifact-row={group.name}
          aria-current={group.name === selectedName}
          onClick={() => onSelect(group)}
          className={cn(
            'flex w-full items-center gap-2 border-0 bg-transparent px-3 py-1.5 text-left transition-colors',
            group.name === selectedName
              ? 'bg-ds-bg-neutral-muted-default'
              : 'hover:bg-ds-bg-neutral-default-hover'
          )}
        >
          <Icon
            className="h-3.5 w-3.5 shrink-0 text-ds-icon-neutral-muted-default"
            aria-hidden
          />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-xs text-ds-text-neutral-default-default">
              {group.name}
            </span>
            <span className="truncate !text-label-xs text-ds-text-neutral-muted-default">
              {group.versions.length > 1
                ? `v${group.latest.version} · ${formatArtifactSize(group.latest.sizeBytes)}`
                : formatArtifactSize(group.latest.sizeBytes)}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-sm font-medium text-ds-text-neutral-default-default">
        {title}
      </p>
      {detail ? (
        <p className="max-w-[380px] text-xs text-ds-text-neutral-muted-default">
          {detail}
        </p>
      ) : null}
      {action}
    </div>
  );
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export default ArtifactTab;
