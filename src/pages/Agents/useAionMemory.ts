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
  clearAionMemory,
  forgetAionMemory,
  getAionMemoryMode,
  invalidateAionMemory,
  loadAionMemory,
  readAionMemory,
  searchAionMemory,
  writeAionMemory,
  type AionMemoryCatalog,
  type AionMemoryDoc,
  type AionMemoryHit,
  type AionMemoryMode,
  type AionMemoryUsage,
} from '@/store/aionMemoryStore';
import { useCallback, useEffect, useMemo, useState } from 'react';

export interface AionMemoryView {
  /** null while the mode is still being negotiated. */
  mode: AionMemoryMode | null;
  /** The scope the listing came from, null until one has been read. This is the
   *  server's answer, not the request: asking for nothing gets the default. */
  scope: string | null;
  scopes: string[];
  /** Metadata rows — no document text. Text arrives from `open` or `search`. */
  docs: AionMemoryDoc[];
  usage: AionMemoryUsage | null;
  loading: boolean;
  /** A failed read or mutation, kept out of `mode` so a working scope that
   *  fails one action keeps showing its rows. */
  error: string | null;
  /** The document whose read or forget is in flight. */
  pendingKey: string | null;
  /** True while a write or a scope-wide forget is in flight. */
  busy: boolean;
  /** The open document, with its content. */
  opened: AionMemoryDoc | null;
  /** null when no search is showing; an array — possibly empty — once one
   *  answered, so "no matches" is distinguishable from "not searching". */
  hits: AionMemoryHit[] | null;
  searching: boolean;
  /** How many documents the last scope-wide forget removed. */
  cleared: number | null;
  selectScope: (scope: string) => void;
  open: (key: string) => Promise<void>;
  close: () => void;
  search: (query: string) => Promise<void>;
  clearSearch: () => void;
  /** Resolves true when the document was stored, so a composer closes only on
   *  a write the server accepted. */
  write: (key: string, content: string) => Promise<boolean>;
  forget: (key: string) => Promise<void>;
  forgetScope: () => Promise<void>;
  reload: () => void;
}

/**
 * What the agent remembers in one scope, plus the four things a person can do
 * about it: read a document, search for one, write one, and forget.
 *
 * The scope is chosen from the set the catalog publishes and is never typed by
 * hand — the edge refuses a scope it does not serve rather than falling back to
 * a default, so a free-form name would turn a switcher into an error generator.
 */
export function useAionMemory(): AionMemoryView {
  const [mode, setMode] = useState<AionMemoryMode | null>(null);
  const [catalog, setCatalog] = useState<AionMemoryCatalog | null>(null);
  // undefined asks for the deployment's default, which is the only thing a
  // client that has never seen a catalog can ask for: the served set of names
  // arrives with one.
  const [requestedScope, setRequestedScope] = useState<string | undefined>(
    undefined
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState<AionMemoryDoc | null>(null);
  const [hits, setHits] = useState<AionMemoryHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [cleared, setCleared] = useState<number | null>(null);
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void (async () => {
      const resolved = await getAionMemoryMode();
      if (!active) return;
      setMode(resolved);
      if (resolved.kind !== 'remote') {
        setCatalog(null);
        setLoading(false);
        return;
      }
      try {
        const next = await loadAionMemory(requestedScope);
        if (active) setCatalog(next);
      } catch (cause) {
        if (active) setError(messageOf(cause));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [requestedScope, reloadCount]);

  const selectScope = useCallback((scope: string) => {
    // Everything on screen belongs to the scope being left: an open document,
    // a result list and a clear-count are all answers about somewhere else.
    setOpened(null);
    setHits(null);
    setCleared(null);
    setError(null);
    setRequestedScope(scope);
  }, []);

  const open = useCallback(
    async (key: string) => {
      setPendingKey(key);
      setError(null);
      try {
        setOpened(await readAionMemory(key, requestedScope));
      } catch (cause) {
        setError(messageOf(cause));
      } finally {
        setPendingKey(null);
      }
    },
    [requestedScope]
  );

  const close = useCallback(() => setOpened(null), []);

  const search = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (!trimmed) {
        setHits(null);
        return;
      }
      setSearching(true);
      setError(null);
      try {
        setHits(await searchAionMemory(trimmed, { scope: requestedScope }));
      } catch (cause) {
        setError(messageOf(cause));
      } finally {
        setSearching(false);
      }
    },
    [requestedScope]
  );

  const clearSearch = useCallback(() => setHits(null), []);

  const write = useCallback(
    async (key: string, content: string) => {
      setBusy(true);
      setError(null);
      setCleared(null);
      try {
        const next = await writeAionMemory(key, content, requestedScope);
        setCatalog(next);
        // Show what was stored without a second read: the write replaced the
        // document whole, so the text is known here and only the row metadata
        // had to come back from the server.
        const row = next.docs.find((doc) => doc.key === key);
        setOpened(row ? { ...row, content } : null);
        // A result list ranked before this write can no longer be trusted to
        // rank it, and this side cannot re-score. Drop it rather than show a
        // stale order; the query is still in the box.
        setHits(null);
        return true;
      } catch (cause) {
        setError(messageOf(cause));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [requestedScope]
  );

  const forget = useCallback(
    async (key: string) => {
      setPendingKey(key);
      setError(null);
      setCleared(null);
      try {
        setCatalog(await forgetAionMemory(key, requestedScope));
        setOpened((current) => (current?.key === key ? null : current));
        setHits(null);
      } catch (cause) {
        setError(messageOf(cause));
      } finally {
        setPendingKey(null);
      }
    },
    [requestedScope]
  );

  const forgetScope = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await clearAionMemory(requestedScope);
      setCatalog(result.catalog);
      setCleared(result.deleted);
      setOpened(null);
      setHits(null);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }, [requestedScope]);

  const reload = useCallback(() => {
    invalidateAionMemory();
    setOpened(null);
    setHits(null);
    setCleared(null);
    setReloadCount((count) => count + 1);
  }, []);

  return useMemo(
    () => ({
      mode,
      scope: catalog?.scope ?? null,
      scopes: catalog?.scopes ?? [],
      docs: catalog?.docs ?? [],
      usage: catalog?.usage ?? null,
      loading,
      error,
      pendingKey,
      busy,
      opened,
      hits,
      searching,
      cleared,
      selectScope,
      open,
      close,
      search,
      clearSearch,
      write,
      forget,
      forgetScope,
      reload,
    }),
    [
      busy,
      catalog,
      clearSearch,
      cleared,
      close,
      error,
      forget,
      forgetScope,
      hits,
      loading,
      mode,
      open,
      opened,
      pendingKey,
      reload,
      search,
      searching,
      selectScope,
      write,
    ]
  );
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
