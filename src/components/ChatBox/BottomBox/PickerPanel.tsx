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

import { Button } from '@/components/ui/button';
import {
  normalizeSkillScopeAgentId,
  SINGLE_AGENT_ID,
} from '@/components/WorkFlow/agents';
import { integrationLeadingIconUrl } from '@/lib/connectorIcons';
import {
  RICH_CONNECTOR_STYLE_CLASSES,
  RICH_SKILL_STYLE_CLASSES,
  connectorNameToToken,
  hashSkillLabel,
} from '@/lib/richText';
import { skillNameToDirName } from '@/lib/skillToolkit';
import { cn } from '@/lib/utils';
import {
  connectorState,
  loadAionConnectors,
  type AionConnector,
} from '@/store/aionConnectorsStore';
import { useSkillsStore } from '@/store/skillsStore';
import { Check, Plus, Wrench } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

/**
 * An item shown in a picker panel. `token` is the exact string inserted inline
 * into the rich chat input when the item is selected (`#skill` / `@connector`).
 */
export interface PickerItem {
  id: string;
  name: string;
  token: string;
  /** One-line description shown under the name (e.g. remote skills). */
  description?: string;
}

interface PickerPanelProps {
  title: string;
  items: PickerItem[];
  /** Current input text — an item is "added" when its token appears in it. */
  inputValue: string;
  onToggleItem: (item: PickerItem) => void;
  /** Leading token tag for a row (`#skill` / `@connector`). */
  renderTag: (item: PickerItem) => ReactNode;
  /** Leading logo/icon for a row, shown before the item name. Omit for no logo. */
  renderLogo?: (item: PickerItem) => ReactNode;
  loading?: boolean;
  emptyLabel: string;
  emptyActionLabel: string;
  onEmptyAction: () => void;
}

/**
 * Floating list panel shown above BoxMain in the BottomBox shell. Selecting an
 * item inserts its token inline into the input; selecting an added item removes
 * it. Purely presentational — the trigger and open state live in BottomBox.
 */
export function PickerPanel({
  title,
  items,
  inputValue,
  onToggleItem,
  renderTag,
  renderLogo,
  loading = false,
  emptyLabel,
  emptyActionLabel,
  onEmptyAction,
}: PickerPanelProps) {
  return (
    <div className="flex w-full flex-col overflow-hidden rounded-2xl border border-solid border-ds-border-neutral-default-default bg-ds-bg-neutral-subtle-default">
      {/* Header */}
      <div className="flex items-center gap-1 px-3 pb-1 pt-2">
        <span className="text-xs font-bold text-ds-text-neutral-muted-default">
          {title}
        </span>
        {items.length > 0 && (
          <span className="text-xs font-bold text-ds-text-neutral-muted-default">
            {items.length}
          </span>
        )}
      </div>

      {/* List: max-h-[240px] caps the panel's scrollable area */}
      <div className="scrollbar-always-visible flex max-h-[240px] flex-col gap-0.5 overflow-y-auto p-1">
        {loading ? (
          <>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-8 w-full animate-pulse rounded-lg bg-ds-bg-neutral-strong-default"
              />
            ))}
          </>
        ) : items.length === 0 ? (
          <div className="flex w-full items-center justify-between gap-2 px-2 py-2">
            <span className="text-xs font-normal text-ds-text-neutral-muted-default">
              {emptyLabel}
            </span>
            <Button
              variant="ghost"
              size="xs"
              buttonContent="text"
              onClick={onEmptyAction}
            >
              {emptyActionLabel}
            </Button>
          </div>
        ) : (
          items.map((item) => (
            <PickerPanelItem
              key={item.id}
              item={item}
              tag={renderTag(item)}
              logo={renderLogo?.(item)}
              added={inputValue.includes(item.token)}
              onToggle={() => onToggleItem(item)}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface PickerPanelItemProps {
  item: PickerItem;
  tag: ReactNode;
  logo?: ReactNode;
  added: boolean;
  onToggle: () => void;
}

function PickerPanelItem({
  item,
  tag,
  logo,
  added,
  onToggle,
}: PickerPanelItemProps) {
  return (
    <button
      type="button"
      aria-pressed={added}
      className="group flex w-full items-center gap-2 rounded-xl border-0 bg-ds-bg-neutral-subtle-default px-2 py-1.5 text-left transition-colors hover:bg-ds-bg-neutral-default-default"
      onClick={onToggle}
      data-testid={`picker-item-${item.id}`}
    >
      {logo && (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center">
          {logo}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="overflow-hidden overflow-ellipsis whitespace-nowrap text-sm font-medium text-ds-text-neutral-default-default">
          {item.name}
        </span>
        {item.description && (
          <span className="overflow-hidden overflow-ellipsis whitespace-nowrap text-xs font-normal text-ds-text-neutral-muted-default">
            {item.description}
          </span>
        )}
      </span>
      <span className="max-w-[45%] shrink-0 overflow-hidden whitespace-nowrap">
        {tag}
      </span>
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        {added ? (
          <Check size={16} className="text-ds-icon-success-default-default" />
        ) : (
          <Plus
            size={16}
            className="text-ds-icon-neutral-muted-default opacity-0 transition-opacity group-hover:opacity-100"
          />
        )}
      </span>
    </button>
  );
}

interface WiredPickerPanelProps {
  inputValue: string;
  onToggleItem: (item: PickerItem) => void;
}

/**
 * The connectors this run could actually reach, read from the edge catalog.
 * Two of the four row states belong here and two do not: a connector this user
 * has not granted, or one the server has no vault to hold a grant in, has no
 * tools behind it — naming it in a message would promise the run something it
 * cannot deliver, and the Connections screen is where that gets fixed.
 */
export function ConnectorPickerPanel({
  inputValue,
  onToggleItem,
}: WiredPickerPanelProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [connectors, setConnectors] = useState<AionConnector[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    loadAionConnectors()
      .then((catalog) => {
        if (!cancelled) setConnectors(catalog);
      })
      .catch(() => {
        // The Connections screen reports why; the composer just offers nothing.
        if (!cancelled) setConnectors([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const items = useMemo(
    () =>
      connectors
        .filter((connector) => {
          const state = connectorState(connector).kind;
          return state === 'connected' || state === 'provisioned';
        })
        .map((connector) => ({
          id: connector.connectorId,
          name: connector.displayName,
          token: connectorNameToToken(connector.displayName),
        })),
    [connectors]
  );

  return (
    <PickerPanel
      title={t('chat.input-attach-connectors')}
      items={items}
      inputValue={inputValue}
      onToggleItem={onToggleItem}
      renderTag={(item) => (
        <span
          className={cn(
            'rounded px-1 py-px text-xs font-medium',
            RICH_CONNECTOR_STYLE_CLASSES
          )}
        >
          {item.token}
        </span>
      )}
      renderLogo={(item) => {
        const iconUrl = integrationLeadingIconUrl(item.name);
        return iconUrl ? (
          <img src={iconUrl} alt="" className="h-4 w-4 object-contain" />
        ) : (
          <Wrench size={16} className="text-ds-icon-neutral-muted-default" />
        );
      }}
      loading={loading}
      emptyLabel={t('chat.no-connectors-added')}
      emptyActionLabel={t('chat.input-attach-manage-connectors')}
      onEmptyAction={() => navigate('/history?tab=connectors')}
    />
  );
}

/** Lists the user's enabled skills from the skills store. */
export function SkillPickerPanel({
  inputValue,
  onToggleItem,
}: WiredPickerPanelProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const skills = useSkillsStore((s) => s.skills);
  const remoteMode = useSkillsStore((s) => s.remoteMode);

  const items = useMemo(
    () =>
      skills
        .filter((s) => s.enabled)
        // In remote mode the composer speaks to the orchestrator chat
        // surface, so a skill scoped away from it (worker-only) is not
        // loadable here and stays out of the picker. Local-mode scope keeps
        // its legacy meaning and never filters.
        .filter(
          (s) =>
            remoteMode.kind !== 'remote' ||
            s.scope.isGlobal ||
            s.scope.selectedAgents.some(
              (agent) => normalizeSkillScopeAgentId(agent) === SINGLE_AGENT_ID
            )
        )
        .map((s) => ({
          id: s.id,
          name: s.name,
          token: `#${s.skillDirName || skillNameToDirName(s.name)}`,
          description: s.description || undefined,
        })),
    [skills, remoteMode]
  );

  return (
    <PickerPanel
      title={t('chat.input-attach-skills')}
      items={items}
      inputValue={inputValue}
      onToggleItem={onToggleItem}
      renderTag={(item) => {
        const clsIdx =
          hashSkillLabel(item.token) % RICH_SKILL_STYLE_CLASSES.length;
        return (
          <span
            className={cn(
              'rounded px-1 py-px text-xs font-medium',
              RICH_SKILL_STYLE_CLASSES[clsIdx]
            )}
          >
            {item.token}
          </span>
        );
      }}
      emptyLabel={t('chat.no-skills-added')}
      emptyActionLabel={t('chat.input-attach-manage-skills')}
      onEmptyAction={() => navigate('/history?tab=agents')}
    />
  );
}
