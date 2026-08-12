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
import {
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogHeader,
} from '@/components/ui/dialog';
import { recordFeatureUsed } from '@/lib/events/appEvents';
import type { ReplySkill } from '@/lib/skillToolkit';
import { putAionSkill } from '@/store/aionSkillsStore';
import { getSkillsStore } from '@/store/skillsStore';
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

interface SaveSkillDialogProps {
  open: boolean;
  skill: ReplySkill | null;
  onClose: () => void;
}

/**
 * Save-as-skill (remote mode only): an assistant reply carrying a SKILL.md
 * document can be stored to the aion SkillStore in one click. The dialog
 * surfaces what would be stored — name, description, and any extra
 * frontmatter such as entrypoint / allowed_tools — before the PUT.
 */
export default function SaveSkillDialog({
  open,
  skill,
  onClose,
}: SaveSkillDialogProps) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);

  if (!skill) return null;

  const extraEntries = Object.entries(skill.extras);
  // An unbounded tool whitelist deserves an explicit flag before it is stored.
  const broadWhitelist = /(^|[,\s])\*([,\s]|$)/.test(
    skill.extras.allowed_tools ?? ''
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await putAionSkill(skill.meta, [], skill.extras);
      const ignored = result.ignored_fields ?? [];
      toast.success(
        t('chat.skill-saved', { name: skill.meta.name }) +
          (ignored.length > 0
            ? ` ${t('chat.skill-saved-ignored-fields', { fields: ignored.join(', ') })}`
            : '')
      );
      recordFeatureUsed('skills', { action: 'save-from-chat' });
      void getSkillsStore().syncFromDisk();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent size="sm" showCloseButton onClose={onClose}>
        <DialogHeader title={t('chat.save-as-skill')} />
        <DialogContentSection>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-body-base font-bold text-ds-text-neutral-default-default">
                {skill.meta.name}
              </span>
              <p className="text-body-sm text-ds-text-neutral-muted-default">
                {skill.meta.description}
              </p>
            </div>
            {extraEntries.length > 0 && (
              <div className="flex flex-col gap-1 rounded-xl bg-ds-bg-neutral-default-default p-3">
                {extraEntries.map(([key, value]) => (
                  <div
                    key={key}
                    className="flex items-baseline gap-2 text-label-sm"
                  >
                    <span className="font-bold text-ds-text-neutral-default-default">
                      {key}
                    </span>
                    <span className="break-all text-ds-text-neutral-muted-default">
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {broadWhitelist && (
              <div
                className="flex items-center gap-2 rounded-xl border border-ds-border-status-error-default-default bg-ds-bg-status-error-subtle-default px-3 py-2"
                role="alert"
              >
                <AlertTriangle className="h-4 w-4 shrink-0 text-ds-icon-status-error-default-default" />
                <span className="text-label-sm text-ds-text-status-error-strong-default">
                  {t('chat.save-as-skill-broad-whitelist')}
                </span>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" type="button" onClick={onClose}>
                {t('layout.cancel')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                type="button"
                disabled={saving}
                onClick={() => void handleSave()}
                data-testid="save-skill-confirm"
              >
                {t('agents.save-skill')}
              </Button>
            </div>
          </div>
        </DialogContentSection>
      </DialogContent>
    </Dialog>
  );
}
