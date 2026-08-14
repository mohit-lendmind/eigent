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
  getAionProjectsMode,
  invalidateAionProjects,
  listAionProjects,
  type AionProject,
  type AionProjectsMode,
} from '@/store/aionProjectsStore';
import { useCallback, useEffect, useMemo, useState } from 'react';

export interface AionProjectsView {
  /** null while the mode is still being negotiated. */
  mode: AionProjectsMode | null;
  projects: AionProject[];
  /** Present when the edge has entries past the ones loaded. */
  nextPageToken?: string;
  loading: boolean;
  loadingMore: boolean;
  /** A failed page read, kept separate from the mode so a working list that
   *  fails to extend keeps showing the rows it already has. */
  error: string | null;
  loadMore: () => void;
  reload: () => void;
}

/**
 * The tenant's Projects in aion mode. Called ONCE per Home hub mount (the value
 * rides the hub context) so the tab count and the list read the same page
 * rather than issuing two walks of the same cursor.
 */
export function useAionProjects(): AionProjectsView {
  const [mode, setMode] = useState<AionProjectsMode | null>(null);
  const [projects, setProjects] = useState<AionProject[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void (async () => {
      const resolved = await getAionProjectsMode();
      if (!active) return;
      setMode(resolved);
      if (resolved.kind !== 'remote') {
        setProjects([]);
        setNextPageToken(undefined);
        setLoading(false);
        return;
      }
      try {
        const page = await listAionProjects();
        if (!active) return;
        setProjects(page.projects);
        setNextPageToken(page.nextPageToken);
      } catch (cause) {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadCount]);

  const loadMore = useCallback(() => {
    if (!nextPageToken || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    void listAionProjects({ pageToken: nextPageToken })
      .then((page) => {
        // Append rather than replace, and drop the spent token even when the
        // page came back empty, so a stuck token can never loop the button.
        setProjects((prev) => [...prev, ...page.projects]);
        setNextPageToken(page.nextPageToken);
      })
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => setLoadingMore(false));
  }, [loadingMore, nextPageToken]);

  const reload = useCallback(() => {
    invalidateAionProjects();
    setReloadCount((count) => count + 1);
  }, []);

  // Stable identity: this value rides the hub context memo, which would
  // otherwise recompute on every render of the Home hub.
  return useMemo(
    () => ({
      mode,
      projects,
      nextPageToken,
      loading,
      loadingMore,
      error,
      loadMore,
      reload,
    }),
    [
      error,
      loadMore,
      loading,
      loadingMore,
      mode,
      nextPageToken,
      projects,
      reload,
    ]
  );
}
