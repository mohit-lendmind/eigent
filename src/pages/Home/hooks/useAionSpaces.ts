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

import { invalidateAionProjects } from '@/store/aionProjectsStore';
import { hydrateSpacesFromAion } from '@/store/aionSpaceBinding';
import {
  archiveAionSpace,
  createAionSpace,
  deleteAionSpace,
  fileProjectInAionSpace,
  getAionSpacesMode,
  invalidateAionSpaces,
  loadAionSpaces,
  renameAionSpace,
  unarchiveAionSpace,
  type AionSpace,
  type AionSpacesMode,
} from '@/store/aionSpacesStore';
import { useCallback, useEffect, useMemo, useState } from 'react';

export interface AionSpacesView {
  /** null while the mode is still being negotiated. */
  mode: AionSpacesMode | null;
  spaces: AionSpace[];
  /** Present when the edge has entries past the ones loaded. */
  nextPageToken?: string;
  loading: boolean;
  loadingMore: boolean;
  /** A failed read or a refused edit, kept out of `mode` so a working listing
   *  whose one action fails keeps showing its rows. */
  error: string | null;
  /** The row whose edit is in flight, so only that row's controls disable. */
  busySpaceId: string | null;
  /** True while a Space is being created, which belongs to no row yet. */
  creating: boolean;
  /** Resolves true when the Space was stored, so a composer closes only on a
   *  write the server accepted. */
  create: (name: string, description?: string) => Promise<boolean>;
  rename: (spaceId: string, name: string) => Promise<boolean>;
  setArchived: (spaceId: string, archived: boolean) => Promise<void>;
  remove: (spaceId: string) => Promise<void>;
  /** Files a Project under a Space, or unfiles it when `spaceId` is omitted.
   *  Resolves to the Space id the Project now carries. */
  fileProject: (
    projectId: string,
    spaceId?: string
  ) => Promise<string | undefined>;
  loadMore: () => void;
  reload: () => void;
}

/**
 * The tenant's Spaces in aion mode. Read ONCE per Home hub mount (the value
 * rides the hub context) so the tab count, the Spaces list and the Projects
 * list's Space picker all read the same page rather than three walks of the
 * same cursor.
 *
 * Every mutation reloads rather than patching the row in place: a Space's
 * `project_count` is measured server-side, and an edit here moves counts that
 * did not come back with the response — filing a Project changes the count of
 * the Space it left as well as the one it joined.
 */
export function useAionSpaces(): AionSpacesView {
  const [mode, setMode] = useState<AionSpacesMode | null>(null);
  const [spaces, setSpaces] = useState<AionSpace[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busySpaceId, setBusySpaceId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void (async () => {
      const resolved = await getAionSpacesMode();
      if (!active) return;
      setMode(resolved);
      if (resolved.kind !== 'remote') {
        setSpaces([]);
        setNextPageToken(undefined);
        setLoading(false);
        return;
      }
      try {
        const page = await loadAionSpaces();
        if (!active) return;
        setSpaces(page.spaces);
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
  }, [reloadCount]);

  const reload = useCallback(() => {
    invalidateAionSpaces();
    // Every mutation on this screen lands here, and the switcher draws the
    // renderer's own Space records rather than this list — so re-project the
    // edge onto them, or a Space created here is invisible in the switcher
    // until the next launch.
    void hydrateSpacesFromAion(true);
    setReloadCount((count) => count + 1);
  }, []);

  const loadMore = useCallback(() => {
    if (!nextPageToken || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    void loadAionSpaces(nextPageToken)
      .then((page) => {
        // Append rather than replace, and drop the spent token even when the
        // page came back empty, so a stuck token can never loop the button.
        setSpaces((prev) => [...prev, ...page.spaces]);
        setNextPageToken(page.nextPageToken);
      })
      .catch((cause) => setError(messageOf(cause)))
      .finally(() => setLoadingMore(false));
  }, [loadingMore, nextPageToken]);

  const create = useCallback(
    async (name: string, description?: string) => {
      setCreating(true);
      setError(null);
      try {
        await createAionSpace(name, description);
        reload();
        return true;
      } catch (cause) {
        setError(messageOf(cause));
        return false;
      } finally {
        setCreating(false);
      }
    },
    [reload]
  );

  const rename = useCallback(
    async (spaceId: string, name: string) => {
      setBusySpaceId(spaceId);
      setError(null);
      try {
        // The edit answers with the whole row, but the listing is ordered by
        // the server and a rename can move a row within it — so re-read rather
        // than splice the new name into an order this side does not own.
        await renameAionSpace(spaceId, name);
        reload();
        return true;
      } catch (cause) {
        setError(messageOf(cause));
        return false;
      } finally {
        setBusySpaceId(null);
      }
    },
    [reload]
  );

  const setArchived = useCallback(
    async (spaceId: string, archived: boolean) => {
      setBusySpaceId(spaceId);
      setError(null);
      try {
        await (archived
          ? archiveAionSpace(spaceId)
          : unarchiveAionSpace(spaceId));
        reload();
      } catch (cause) {
        setError(messageOf(cause));
      } finally {
        setBusySpaceId(null);
      }
    },
    [reload]
  );

  const remove = useCallback(
    async (spaceId: string) => {
      setBusySpaceId(spaceId);
      setError(null);
      try {
        await deleteAionSpace(spaceId);
        reload();
      } catch (cause) {
        // A Space that still holds Projects is refused by the edge. Report the
        // refusal and keep the row: it is still there, and a list that dropped
        // it would claim the delete had happened.
        setError(messageOf(cause));
      } finally {
        setBusySpaceId(null);
      }
    },
    [reload]
  );

  const fileProject = useCallback(
    async (projectId: string, spaceId?: string) => {
      setError(null);
      try {
        const filed = await fileProjectInAionSpace(projectId, spaceId);
        // The Project row that was just filed still carries its old `space_id`
        // in the cached page. Drop that cache so the next read of the Projects
        // list is truthful, without tearing down the list being interacted
        // with — the caller renders the new filing from the answer above.
        invalidateAionProjects();
        reload();
        return filed;
      } catch (cause) {
        setError(messageOf(cause));
        throw cause;
      }
    },
    [reload]
  );

  // Stable identity: this value rides the hub context memo, which would
  // otherwise recompute on every render of the Home hub.
  return useMemo(
    () => ({
      mode,
      spaces,
      nextPageToken,
      loading,
      loadingMore,
      error,
      busySpaceId,
      creating,
      create,
      rename,
      setArchived,
      remove,
      fileProject,
      loadMore,
      reload,
    }),
    [
      busySpaceId,
      create,
      creating,
      error,
      fileProject,
      loadMore,
      loading,
      loadingMore,
      mode,
      nextPageToken,
      reload,
      remove,
      rename,
      setArchived,
      spaces,
    ]
  );
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
