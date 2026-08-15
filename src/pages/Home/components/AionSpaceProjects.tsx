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

// What a Space holds, listed under its row. Read through the `space_id` filter
// rather than from the Projects list this hub already loaded: that list is one
// page of the tenant's newest Projects, so filtering it client-side would show
// a Space as empty whenever everything filed in it is older than a page.

import { listAionProjects, type AionProject } from '@/store/aionProjectsStore';
import { FolderOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatHubRelativeAgo } from '../utils';

export default function AionSpaceProjects({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<AionProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setProjects(null);
    setError(null);
    void listAionProjects({ spaceId })
      .then((page) => {
        if (active) setProjects(page.projects);
      })
      .catch((cause) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    return () => {
      active = false;
    };
  }, [spaceId]);

  if (error) {
    return (
      <div
        className="px-9 py-2 text-body-xs text-ds-text-status-error-strong-default"
        role="alert"
        data-testid="aion-space-projects-error"
      >
        {t('layout.projects-remote-error', { message: error })}
      </div>
    );
  }
  if (projects === null) {
    return (
      <div className="px-9 py-2 text-body-xs text-ds-text-neutral-muted-default">
        {t('layout.loading')}
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-1 pb-2"
      data-testid="aion-space-projects"
      data-space-id={spaceId}
      data-count={projects.length}
    >
      {projects.length === 0 ? (
        <div
          className="px-9 py-2 text-body-xs text-ds-text-neutral-muted-default"
          data-testid="aion-space-projects-empty"
        >
          {t('layout.aion-space-projects-empty')}
        </div>
      ) : (
        projects.map((project) => (
          <div
            key={project.projectId}
            data-testid="aion-space-project-row"
            data-project-id={project.projectId}
            className="flex items-center gap-3 rounded-lg px-9 py-1.5"
          >
            <FolderOpen
              className="h-4 w-4 shrink-0 text-ds-icon-neutral-muted-default"
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-body-xs text-ds-text-neutral-default-default">
              {project.title}
            </span>
            <span className="w-24 shrink-0 truncate text-right text-body-xs tabular-nums text-ds-text-neutral-muted-default">
              {formatHubRelativeAgo(project.updatedAt, t)}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
