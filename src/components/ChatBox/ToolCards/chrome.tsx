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

// Shared chrome for the typed tool cards: one shell, one status vocabulary,
// one copy affordance — so bash/code/browser/generic cards read as a family
// on both surfaces (chat timeline and work-log fold).

import { Check, Copy, Loader2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export type ToolCardStatus = 'running' | 'done' | 'error';

export function ToolStatusIcon({ status }: { status: ToolCardStatus }) {
  if (status === 'running') {
    return (
      <Loader2
        size={14}
        aria-hidden
        className="shrink-0 animate-spin text-ds-icon-neutral-subtle-default"
      />
    );
  }
  if (status === 'error') {
    return (
      <X
        size={14}
        aria-hidden
        className="shrink-0 text-ds-icon-status-error-default-default"
      />
    );
  }
  return (
    <Check
      size={14}
      aria-hidden
      className="shrink-0 text-ds-icon-neutral-subtle-default"
    />
  );
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <button
      type="button"
      aria-label={label}
      className="shrink-0 rounded-md p-1 text-ds-icon-neutral-subtle-default transition-colors hover:bg-ds-bg-neutral-muted-hover hover:text-ds-icon-neutral-default-default"
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
    </button>
  );
}

export function CardShell({
  header,
  children,
  className,
}: {
  header: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex w-full min-w-0 flex-col overflow-hidden rounded-lg border border-ds-border-neutral-default bg-ds-bg-neutral-default-default',
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-2 px-3 py-2">{header}</div>
      {children}
    </div>
  );
}

/** Preformatted output body shared by bash + generic cards. */
export function OutputBlock({
  text,
  error,
  testId,
}: {
  text: string;
  error?: boolean;
  testId?: string;
}) {
  return (
    <pre
      data-testid={testId}
      className={cn(
        'max-h-48 w-full min-w-0 overflow-auto whitespace-pre-wrap break-words border-t border-ds-border-neutral-default bg-ds-bg-neutral-muted-default px-3 py-2 font-mono !text-label-xs',
        error
          ? 'text-ds-text-status-error-default-default'
          : 'text-ds-text-neutral-muted-default'
      )}
    >
      {text}
    </pre>
  );
}

/** Uppercase section label used inside verbose (work-log) card bodies. */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 !text-label-xs font-medium uppercase tracking-wide text-ds-text-neutral-subtle-default">
      {children}
    </div>
  );
}

export function useCardLabels() {
  const { t } = useTranslation();
  return {
    copy: t('chat.tool-card-copy', { defaultValue: 'Copy' }),
    request: t('chat.tool-card-request', { defaultValue: 'Request' }),
    response: t('chat.tool-card-response', { defaultValue: 'Response' }),
  };
}
