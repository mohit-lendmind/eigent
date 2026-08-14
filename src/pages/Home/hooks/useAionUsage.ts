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
  getAionUsageMode,
  invalidateAionUsage,
  loadAionUsage,
  type AionRunSpend,
  type AionUsageMode,
  type AionUsageTotals,
} from '@/store/aionUsageStore';
import { useCallback, useEffect, useMemo, useState } from 'react';

export interface AionUsageView {
  /** null while the mode is still being negotiated. */
  mode: AionUsageMode | null;
  /** null until a page has been read; the window totals, not a page subtotal. */
  totals: AionUsageTotals | null;
  runs: AionRunSpend[];
  /** Present when the edge has settled runs past the ones loaded. */
  nextPageToken?: string;
  loading: boolean;
  loadingMore: boolean;
  /** A failed page read, kept separate from the mode so a working bill that
   *  fails to extend keeps showing the rows it already has. */
  error: string | null;
  loadMore: () => void;
  reload: () => void;
}

/**
 * The tenant's bill in aion mode. Totals come from the first page and are NOT
 * recomputed as later pages arrive: the edge already covers the whole window on
 * every page, and re-summing the loaded rows would turn a true total into a
 * page subtotal that shrinks the bill the more of it you read.
 */
export function useAionUsage(): AionUsageView {
  const [mode, setMode] = useState<AionUsageMode | null>(null);
  const [totals, setTotals] = useState<AionUsageTotals | null>(null);
  const [runs, setRuns] = useState<AionRunSpend[]>([]);
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
      const resolved = await getAionUsageMode();
      if (!active) return;
      setMode(resolved);
      if (resolved.kind !== 'remote') {
        setTotals(null);
        setRuns([]);
        setNextPageToken(undefined);
        setLoading(false);
        return;
      }
      try {
        const page = await loadAionUsage();
        if (!active) return;
        setTotals(page.totals);
        setRuns(page.runs);
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
    void loadAionUsage({ pageToken: nextPageToken })
      .then((page) => {
        // Append rather than replace, and drop the spent token even when the
        // page came back empty, so a stuck token can never loop the button.
        setRuns((prev) => [...prev, ...page.runs]);
        setNextPageToken(page.nextPageToken);
      })
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => setLoadingMore(false));
  }, [loadingMore, nextPageToken]);

  const reload = useCallback(() => {
    invalidateAionUsage();
    setReloadCount((count) => count + 1);
  }, []);

  // Stable identity: this value rides the hub context memo, which would
  // otherwise recompute on every render of the Home hub.
  return useMemo(
    () => ({
      mode,
      totals,
      runs,
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
      runs,
      reload,
      totals,
    ]
  );
}
