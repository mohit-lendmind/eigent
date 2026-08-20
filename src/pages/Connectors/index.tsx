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

// The tenant's connectors as aion reports them. The catalog is the operator's,
// so this screen registers nothing and installs nothing — it shows which
// integrations exist and whether this user has granted access to each.
//
// Three states share one row and must not be collapsed: connected, connectable
// but not connected, and in the catalog but not connectable here (the server
// has no connector vault, which no user action can fix). An empty catalog is a
// fourth fact again — this tenant has no integrations registered — and reads
// differently from a backend that cannot answer.

import SearchInput from '@/components/Dashboard/SearchInput';
import { Button } from '@/components/ui/button';
import { useHost } from '@/host';
import {
  connectorState,
  type AionConnector,
} from '@/store/aionConnectorsStore';
import {
  AlertCircle,
  BadgeCheck,
  ExternalLink,
  Loader2,
  Plug,
  RefreshCw,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAionConnectors } from './useAionConnectors';

function Banner({ message, testId }: { message: string; testId: string }) {
  return (
    <div
      className="flex items-center gap-3 rounded-2xl bg-ds-bg-neutral-default-default px-4 py-3.5"
      role="alert"
      data-testid={testId}
    >
      <AlertCircle className="h-5 w-5 shrink-0 text-ds-icon-status-error-default-default" />
      <span className="text-body-sm text-ds-text-neutral-default-default">
        {message}
      </span>
    </div>
  );
}

function StateBadge({ connector }: { connector: AionConnector }) {
  const { t } = useTranslation();
  const state = connectorState(connector);
  if (state.kind === 'connected') {
    return (
      <span
        className="text-ds-text-status-success-strong-default flex items-center gap-1.5 text-body-xs"
        data-testid="aion-connector-state-connected"
      >
        <BadgeCheck className="h-4 w-4" />
        {t('connectors.aion-state-connected')}
      </span>
    );
  }
  if (state.kind === 'provisioned') {
    return (
      <span
        className="text-body-xs text-ds-text-neutral-muted-default"
        data-testid="aion-connector-state-provisioned"
      >
        {t('connectors.aion-state-provisioned')}
      </span>
    );
  }
  if (state.kind === 'unavailable') {
    return (
      <span
        className="text-ds-text-status-warning-strong-default text-body-xs"
        data-testid="aion-connector-state-unavailable"
      >
        {t('connectors.aion-state-unavailable')}
      </span>
    );
  }
  return (
    <span
      className="text-body-xs text-ds-text-neutral-muted-default"
      data-testid="aion-connector-state-disconnected"
    >
      {t('connectors.aion-state-disconnected')}
    </span>
  );
}

export default function AionConnectors() {
  const { t } = useTranslation();
  const host = useHost();
  const electronAPI = host?.electronAPI;
  const [searchQuery, setSearchQuery] = useState('');

  // The consent page is opened in the user's own browser, where their provider
  // session already lives and where nothing has to be read back out: the grant
  // lands on the edge callback, not in this window.
  const openExternal = useCallback(
    async (url: string) => {
      if (electronAPI?.openExternal) {
        const result = await electronAPI.openExternal(url);
        if (result && result.success === false) {
          throw new Error(result.error || t('connectors.aion-open-failed'));
        }
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    [electronAPI, t]
  );

  const {
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
  } = useAionConnectors(openExternal);

  const visible = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    if (!needle) return connectors;
    return connectors.filter(
      (connector) =>
        connector.displayName.toLowerCase().includes(needle) ||
        connector.connectorId.toLowerCase().includes(needle)
    );
  }, [connectors, searchQuery]);

  if (mode === null || loading) {
    return (
      <div className="w-full py-12 text-body-sm text-ds-text-neutral-muted-default">
        {t('layout.loading')}
      </div>
    );
  }
  if (mode.kind === 'unsupported') {
    return (
      <div className="w-full py-4">
        <Banner
          testId="aion-connectors-banner"
          message={t('connectors.aion-backend-too-old', {
            version: mode.edgeApiVersion,
          })}
        />
      </div>
    );
  }
  if (mode.kind === 'error') {
    return (
      <div className="w-full py-4">
        <Banner
          testId="aion-connectors-banner"
          message={t('connectors.aion-remote-error', { message: mode.message })}
        />
      </div>
    );
  }

  return (
    <div
      className="flex w-full min-w-0 flex-col gap-4 py-4"
      data-testid="aion-connectors"
    >
      <div className="flex items-center justify-between gap-3">
        <SearchInput
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={t('connectors.search-placeholder')}
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={reload}
          data-testid="aion-connectors-refresh"
        >
          <RefreshCw className="mr-1.5 h-4 w-4" />
          {t('connectors.aion-refresh')}
        </Button>
      </div>

      {error ? <Banner testId="aion-connectors-error" message={error} /> : null}
      {awaitTimedOut ? (
        <div
          className="rounded-2xl bg-ds-bg-neutral-default-default px-6 py-4 text-body-sm text-ds-text-neutral-default-default"
          role="status"
          data-testid="aion-connectors-await-timeout"
        >
          {t('connectors.aion-await-timeout')}
        </div>
      ) : null}

      {connectors.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center p-5 text-center"
          data-testid="aion-connectors-empty"
        >
          <Plug className="mb-4 h-12 w-12 text-ds-icon-neutral-muted-default" />
          <div className="text-sm text-ds-text-neutral-muted-default">
            {t('connectors.aion-empty')}
          </div>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-5 text-center">
          <div className="text-sm text-ds-text-neutral-muted-default">
            {t('connectors.no-matching')}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {visible.map((connector) => {
            const state = connectorState(connector);
            const busy = busyId === connector.connectorId;
            const awaiting = awaitingId === connector.connectorId;
            return (
              <div
                key={connector.connectorId}
                data-testid="aion-connector-row"
                data-connector-id={connector.connectorId}
                data-connected={connector.connected ? 'true' : 'false'}
                className="flex w-full items-center gap-4 rounded-xl bg-ds-bg-neutral-default-default px-4 py-3"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-body-sm text-ds-text-neutral-default-default">
                    {connector.displayName}
                  </span>
                  <span className="truncate text-body-xs text-ds-text-neutral-muted-default">
                    {connector.connectorId}
                  </span>
                </div>
                <StateBadge connector={connector} />
                <div className="flex w-[168px] shrink-0 justify-end">
                  {state.kind === 'connected' ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      data-testid="aion-connector-disconnect"
                      onClick={() => void disconnect(connector.connectorId)}
                    >
                      {busy ? (
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      ) : null}
                      {t('connectors.aion-disconnect')}
                    </Button>
                  ) : state.kind === 'disconnected' ? (
                    awaiting ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        data-testid="aion-connector-awaiting"
                        onClick={stopAwaiting}
                      >
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                        {t('connectors.aion-awaiting')}
                      </Button>
                    ) : (
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={busy}
                        data-testid="aion-connector-connect"
                        onClick={() => void connect(connector.connectorId)}
                      >
                        {busy ? (
                          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                        ) : (
                          <ExternalLink className="mr-1.5 h-4 w-4" />
                        )}
                        {t('connectors.aion-connect')}
                      </Button>
                    )
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
