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

// Which Space a Project is filed under, and the one control that changes it.
// Filing is a property of the Project, not of a run: it changes what a listing
// shows and never what the Project does.

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHomeHub } from '../context';

// Radix has no value for "nothing selected" that survives a round trip, so the
// unfiled option carries a sentinel the transport never sees: it is translated
// back to an absent `space_id` before the call.
const UNFILED = '__unfiled__';

export default function AionProjectSpace({
  projectId,
  spaceId,
}: {
  projectId: string;
  spaceId?: string;
}) {
  const { t } = useTranslation();
  const { aionSpaces } = useHomeHub();
  const { spaces, mode, fileProject } = aionSpaces;
  const [filedIn, setFiledIn] = useState<string | undefined>(spaceId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Without a Space listing there is nothing to choose from and no name to
  // render, so the control is absent rather than an empty dropdown.
  if (mode?.kind !== 'remote') return null;

  const known = spaces.some((space) => space.spaceId === filedIn);

  const onChange = (next: string) => {
    const target = next === UNFILED ? undefined : next;
    if (target === filedIn) return;
    setSaving(true);
    setError(null);
    void fileProject(projectId, target)
      .then((filed) => setFiledIn(filed))
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : String(cause))
      )
      .finally(() => setSaving(false));
  };

  return (
    <div
      className="flex items-center gap-3 px-3 py-2"
      data-testid="aion-project-space"
      data-project-id={projectId}
      data-space-id={filedIn ?? ''}
    >
      <span className="text-body-xs text-ds-text-neutral-muted-default">
        {t('layout.aion-space-project-label')}
      </span>
      <Select
        value={filedIn ?? UNFILED}
        disabled={saving}
        onValueChange={onChange}
      >
        <SelectTrigger
          size="sm"
          className="w-56"
          aria-label={t('layout.aion-space-picker')}
          data-testid="aion-project-space-select"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNFILED}>
            {t('layout.aion-space-none')}
          </SelectItem>
          {/* A Project filed in a Space past the loaded page would otherwise
              render as blank — show the id it carries rather than nothing, so
              "filed somewhere not listed here" never reads as "filed nowhere". */}
          {filedIn && !known ? (
            <SelectItem value={filedIn}>
              {t('layout.aion-space-unlisted', { id: filedIn })}
            </SelectItem>
          ) : null}
          {spaces.map((space) => (
            <SelectItem key={space.spaceId} value={space.spaceId}>
              {space.status === 'archived'
                ? t('layout.aion-space-archived-option', {
                    name: space.name.trim() || t('layout.spaces-untitled'),
                  })
                : space.name.trim() || t('layout.spaces-untitled')}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? (
        <span
          className="text-body-xs text-ds-text-status-error-strong-default"
          role="alert"
          data-testid="aion-project-space-error"
        >
          {t('layout.aion-space-file-failed', { message: error })}
        </span>
      ) : null}
    </div>
  );
}
