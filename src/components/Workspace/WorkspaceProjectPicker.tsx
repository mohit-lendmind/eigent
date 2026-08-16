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

import { SpaceSwitchDropdown } from '@/components/ProjectPageSidebar/SpaceSwitchDropdown';
import AlertDialog from '@/components/ui/alertDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import {
  getActiveSpaceTriggerLabel,
  getDefaultNewSpaceName,
} from '@/lib/spaceLabel';
import {
  renameBoundSpace,
} from '@/store/aionSpaceBinding';
import { cn } from '@/lib/utils';
import {
  getVisibleProjectMetasForSpace,
  isDisposableBlankSpace,
  useSpaceStore,
} from '@/store/spaceStore';
import { ChevronsUpDown, FolderIcon } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

/** Shared chrome so read-only and dropdown trigger stay the same height (Button md = 32px). */
const PROJECT_PICKER_SHELL_CLASS =
  'bg-ds-bg-neutral-subtle-default shadow-workspace-project-picker box-border inline-flex h-8 min-h-8 w-fit min-w-[180px] max-w-[300px] items-center gap-2 rounded-full px-3 py-0 font-semibold';

export interface WorkspaceProjectPickerProps {
  /** Display-only: render the current project name without the dropdown. */
  readOnly?: boolean;
}

/**
 * Space switcher for the workspace landing. Project switching lives in the
 * left sidebar; this control only creates, renames and switches Spaces.
 */
export function WorkspaceProjectPicker({
  readOnly = false,
}: WorkspaceProjectPickerProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId);
  const spacesById = useSpaceStore((s) => s.spaces);
  const projectsBySpaceId = useSpaceStore((s) => s.projectsBySpaceId);
  const setActiveSpace = useSpaceStore((s) => s.setActiveSpace);
  const createSpace = useSpaceStore((s) => s.createSpace);
  const updateSpace = useSpaceStore((s) => s.updateSpace);
  const { projectStore } = useChatStoreAdapter();

  const [menuOpen, setMenuOpen] = useState(false);
  const [switchingSpaceId, setSwitchingSpaceId] = useState<string | null>(null);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renamingSpace, setRenamingSpace] = useState(false);

  const activeSpace = activeSpaceId ? spacesById[activeSpaceId] : null;
  const canRenameActiveSpace = Boolean(
    activeSpace &&
    activeSpace.status === 'active' &&
    activeSpace.sourceType !== 'legacy' &&
    activeSpace.metadata?.legacy !== true
  );
  const activeSpaces = useMemo(
    () =>
      Object.values(spacesById)
        .filter(
          (space) =>
            space.status !== 'archived' &&
            !(
              space.id === 'legacy_local' &&
              activeSpaceId !== 'legacy_local' &&
              getVisibleProjectMetasForSpace(projectsBySpaceId, space.id)
                .length === 0
            ) &&
            (space.id === activeSpaceId ||
              !isDisposableBlankSpace(space, projectsBySpaceId))
        )
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [activeSpaceId, projectsBySpaceId, spacesById]
  );

  const activeSpaceTitle = useMemo(
    () =>
      getActiveSpaceTriggerLabel(activeSpace?.name, t, {
        emptyLabelKey: activeSpaceId
          ? 'layout.spaces-untitled'
          : 'layout.spaces-select-space',
      }),
    [activeSpace, activeSpaceId, t]
  );

  const activateSpace = useCallback(
    async (spaceId: string) => {
      setSwitchingSpaceId(spaceId);
      try {
        const projectsInSpace = useSpaceStore
          .getState()
          .getProjectsForSpace(spaceId);
        setActiveSpace(spaceId);
        projectStore.setActiveProject(
          projectsInSpace.length > 0 ? projectsInSpace[0].id : null
        );
        navigate('/');
        setMenuOpen(false);
      } catch (error) {
        console.warn('[WorkspaceProjectPicker] Failed to switch Space:', error);
        toast.error(t('layout.spaces-create-failed'));
      } finally {
        setSwitchingSpaceId(null);
      }
    },
    [navigate, projectStore, setActiveSpace, t]
  );

  const handleNewSpace = useCallback(() => {
    try {
      const name = getDefaultNewSpaceName(t);
      const spaceId = createSpace({
        name,
        sourceType: 'blank',
        setActive: false,
        metadata: {
          createdFrom: 'workspace_space_picker',
          autoCreatedPlaceholder: true,
        },
      });
      setActiveSpace(spaceId);
      projectStore.setActiveProject(null);
      navigate('/');
      setMenuOpen(false);
    } catch (error) {
      console.error('Failed to create Space:', error);
      toast.error(t('layout.spaces-create-failed'));
    }
  }, [createSpace, navigate, projectStore, setActiveSpace, t]);

  const openRenameDialog = () => {
    if (!canRenameActiveSpace || !activeSpace) return;
    setRenameValue(activeSpace.name?.trim() || '');
    setMenuOpen(false);
    setRenameDialogOpen(true);
  };

  const handleRenameSpace = async () => {
    const nextName = renameValue.trim();
    if (!activeSpaceId || !nextName || renamingSpace) return;
    setRenamingSpace(true);
    try {
      updateSpace(activeSpaceId, { name: nextName });
      await renameBoundSpace(activeSpaceId, nextName);
      toast.success(t('layout.spaces-rename-success'));
    } catch (error) {
      console.warn('[WorkspaceProjectPicker] Failed to rename Space:', error);
      toast.error(t('layout.spaces-rename-failed'));
    } finally {
      setRenamingSpace(false);
    }
  };

  if (readOnly) {
    return (
      <div
        className={cn(PROJECT_PICKER_SHELL_CLASS, 'justify-center')}
        aria-label={activeSpaceTitle}
      >
        <FolderIcon className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 truncate text-label-sm text-ds-text-neutral-default-default">
          {activeSpaceTitle}
        </span>
      </div>
    );
  }

  return (
    <>
      <AlertDialog
        isOpen={renameDialogOpen}
        onClose={() => setRenameDialogOpen(false)}
        onConfirm={handleRenameSpace}
        title={t('layout.spaces-rename-title')}
        confirmText={t('layout.save')}
        cancelText={t('layout.cancel')}
        confirmVariant="primary"
        confirmDisabled={!renameValue.trim() || renamingSpace}
      >
        <Input
          autoFocus
          value={renameValue}
          placeholder={t('layout.spaces-rename-placeholder')}
          onChange={(event) => setRenameValue(event.target.value)}
          onEnter={() => {
            if (renameValue.trim() && !renamingSpace) {
              void handleRenameSpace();
              setRenameDialogOpen(false);
            }
          }}
        />
      </AlertDialog>
      <SpaceSwitchDropdown
        open={menuOpen}
        onOpenChange={setMenuOpen}
        contentAlign="center"
        contentSideOffset={6}
        triggerWrapperClassName="w-fit"
        trigger={
          <Button
            id="workspace-project-picker-trigger"
            type="button"
            variant="ghost"
            size="md"
            buttonContent="text"
            buttonRadius="full"
            className={cn(
              PROJECT_PICKER_SHELL_CLASS,
              'no-drag justify-between hover:bg-ds-bg-neutral-default-hover'
            )}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            <FolderIcon className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 truncate text-label-sm text-ds-text-neutral-default-default">
              {activeSpaceTitle}
            </span>
            <ChevronsUpDown
              className="size-4 shrink-0 opacity-80"
              aria-hidden
            />
          </Button>
        }
        spaces={activeSpaces}
        activeSpaceId={activeSpaceId}
        switchingSpaceId={switchingSpaceId}
        canRenameActiveSpace={canRenameActiveSpace}
        createSpaceMenu={{ onCreateSpace: handleNewSpace }}
        onRenameSpace={openRenameDialog}
        onSpaceSelect={activateSpace}
      />
    </>
  );
}
