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

import type { TodoState } from '@/api/aion/v1/reducer';
import { SidePanelAccordionBox } from '@/components/Session/SidePanelAccordionBox';
import {
  buildPlanRows,
  type PlanEvidenceLink,
  type PlanRow,
} from '@/components/Session/SidePanelSections/buildPlanRows';
import {
  ProgressCircle,
  ProgressConnector,
} from '@/components/Session/SidePanelSections/primitives';
import { cn } from '@/lib/utils';
import { usePageTabStore } from '@/store/pageTabStore';
import { AnimatePresence, motion } from 'framer-motion';
import { useMemo } from 'react';

interface PlanSectionProps {
  title: string;
  /** The reducer's todo fold, in creation order. Empty = no section at all. */
  todos: TodoState[];
  /** Name → newest published artifact id; joins evidence refs to the viewer. */
  artifactIdByName: Record<string, string>;
}

/**
 * The agent's own plan (aion todo events), as a nested checklist beside the
 * other side-panel sections. Renders nothing when the run planned nothing —
 * a single-turn answer emits no todo events, and an empty Plan box would
 * read as "the agent never plans".
 */
export function PlanSection({
  title,
  todos,
  artifactIdByName,
}: PlanSectionProps) {
  const { rows, done, total } = useMemo(
    () => buildPlanRows(todos, artifactIdByName),
    [todos, artifactIdByName]
  );
  const openArtifactPreview = usePageTabStore((s) => s.openArtifactPreview);

  if (total === 0) return null;

  const collapsedStrip = (
    <div className="gap-1 min-w-0 mx-1 flex items-center overflow-hidden">
      <AnimatePresence initial={false}>
        {rows.map((row, idx) => (
          <motion.span
            key={row.todoId}
            layout
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="gap-1 min-w-0 flex items-center"
          >
            <ProgressCircle done={row.status === 'done'} />
            {idx < rows.length - 1 ? <ProgressConnector /> : null}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );

  return (
    <SidePanelAccordionBox
      title={title}
      titleSuffix={
        <span
          className="bg-ds-bg-neutral-subtle-default text-ds-text-neutral-subtle-default text-label-xs font-bold px-1.5 inline-flex items-center justify-center rounded-full"
          data-testid="plan-count"
        >
          {done}/{total}
        </span>
      }
    >
      {({ open }) => {
        if (!open) return collapsedStrip;
        return (
          <motion.ul layout className="p-0 m-0 space-y-0.5 list-none">
            <AnimatePresence initial={false}>
              {rows.map((row) => (
                <motion.li
                  key={row.todoId}
                  layout
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                >
                  <PlanRowItem
                    row={row}
                    onOpenEvidence={(link) =>
                      link.artifactId
                        ? openArtifactPreview(link.artifactId, link.label)
                        : undefined
                    }
                  />
                </motion.li>
              ))}
            </AnimatePresence>
          </motion.ul>
        );
      }}
    </SidePanelAccordionBox>
  );
}

function PlanRowItem({
  row,
  onOpenEvidence,
}: {
  row: PlanRow;
  onOpenEvidence: (link: PlanEvidenceLink) => void;
}) {
  const isDone = row.status === 'done';
  return (
    <div
      className="gap-2 px-1.5 py-1.5 rounded-md min-w-0 w-full flex flex-col hover:bg-ds-bg-neutral-subtle-default"
      style={{ paddingLeft: 6 + row.depth * 14 }}
      data-testid="plan-row"
      data-todo-id={row.todoId}
      data-todo-depth={row.depth}
      data-todo-status={row.status}
    >
      <div className="gap-2 min-w-0 w-full flex items-center">
        <span className="flex shrink-0 items-center">
          <ProgressCircle done={isDone} />
        </span>
        <span
          className={cn(
            'text-ds-text-neutral-default-default text-body-sm min-w-0 flex-1 truncate text-left',
            isDone && 'line-through',
            row.status === 'in_progress' && 'font-medium'
          )}
        >
          {row.title}
        </span>
        {row.childExecution ? (
          <span className="bg-ds-bg-neutral-subtle-default text-ds-text-neutral-muted-default text-label-xs px-1.5 shrink-0 rounded-full">
            {row.childExecution}
          </span>
        ) : null}
        {!isDone && row.status !== 'pending' ? (
          <span className="text-ds-text-neutral-muted-default text-label-xs shrink-0">
            {row.status.replace(/_/g, ' ')}
          </span>
        ) : null}
      </div>
      {row.evidence.length > 0 ? (
        <div className="gap-1 pl-6 flex min-w-0 flex-wrap items-center">
          {row.evidence.map((link) =>
            link.artifactId ? (
              <button
                key={`${link.kind}:${link.ref}`}
                type="button"
                onClick={() => onOpenEvidence(link)}
                className="bg-ds-bg-neutral-subtle-default text-ds-text-brand-default-default text-label-xs px-1.5 py-0.5 max-w-full cursor-pointer truncate rounded-md hover:bg-ds-bg-neutral-subtle-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-ring-brand-default-focus/40"
              >
                {link.label}
              </button>
            ) : (
              <span
                key={`${link.kind}:${link.ref}`}
                className="bg-ds-bg-neutral-subtle-default text-ds-text-neutral-muted-default text-label-xs px-1.5 py-0.5 max-w-full truncate rounded-md"
              >
                {link.label}
              </span>
            )
          )}
        </div>
      ) : null}
    </div>
  );
}
