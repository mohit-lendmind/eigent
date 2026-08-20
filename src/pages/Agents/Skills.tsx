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

import SearchInput from '@/components/Dashboard/SearchInput';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  clearAionSyncUpSnapshot,
  getAionSyncUpCandidates,
} from '@/store/aionSkillsStore';
import { useSkillsStore, type Skill } from '@/store/skillsStore';
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type MotionProps,
} from 'framer-motion';
import { AlertCircle, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import SkillDeleteDialog from './components/SkillDeleteDialog';
import SkillListItem from './components/SkillListItem';
import SkillSyncUpDialog from './components/SkillSyncUpDialog';
import SkillUploadDialog from './components/SkillUploadDialog';

// One-time sync-up marker: once the offer has been shown on a
// skills-capable remote stack it never repeats, accepted or not.
const SYNC_UP_MARKER = 'aion-skills-sync-up-offered';

export default function Skills() {
  const { t } = useTranslation();
  const shouldReduceMotion = useReducedMotion();
  const [searchParams, setSearchParams] = useSearchParams();
  const { skills, refresh, remoteMode } = useSkillsStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [hasCompletedInitialSync, setHasCompletedInitialSync] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [skillDialogMode, setSkillDialogMode] = useState<'upload' | 'create'>(
    'upload'
  );
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [skillToDelete, setSkillToDelete] = useState<Skill | null>(null);
  const [syncUpOpen, setSyncUpOpen] = useState(false);

  // On first mount, read the list from the SkillStore.
  useEffect(() => {
    let isActive = true;

    void refresh().finally(() => {
      if (isActive) {
        setHasCompletedInitialSync(true);
      }
    });

    return () => {
      isActive = false;
    };
  }, [refresh]);

  // One-time sync-up offer once the first remote list has landed
  useEffect(() => {
    if (!hasCompletedInitialSync || remoteMode.kind !== 'remote') return;
    if (localStorage.getItem(SYNC_UP_MARKER)) return;
    if (getAionSyncUpCandidates().length === 0) {
      localStorage.setItem(SYNC_UP_MARKER, '1');
      clearAionSyncUpSnapshot();
      return;
    }
    setSyncUpOpen(true);
  }, [hasCompletedInitialSync, remoteMode]);

  const handleSyncUpClose = () => {
    localStorage.setItem(SYNC_UP_MARKER, '1');
    clearAionSyncUpSnapshot();
    setSyncUpOpen(false);
  };

  // A stack that cannot serve skills renders a visible state — never an
  // empty list that reads as "you have no skills".
  const remoteUnavailable =
    remoteMode.kind === 'unsupported' || remoteMode.kind === 'error';

  useEffect(() => {
    const action = searchParams.get('skillAction');
    if (action !== 'create' && action !== 'upload') return;
    setSkillDialogMode(action);
    setUploadDialogOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('skillAction');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const yourSkills = useMemo(() => {
    return skills
      .filter((skill) => !skill.isExample)
      .filter(
        (skill) =>
          skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          skill.description.toLowerCase().includes(searchQuery.toLowerCase())
      );
  }, [skills, searchQuery]);

  const exampleSkills = useMemo(() => {
    return skills
      .filter((skill) => skill.isExample)
      .filter(
        (skill) =>
          skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          skill.description.toLowerCase().includes(searchQuery.toLowerCase())
      );
  }, [skills, searchQuery]);

  const handleDeleteClick = (skill: Skill) => {
    setSkillToDelete(skill);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = () => {
    setDeleteDialogOpen(false);
    setSkillToDelete(null);
  };

  const handleDeleteCancel = () => {
    setDeleteDialogOpen(false);
    setSkillToDelete(null);
  };

  // `animateChanges` selects motion props, never the tree SHAPE. Swapping the
  // shape — wrappers appearing or disappearing around the rows — makes React
  // unmount and remount every row, and a remount throws away what the row is
  // holding: an open scope popover, a focused control, a half-made choice. The
  // flag flips the moment the first sync settles, which is exactly when
  // someone is most likely to be mid-interaction.
  const renderYourSkills = (animateChanges: boolean) => {
    const still: MotionProps = { initial: false, transition: { duration: 0 } };
    const rowMotion: MotionProps = animateChanges
      ? {
          initial: {
            opacity: 0,
            transform: shouldReduceMotion
              ? 'translateY(0px)'
              : 'translateY(8px)',
          },
          animate: { opacity: 1, transform: 'translateY(0px)' },
          exit: {
            opacity: 0,
            transform: shouldReduceMotion
              ? 'translateY(0px)'
              : 'translateY(-4px)',
            transition: {
              duration: 0.16,
              ease: [0.23, 1, 0.32, 1],
            },
          },
          transition: {
            duration: shouldReduceMotion ? 0.16 : 0.2,
            ease: [0.23, 1, 0.32, 1],
          },
        }
      : still;
    const placeholderMotion: MotionProps = animateChanges
      ? {
          initial: { opacity: 0 },
          animate: { opacity: 1 },
          exit: { opacity: 0 },
          transition: {
            duration: 0.16,
            ease: [0.23, 1, 0.32, 1],
          },
        }
      : still;

    return (
      <div className="flex flex-col gap-3">
        <AnimatePresence mode="popLayout" initial={false}>
          {yourSkills.length === 0 ? (
            <motion.div key="your-skills-placeholder" {...placeholderMotion}>
              <SkillListItem
                variant="placeholder"
                message={
                  searchQuery
                    ? t('agents.no-skills-found')
                    : t('agents.no-your-skills')
                }
                addButtonText={
                  !searchQuery ? t('agents.add-your-first-skill') : undefined
                }
                onAddClick={
                  !searchQuery
                    ? () => {
                        setSkillDialogMode('upload');
                        setUploadDialogOpen(true);
                      }
                    : undefined
                }
              />
            </motion.div>
          ) : (
            yourSkills.map((skill) => (
              <motion.div key={skill.id} {...rowMotion}>
                <SkillListItem
                  skill={skill}
                  onDelete={() => handleDeleteClick(skill)}
                />
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <div className="m-auto flex h-auto w-full flex-1 flex-col">
      {/* Header Section */}
      <div className="flex w-full items-center justify-between px-6 pb-6 pt-8">
        <div className="text-heading-sm font-bold text-ds-text-neutral-default-default">
          {t('agents.skills')}
        </div>
      </div>

      {/* Content Section */}
      <div className="mb-12 flex flex-col gap-4">
        {remoteUnavailable ? (
          <div
            className="mx-6 flex items-center gap-3 rounded-2xl bg-ds-bg-neutral-default-default px-4 py-3.5"
            role="alert"
            data-testid="skills-remote-banner"
          >
            <AlertCircle className="h-5 w-5 shrink-0 text-ds-icon-status-error-default-default" />
            <span className="text-body-sm text-ds-text-neutral-default-default">
              {remoteMode.kind === 'unsupported'
                ? t('agents.skills-backend-too-old', {
                    version: remoteMode.edgeApiVersion,
                  })
                : remoteMode.kind === 'error'
                  ? t('agents.skills-remote-error', {
                      message: remoteMode.message,
                    })
                  : null}
            </span>
          </div>
        ) : (
          <div className="flex w-full flex-col items-center justify-between gap-3 rounded-2xl bg-ds-bg-neutral-default-default px-6 py-4">
            <Tabs defaultValue="your-skills" className="w-full">
              <div className="z-10 flex w-full items-center justify-between gap-4 border-x-0 border-b-[0.5px] border-t-0 border-solid border-ds-border-neutral-default-default bg-ds-bg-neutral-default-default">
                <TabsList
                  appearance="border"
                  className="h-auto flex-1 justify-start"
                >
                  <TabsTrigger value="your-skills">
                    {t('agents.your-skills')}
                  </TabsTrigger>
                  <TabsTrigger value="example-skills">
                    {t('agents.example-skills')}
                  </TabsTrigger>
                </TabsList>
                <div className="mb-2 flex items-center gap-2">
                  <SearchInput
                    variant="icon"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t('agents.search-skills')}
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    data-testid="skills-add"
                    onClick={() => {
                      setSkillDialogMode('upload');
                      setUploadDialogOpen(true);
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    {t('agents.add-skill')}
                  </Button>
                </div>
              </div>
              <TabsContent value="your-skills" className="mt-4">
                {renderYourSkills(
                  hasCompletedInitialSync && searchQuery.length === 0
                )}
              </TabsContent>
              <TabsContent value="example-skills" className="mt-4">
                {exampleSkills.length === 0 ? (
                  <SkillListItem
                    variant="placeholder"
                    message={
                      searchQuery
                        ? t('agents.no-skills-found')
                        : t('agents.no-example-skills')
                    }
                  />
                ) : (
                  <div className="flex flex-col gap-3">
                    {exampleSkills.map((skill) => (
                      <SkillListItem
                        key={skill.id}
                        skill={skill}
                        onDelete={undefined}
                      />
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>

      {/* Upload Dialog */}
      <SkillUploadDialog
        open={uploadDialogOpen}
        mode={skillDialogMode}
        onClose={() => setUploadDialogOpen(false)}
      />

      {/* Delete Dialog */}
      <SkillDeleteDialog
        open={deleteDialogOpen}
        skill={skillToDelete}
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />

      {/* One-time sync-up offer (remote mode, C5) */}
      <SkillSyncUpDialog
        open={syncUpOpen}
        candidates={getAionSyncUpCandidates()}
        onClose={handleSyncUpClose}
      />
    </div>
  );
}
