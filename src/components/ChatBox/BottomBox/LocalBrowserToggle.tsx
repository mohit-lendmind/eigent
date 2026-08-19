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
 * Where the next run's browser actions execute: the sandbox pod (default) or
 * a visible window on this desktop. Same pill-trigger shell as `ModelSelect` /
 * `ApprovalModeSelect` so the `BoxFooter` controls read as one family.
 * Renders nothing until the support probe says this build AND the connected
 * edge can serve a delegated run — an affordance the backend cannot honor is
 * not offered. The choice binds per run at submit and is immutable for that
 * run; flipping it here changes the next command only.
 *
 * With the local browser on, the menu also carries the session choice: a
 * fresh isolated partition (default) or the user's logged-in sessions —
 * an explicit opt-in with the warning inline, because it lets the agent act
 * on sites where the user is signed in.
 */

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { probeLocalBrowserSupport } from '@/store/aionChatBridge';
import { useAionLocalBrowserStore } from '@/store/aionLocalBrowserStore';
import {
  Check,
  ChevronDown,
  Cloud,
  Monitor,
  TriangleAlert,
} from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

const triggerShellClass = cn(
  'rounded-xl px-2 py-1 inline-flex max-w-[min(100%,320px)] shrink-0 items-center gap-1.5',
  'bg-ds-bg-neutral-default-default text-ds-text-neutral-default-default'
);

export interface LocalBrowserToggleProps {
  /** Project whose next run the choice applies to. */
  projectId?: string | null;
  /**
   * Fallback scope for a composer whose Project does not exist yet (the
   * Space's direct chat — the Project is only minted at first send). The
   * choice parks on the Space and adoptSpaceChoice moves it onto the Project
   * created from it. Ignored whenever projectId is set.
   */
  spaceId?: string | null;
  disabled?: boolean;
  /** When true, hides the text label and shows only the icon (narrow footer). */
  compact?: boolean;
  className?: string;
}

export function LocalBrowserToggle({
  projectId,
  spaceId,
  disabled,
  compact = false,
  className,
}: LocalBrowserToggleProps) {
  const { t } = useTranslation();
  const supported = useAionLocalBrowserStore((s) => s.supported);
  const enabled = useAionLocalBrowserStore((s) => {
    if (projectId) return s.projectLocalBrowser[projectId] ?? false;
    if (spaceId) return s.spaceLocalBrowser[spaceId] ?? false;
    return false;
  });
  const sessionMode = useAionLocalBrowserStore((s) => {
    if (projectId) return s.projectSessionMode[projectId] ?? 'isolated';
    if (spaceId) return s.spaceSessionMode[spaceId] ?? 'isolated';
    return 'isolated';
  });
  const setLocalBrowser = useAionLocalBrowserStore((s) => s.setLocalBrowser);
  const setSessionMode = useAionLocalBrowserStore((s) => s.setSessionMode);
  const setSpaceLocalBrowser = useAionLocalBrowserStore(
    (s) => s.setSpaceLocalBrowser
  );
  const setSpaceSessionMode = useAionLocalBrowserStore(
    (s) => s.setSpaceSessionMode
  );

  useEffect(() => {
    void probeLocalBrowserSupport();
  }, []);

  if (supported !== true || (!projectId && !spaceId)) return null;

  const setEnabled = (value: boolean) =>
    projectId
      ? setLocalBrowser(projectId, value)
      : setSpaceLocalBrowser(spaceId!, value);
  const setMode = (mode: 'isolated' | 'logged_in') =>
    projectId
      ? setSessionMode(projectId, mode)
      : setSpaceSessionMode(spaceId!, mode);

  const options = [
    { value: false, label: t('chat.local-browser-cloud'), icon: Cloud },
    { value: true, label: t('chat.local-browser-local'), icon: Monitor },
  ] as const;
  const current = options.find((o) => o.value === enabled) ?? options[0];
  const CurrentIcon = current.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={current.label}
          aria-label={current.label}
          aria-haspopup="menu"
          className={cn(
            triggerShellClass,
            'min-w-0 cursor-pointer border-0 text-left',
            'justify-between font-semibold transition-colors',
            'hover:bg-ds-bg-neutral-subtle-default active:bg-ds-bg-neutral-subtle-default data-[state=open]:bg-ds-bg-neutral-subtle-default',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-border-neutral-strong-default focus-visible:ring-offset-2 focus-visible:ring-offset-ds-bg-neutral-default-default',
            'disabled:pointer-events-none disabled:opacity-50',
            className
          )}
        >
          <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            <CurrentIcon
              className="h-3.5 w-3.5 shrink-0 opacity-80"
              aria-hidden
            />
            {!compact && (
              <span className="min-w-0 flex-1 truncate text-left !text-label-xs text-ds-text-neutral-default-default">
                {current.label}
              </span>
            )}
          </span>
          <ChevronDown
            className="h-3.5 w-3.5 shrink-0 opacity-80"
            aria-hidden
            strokeWidth={2}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="top"
        sideOffset={4}
        collisionPadding={12}
        avoidCollisions
        className="w-[200px]"
      >
        {options.map((option) => {
          const OptionIcon = option.icon;
          return (
            <DropdownMenuItem
              key={String(option.value)}
              onSelect={() => setEnabled(option.value)}
              className="flex items-center justify-between gap-2"
            >
              <span className="flex items-center gap-2">
                <OptionIcon
                  className="h-4 w-4 shrink-0 opacity-80"
                  aria-hidden
                />
                <span className="text-body-sm">{option.label}</span>
              </span>
              {enabled === option.value && (
                <Check className="h-4 w-4 text-ds-text-success-default-default" />
              )}
            </DropdownMenuItem>
          );
        })}
        {enabled && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => setMode('isolated')}
              className="flex items-center justify-between gap-2"
            >
              <span className="text-body-sm">
                {t('chat.local-browser-session-fresh')}
              </span>
              {sessionMode !== 'logged_in' && (
                <Check className="h-4 w-4 text-ds-text-success-default-default" />
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setMode('logged_in')}
              className="flex items-start justify-between gap-2"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-center gap-1 text-body-sm">
                  <TriangleAlert
                    className="h-3.5 w-3.5 shrink-0 text-ds-text-warning-default-default"
                    aria-hidden
                  />
                  {t('chat.local-browser-session-logged-in')}
                </span>
                <span className="text-xs text-ds-text-warning-default-default">
                  {t('chat.local-browser-session-warning')}
                </span>
              </span>
              {sessionMode === 'logged_in' && (
                <Check className="h-4 w-4 shrink-0 text-ds-text-success-default-default" />
              )}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
