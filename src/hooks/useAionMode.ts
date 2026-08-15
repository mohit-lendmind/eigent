// Which control plane this renderer is attached to, for the surfaces that only
// one of the two planes can serve.
//
// Nav registries are the reason this exists. Some sections only aion can serve
// — a bill needs a plane that meters what a run costs — so on any other plane
// the entry is hidden rather than left clickable over an empty screen.

import { useEffect, useState } from 'react';

import {
  getAionRemoteConfig,
  type AionRemoteConfig,
} from '@/store/aionChatBridge';

/**
 * `unknown` is the state before the main process answers. It is deliberately
 * not a synonym for `legacy`: a gated entry stays hidden until the mode is
 * known, so a dead screen can never flash into the nav on an aion stack.
 */
export type AionMode = 'unknown' | 'aion' | 'legacy';

/**
 * A misconfigured remote backend is still aion mode. The desktop was pointed
 * at an edge, so the legacy screens are just as dead as they are on a working
 * one — the error belongs to the surfaces that read the edge, not here.
 */
export function modeFromConfig(config: AionRemoteConfig | null): AionMode {
  return config === null ? 'legacy' : 'aion';
}

export function useAionMode(): AionMode {
  const [mode, setMode] = useState<AionMode>('unknown');

  useEffect(() => {
    let active = true;
    void getAionRemoteConfig()
      .then((config) => {
        if (active) setMode(modeFromConfig(config));
      })
      .catch(() => {
        // getAionRemoteConfig resolves rather than rejects for a misconfigured
        // backend; a throw here means the IPC itself is unavailable, which is
        // the packaged web build — legacy by construction.
        if (active) setMode('legacy');
      });
    return () => {
      active = false;
    };
  }, []);

  return mode;
}

/**
 * Filters a declarative nav registry. An entry is kept when the mode is one it
 * can serve; `unknown` keeps only the entries both planes can serve.
 */
export function visibleInMode<T extends { id: string }>(
  items: readonly T[],
  mode: AionMode,
  legacyOnly: readonly string[],
  aionOnly: readonly string[] = []
): T[] {
  if (mode === 'legacy') {
    return items.filter((item) => !aionOnly.includes(item.id));
  }
  if (mode === 'aion') {
    return items.filter((item) => !legacyOnly.includes(item.id));
  }
  return items.filter(
    (item) => !legacyOnly.includes(item.id) && !aionOnly.includes(item.id)
  );
}
