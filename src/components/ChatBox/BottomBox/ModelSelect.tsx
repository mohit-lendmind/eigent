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
 * Model picker for the chat input bar. It offers the edge's alias catalog and
 * nothing else: provider credentials belong to the operator, so there is no
 * "configure this one first" rung here and no way for a selection to name a
 * model the backend cannot serve. A selection made with a Project open pins
 * that Project; made without one it moves the global default.
 */

import type { ModelAliasCatalog } from '@/api/aion/v1/transport';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { getAionModelCatalog, resolveModelAlias } from '@/store/aionChatBridge';
import { useAionModelStore } from '@/store/aionModelStore';

import { Check, ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface ModelSelectProps {
  disabled?: boolean;
  /**
   * Project whose pinned model this dropdown reads and writes. When set,
   * selections update only that Project's captured model; the global
   * default model is left untouched.
   */
  projectId?: string | null;
  /**
   * When true, shows the current default model in the same shell as
   * `ProjectModeToggle` (readOnly) — no chevron, not interactive,
   * no filled background (session input bar).
   * Used for session chat input where the model is fixed for the session.
   */
  readOnly?: boolean;
}

const modelTriggerShellClass = cn(
  'rounded-xl px-2 py-1 inline-flex max-w-[min(100%,320px)] shrink-0 items-center gap-1.5',
  'bg-ds-bg-neutral-default-default text-ds-text-neutral-default-default'
);

export function ModelSelect({
  disabled,
  projectId,
  readOnly = false,
}: ModelSelectProps) {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState<ModelAliasCatalog | null>(null);
  const [catalogState, setCatalogState] = useState<
    'loading' | 'ready' | 'error'
  >('loading');
  const selectedAlias = useAionModelStore((s) => s.selectedAlias);
  const pinnedAlias = useAionModelStore((s) =>
    projectId ? (s.projectAlias[projectId] ?? null) : null
  );
  const setSelectedAlias = useAionModelStore((s) => s.setSelectedAlias);
  const setProjectAlias = useAionModelStore((s) => s.setProjectAlias);
  const [open, setOpen] = useState(false);

  const loadCatalog = useCallback(() => {
    setCatalogState((prev) => (prev === 'ready' ? prev : 'loading'));
    getAionModelCatalog()
      .then((next) => {
        if (!next) {
          // No usable transport: tasks fail visibly, and so does the picker.
          setCatalogState('error');
          return;
        }
        setCatalog(next);
        setCatalogState('ready');
      })
      .catch(() => setCatalogState('error'));
  }, []);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  // selectedAlias / pinnedAlias subscriptions re-render this memo; the
  // resolver itself reads the same store state.
  const effectiveAlias = useMemo(() => {
    if (!catalog) return pinnedAlias ?? selectedAlias;
    return resolveModelAlias(catalog, projectId ?? undefined);
  }, [catalog, pinnedAlias, selectedAlias, projectId]);

  const label = useMemo(() => {
    if (!effectiveAlias) return t('setting.select-default-model');
    const option = catalog?.aliases?.find((a) => a.alias === effectiveAlias);
    return option?.display_name || effectiveAlias;
  }, [catalog, effectiveAlias, t]);

  if (readOnly) {
    return (
      <div
        role="status"
        title={label}
        aria-label={label}
        className={cn(
          modelTriggerShellClass,
          'pointer-events-none bg-transparent',
          { 'opacity-50': disabled }
        )}
      >
        <span className="inline-flex min-h-[1.25rem] min-w-0 items-center gap-1.5 overflow-hidden">
          <span className="min-w-0 truncate !text-label-xs font-semibold">
            {label}
          </span>
        </span>
      </div>
    );
  }

  return (
    <DropdownMenu
      onOpenChange={(next) => {
        setOpen(next);
        if (next && catalogState === 'error') loadCatalog();
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          data-testid="aion-model-select"
          title={label}
          aria-label={label}
          aria-haspopup="menu"
          className={cn(
            modelTriggerShellClass,
            'min-w-0 cursor-pointer border-0 text-left',
            'duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] justify-between font-semibold transition-[background-color,box-shadow,opacity]',
            'hover:bg-ds-bg-neutral-subtle-default active:bg-ds-bg-neutral-subtle-default data-[state=open]:bg-ds-bg-neutral-subtle-default',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-border-neutral-strong-default focus-visible:ring-offset-2 focus-visible:ring-offset-ds-bg-neutral-default-default',
            'disabled:pointer-events-none disabled:opacity-50',
            open && 'min-w-[220px]'
          )}
        >
          <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            <span className="min-w-0 flex-1 truncate text-center !text-label-xs text-ds-text-neutral-default-default">
              {label}
            </span>
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
        className="w-[280px]"
      >
        {catalogState !== 'ready' ? (
          <DropdownMenuItem disabled className="text-body-sm">
            {catalogState === 'loading'
              ? t('setting.aion-models-loading')
              : t('setting.aion-models-error')}
          </DropdownMenuItem>
        ) : (
          // Internal aliases (diagnostic/CI fixtures) are API-selectable
          // but never offered here.
          (catalog?.aliases ?? [])
            .filter((option) => !option.internal)
            .map((option) => (
              <DropdownMenuItem
                key={option.alias}
                onSelect={() => {
                  if (projectId) {
                    setProjectAlias(projectId, option.alias);
                  } else {
                    setSelectedAlias(option.alias);
                  }
                }}
                className="flex items-start justify-between gap-2"
              >
                <div className="min-w-0 flex-1">
                  <span className="text-body-sm">
                    {option.display_name || option.alias}
                    {option.is_default && (
                      <span className="ml-1 text-xs text-ds-text-neutral-subtle-default">
                        {t('setting.aion-model-default')}
                      </span>
                    )}
                  </span>
                  {option.description && (
                    <div className="text-xs text-ds-text-neutral-subtle-default">
                      {option.description}
                    </div>
                  )}
                </div>
                {option.alias === effectiveAlias && (
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-ds-text-success-default-default" />
                )}
              </DropdownMenuItem>
            ))
        )}
        <div className="px-2 pb-1 pt-1.5 text-xs text-ds-text-neutral-subtle-default">
          {t('setting.aion-model-hint')}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
