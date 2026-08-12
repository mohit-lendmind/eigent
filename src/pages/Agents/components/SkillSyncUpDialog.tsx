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
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogHeader,
} from '@/components/ui/dialog';
import { useSkillsStore, type Skill } from '@/store/skillsStore';
import { AlertCircle, Check } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface SkillSyncUpDialogProps {
  open: boolean;
  /** Local skills captured before the first remote sync (examples excluded). */
  candidates: Skill[];
  onClose: () => void;
}

type SyncResult =
  | { kind: 'ok'; ignoredFields: string[] }
  | { kind: 'error'; message: string };

/**
 * One-time sync-up: on the first skills-capable remote launch the
 * user's local skills can be uploaded to the aion SkillStore — per-skill
 * consent, sequential PUTs, per-skill result report. The offer never repeats:
 * the caller records the marker when this dialog closes.
 */
export default function SkillSyncUpDialog({
  open,
  candidates,
  onClose,
}: SkillSyncUpDialogProps) {
  const { t } = useTranslation();
  const { addSkill } = useSkillsStore();
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Map<string, SyncResult>>(new Map());
  const [uploading, setUploading] = useState(false);
  const [finished, setFinished] = useState(false);

  const selected = candidates.filter((skill) => !excluded.has(skill.id));

  const handleUpload = async () => {
    setUploading(true);
    const report = new Map<string, SyncResult>();
    for (const skill of selected) {
      try {
        const outcome = await addSkill({
          name: skill.name,
          description: skill.description,
          filePath: skill.filePath,
          fileContent: skill.fileContent,
          scope: skill.scope,
          enabled: skill.enabled,
        });
        report.set(skill.id, {
          kind: 'ok',
          ignoredFields: outcome?.ignoredFields ?? [],
        });
      } catch (error) {
        report.set(skill.id, {
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
      setResults(new Map(report));
    }
    setUploading(false);
    setFinished(true);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent size="sm" showCloseButton onClose={onClose}>
        <DialogHeader title={t('agents.skills-sync-up-title')} />
        <DialogContentSection>
          <div className="flex flex-col gap-4">
            <p className="text-label-sm text-ds-text-neutral-muted-default">
              {t('agents.skills-sync-up-hint')}
            </p>
            <div className="flex max-h-[240px] flex-col gap-2 overflow-y-auto">
              {candidates.map((skill) => {
                const result = results.get(skill.id);
                return (
                  <div key={skill.id} className="flex items-start gap-2">
                    <Checkbox
                      checked={!excluded.has(skill.id)}
                      disabled={uploading || finished}
                      onCheckedChange={(checked) => {
                        setExcluded((prev) => {
                          const next = new Set(prev);
                          if (checked === true) {
                            next.delete(skill.id);
                          } else {
                            next.add(skill.id);
                          }
                          return next;
                        });
                      }}
                    />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-body-sm font-bold text-ds-text-neutral-default-default">
                        {skill.name}
                      </span>
                      {result?.kind === 'ok' && (
                        <span className="flex items-center gap-1 text-label-xs text-ds-text-neutral-muted-default">
                          <Check className="h-3 w-3 shrink-0" />
                          {result.ignoredFields.length > 0
                            ? t('agents.skill-fields-ignored', {
                                fields: result.ignoredFields.join(', '),
                              })
                            : t('agents.skills-sync-up-uploaded')}
                        </span>
                      )}
                      {result?.kind === 'error' && (
                        <span className="flex items-center gap-1 text-label-xs text-ds-text-status-error-strong-default">
                          <AlertCircle className="h-3 w-3 shrink-0" />
                          {result.message}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end gap-2">
              {finished ? (
                <Button
                  variant="primary"
                  size="sm"
                  type="button"
                  onClick={onClose}
                >
                  {t('agents.skills-sync-up-done')}
                </Button>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    disabled={uploading}
                    onClick={onClose}
                  >
                    {t('agents.skills-sync-up-skip')}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    type="button"
                    disabled={uploading || selected.length === 0}
                    onClick={() => void handleUpload()}
                  >
                    {t('agents.skills-sync-up-upload', {
                      count: selected.length,
                    })}
                  </Button>
                </>
              )}
            </div>
          </div>
        </DialogContentSection>
      </DialogContent>
    </Dialog>
  );
}
