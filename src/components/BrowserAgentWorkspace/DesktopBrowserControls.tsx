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

/**
 * Header strip for a delegated run's browser card: says the page is live in a
 * window on this desktop, carries the logged-in-sessions badge when the run
 * borrows them, and offers Take Control / Give Back over the agent-browser
 * host bridge. Taking control makes the agent's pending and subsequent
 * actions fail fast with an in-band wait notice (pause-and-fail); giving back
 * lets it re-observe and continue. A closed window is the kill switch — the
 * run's remaining browser actions all fail — and the strip says so.
 *
 * State is polled rather than pushed: the window lives in the main process
 * and can be closed or retaken there at any moment, so the strip re-asks
 * while mounted instead of trusting its last render.
 */

import { Button } from '@/components/ui/button';
import { useHost } from '@/host';
import { Hand, Monitor, TriangleAlert, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const POLL_MS = 1500;

interface AgentBrowserStatus {
  windowOpen: boolean;
  takenOver: boolean;
  runId: string | null;
}

export function DesktopBrowserControls({
  runId,
  sessionMode,
}: {
  /** The run this card projects; window-closed only applies to its own run. */
  runId: string;
  sessionMode?: string;
}) {
  const { t } = useTranslation();
  const host = useHost();
  const [status, setStatus] = useState<AgentBrowserStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      const reply = await host?.electronAPI?.agentBrowserStatus?.();
      setStatus(reply?.success && reply.status ? reply.status : null);
    } catch {
      setStatus(null);
    }
  }, [host]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const setTaken = async (taken: boolean) => {
    try {
      await host?.electronAPI?.agentBrowserTakeControl?.(taken);
    } finally {
      void refresh();
    }
  };

  const closed =
    status !== null && status.runId === runId && !status.windowOpen;

  return (
    <div
      data-testid="desktop-browser-controls"
      className="flex flex-wrap items-center justify-between gap-sm rounded-lg bg-ds-bg-neutral-subtle-default px-2 py-1"
    >
      <div className="flex min-w-0 items-center gap-sm">
        <div className="flex items-center gap-1 text-xs font-medium text-ds-text-neutral-default-default">
          <Monitor size={14} />
          <span>{t('chat.local-browser-live')}</span>
        </div>
        {sessionMode === 'logged_in' && (
          <div
            data-testid="logged-in-badge"
            className="flex items-center gap-1 rounded bg-ds-bg-warning-subtle-default px-1.5 py-0.5 text-xs text-ds-text-warning-default-default"
          >
            <TriangleAlert size={12} />
            <span>{t('chat.local-browser-logged-in-badge')}</span>
          </div>
        )}
      </div>
      {closed ? (
        <span
          data-testid="desktop-browser-closed"
          className="text-xs text-ds-text-warning-default-default"
        >
          {t('chat.local-browser-closed-notice')}
        </span>
      ) : status?.takenOver ? (
        <div className="flex items-center gap-sm">
          <span className="text-xs text-ds-text-neutral-muted-default">
            {t('chat.local-browser-taken-notice')}
          </span>
          <Button size="xs" variant="success" onClick={() => setTaken(false)}>
            <Undo2 size={14} />
            <span>{t('chat.local-browser-give-back')}</span>
          </Button>
        </div>
      ) : status?.windowOpen ? (
        <Button size="xs" variant="primary" onClick={() => setTaken(true)}>
          <Hand size={14} />
          <span>{t('chat.local-browser-take-control')}</span>
        </Button>
      ) : null}
    </div>
  );
}
