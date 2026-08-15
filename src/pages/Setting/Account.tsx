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

// Who this desktop is authenticated as, and the keys the tenant holds.
//
// Three facts drive what this screen offers, and none of them can be guessed
// from the credential in hand: whether this deployment serves key management at
// all, whether the key in force came from the environment (in which case the
// app cannot replace it and must not pretend otherwise), and which listed row
// is this client's own — the one whose revocation ends this session.

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertCircle, Copy, Loader2, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAionAccount } from './useAionAccount';

function Banner({ message, testId }: { message: string; testId: string }) {
  return (
    <div
      className="flex items-start gap-3 rounded-2xl bg-ds-bg-neutral-default-default px-6 py-4"
      role="alert"
      data-testid={testId}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-ds-icon-status-error-default-default" />
      <span className="text-body-sm text-ds-text-neutral-default-default">
        {message}
      </span>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-body-sm text-ds-text-neutral-muted-default">
        {label}
      </span>
      <span className="truncate text-body-sm text-ds-text-neutral-default-default">
        {value}
      </span>
    </div>
  );
}

export default function SettingAccount() {
  const { t } = useTranslation();
  const {
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
  } = useAionAccount();
  const [label, setLabel] = useState('');
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  const body = () => {
    if (mode === null || loading) {
      return (
        <div className="py-8 text-body-sm text-ds-text-neutral-muted-default">
          {t('layout.loading')}
        </div>
      );
    }
    if (mode.kind === 'local') {
      return (
        <Banner
          testId="aion-account-banner"
          message={t('setting.account-local')}
        />
      );
    }
    if (mode.kind === 'needs-key') {
      return (
        <Banner
          testId="aion-account-banner"
          message={t('setting.account-needs-key')}
        />
      );
    }
    if (mode.kind === 'unsupported') {
      return (
        <Banner
          testId="aion-account-banner"
          message={t('setting.account-backend-too-old', {
            version: mode.edgeApiVersion,
          })}
        />
      );
    }
    if (mode.kind === 'error') {
      return (
        <Banner
          testId="aion-account-banner"
          message={t('setting.account-remote-error', { message: mode.message })}
        />
      );
    }

    return (
      <div className="flex flex-col gap-6" data-testid="aion-account">
        {error ? (
          <Banner testId="aion-account-error" message={error} />
        ) : null}

        <div className="flex flex-col gap-3 rounded-2xl bg-ds-bg-neutral-default-default px-6 py-4">
          <div className="text-body-base font-bold text-ds-text-neutral-default-default">
            {t('setting.account-identity')}
          </div>
          <Field
            label={t('setting.account-tenant')}
            value={account?.tenantId ?? ''}
          />
          {/* Absent means a tenant-wide key that names nobody — a different
              fact from a user with no name, and the reason per-user resources
              are unavailable to it. */}
          <Field
            label={t('setting.account-user')}
            value={account?.userId ?? t('setting.account-user-none')}
          />
          <Field
            label={t('setting.account-key')}
            value={account?.keyId ?? ''}
          />
          {/* An empty scope array means unrestricted, not powerless. */}
          <Field
            label={t('setting.account-scopes')}
            value={
              account && account.scopes.length > 0
                ? account.scopes.join(', ')
                : t('setting.account-scopes-unrestricted')
            }
          />
          {account?.cellId ? (
            <Field label={t('setting.account-cell')} value={account.cellId} />
          ) : null}
        </div>

        {mode.keySource === 'env' ? (
          <div
            className="rounded-2xl bg-ds-bg-neutral-default-default px-6 py-4 text-body-sm text-ds-text-neutral-default-default"
            data-testid="aion-account-env-pinned"
          >
            {t('setting.account-env-pinned')}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4 rounded-2xl bg-ds-bg-neutral-default-default px-6 py-4">
            <span className="text-body-sm text-ds-text-neutral-default-default">
              {t('setting.account-sign-out-description')}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              data-testid="aion-account-sign-out"
              onClick={() => void signOut()}
            >
              {t('setting.account-sign-out')}
            </Button>
          </div>
        )}

        {account?.keyManagement === false ? (
          <div
            className="rounded-2xl bg-ds-bg-neutral-default-default px-6 py-4 text-body-sm text-ds-text-neutral-default-default"
            data-testid="aion-account-no-key-management"
          >
            {t('setting.account-no-key-management')}
          </div>
        ) : (
          <div className="flex flex-col gap-4 rounded-2xl bg-ds-bg-neutral-default-default px-6 py-4">
            <div className="text-body-base font-bold text-ds-text-neutral-default-default">
              {t('setting.account-keys')}
            </div>

            {minted ? (
              <div
                className="flex flex-col gap-2 rounded-xl bg-ds-bg-neutral-subtle-default px-4 py-3"
                role="status"
                data-testid="aion-account-minted"
              >
                {minted.rawKey ? (
                  <>
                    <span className="text-body-sm text-ds-text-neutral-default-default">
                      {t('setting.account-key-shown-once')}
                    </span>
                    <div className="flex items-center gap-2">
                      <code
                        className="min-w-0 flex-1 break-all text-body-xs text-ds-text-neutral-default-default"
                        data-testid="aion-account-minted-key"
                      >
                        {minted.rawKey}
                      </code>
                      <Button
                        variant="secondary"
                        size="sm"
                        data-testid="aion-account-copy-key"
                        onClick={() =>
                          void navigator.clipboard?.writeText(
                            minted.rawKey ?? ''
                          )
                        }
                      >
                        <Copy className="mr-1.5 h-4 w-4" />
                        {t('setting.account-copy')}
                      </Button>
                    </div>
                  </>
                ) : (
                  // A replay is a success with nothing to show: the secret was
                  // handed over once and is not recoverable.
                  <span
                    className="text-body-sm text-ds-text-neutral-default-default"
                    data-testid="aion-account-minted-replay"
                  >
                    {t('setting.account-key-replayed')}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={dismissMinted}
                  data-testid="aion-account-dismiss-key"
                >
                  {t('setting.account-dismiss')}
                </Button>
              </div>
            ) : null}

            <div className="flex items-end gap-2">
              <Input
                className="flex-1"
                value={label}
                size="sm"
                spellCheck={false}
                placeholder={t('setting.account-key-label-placeholder')}
                data-testid="aion-account-key-label"
                onChange={(event) => setLabel(event.target.value)}
              />
              <Button
                variant="primary"
                size="sm"
                disabled={busy}
                data-testid="aion-account-create-key"
                onClick={() =>
                  void createKey(label).then(() => setLabel(''))
                }
              >
                {busy ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : null}
                {t('setting.account-create-key')}
              </Button>
            </div>

            {keys.length === 0 ? (
              <div
                className="text-body-sm text-ds-text-neutral-muted-default"
                data-testid="aion-account-keys-empty"
              >
                {t('setting.account-keys-empty')}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {keys.map((key) => (
                  <div
                    key={key.keyId}
                    className="flex items-center gap-4 rounded-xl bg-ds-bg-neutral-subtle-default px-4 py-3"
                    data-testid="aion-account-key-row"
                    data-key-id={key.keyId}
                    data-current={key.current ? 'true' : 'false'}
                    data-status={key.status}
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-body-sm text-ds-text-neutral-default-default">
                        {key.label ?? key.keyId}
                      </span>
                      <span className="truncate text-body-xs text-ds-text-neutral-muted-default">
                        {/* Absent means never authenticated — which is what
                            makes a key safe to revoke, so it is said rather
                            than rendered as an epoch. */}
                        {key.lastUsedAt
                          ? t('setting.account-key-last-used', {
                              when: new Date(key.lastUsedAt).toLocaleString(),
                            })
                          : t('setting.account-key-never-used')}
                      </span>
                    </div>
                    {key.current ? (
                      <span
                        className="text-body-xs text-ds-text-neutral-muted-default"
                        data-testid="aion-account-key-current"
                      >
                        {t('setting.account-key-current')}
                      </span>
                    ) : null}
                    {key.status === 'revoked' ? (
                      <span className="text-body-xs text-ds-text-neutral-muted-default">
                        {t('setting.account-key-revoked')}
                      </span>
                    ) : confirmRevoke === key.keyId ? (
                      <div className="flex items-center gap-2">
                        <span className="text-body-xs text-ds-text-status-warning-strong-default">
                          {key.current
                            ? t('setting.account-revoke-current-warning')
                            : t('setting.account-revoke-warning')}
                        </span>
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={busy}
                          data-testid="aion-account-revoke-confirm"
                          onClick={() => {
                            setConfirmRevoke(null);
                            void revokeKey(key.keyId);
                          }}
                        >
                          {t('setting.account-revoke-confirm')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmRevoke(null)}
                        >
                          {t('setting.account-cancel')}
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        data-testid="aion-account-revoke"
                        onClick={() => setConfirmRevoke(key.keyId)}
                      >
                        {t('setting.account-revoke')}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="m-auto h-auto w-full flex-1">
      <div className="mx-auto flex w-full max-w-[900px] items-center justify-between px-6 pb-6 pt-8">
        <div className="text-heading-sm font-bold text-ds-text-neutral-default-default">
          {t('setting.account')}
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={reload}
          data-testid="aion-account-refresh"
        >
          <RefreshCw className="mr-1.5 h-4 w-4" />
          {t('setting.account-refresh')}
        </Button>
      </div>
      <div className="mx-auto mb-8 w-full max-w-[900px] px-6">{body()}</div>
    </div>
  );
}
