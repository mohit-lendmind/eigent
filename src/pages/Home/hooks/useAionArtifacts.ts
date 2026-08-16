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

import {
  getAionArtifactsMode,
  grantAionArtifact,
  invalidateAionArtifacts,
  loadAionArtifacts,
  type AionArtifact,
  type AionArtifactsMode,
} from '@/store/aionArtifactsStore';
import { useCallback, useEffect, useMemo, useState } from 'react';

export interface AionArtifactsView {
  /** null while the mode is still being negotiated. */
  mode: AionArtifactsMode | null;
  artifacts: AionArtifact[];
  /** Present when the edge has entries past the ones loaded. */
  nextPageToken?: string;
  loading: boolean;
  loadingMore: boolean;
  /** A failed page read or a refused grant, kept separate from the mode so a
   *  working listing whose download fails keeps showing its rows. */
  error: string | null;
  /** The row whose grant is being minted, so only that row's button disables. */
  downloadingId: string | null;
  /** Mints a read grant and hands the URL to `open`. */
  download: (artifactId: string) => Promise<void>;
  loadMore: () => void;
  reload: () => void;
}

/**
 * One Project's published artifacts. Called when the listing is opened rather
 * than with the Project row: an artifact page is a second request per Project,
 * and drawing a collapsed list of Projects must not cost one apiece.
 */
export function useAionArtifacts(
  projectId: string,
  open: (url: string) => Promise<void>
): AionArtifactsView {
  const [mode, setMode] = useState<AionArtifactsMode | null>(null);
  const [artifacts, setArtifacts] = useState<AionArtifact[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void (async () => {
      const resolved = await getAionArtifactsMode();
      if (!active) return;
      setMode(resolved);
      if (resolved.kind !== 'remote') {
        setArtifacts([]);
        setNextPageToken(undefined);
        setLoading(false);
        return;
      }
      try {
        const page = await loadAionArtifacts(projectId);
        if (!active) return;
        setArtifacts(page.artifacts);
        setNextPageToken(page.nextPageToken);
      } catch (cause) {
        if (active) setError(messageOf(cause));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [projectId, reloadCount]);

  const loadMore = useCallback(() => {
    if (!nextPageToken || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    void loadAionArtifacts(projectId, nextPageToken)
      .then((page) => {
        // Append rather than replace, and drop the spent token even when the
        // page came back empty, so a stuck token can never loop the button.
        setArtifacts((prev) => [...prev, ...page.artifacts]);
        setNextPageToken(page.nextPageToken);
      })
      .catch((cause) => setError(messageOf(cause)))
      .finally(() => setLoadingMore(false));
  }, [loadingMore, nextPageToken, projectId]);

  const download = useCallback(
    async (artifactId: string) => {
      setDownloadingId(artifactId);
      setError(null);
      try {
        const grant = await grantAionArtifact(projectId, artifactId);
        await open(grant.downloadUrl);
      } catch (cause) {
        setError(messageOf(cause));
      } finally {
        setDownloadingId(null);
      }
    },
    [open, projectId]
  );

  const reload = useCallback(() => {
    invalidateAionArtifacts(projectId);
    setReloadCount((count) => count + 1);
  }, [projectId]);

  return useMemo(
    () => ({
      mode,
      artifacts,
      nextPageToken,
      loading,
      loadingMore,
      error,
      downloadingId,
      download,
      loadMore,
      reload,
    }),
    [
      artifacts,
      download,
      downloadingId,
      error,
      loadMore,
      loading,
      loadingMore,
      mode,
      nextPageToken,
      reload,
    ]
  );
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
