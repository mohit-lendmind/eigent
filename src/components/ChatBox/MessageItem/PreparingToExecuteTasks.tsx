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

import ShinyText from '@/components/ui/ShinyText/ShinyText';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

// The aion run_progress stage vocabulary is closed for now but declared
// expandable, so an unknown stage falls back to the event's own detail (or
// the generic preparing label) rather than rendering a raw enum token.
function stageLabel(t: TFunction, stage?: string, detail?: string): string {
  switch (stage) {
    case 'dispatching':
      // The long wait under this stage is workspace provisioning — the run
      // was claimed and the sandbox is being prepared.
      return t('chat.run-stage-dispatching', {
        defaultValue: 'Preparing the workspace…',
      });
    case 'workspace_ready':
      return t('chat.run-stage-workspace-ready', {
        defaultValue: 'Workspace ready — starting the agent…',
      });
    case 'starting':
      return t('chat.run-stage-starting', {
        defaultValue: 'Agent running — waiting for its first output…',
      });
    default:
      return detail || t('chat.preparing-to-execute-tasks');
  }
}

/**
 * Shown from submit until the run has renderable output. Without a stage it
 * is the generic preparing shimmer; with one (aion run_progress) it narrates
 * where the dispatch actually is.
 */
export function PreparingToExecuteTasks({
  stage,
  detail,
}: {
  stage?: string;
  detail?: string;
} = {}) {
  const { t } = useTranslation();

  return (
    <div
      className="py-2 min-w-0 flex w-full items-center"
      role="status"
      aria-live="polite"
      data-run-stage={stage || undefined}
    >
      <ShinyText
        text={stageLabel(t, stage, detail)}
        className="text-body-sm"
        speed={2.5}
      />
    </div>
  );
}
