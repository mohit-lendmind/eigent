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

import AionTriggers from './AionTriggers';
import { useAionProjects } from './hooks/useAionProjects';
import { useAionSchedules } from './hooks/useAionSchedules';

/**
 * The workspace's own triggers tab. It owns the two reads because it mounts on
 * a different route than the Home hub, so the two screens are never in one
 * tree at once — see the note on `AionTriggers` for why a second caller in the
 * same tree would be a duplicate ledger fan-out.
 */
export default function AionTriggersPanel({
  className,
  openCreateRequestId,
  createTaskPrompt,
}: {
  className?: string;
  openCreateRequestId?: number;
  createTaskPrompt?: string;
}) {
  const aionSchedules = useAionSchedules();
  const aionProjects = useAionProjects();
  return (
    <AionTriggers
      aionSchedules={aionSchedules}
      aionProjects={aionProjects}
      className={className}
      openCreateRequestId={openCreateRequestId}
      createTaskPrompt={createTaskPrompt}
    />
  );
}
