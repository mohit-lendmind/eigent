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

// What a Project produced, listed under its row. Rendered only while open: the
// listing is a request per Project, and a collapsed hub of Projects must not
// cost one apiece.

import { Button } from '@/components/ui/button';
import { formatBytes } from '@/lib/utils';
import { Download, FileText, Loader2 } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAionArtifacts } from '../hooks/useAionArtifacts';
import { formatHubRelativeAgo } from '../utils';

/**
 * A row's own version is worth showing only where the name repeats — otherwise
 * every row would carry a `v1` that distinguishes nothing.
 */
function repeatedNames(names: string[]): Set<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) repeated.add(name);
    seen.add(name);
  }
  return repeated;
}

export default function AionProjectArtifacts({
  projectId,
  openExternal,
}: {
  projectId: string;
  openExternal: (url: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const {
    mode,
    artifacts,
    nextPageToken,
    loading,
    loadingMore,
    error,
    downloadingId,
    download,
    loadMore,
  } = useAionArtifacts(projectId, openExternal);

  const repeated = repeatedNames(artifacts.map((a) => a.name));
  const onDownload = useCallback(
    (artifactId: string) => {
      void download(artifactId);
    },
    [download]
  );

  if (mode === null || loading) {
    return (
      <div
        className="px-3 py-2 text-body-xs text-ds-text-neutral-muted-default"
        data-testid="aion-artifacts-loading"
      >
        {t('layout.loading')}
      </div>
    );
  }

  // Below the listing floor an empty list would claim the Project produced
  // nothing, when in fact this desktop cannot enumerate what it produced.
  if (mode.kind === 'unsupported') {
    return (
      <div
        className="px-3 py-2 text-body-xs text-ds-text-neutral-muted-default"
        role="alert"
        data-testid="aion-artifacts-unsupported"
      >
        {t('layout.artifacts-backend-too-old', {
          version: mode.edgeApiVersion,
        })}
      </div>
    );
  }
  if (mode.kind !== 'remote') {
    return null;
  }

  if (error && artifacts.length === 0) {
    return (
      <div
        className="px-3 py-2 text-body-xs text-ds-text-status-error-strong-default"
        role="alert"
        data-testid="aion-artifacts-error"
      >
        {t('layout.artifacts-remote-error', { message: error })}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 pb-2" data-testid="aion-artifacts">
      {artifacts.length === 0 ? (
        <div
          className="px-3 py-2 text-body-xs text-ds-text-neutral-muted-default"
          data-testid="aion-artifacts-empty"
        >
          {t('layout.artifacts-empty')}
        </div>
      ) : (
        artifacts.map((artifact) => (
          <div
            key={artifact.artifactId}
            data-testid="aion-artifact-row"
            className="flex items-center gap-3 rounded-lg px-3 py-1.5"
          >
            <FileText
              className="h-4 w-4 shrink-0 text-ds-icon-neutral-muted-default"
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-body-xs text-ds-text-neutral-default-default">
              {artifact.name}
              {repeated.has(artifact.name) ? (
                <span className="ml-1.5 text-ds-text-neutral-muted-default">
                  {t('layout.artifacts-version', { version: artifact.version })}
                </span>
              ) : null}
            </span>
            <span className="shrink-0 text-body-xs tabular-nums text-ds-text-neutral-muted-default">
              {formatBytes(artifact.sizeBytes)}
            </span>
            <span className="w-24 shrink-0 truncate text-right text-body-xs tabular-nums text-ds-text-neutral-muted-default">
              {formatHubRelativeAgo(artifact.publishedAt, t)}
            </span>
            <Button
              variant="ghost"
              size="icon"
              data-testid="aion-artifact-download"
              aria-label={t('layout.artifacts-download', {
                name: artifact.name,
              })}
              disabled={downloadingId === artifact.artifactId}
              onClick={() => onDownload(artifact.artifactId)}
            >
              {downloadingId === artifact.artifactId ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Download className="h-4 w-4" aria-hidden />
              )}
            </Button>
          </div>
        ))
      )}
      {/* A failure that arrives with rows already drawn reports below them —
          a refused download must not take the listing away. */}
      {error ? (
        <div
          className="px-3 text-body-xs text-ds-text-status-error-strong-default"
          role="alert"
          data-testid="aion-artifacts-error"
        >
          {t('layout.artifacts-remote-error', { message: error })}
        </div>
      ) : null}
      {nextPageToken ? (
        <div className="px-3 pt-1">
          <Button
            variant="secondary"
            size="sm"
            data-testid="aion-artifacts-load-more"
            disabled={loadingMore}
            onClick={loadMore}
          >
            {loadingMore ? t('layout.loading') : t('layout.projects-load-more')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
