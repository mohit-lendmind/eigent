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
import { formatArtifactSize } from '@/components/Session/PreviewPanel/tabs/artifact/artifactLanes';
import { usePageTabStore } from '@/store/pageTabStore';
import { FileBox } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface ArtifactCardProps {
  card: NonNullable<Message['artifactCard']>;
}

/**
 * Announces a published deliverable in the conversation, where the run
 * produced it, with the one affordance that matters: open it in the viewer.
 */
export function ArtifactCard({ card }: ArtifactCardProps) {
  const { t } = useTranslation();
  const openArtifactPreview = usePageTabStore((s) => s.openArtifactPreview);
  return (
    <div
      data-artifact-card={card.name}
      className="flex w-full min-w-0 items-center gap-2.5 rounded-xl border border-solid border-ds-border-neutral-subtle-disabled bg-ds-bg-neutral-default-default px-3 py-2"
    >
      <FileBox
        size={16}
        aria-hidden
        className="shrink-0 text-ds-icon-neutral-default-default"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate !text-label-sm font-medium text-ds-text-neutral-default-default">
          {card.name}
        </span>
        <span className="truncate !text-label-xs text-ds-text-neutral-muted-default">
          {card.version > 1 ? `v${card.version} · ` : ''}
          {formatArtifactSize(card.sizeBytes)}
          {card.mediaType ? ` · ${card.mediaType}` : ''}
        </span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => openArtifactPreview(card.artifactId, card.name)}
        className="shrink-0"
      >
        {t('artifact.open', { defaultValue: 'Open' })}
      </Button>
    </div>
  );
}

export default ArtifactCard;
