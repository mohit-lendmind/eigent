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
  clearStoredAionApiKey,
  createAionApiKey,
  getAionAccountMode,
  invalidateAionAccount,
  loadAionAccount,
  loadAionApiKeys,
  revokeAionApiKey,
  type AionAccount,
  type AionAccountMode,
  type AionApiKey,
} from '@/store/aionAccountStore';
import { useCallback, useEffect, useMemo, useState } from 'react';

/** A freshly minted key, held only long enough for the user to copy it. */
export interface MintedKey {
  keyId: string;
  /** Absent on an idempotent replay: the secret was shown once and is gone. */
  rawKey?: string;
  replayed: boolean;
}

export interface AionAccountView {
  /** null while the mode is still being negotiated. */
  mode: AionAccountMode | null;
  account: AionAccount | null;
  keys: AionApiKey[];
  loading: boolean;
  /** A failed read or action, kept out of `mode` so one failure does not blank
   *  an account that loaded. */
  error: string | null;
  busy: boolean;
  minted: MintedKey | null;
  createKey: (label: string) => Promise<void>;
  revokeKey: (keyId: string) => Promise<void>;
  dismissMinted: () => void;
  signOut: () => Promise<void>;
  reload: () => void;
}

/**
 * The account this desktop is authenticated as, plus the tenant's keys when the
 * deployment serves them. Key management is loaded only when `key_management`
 * says the routes exist: a list request against a deployment without a key
 * directory answers 501, and rendering the section from its failure would make
 * an operator's deliberate configuration look like an outage.
 */
export function useAionAccount(): AionAccountView {
  const [mode, setMode] = useState<AionAccountMode | null>(null);
  const [account, setAccount] = useState<AionAccount | null>(null);
  const [keys, setKeys] = useState<AionApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [minted, setMinted] = useState<MintedKey | null>(null);
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void (async () => {
      const resolved = await getAionAccountMode();
      if (!active) return;
      setMode(resolved);
      if (resolved.kind !== 'remote') {
        setAccount(null);
        setKeys([]);
        setLoading(false);
        return;
      }
      try {
        const loaded = await loadAionAccount();
        if (!active) return;
        setAccount(loaded);
        setKeys(loaded.keyManagement ? await loadAionApiKeys() : []);
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

  const createKey = useCallback(async (label: string) => {
    setBusy(true);
    setError(null);
    try {
      const created = await createAionApiKey(label);
      setMinted(created);
      setKeys(await loadAionApiKeys());
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  const revokeKey = useCallback(async (keyId: string) => {
    setBusy(true);
    setError(null);
    try {
      setKeys(await revokeAionApiKey(keyId));
      // A minted key that has just been revoked is no longer worth copying.
      setMinted((current) => (current?.keyId === keyId ? null : current));
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  const dismissMinted = useCallback(() => setMinted(null), []);

  const signOut = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await clearStoredAionApiKey();
      // Reloading the window is what puts the app back through the guard, and
      // so through onboarding — the alternative is a live renderer holding a
      // transport for a key the profile no longer has.
      globalThis.location?.reload();
    } catch (cause) {
      setError(messageOf(cause));
      setBusy(false);
    }
  }, []);

  const reload = useCallback(() => {
    invalidateAionAccount();
    setMinted(null);
    setReloadCount((count) => count + 1);
  }, []);

  return useMemo(
    () => ({
      mode,
      account,
      keys,
      loading,
      error,
      busy,
      minted,
      createKey,
      revokeKey,
      dismissMinted,
      signOut,
      reload,
    }),
    [
      account,
      busy,
      createKey,
      dismissMinted,
      error,
      keys,
      loading,
      minted,
      mode,
      reload,
      revokeKey,
      signOut,
    ]
  );
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
