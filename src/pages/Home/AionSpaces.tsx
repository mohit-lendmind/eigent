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

// Spaces as aion serves them. A Space here is a grouping and nothing else — it
// owns no files, no local folder and no runtime, so this list carries none of
// the legacy hub's source badges; what it does carry is a count the server
// measured, which is the one number a client cannot compute for itself.
//
// An archived Space stays listed. It is shelved, not deleted, and what it holds
// is still filed under it — hiding the row would leave those Projects looking
// as though they belong to nothing.

import ConfirmModal from '@/components/ui/alertDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { AionSpace, AionSpacesMode } from '@/store/aionSpacesStore';
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  FolderKanban,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AionSpaceProjects from './components/AionSpaceProjects';
import { HomeHubToneTag } from './components/HomeHubItemShared';
import { useHomeHub } from './context';
import {
  compareHubByName,
  compareHubByTimestamp,
  formatHubRelativeAgo,
  matchesHubNameSearch,
} from './utils';

const GRID_CLASS =
  'grid-cols-[20px_minmax(0,2fr)_96px_112px_96px_auto] gap-x-4 px-3';

/**
 * A status this build does not know renders as itself rather than as active:
 * the contract's status is an open set, and drawing an unrecognized value as
 * "in service" would put a shelved Space back on the shelf it was taken off.
 */
function statusLabel(
  space: AionSpace,
  t: (key: string) => string
): { label: string; tone: 'neutral' | 'information' } {
  switch (space.status) {
    case 'archived':
      return { label: t('layout.aion-space-status-archived'), tone: 'neutral' };
    case 'active':
      return {
        label: t('layout.aion-space-status-active'),
        tone: 'information',
      };
    default:
      return { label: t('layout.aion-space-status-unknown'), tone: 'neutral' };
  }
}

function Banner({ message }: { message: string }) {
  return (
    <div
      className="mx-6 flex items-center gap-4 rounded-2xl bg-ds-bg-neutral-default-default px-6 py-6"
      role="alert"
      data-testid="aion-spaces-banner"
    >
      <AlertCircle className="h-5 w-5 shrink-0 text-ds-icon-status-error-default-default" />
      <span className="text-body-sm text-ds-text-neutral-default-default">
        {message}
      </span>
    </div>
  );
}

export default function AionSpaces({ mode }: { mode: AionSpacesMode }) {
  const { t } = useTranslation();
  const { searchQuery, sortBy, sortDirection, aionSpaces } = useHomeHub();
  const {
    spaces,
    nextPageToken,
    loading,
    loadingMore,
    error,
    busySpaceId,
    creating,
    create,
    rename,
    setArchived,
    remove,
    loadMore,
  } = aionSpaces;

  const [openSpaceId, setOpenSpaceId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(
    null
  );
  const [confirmDelete, setConfirmDelete] = useState<AionSpace | null>(null);

  const visible = useMemo(() => {
    const untitled = t('layout.spaces-untitled');
    const named = (space: AionSpace) => space.name.trim() || untitled;
    const filtered = spaces.filter((space) =>
      matchesHubNameSearch(searchQuery, named(space))
    );
    return [...filtered].sort((a, b) => {
      if (sortBy === 'name') {
        return compareHubByName(named(a), named(b), sortDirection);
      }
      const left = sortBy === 'created' ? a.createdAt : a.updatedAt;
      const right = sortBy === 'created' ? b.createdAt : b.updatedAt;
      return compareHubByTimestamp(left, right, sortDirection);
    });
  }, [searchQuery, sortBy, sortDirection, spaces, t]);

  if (mode.kind === 'unsupported') {
    return (
      <Banner
        message={t('layout.aion-space-backend-too-old', {
          version: mode.edgeApiVersion,
        })}
      />
    );
  }
  if (mode.kind === 'error') {
    return (
      <Banner
        message={t('layout.aion-space-remote-error', { message: mode.message })}
      />
    );
  }
  if (loading) {
    return (
      <div className="flex w-full min-w-0 flex-col">
        <div className="pb-12 text-body-sm text-ds-text-neutral-muted-default">
          {t('layout.loading')}
        </div>
      </div>
    );
  }
  // A first read that failed with nothing loaded is the whole surface failing;
  // a failure that arrives with rows drawn reports below them.
  if (error && spaces.length === 0) {
    return (
      <Banner message={t('layout.aion-space-remote-error', { message: error })} />
    );
  }

  const submitDraft = () => {
    const name = (draftName ?? '').trim();
    if (!name) return;
    void create(name).then((stored) => {
      if (stored) setDraftName(null);
    });
  };

  const submitRename = () => {
    if (!renaming) return;
    const name = renaming.name.trim();
    if (!name) return;
    void rename(renaming.id, name).then((stored) => {
      if (stored) setRenaming(null);
    });
  };

  return (
    <div className="flex w-full min-w-0 flex-col" data-testid="aion-spaces">
      <div className="mb-12 w-full min-w-0">
        <div className="flex items-center justify-end px-3 pb-2">
          <Button
            variant="primary"
            size="sm"
            data-testid="aion-spaces-new"
            disabled={creating || draftName !== null}
            onClick={() => setDraftName('')}
          >
            <Plus className="mr-1.5 h-4 w-4" aria-hidden />
            {t('layout.aion-space-new')}
          </Button>
        </div>

        {draftName !== null ? (
          <div className="flex items-center gap-2 px-3 pb-3">
            <Input
              autoFocus
              value={draftName}
              placeholder={t('layout.aion-space-name-placeholder')}
              data-testid="aion-spaces-name-input"
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitDraft();
                if (event.key === 'Escape') setDraftName(null);
              }}
            />
            <Button
              variant="primary"
              size="sm"
              data-testid="aion-spaces-create"
              disabled={creating || !draftName.trim()}
              onClick={submitDraft}
            >
              {t('layout.aion-space-create')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              data-testid="aion-spaces-create-cancel"
              onClick={() => setDraftName(null)}
            >
              {t('layout.cancel')}
            </Button>
          </div>
        ) : null}

        {spaces.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <FolderKanban className="mb-4 h-12 w-12 text-ds-icon-neutral-muted-default" />
            <div
              className="text-sm text-ds-text-neutral-muted-default"
              data-testid="aion-spaces-empty"
            >
              {t('layout.aion-space-empty')}
            </div>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <div className="text-sm text-ds-text-neutral-muted-default">
              {t('layout.search-no-results')}
            </div>
          </div>
        ) : (
          <>
            <div className={cn('grid items-center py-2.5', GRID_CLASS)}>
              <span aria-hidden />
              {[
                'layout.home-list-name',
                'layout.aion-space-list-projects',
                'layout.home-list-status',
                'layout.home-list-updated',
              ].map((key, index) => (
                <span
                  key={key}
                  className={cn(
                    'truncate !text-label-sm font-normal leading-none text-ds-text-neutral-muted-default',
                    index === 0 ? 'text-left' : 'text-right'
                  )}
                >
                  {t(key)}
                </span>
              ))}
              <span aria-hidden />
            </div>
            <div className="flex flex-col gap-1">
              {visible.map((space) => {
                const status = statusLabel(space, t);
                const expanded = openSpaceId === space.spaceId;
                const busy = busySpaceId === space.spaceId;
                const name = space.name.trim() || t('layout.spaces-untitled');
                return (
                  <div
                    key={space.spaceId}
                    data-testid="aion-space-row"
                    data-space-id={space.spaceId}
                    data-status={space.status}
                    data-project-count={space.projectCount}
                    className="rounded-xl border border-solid border-transparent bg-ds-bg-neutral-default-default"
                  >
                    <div
                      className={cn('grid items-center py-2.5', GRID_CLASS)}
                    >
                      <button
                        type="button"
                        data-testid="aion-space-toggle"
                        aria-expanded={expanded}
                        aria-label={t('layout.aion-space-toggle', { name })}
                        className="flex h-5 w-5 items-center justify-center rounded outline-none focus-visible:ring-2 focus-visible:ring-ds-ring-neutral-subtle-default"
                        onClick={() =>
                          setOpenSpaceId(expanded ? null : space.spaceId)
                        }
                      >
                        {expanded ? (
                          <ChevronDown
                            className="h-4 w-4 text-ds-icon-neutral-muted-default"
                            aria-hidden
                          />
                        ) : (
                          <ChevronRight
                            className="h-4 w-4 text-ds-icon-neutral-muted-default"
                            aria-hidden
                          />
                        )}
                      </button>

                      {renaming?.id === space.spaceId ? (
                        <Input
                          autoFocus
                          value={renaming.name}
                          data-testid="aion-space-rename-input"
                          onChange={(event) =>
                            setRenaming({
                              id: space.spaceId,
                              name: event.target.value,
                            })
                          }
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') submitRename();
                            if (event.key === 'Escape') setRenaming(null);
                          }}
                        />
                      ) : (
                        <span
                          className="truncate text-body-sm text-ds-text-neutral-default-default"
                          data-testid="aion-space-name"
                        >
                          {name}
                        </span>
                      )}

                      <span
                        className="truncate text-right text-body-xs tabular-nums text-ds-text-neutral-muted-default"
                        data-testid="aion-space-project-count"
                      >
                        {space.projectCount}
                      </span>
                      <div className="flex justify-end">
                        <HomeHubToneTag
                          label={status.label}
                          tone={status.tone}
                        />
                      </div>
                      <span className="truncate text-right text-body-xs tabular-nums text-ds-text-neutral-muted-default">
                        {formatHubRelativeAgo(space.updatedAt, t)}
                      </span>

                      <div className="flex items-center justify-end gap-1">
                        {renaming?.id === space.spaceId ? (
                          <>
                            <Button
                              variant="primary"
                              size="sm"
                              data-testid="aion-space-rename-save"
                              disabled={busy || !renaming.name.trim()}
                              onClick={submitRename}
                            >
                              {t('layout.aion-space-save')}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              data-testid="aion-space-rename-cancel"
                              onClick={() => setRenaming(null)}
                            >
                              {t('layout.cancel')}
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              data-testid="aion-space-rename"
                              aria-label={t('layout.aion-space-rename', {
                                name,
                              })}
                              disabled={busy}
                              onClick={() =>
                                setRenaming({
                                  id: space.spaceId,
                                  name: space.name,
                                })
                              }
                            >
                              <Pencil className="h-4 w-4" aria-hidden />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              data-testid="aion-space-archive"
                              data-archived={
                                space.status === 'archived' ? 'true' : 'false'
                              }
                              aria-label={t(
                                space.status === 'archived'
                                  ? 'layout.aion-space-unarchive'
                                  : 'layout.aion-space-archive',
                                { name }
                              )}
                              disabled={busy}
                              onClick={() =>
                                void setArchived(
                                  space.spaceId,
                                  space.status !== 'archived'
                                )
                              }
                            >
                              {space.status === 'archived' ? (
                                <ArchiveRestore
                                  className="h-4 w-4"
                                  aria-hidden
                                />
                              ) : (
                                <Archive className="h-4 w-4" aria-hidden />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              data-testid="aion-space-delete"
                              aria-label={t('layout.aion-space-delete', {
                                name,
                              })}
                              disabled={busy}
                              onClick={() => setConfirmDelete(space)}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    {expanded ? (
                      <AionSpaceProjects spaceId={space.spaceId} />
                    ) : null}
                  </div>
                );
              })}
            </div>
            {error ? (
              <div
                className="px-3 pt-3 text-body-xs text-ds-text-status-error-strong-default"
                role="alert"
                data-testid="aion-spaces-error"
              >
                {t('layout.aion-space-remote-error', { message: error })}
              </div>
            ) : null}
            {nextPageToken ? (
              <div className="flex justify-center pt-4">
                <Button
                  variant="secondary"
                  size="sm"
                  data-testid="aion-spaces-load-more"
                  disabled={loadingMore}
                  onClick={loadMore}
                >
                  {loadingMore
                    ? t('layout.loading')
                    : t('layout.projects-load-more')}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>

      <ConfirmModal
        isOpen={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          const space = confirmDelete;
          setConfirmDelete(null);
          if (space) void remove(space.spaceId);
        }}
        title={t('layout.aion-space-delete-title')}
        message={
          // Say what the server will refuse before it refuses it: an occupied
          // Space cannot be deleted, and the count is the reason.
          confirmDelete && confirmDelete.projectCount > 0
            ? t('layout.aion-space-delete-occupied', {
                projects: confirmDelete.projectCount,
              })
            : t('layout.aion-space-delete-confirmation', {
                name:
                  confirmDelete?.name.trim() || t('layout.spaces-untitled'),
              })
        }
        confirmText={t('layout.delete')}
        cancelText={t('layout.cancel')}
        confirmVariant="caution"
      />
    </div>
  );
}
