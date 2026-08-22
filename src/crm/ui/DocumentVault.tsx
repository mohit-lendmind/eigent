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
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCrmDocumentsStore } from '../documentsStore';
import type { DocInsight } from '../domain/types';
import { useCrmEventLogStore } from '../fold/eventLogStore';
import { DocCard } from './DocCard';
import { AttributionGateCard, ConflictGateCard } from './DocGateCards';

export interface DocumentVaultProps {
  /** Hand dropped/selected files to the ingest seam (desktop-wired). */
  onFiles?: (files: File[]) => void;
  /** Open the source document at a det fact's located quote span (US1.4). */
  onOpenSource?: (insight: DocInsight) => void;
}

export function DocumentVault({ onFiles, onOpenSource }: DocumentVaultProps) {
  const { t } = useTranslation();
  const documentsById = useCrmDocumentsStore((s) => s.documentsById);
  const openGates = useCrmEventLogStore((s) => s.openGates);

  const [dragActive, setDragActive] = useState(false);
  const [announce, setAnnounce] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const documents = Object.values(documentsById).sort(
    (a, b) => b.when - a.when
  );
  const gates = Object.values(openGates).filter(
    (g) => g.status === 'open' && (g.gateId === 'G2' || g.gateId === 'G3')
  );

  const acceptFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      onFiles?.(files);
      setAnnounce(t('crm.vault.uploading', { count: files.length }));
    },
    [onFiles, t]
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

      {gates.length > 0 && (
        <div className="flex flex-col gap-2">
          {gates.map((gate) =>
            gate.gateId === 'G2' ? (
              <AttributionGateCard key={gate.id} gate={gate} />
            ) : (
              <ConflictGateCard key={gate.id} gate={gate} />
            )
          )}
        </div>
      )}

      {documents.length === 0 ? (
        <div className="rounded-lg border border-ds-bg-neutral-default-default bg-ds-bg-neutral-subtle-default px-4 py-8 text-center text-sm text-ds-text-neutral-default-default">
          {t('crm.vault.empty')}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {documents.map((doc) => (
            <DocCard key={doc.id} document={doc} onOpenSource={onOpenSource} />
          ))}
        </div>
      )}
    </div>
  );
}

export default DocumentVault;
