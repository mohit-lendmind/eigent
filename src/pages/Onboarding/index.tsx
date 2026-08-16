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

// The first screen on a profile that is not connected yet. Usually that means
// an endpoint with no credential, and the screen asks for a key. It is also
// where a profile with no endpoint at all, or one the main process could not
// resolve, lands — so it names those instead of asking for a key that cannot
// reach anything.
//
// It checks the key before keeping it: a key is verified against the account
// route and only then handed to the main process to store. Storing first would leave a mistyped key on disk with
// every screen failing 401 and no way back that does not need the key.
//
// The key is typed here and never held here — no renderer storage, no state
// that outlives the submit.

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  getAionBackendState,
  type AionBackendState,
} from '@/store/aionChatBridge';
import { verifyAndStoreAionApiKey } from '@/store/aionAccountStore';
import { AlertCircle, KeyRound, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

export default function Onboarding() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [state, setState] = useState<AionBackendState | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getAionBackendState()
      .then((resolved) => {
        if (!active) return;
        setState(resolved);
        // A profile that already holds a key has nothing to onboard; this can
        // happen when a second window opens after the first one connected.
        if (resolved.kind === 'ready') navigate('/', { replace: true });
      })
      .catch((cause) => {
        if (active) setError(messageOf(cause));
      });
    return () => {
      active = false;
    };
  }, [navigate]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await verifyAndStoreAionApiKey(apiKey);
      setApiKey('');
      navigate('/', { replace: true });
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const edgeBaseUrl =
    state && (state.kind === 'needs-key' || state.kind === 'ready')
      ? state.edgeBaseUrl
      : '';

  // No endpoint, or one that failed to resolve: a key is not the missing
  // piece, so offering the field would send the user round a loop they
  // cannot finish.
  if (state && (state.kind === 'local' || state.kind === 'error')) {
    return (
      <div
        className="flex h-screen w-full items-center justify-center px-6"
        data-testid="aion-onboarding"
      >
        <div className="flex w-full max-w-[480px] flex-col gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-ds-icon-status-error-default-default" />
            <h1 className="text-heading-h4 text-ds-text-neutral-default-default">
              {t('onboarding.unreachable-title')}
            </h1>
          </div>
          <p
            className="text-body-sm text-ds-text-neutral-muted-default"
            data-testid="aion-onboarding-unreachable"
          >
            {state.kind === 'local'
              ? t('onboarding.no-endpoint')
              : t('onboarding.resolve-failed', { message: state.message })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-screen w-full items-center justify-center px-6"
      data-testid="aion-onboarding"
    >
      <div className="flex w-full max-w-[480px] flex-col gap-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-ds-icon-neutral-default-default" />
            <h1 className="text-heading-h4 text-ds-text-neutral-default-default">
              {t('onboarding.title')}
            </h1>
          </div>
          <p className="text-body-sm text-ds-text-neutral-muted-default">
            {t('onboarding.subtitle')}
          </p>
          {edgeBaseUrl ? (
            <p
              className="break-all text-body-xs text-ds-text-neutral-muted-default"
              data-testid="aion-onboarding-endpoint"
            >
              {edgeBaseUrl}
            </p>
          ) : null}
        </div>

        <Input
          type="password"
          value={apiKey}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          title={t('onboarding.key-label')}
          placeholder={t('onboarding.key-placeholder')}
          state={error ? 'error' : 'default'}
          data-testid="aion-onboarding-key"
          onChange={(event) => setApiKey(event.target.value)}
          onEnter={() => {
            if (!busy && apiKey.trim() !== '') void submit();
          }}
        />

        {error ? (
          <div
            className="flex items-start gap-3 rounded-2xl bg-ds-bg-neutral-default-default px-4 py-3"
            role="alert"
            data-testid="aion-onboarding-error"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-ds-icon-status-error-default-default" />
            <span className="text-body-sm text-ds-text-neutral-default-default">
              {error}
            </span>
          </div>
        ) : null}

        <Button
          variant="primary"
          size="md"
          disabled={busy || apiKey.trim() === ''}
          data-testid="aion-onboarding-submit"
          onClick={() => void submit()}
        >
          {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
          {t('onboarding.connect')}
        </Button>

        <p className="text-body-xs text-ds-text-neutral-muted-default">
          {t('onboarding.storage-note')}
        </p>
      </div>
    </div>
  );
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
