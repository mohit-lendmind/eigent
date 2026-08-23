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

// M5 (FR-014) — the minimal, gated pack editor. A criteria pack is adviser-
// curated (NOT a licensed DB), so editing a rule is an authored act: the save is
// gated on a named editor, and every edit folds an authorship record (who edited
// which rule, when). The editor loads the SYNTHETIC pack as its seed — no real
// lender data ships here. This is deliberately minimal: it edits a rule's compared
// value, records the before/after, and shows the current authorship of each rule.

import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  CriteriaPack,
  CriteriaRule,
} from '../agentContracts/criteriaAffordability';
import type { RecordPackEditInput, RuleAuthorship } from '../criteria/packEdit';
import { SYNTHETIC_CRITERIA_PACK } from '../fixtures/criteriaPack';

export interface CriteriaPackEditorProps {
  /** Defaults to the synthetic seed pack — no real lender data ships here. */
  pack?: CriteriaPack;
  /** The named editor; the save is gated closed until this is present. */
  editorId: string;
  /** Current folded authorship, keyed by `${lenderId} ${ruleKey}`. */
  authorship?: Record<string, RuleAuthorship>;
  onEdit: (input: RecordPackEditInput) => void;
}

function ruleValueString(rule: CriteriaRule): string {
  return Array.isArray(rule.value) ? rule.value.join(', ') : String(rule.value);
}

function RuleEditor({
  packRef,
  lenderId,
  rule,
  editorId,
  authorship,
  onEdit,
}: {
  packRef: string;
  lenderId: string;
  rule: CriteriaRule;
  editorId: string;
  authorship?: RuleAuthorship;
  onEdit: (input: RecordPackEditInput) => void;
}) {
  const { t } = useTranslation();
  const original = ruleValueString(rule);
  const [draft, setDraft] = useState(original);
  const gated = editorId.trim().length > 0;
  const changed = draft !== original;

  return (
    <div className="flex flex-col gap-1 rounded-md border border-ds-bg-neutral-default-default bg-ds-bg-neutral-subtle-default p-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-ds-text-neutral-strong-default">
          {rule.key}
        </span>
        {authorship && (
          <span className="text-[11px] text-ds-text-neutral-muted-default">
            {t('crm.criteria.pack-edited-by', {
              who: authorship.editedBy,
              count: authorship.editCount,
            })}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label={t('crm.criteria.pack-value-label', { rule: rule.key })}
          className="flex-1 rounded-md border border-ds-bg-neutral-default-default bg-ds-bg-neutral-default-default px-2 py-1 text-xs text-ds-text-neutral-strong-default"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!gated || !changed}
          title={!gated ? t('crm.criteria.pack-gated-title') : undefined}
          onClick={() =>
            onEdit({
              packRef,
              lenderId,
              ruleKey: rule.key,
              editedBy: editorId.trim(),
              field: 'value',
              before: original,
              after: draft,
              at: Date.now(),
            })
          }
        >
          {t('crm.criteria.pack-save')}
        </Button>
      </div>
    </div>
  );
}

/**
 * The minimal gated pack editor (FR-014). Loads the synthetic seed, edits a
 * rule's compared value, and hands each gated edit up as an authorship record.
 */
export function CriteriaPackEditor({
  pack = SYNTHETIC_CRITERIA_PACK,
  editorId,
  authorship,
  onEdit,
}: CriteriaPackEditorProps) {
  const { t } = useTranslation();
  return (
    <section
      className="flex flex-col gap-3"
      aria-label={t('crm.criteria.pack-title')}
    >
      <header>
        <h2 className="text-sm font-semibold text-ds-text-neutral-strong-default">
          {t('crm.criteria.pack-title')}
        </h2>
        <p className="text-xs text-ds-text-neutral-muted-default">
          {t('crm.criteria.pack-subtitle')}
        </p>
      </header>
      {!editorId.trim() && (
        <p className="text-xs text-ds-text-warning-strong-default">
          {t('crm.criteria.pack-gated-note')}
        </p>
      )}
      <div className="flex flex-col gap-3">
        {pack.lenders.map((lender) => (
          <div key={lender.lenderId} className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-ds-text-neutral-strong-default">
              {lender.lenderId}
            </h3>
            {lender.rules.map((rule) => (
              <RuleEditor
                key={rule.key}
                packRef={pack.packRef}
                lenderId={lender.lenderId}
                rule={rule}
                editorId={editorId}
                authorship={authorship?.[`${lender.lenderId} ${rule.key}`]}
                onEdit={onEdit}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

export default CriteriaPackEditor;
