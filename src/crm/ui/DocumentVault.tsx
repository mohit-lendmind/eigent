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

// FR-011 (US1) — the document vault screen. A drop target queues documents, then
// the list reads the CrmDocument machine straight off the fold (QUEUED → …). The
// docintel decision gates (G2/G3) raised by the write path are surfaced above the
// list so an adviser can act without hunting. A polite live region announces each
// upload so a screen reader hears the queue grow. Ingest itself rides the edge
// seam (onFiles), which the desktop wires; the screen is a thin read otherwise.

import { UploadCloud } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getCrmCasesStore, useCrmCasesStore } from '../casesStore';
import { useCrmDocumentsStore } from '../documentsStore';
import type { FactFindSectionKey } from '../domain/factFindSchema';
import type { CrmDocument, DocInsight } from '../domain/types';
import { useCrmEventLogStore } from '../fold/eventLogStore';
import { DocCard } from './DocCard';
import {
  AttributionGateCard,
  ConflictGateCard,
  DocErrorCard,
  IncomeGateCard,
} from './DocGateCards';
import { SourceQuoteViewer } from './SourceQuoteViewer';
import {
  confirmAttributionGate,
  conflictForGate,
  rejectAttributionGate,
  resolveConflictGate,
  selectCaseIncomeGate,
  uploadVaultDocuments,
} from './vaultSurface';

export interface DocumentVaultProps {
  /**
   * The case this vault acts on. When present the screen wires the live loop:
   * uploads ride the ingest seam, G2/G3 gates resolve in place, and G9 is
   * assessed off the case's income facts. Absent ⇒ the read-only preview the
   * stories/tests render.
   */
  caseId?: string;
  firmId?: string;
  /** Adviser identity recorded on a gate resolution. */
  adviserId?: string;
  /** Override the ingest seam (stories/tests). Defaults to uploadVaultDocuments. */
  onFiles?: (files: File[]) => void;
  /** Open the source document at a det fact's located quote span (US1.4). */
  onOpenSource?: (insight: DocInsight) => void;
}

export function DocumentVault({
  caseId,
  firmId = 'lendmind',
  adviserId = 'adviser:me',
  onFiles,
  onOpenSource,
}: DocumentVaultProps) {
  const { t } = useTranslation();
  const documentsById = useCrmDocumentsStore((s) => s.documentsById);
  const openGates = useCrmEventLogStore((s) => s.openGates);
  const casesById = useCrmCasesStore((s) => s.casesById);

  const [dragActive, setDragActive] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [sourceInsight, setSourceInsight] = useState<DocInsight | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Finding 7: scope the list to THIS case. A document belongs to the case when
  // its owner is one of the case's applicants, or it is a joint document. Without
  // a caseId (the read-only preview) every document is shown. Unscoped, a second
  // case would leak the first case's documents into this vault.
  const caseOwnerIds = useMemo(() => {
    if (!caseId) return null;
    const kase = casesById[caseId];
    return kase
      ? new Set<string>(kase.applicants.map((a) => a.clientId))
      : new Set<string>();
  }, [caseId, casesById]);

  const documents = Object.values(documentsById)
    .filter(
      (d) =>
        caseOwnerIds === null ||
        d.owner === 'joint' ||
        caseOwnerIds.has(d.owner)
    )
    .sort((a, b) => b.when - a.when);
  const gates = Object.values(openGates).filter(
    (g) => g.status === 'open' && (g.gateId === 'G2' || g.gateId === 'G3')
  );
  const incomeGate = caseId ? selectCaseIncomeGate(caseId) : undefined;

  const acceptFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      // Only ingest — and only announce — when there is somewhere for the files
      // to go. A read-only preview (no onFiles, no caseId) does nothing, so a
      // "uploading N document(s)" announcement there would be a false claim.
      if (onFiles) {
        onFiles(files);
      } else if (caseId) {
        setUploadError('');
        void uploadVaultDocuments(caseId, firmId, files, {
          kind: 'adviser',
          id: adviserId,
        }).then((r) => {
          if (!r.ok) setUploadError(r.error);
        });
      } else {
        return;
      }
      setAnnounce(t('crm.vault.uploading', { count: files.length }));
    },
    [onFiles, caseId, firmId, adviserId, t]
  );

  // US1.4 deep-link: unless the caller overrides it (stories/tests), a det fact's
  // "view source" opens the in-vault source-quote viewer at the highlighted span.
  const openSource =
    onOpenSource ?? ((insight: DocInsight) => setSourceInsight(insight));

  // US2 syn-confirm (FR-011): confirming a `syn` insight promotes exactly the
  // fact-find field it maps to (the document owner + the insight's section/field)
  // from syn → det, so G9 can clear once a human has checked it. A joint document
  // or an unmapped insight is not confirmable in place.
  const confirmInsight = useCallback(
    (document: CrmDocument, insight: DocInsight) => {
      if (!caseId || document.owner === 'joint') return;
      if (insight.section === undefined || insight.fieldKey === undefined) {
        return;
      }
      getCrmCasesStore()
        .getState()
        .confirmSynthesizedField(
          caseId,
          document.owner,
          insight.section as FactFindSectionKey,
          insight.fieldKey,
          { confirmedBy: adviserId }
        );
    },
    [caseId, adviserId]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      acceptFiles(Array.from(e.dataTransfer.files));
    },
    [acceptFiles]
  );

  return (
    <div className="flex flex-col gap-4 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-ds-text-neutral-strong-default">
          {t('crm.vault.title')}
        </h1>
        <p className="text-sm text-ds-text-neutral-default-default">
          {t('crm.vault.subtitle')}
        </p>
      </header>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center ${
          dragActive
            ? 'border-ds-bg-brand-default-default bg-ds-bg-brand-subtle-default'
            : 'border-ds-bg-neutral-default-default bg-ds-bg-neutral-subtle-default'
        }`}
      >
        <UploadCloud
          className="h-6 w-6 text-ds-text-neutral-muted-default"
          aria-hidden
        />
        <span className="text-sm text-ds-text-neutral-default-default">
          {t('crm.vault.dropzone')}
        </span>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded border border-ds-bg-brand-default-default px-3 py-1 text-sm font-medium text-ds-text-brand-strong-default hover:bg-ds-bg-brand-subtle-default"
        >
          {t('crm.vault.choose')}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          aria-label={t('crm.vault.choose')}
          onChange={(e) => acceptFiles(Array.from(e.target.files ?? []))}
        />
      </div>

      <div aria-live="polite" className="sr-only">
        {announce}
      </div>

      {uploadError !== '' && <DocErrorCard message={uploadError} />}

      {incomeGate !== undefined && <IncomeGateCard result={incomeGate} />}

      {gates.length > 0 && (
        <div className="flex flex-col gap-2">
          {gates.map((gate) => {
            if (gate.gateId === 'G2') {
              const docId = gate.id.startsWith('G2_')
                ? gate.id.slice(3)
                : gate.id;
              return (
                <AttributionGateCard
                  key={gate.id}
                  gate={gate}
                  onConfirm={() =>
                    confirmAttributionGate(gate, docId, adviserId)
                  }
                  onReject={() => rejectAttributionGate(gate)}
                />
              );
            }
            const view = conflictForGate(gate);
            return (
              <ConflictGateCard
                key={gate.id}
                gate={gate}
                existingLabel={view?.existingLabel}
                incomingLabel={view?.incomingLabel}
                onKeepExisting={
                  view
                    ? () =>
                        resolveConflictGate(
                          gate,
                          {
                            conflictId: view.conflictId,
                            chosenValue: view.existing,
                          },
                          adviserId
                        )
                    : undefined
                }
                onUseIncoming={
                  view
                    ? () =>
                        resolveConflictGate(
                          gate,
                          {
                            conflictId: view.conflictId,
                            chosenValue: view.incoming,
                          },
                          adviserId
                        )
                    : undefined
                }
              />
            );
          })}
        </div>
      )}

      {documents.length === 0 ? (
        <div className="rounded-lg border border-ds-bg-neutral-default-default bg-ds-bg-neutral-subtle-default px-4 py-8 text-center text-sm text-ds-text-neutral-default-default">
          {t('crm.vault.empty')}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {documents.map((doc) => (
            <DocCard
              key={doc.id}
              document={doc}
              onOpenSource={openSource}
              onConfirmInsight={
                caseId ? (insight) => confirmInsight(doc, insight) : undefined
              }
            />
          ))}
        </div>
      )}

      {sourceInsight !== null && (
        <SourceQuoteViewer
          insight={sourceInsight}
          onClose={() => setSourceInsight(null)}
        />
      )}
    </div>
  );
}

export default DocumentVault;
