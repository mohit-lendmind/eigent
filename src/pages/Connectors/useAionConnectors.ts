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
  connectAionConnector,
  disconnectAionConnector,
  getAionConnectorsMode,
  invalidateAionConnectors,
  loadAionConnectors,
  type AionConnector,
  type AionConnectorsMode,
} from '@/store/aionConnectorsStore';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// The consent flow completes in the user's browser and lands on the cell, so
// the only way this renderer learns the outcome is by re-reading the catalog.
// Bounded on purpose: an abandoned consent window must stop the polling rather
// than leave the row spinning for the rest of the session.
const AWAIT_POLL_INTERVAL_MS = 2_000;
const AWAIT_TIMEOUT_MS = 120_000;

export interface AionConnectorsView {
  /** null while the mode is still being negotiated. */
  mode: AionConnectorsMode | null;
  connectors: AionConnector[];
  loading: boolean;
  /** A failed read or mutation, kept out of `mode` so a working catalog that
   *  fails one action keeps showing its rows. */
  error: string | null;
  /** The row whose request is in flight, so only that row's button disables. */
  busyId: string | null;
  /** The row whose consent window is open and whose grant is being polled for. */
  awaitingId: string | null;
  /** True once the poll window for `awaitingId` elapsed without a grant. */
  awaitTimedOut: boolean;
  connect: (connectorId: string) => Promise<void>;
  disconnect: (connectorId: string) => Promise<void>;
  /** Abandons the wait without touching the flow — the state row stays valid
   *  server-side until it expires, so this is a UI decision only. */
  stopAwaiting: () => void;
  reload: () => void;
}

/**
 * The tenant's connector catalog in aion mode, plus the two actions the edge
 * serves. Connect deliberately resolves as soon as the browser has been handed
 * the consent URL: the grant is written by the cell's callback listener, so
 * treating the response as "connected" would report success for a flow the user
 * has not completed — and may abandon.
 */
export function useAionConnectors(
  openExternal: (url: string) => Promise<void>
): AionConnectorsView {
  const [mode, setMode] = useState<AionConnectorsMode | null>(null);
  const [connectors, setConnectors] = useState<AionConnector[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [awaitingId, setAwaitingId] = useState<string | null>(null);
  const [awaitTimedOut, setAwaitTimedOut] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);

  // Read by the poll loop, which must see the CURRENT rows without restarting
  // on every catalog refresh — an interval keyed on `connectors` would reset
  // its clock each tick and never reach the timeout.
  const connectorsRef = useRef<AionConnector[]>([]);
  connectorsRef.current = connectors;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void (async () => {
      const resolved = await getAionConnectorsMode();
      if (!active) return;
      setMode(resolved);
      if (resolved.kind !== 'remote') {
        setConnectors([]);
        setLoading(false);
        return;
      }
      try {
        const rows = await loadAionConnectors();
        if (active) setConnectors(rows);
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

  const refresh = useCallback(async () => {
    invalidateAionConnectors();
    const rows = await loadAionConnectors();
    setConnectors(rows);
    return rows;
  }, []);

  useEffect(() => {
    if (!awaitingId) return;
    let active = true;
    const deadline = Date.now() + AWAIT_TIMEOUT_MS;
    const timer = setInterval(() => {
      if (Date.now() >= deadline) {
        clearInterval(timer);
        if (active) {
          setAwaitingId(null);
          setAwaitTimedOut(true);
        }
        return;
      }
      void refresh()
        .then((rows) => {
          if (!active) return;
          const row = rows.find((c) => c.connectorId === awaitingId);
          if (row?.connected) setAwaitingId(null);
        })
        // A transient read failure mid-flow is not the flow failing: keep
        // polling and let the deadline decide.
        .catch(() => undefined);
    }, AWAIT_POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [awaitingId, refresh]);

  const connect = useCallback(
    async (connectorId: string) => {
      setBusyId(connectorId);
      setError(null);
      setAwaitTimedOut(false);
      try {
        const url = await connectAionConnector(connectorId);
        // Wait only after the browser actually has the URL — if opening it
        // fails there is nothing to wait for, and a spinner would be a lie.
        await openExternal(url);
        setAwaitingId(connectorId);
      } catch (cause) {
        setError(messageOf(cause));
      } finally {
        setBusyId(null);
      }
    },
    [openExternal]
  );

  const disconnect = useCallback(async (connectorId: string) => {
    setBusyId(connectorId);
    setError(null);
    try {
      setConnectors(await disconnectAionConnector(connectorId));
      // A disconnect during a pending connect ends the wait: whatever the user
      // meant, they no longer want this row polled into `connected`.
      setAwaitingId((current) => (current === connectorId ? null : current));
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusyId(null);
    }
  }, []);

  const stopAwaiting = useCallback(() => {
    setAwaitingId(null);
    setAwaitTimedOut(false);
  }, []);

  const reload = useCallback(() => {
    invalidateAionConnectors();
    setAwaitingId(null);
    setAwaitTimedOut(false);
    setReloadCount((count) => count + 1);
  }, []);

  return useMemo(
    () => ({
      mode,
      connectors,
      loading,
      error,
      busyId,
      awaitingId,
      awaitTimedOut,
      connect,
      disconnect,
      stopAwaiting,
      reload,
    }),
    [
      awaitTimedOut,
      awaitingId,
      busyId,
      connect,
      connectors,
      disconnect,
      error,
      loading,
      mode,
      reload,
      stopAwaiting,
    ]
  );
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
