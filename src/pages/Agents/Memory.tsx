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

// What the agent remembers between sessions, as aion stores it. The listing is
// a table of contents — no document text — so opening the screen costs one
// listing and one quota read, not the whole scope.
//
// Two facts this screen must never blur. A row without `content` has text that
// was not returned here, not an empty document (an empty one cannot be
// stored). And a cap of zero means that dimension is uncapped, so it renders as
// "no limit" rather than a full meter, which would read as no room left.

import ConfirmModal from '@/components/ui/alertDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { formatBytes, formatRelativeTime } from '@/lib/utils';
import type { AionMemoryDoc, AionMemoryUsage } from '@/store/aionMemoryStore';
import { AlertCircle, Brain, Loader2, Plus, RefreshCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAionMemory } from './useAionMemory';

function percentOf(used: number, cap: number): number {
  if (cap <= 0) return 0;
  return Math.min(100, Math.round((used / cap) * 100));
}

function Banner({ message, testId }: { message: string; testId: string }) {
  return (
    <div
      className="flex items-center gap-4 rounded-2xl bg-ds-bg-neutral-default-default px-6 py-6"
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

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-12 flex flex-col gap-6">
      <div className="flex w-full flex-col items-center justify-between rounded-2xl bg-ds-bg-neutral-default-default px-6 py-4">
        <div className="flex h-16 w-16 items-center justify-center">
          <Brain className="h-8 w-8 text-ds-icon-neutral-muted-default" />
        </div>
        {children}
      </div>
    </div>
  );
}

function Usage({ usage }: { usage: AionMemoryUsage }) {
  const { t } = useTranslation();
  const docsCapped = usage.capDocsPerScope > 0;
  const bytesCapped = usage.capScopeBytes > 0;
  return (
    <div
      className="flex flex-col gap-3 rounded-2xl bg-ds-bg-neutral-default-default px-6 py-4"
      data-testid="aion-memory-usage"
      data-doc-count={usage.docCount}
      data-total-bytes={usage.totalBytes}
      data-cap-docs={usage.capDocsPerScope}
      data-cap-scope-bytes={usage.capScopeBytes}
      data-cap-doc-bytes={usage.capDocBytes}
    >
      <div className="flex flex-col gap-1">
        <span
          className="text-body-xs text-ds-text-neutral-muted-default"
          data-testid="aion-memory-usage-documents"
        >
          {docsCapped
            ? t('agents.memory-usage-documents', {
                count: usage.docCount,
                cap: usage.capDocsPerScope,
              })
            : t('agents.memory-usage-documents-uncapped', {
                count: usage.docCount,
              })}
        </span>
        {docsCapped ? (
          <Progress
            value={percentOf(usage.docCount, usage.capDocsPerScope)}
          />
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <span
          className="text-body-xs text-ds-text-neutral-muted-default"
          data-testid="aion-memory-usage-stored"
        >
          {bytesCapped
            ? t('agents.memory-usage-stored', {
                used: formatBytes(usage.totalBytes),
                cap: formatBytes(usage.capScopeBytes),
              })
            : t('agents.memory-usage-stored-uncapped', {
                used: formatBytes(usage.totalBytes),
              })}
        </span>
        {bytesCapped ? (
          <Progress
            value={percentOf(usage.totalBytes, usage.capScopeBytes)}
          />
        ) : null}
      </div>
      <span className="text-body-xs text-ds-text-neutral-muted-default">
        {usage.capDocBytes > 0
          ? t('agents.memory-usage-doc-cap', {
              cap: formatBytes(usage.capDocBytes),
            })
          : t('agents.memory-usage-doc-cap-uncapped')}
      </span>
    </div>
  );
}

function Stamp({ doc }: { doc: AionMemoryDoc }) {
  const { t } = useTranslation();
  // A document that has never been rewritten carries no `updated_at` at all,
  // rather than a copy of `created_at` — so say which of the two this is.
  const when = doc.updatedAt
    ? t('agents.memory-updated', { when: formatRelativeTime(doc.updatedAt) })
    : doc.createdAt
      ? t('agents.memory-created', { when: formatRelativeTime(doc.createdAt) })
      : t('agents.memory-never-rewritten');
  return (
    <span className="text-body-xs text-ds-text-neutral-muted-default">
      {when}
    </span>
  );
}

export default function Memory() {
  const { t } = useTranslation();
  const {
    mode,
    scope,
    scopes,
    docs,
    usage,
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
  } = useAionMemory();

  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<{ key: string; content: string } | null>(
    null
  );
  const [edited, setEdited] = useState('');
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [confirmScope, setConfirmScope] = useState(false);

  useEffect(() => {
    setEdited(opened?.content ?? '');
  }, [opened]);

  const header = (
    <div className="flex w-full items-center justify-between px-6 pb-6 pt-8">
      <div className="flex flex-col gap-1">
        <div className="text-heading-sm font-bold text-ds-text-neutral-default-default">
          {t('agents.memory')}
        </div>
        <div className="text-body-sm text-ds-text-neutral-muted-default">
          {t('agents.memory-description')}
        </div>
      </div>
      {mode?.kind === 'remote' ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={reload}
          data-testid="aion-memory-refresh"
        >
          <RefreshCw className="mr-1.5 h-4 w-4" />
          {t('agents.memory-refresh')}
        </Button>
      ) : null}
    </div>
  );

  const frame = (body: React.ReactNode) => (
    <div
      className="m-auto flex h-auto w-full flex-1 flex-col"
      data-testid="aion-memory"
      data-mode={mode?.kind ?? 'pending'}
    >
      {header}
      <div className="flex flex-col gap-4 px-6 pb-12">{body}</div>
    </div>
  );

  if (mode === null || (loading && !usage)) {
    return frame(
      <div className="py-6 text-body-sm text-ds-text-neutral-muted-default">
        {t('layout.loading')}
      </div>
    );
  }

  // Memory is served by the aion backend. On the legacy plane there is nothing
  // storing it, so this stays the placeholder it has always been rather than an
  // empty list implying the agent remembers nothing.
  if (mode.kind === 'local') {
    return frame(
      <Placeholder>
        <h2 className="mb-2 text-body-md font-bold text-ds-text-neutral-default-default">
          {t('layout.coming-soon')}
        </h2>
        <p className="max-w-md text-center text-body-sm text-ds-text-neutral-muted-default">
          {t('agents.memory-coming-soon-description')}
        </p>
      </Placeholder>
    );
  }
  if (mode.kind === 'unsupported') {
    return frame(
      <Banner
        testId="aion-memory-banner"
        message={t('agents.memory-backend-too-old', {
          version: mode.edgeApiVersion,
        })}
      />
    );
  }
  if (mode.kind === 'error') {
    return frame(
      <Banner
        testId="aion-memory-banner"
        message={t('agents.memory-remote-error', { message: mode.message })}
      />
    );
  }

  const runSearch = () => void search(query);

  const list = hits ?? docs;

  return frame(
    <>
      {scopes.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body-xs text-ds-text-neutral-muted-default">
            {t('agents.memory-scope-label')}
          </span>
          {scopes.map((name) => (
            <Button
              key={name}
              size="sm"
              variant={name === scope ? 'primary' : 'secondary'}
              disabled={busy}
              data-testid="aion-memory-scope"
              data-scope={name}
              data-active={name === scope ? 'true' : 'false'}
              onClick={() => selectScope(name)}
            >
              {name}
            </Button>
          ))}
        </div>
      ) : scope ? (
        <span
          className="text-body-xs text-ds-text-neutral-muted-default"
          data-testid="aion-memory-scope"
          data-scope={scope}
          data-active="true"
        >
          {t('agents.memory-scope-label')} {scope}
        </span>
      ) : null}

      {usage ? <Usage usage={usage} /> : null}

      <div className="flex items-center gap-2">
        <Input
          value={query}
          placeholder={t('agents.memory-search-placeholder')}
          data-testid="aion-memory-search"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') runSearch();
          }}
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={searching || !query.trim()}
          data-testid="aion-memory-search-run"
          onClick={runSearch}
        >
          {searching ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : null}
          {t('agents.memory-search')}
        </Button>
        {hits ? (
          <Button
            variant="ghost"
            size="sm"
            data-testid="aion-memory-search-clear"
            onClick={() => {
              setQuery('');
              clearSearch();
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
        <Button
          variant="primary"
          size="sm"
          disabled={busy}
          data-testid="aion-memory-new"
          onClick={() => {
            close();
            setDraft({ key: '', content: '' });
          }}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          {t('agents.memory-new')}
        </Button>
      </div>

      {error ? <Banner testId="aion-memory-error" message={error} /> : null}
      {cleared !== null ? (
        <div
          className="rounded-2xl bg-ds-bg-neutral-default-default px-6 py-4 text-body-sm text-ds-text-neutral-default-default"
          role="status"
          data-testid="aion-memory-cleared"
          data-deleted={cleared}
        >
          {t('agents.memory-cleared', { count: cleared })}
        </div>
      ) : null}

      <div className="flex w-full min-w-0 items-start gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {hits ? (
            <span className="pb-1 text-body-xs text-ds-text-neutral-muted-default">
              {t('agents.memory-results', { count: hits.length })}
            </span>
          ) : null}

          {list.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center p-8 text-center"
              data-testid={hits ? 'aion-memory-no-matches' : 'aion-memory-empty'}
            >
              <div className="text-body-sm text-ds-text-neutral-muted-default">
                {hits ? t('agents.memory-no-matches') : t('agents.memory-empty')}
              </div>
            </div>
          ) : hits ? (
            hits.map((hit) => (
              <button
                key={hit.doc.key}
                type="button"
                data-testid="aion-memory-hit"
                data-key={hit.doc.key}
                data-score={hit.score}
                className="flex w-full flex-col items-start gap-1 rounded-xl bg-ds-bg-neutral-default-default px-4 py-3 text-left"
                onClick={() => void open(hit.doc.key)}
              >
                <div className="flex w-full items-center justify-between gap-3">
                  <span className="truncate text-body-sm text-ds-text-neutral-default-default">
                    {hit.doc.key}
                  </span>
                  <span className="shrink-0 text-body-xs text-ds-text-neutral-muted-default">
                    {t('agents.memory-score', { score: hit.score.toFixed(2) })}
                  </span>
                </div>
                {/* A hit carries its text, so the excerpt is the document's own
                    content and never a placeholder. */}
                <span className="line-clamp-2 text-body-xs text-ds-text-neutral-muted-default">
                  {hit.doc.content}
                </span>
              </button>
            ))
          ) : (
            docs.map((doc) => (
              <div
                key={doc.key}
                data-testid="aion-memory-row"
                data-key={doc.key}
                data-bytes={doc.bytes}
                className="flex w-full items-center gap-4 rounded-xl bg-ds-bg-neutral-default-default px-4 py-3"
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
                  data-testid="aion-memory-open"
                  disabled={pendingKey === doc.key}
                  onClick={() => void open(doc.key)}
                >
                  <span className="truncate text-body-sm text-ds-text-neutral-default-default">
                    {doc.key}
                  </span>
                  <Stamp doc={doc} />
                </button>
                <span className="shrink-0 text-body-xs text-ds-text-neutral-muted-default">
                  {formatBytes(doc.bytes)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pendingKey === doc.key || busy}
                  data-testid="aion-memory-forget"
                  onClick={() => setConfirmKey(doc.key)}
                >
                  {pendingKey === doc.key ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : null}
                  {t('agents.memory-forget')}
                </Button>
              </div>
            ))
          )}

          {docs.length > 0 ? (
            <div className="pt-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                data-testid="aion-memory-forget-all"
                onClick={() => setConfirmScope(true)}
              >
                {t('agents.memory-forget-all')}
              </Button>
            </div>
          ) : null}
        </div>

        <div className="flex w-[360px] shrink-0 flex-col gap-3 rounded-2xl bg-ds-bg-neutral-default-default px-4 py-4">
          {draft ? (
            <>
              <label
                className="text-body-xs text-ds-text-neutral-muted-default"
                htmlFor="aion-memory-key"
              >
                {t('agents.memory-key-label')}
              </label>
              <Input
                id="aion-memory-key"
                value={draft.key}
                placeholder={t('agents.memory-key-placeholder')}
                data-testid="aion-memory-key-input"
                onChange={(event) =>
                  setDraft({ ...draft, key: event.target.value })
                }
              />
              <label
                className="text-body-xs text-ds-text-neutral-muted-default"
                htmlFor="aion-memory-content"
              >
                {t('agents.memory-content-label')}
              </label>
              <Textarea
                id="aion-memory-content"
                rows={8}
                value={draft.content}
                placeholder={t('agents.memory-content-placeholder')}
                data-testid="aion-memory-content-input"
                onChange={(event) =>
                  setDraft({ ...draft, content: event.target.value })
                }
              />
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  // An empty document cannot be stored, so an empty composer has
                  // nothing to send — the server would refuse it.
                  disabled={busy || !draft.key.trim() || !draft.content.trim()}
                  data-testid="aion-memory-save"
                  onClick={() => {
                    void write(draft.key.trim(), draft.content).then(
                      (stored) => {
                        if (stored) setDraft(null);
                      }
                    );
                  }}
                >
                  {busy ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : null}
                  {t('agents.memory-save')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="aion-memory-cancel"
                  onClick={() => setDraft(null)}
                >
                  {t('layout.cancel')}
                </Button>
              </div>
            </>
          ) : opened ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <span
                  className="truncate text-body-sm font-bold text-ds-text-neutral-default-default"
                  data-testid="aion-memory-reader"
                  data-key={opened.key}
                >
                  {opened.key}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="aion-memory-close"
                  onClick={close}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <Stamp doc={opened} />
              {opened.updatedBySession ? (
                <span className="truncate text-body-xs text-ds-text-neutral-muted-default">
                  {t('agents.memory-written-by', {
                    session: opened.updatedBySession,
                  })}
                </span>
              ) : null}
              <Textarea
                rows={12}
                value={edited}
                data-testid="aion-memory-reader-content"
                onChange={(event) => setEdited(event.target.value)}
              />
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={
                    busy || !edited.trim() || edited === opened.content
                  }
                  data-testid="aion-memory-save"
                  onClick={() => void write(opened.key, edited)}
                >
                  {busy ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : null}
                  {t('agents.memory-save')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  data-testid="aion-memory-forget"
                  onClick={() => setConfirmKey(opened.key)}
                >
                  {t('agents.memory-forget')}
                </Button>
              </div>
            </>
          ) : (
            <span
              className="text-body-xs text-ds-text-neutral-muted-default"
              data-testid="aion-memory-select-hint"
            >
              {t('agents.memory-select-hint')}
            </span>
          )}
        </div>
      </div>

      <ConfirmModal
        isOpen={confirmKey !== null}
        onClose={() => setConfirmKey(null)}
        onConfirm={() => {
          const key = confirmKey;
          setConfirmKey(null);
          if (key) void forget(key);
        }}
        title={t('agents.memory-forget-title')}
        message={t('agents.memory-forget-confirmation', {
          key: confirmKey ?? '',
        })}
        confirmText={t('agents.memory-forget')}
        cancelText={t('layout.cancel')}
        confirmVariant="caution"
      />
      <ConfirmModal
        isOpen={confirmScope}
        onClose={() => setConfirmScope(false)}
        onConfirm={() => {
          setConfirmScope(false);
          void forgetScope();
        }}
        title={t('agents.memory-forget-all-title')}
        message={t('agents.memory-forget-all-confirmation', {
          scope: scope ?? '',
        })}
        confirmText={t('agents.memory-forget')}
        cancelText={t('layout.cancel')}
        confirmVariant="caution"
      />
    </>
  );
}
