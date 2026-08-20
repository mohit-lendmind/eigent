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

import { EdgeProblemError } from '@/api/aion/v1/problems';
import ConfirmModal from '@/components/ui/alertDialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogHeader,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { recordFeatureUsed } from '@/lib/events/appEvents';
import { buildSkillMd, parseSkillMd } from '@/lib/skillToolkit';
import { extractSkillsFromZip, type ZipSkill } from '@/lib/skillZip';
import {
  getAionSkillsMode,
  putAionSkill,
  type AionSkillsMode,
} from '@/store/aionSkillsStore';
import { useSkillsStore } from '@/store/skillsStore';

import { AlertCircle, File, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

/**
 * The store's validation verdict (skill_invalid findings, quota, stale
 * If-Match) rendered inline in the dialog instead of a generic toast.
 */
function remoteErrorText(error: unknown): string {
  if (error instanceof EdgeProblemError) {
    return error.problem.detail ?? error.problem.title;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Why the SkillStore cannot take a document, in its own words where it has
 * any: a stack too old names its version, an unreachable one names its
 * failure, and no transport at all means an upload has nowhere to land.
 */
function skillStoreUnavailableText(
  mode: AionSkillsMode,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (mode.kind === 'error') return mode.message;
  if (mode.kind === 'unsupported') {
    return t('agents.skills-backend-too-old', {
      version: mode.edgeApiVersion,
    });
  }
  return t('agents.skills-no-backend');
}

/** Guard renderer memory while the archive is held for unpacking. */
const MAX_SKILL_ZIP_IMPORT_BYTES = 50 * 1024 * 1024;

interface SkillUploadDialogProps {
  open: boolean;
  onClose: () => void;
  /** File upload vs compose SKILL.md in the editor */
  mode?: 'upload' | 'create';
}

export default function SkillUploadDialog({
  open,
  onClose,
  mode = 'upload',
}: SkillUploadDialogProps) {
  const { t } = useTranslation();
  const { addSkill, refresh } = useSkillsStore();
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [_isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isZip, setIsZip] = useState(false);
  const [uploadError, setUploadError] = useState<'invalid_format' | null>(null);
  const [conflictDialog, setConflictDialog] = useState<{
    open: boolean;
    folderName: string;
    skillName: string;
  } | null>(null);
  const [pendingConflicts, setPendingConflicts] = useState<
    Array<{ folderName: string; skillName: string }>
  >([]);
  const [confirmedReplacements, setConfirmedReplacements] = useState<
    Set<string>
  >(new Set());
  const [composeContent, setComposeContent] = useState('');
  const [savingCompose, setSavingCompose] = useState(false);
  // Remote (aion SkillStore) path: the unpacked archive awaiting conflict
  // consent, and the store's inline validation verdict.
  const [pendingRemoteZip, setPendingRemoteZip] = useState<ZipSkill[] | null>(
    null
  );
  const [remoteNotice, setRemoteNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open || mode !== 'create') return;
    setComposeContent(
      buildSkillMd(
        t('agents.create-skill-default-name'),
        t('agents.create-skill-default-description'),
        '## Instructions\n\n'
      )
    );
  }, [open, mode, t]);

  const handleClose = useCallback(() => {
    setSelectedFile(null);
    setFileContent('');
    setIsDragging(false);
    setIsZip(false);
    setUploadError(null);
    setConflictDialog(null);
    setPendingConflicts([]);
    setConfirmedReplacements(new Set());
    setPendingRemoteZip(null);
    setRemoteNotice(null);
    setComposeContent('');
    setSavingCompose(false);
    onClose();
  }, [onClose]);

  const handleSaveCompose = useCallback(async () => {
    const meta = parseSkillMd(composeContent);
    if (!meta) {
      toast.error(t('agents.upload-error-invalid-yaml'));
      return;
    }
    setSavingCompose(true);
    setRemoteNotice(null);
    try {
      const outcome = await addSkill({
        name: meta.name,
        description: meta.description,
        filePath: 'SKILL.md',
        fileContent: composeContent,
        scope: { isGlobal: true, selectedAgents: [] },
        enabled: true,
      });
      toast.success(t('agents.skill-added-success'));
      if (outcome && outcome.ignoredFields.length > 0) {
        toast.info(
          t('agents.skill-fields-ignored', {
            fields: outcome.ignoredFields.join(', '),
          })
        );
      }
      recordFeatureUsed('skills', { action: 'create' });
      handleClose();
    } catch (error) {
      // Validation findings stay inline so the author can fix the document
      // in place rather than chase a toast that has already gone.
      setRemoteNotice(remoteErrorText(error));
    } finally {
      setSavingCompose(false);
    }
  }, [addSkill, composeContent, handleClose, t]);

  /**
   * Remote zip import: sequential PUTs for the archive's skills, skipping
   * name conflicts the user did not confirm. Reports per-skill failures and
   * any store-stripped fields, then refreshes the list.
   */
  const importRemoteZip = useCallback(
    async (zipSkills: ZipSkill[], confirmed: Set<string>) => {
      const existing = new Set(
        useSkillsStore.getState().skills.map((s) => s.name)
      );
      const failures: string[] = [];
      const ignoredNotes: string[] = [];
      let imported = 0;
      for (const zipSkill of zipSkills) {
        const key = zipSkill.folderName || zipSkill.meta.name;
        if (existing.has(zipSkill.meta.name) && !confirmed.has(key)) {
          continue;
        }
        try {
          const result = await putAionSkill(zipSkill.meta, zipSkill.files);
          imported += 1;
          if (result.ignored_fields?.length) {
            ignoredNotes.push(
              `${zipSkill.meta.name}: ${result.ignored_fields.join(', ')}`
            );
          }
        } catch (error) {
          failures.push(`${zipSkill.meta.name}: ${remoteErrorText(error)}`);
        }
      }
      await refresh();
      if (imported > 0) {
        toast.success(t('agents.skill-added-success'));
        recordFeatureUsed('skills', { action: 'upload', format: 'zip' });
      }
      if (ignoredNotes.length > 0) {
        toast.info(
          t('agents.skill-fields-ignored', {
            fields: ignoredNotes.join('; '),
          })
        );
      }
      if (failures.length > 0) {
        toast.error(failures.join('\n'));
      }
    },
    [refresh, t]
  );

  const resetConflictState = useCallback(() => {
    setConflictDialog(null);
    setPendingConflicts([]);
    setConfirmedReplacements(new Set());
    setPendingRemoteZip(null);
  }, []);

  const handleConflictConfirm = useCallback(async () => {
    if (!conflictDialog) return;

    const { folderName } = conflictDialog;
    const newConfirmed = new Set(confirmedReplacements);
    newConfirmed.add(folderName);
    setConfirmedReplacements(newConfirmed);

    // Remove current conflict from pending list
    const remaining = pendingConflicts.filter(
      (c) => c.folderName !== folderName
    );
    setPendingConflicts(remaining);

    // If more conflicts, show next one
    if (remaining.length > 0) {
      setConflictDialog({
        open: true,
        folderName: remaining[0].folderName,
        skillName: remaining[0].skillName,
      });
    } else {
      // All conflicts handled, proceed with import
      setConflictDialog(null);
      if (pendingRemoteZip) {
        await importRemoteZip(pendingRemoteZip, newConfirmed);
      }
      resetConflictState();
    }
  }, [
    conflictDialog,
    confirmedReplacements,
    importRemoteZip,
    pendingConflicts,
    pendingRemoteZip,
    resetConflictState,
  ]);

  const handleConflictCancel = useCallback(async () => {
    if (!conflictDialog) return;

    // Remove current conflict from pending list (user skipped this one)
    const remaining = pendingConflicts.filter(
      (c) => c.folderName !== conflictDialog.folderName
    );
    setPendingConflicts(remaining);

    // If more conflicts, show next one
    if (remaining.length > 0) {
      setConflictDialog({
        open: true,
        folderName: remaining[0].folderName,
        skillName: remaining[0].skillName,
      });
    } else {
      // All conflicts handled, proceed with import
      setConflictDialog(null);
      if (pendingRemoteZip) {
        // Unconfirmed conflicts are skipped inside the import; fresh names
        // in the archive still land.
        await importRemoteZip(pendingRemoteZip, confirmedReplacements);
      }
      resetConflictState();
    }
  }, [
    conflictDialog,
    confirmedReplacements,
    importRemoteZip,
    pendingConflicts,
    pendingRemoteZip,
    resetConflictState,
  ]);

  const handleUpload = useCallback(
    async (
      fileArg?: File,
      options?: { isZipOverride?: boolean; contentOverride?: string }
    ) => {
      const fileToUse = fileArg ?? selectedFile;
      if (!fileToUse) return;

      const isZipToUse = options?.isZipOverride ?? isZip;
      const fileContentToUse = options?.contentOverride ?? fileContent;

      setIsUploading(true);
      try {
        // Zip import: Brain REST (Web + Electron) or IPC fallback (Electron only)
        if (isZipToUse) {
          let buffer: ArrayBuffer;
          try {
            buffer = await fileToUse.arrayBuffer();
          } catch {
            toast.error(t('agents.file-read-error'));
            return;
          }

          if (buffer.byteLength > MAX_SKILL_ZIP_IMPORT_BYTES) {
            toast.error(t('agents.zip-import-too-large'));
            return;
          }

          // The archive is unpacked here in the renderer and fed to the
          // SkillStore as one PUT per skill, so a name already taken is a
          // conflict this dialog resolves before any of them are sent.
          const remote = await getAionSkillsMode();
          if (remote.kind !== 'remote') {
            setRemoteNotice(skillStoreUnavailableText(remote, t));
            return;
          }
          const zipSkills = await extractSkillsFromZip(buffer);
          if (zipSkills.length === 0) {
            setUploadError('invalid_format');
            return;
          }
          const existing = new Set(
            useSkillsStore.getState().skills.map((s) => s.name)
          );
          const conflicts = zipSkills
            .filter((z) => existing.has(z.meta.name))
            .map((z) => ({
              folderName: z.folderName || z.meta.name,
              skillName: z.meta.name,
            }));
          if (conflicts.length > 0) {
            setPendingConflicts(conflicts);
            setPendingRemoteZip(zipSkills);
            setConflictDialog({
              open: true,
              folderName: conflicts[0].folderName,
              skillName: conflicts[0].skillName,
            });
            setSelectedFile(null);
            setFileContent('');
            if (fileInputRef.current) fileInputRef.current.value = '';
            onClose();
            return;
          }
          await importRemoteZip(zipSkills, new Set());
          handleClose();
          return;
        }

        if (!fileContentToUse) return;

        const fileName = fileToUse.name.replace(/\.[^/.]+$/, '');

        // Prefer SKILL.md frontmatter (name + description) at upload time
        const meta = parseSkillMd(fileContentToUse);
        let name = meta?.name ?? fileName;
        let description = meta?.description ?? '';

        // Fallback: no frontmatter — use first heading and first paragraph
        if (!meta && fileContentToUse.startsWith('#')) {
          const lines = fileContentToUse.split('\n');
          const headingMatch = lines[0].match(/^#\s+(.+)/);
          if (headingMatch) name = headingMatch[1];
          for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line && !line.startsWith('#')) {
              description = line;
              break;
            }
          }
        }

        const outcome = await addSkill({
          name,
          description: description || t('agents.custom-skill'),
          filePath: fileToUse.name,
          fileContent: fileContentToUse,
          scope: { isGlobal: true, selectedAgents: [] },
          enabled: true,
        });

        toast.success(t('agents.skill-added-success'));
        if (outcome && outcome.ignoredFields.length > 0) {
          toast.info(
            t('agents.skill-fields-ignored', {
              fields: outcome.ignoredFields.join(', '),
            })
          );
        }
        recordFeatureUsed('skills', { action: 'upload', format: 'md' });
        handleClose();
      } catch (error) {
        setRemoteNotice(remoteErrorText(error));
      } finally {
        setIsUploading(false);
      }
    },
    [
      addSkill,
      fileContent,
      handleClose,
      importRemoteZip,
      isZip,
      onClose,
      selectedFile,
      t,
    ]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const processFile = useCallback(
    async (file: File) => {
      // Only .zip or skill package (.skill, .md) are valid
      const skillPackageExtensions = ['.zip', '.skill', '.md'];
      const extension = file.name
        .substring(file.name.lastIndexOf('.'))
        .toLowerCase();

      if (!skillPackageExtensions.includes(extension)) {
        setSelectedFile(file);
        setUploadError('invalid_format');
        return;
      }

      // Validate file size (max 5MB to allow small zip bundles)
      if (file.size > 5 * 1024 * 1024) {
        toast.error(t('agents.file-too-large'));
        return;
      }

      try {
        setUploadError(null);
        setSelectedFile(file);

        // Detect if file is a zip archive: .zip always, .skill by magic bytes
        let treatAsZip = extension === '.zip';
        if (extension === '.skill') {
          const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
          // ZIP magic bytes: PK\x03\x04
          if (
            header[0] === 0x50 &&
            header[1] === 0x4b &&
            header[2] === 0x03 &&
            header[3] === 0x04
          ) {
            treatAsZip = true;
          }
        }

        if (treatAsZip) {
          setIsZip(true);
          setFileContent('');
          await handleUpload(file, {
            isZipOverride: true,
            contentOverride: '',
          });
        } else {
          const content = await file.text();
          setIsZip(false);
          setFileContent(content);
          // Let handleUpload's fallback logic handle files without frontmatter
          // (it extracts name from # heading or filename)
          await handleUpload(file, {
            isZipOverride: false,
            contentOverride: content,
          });
        }
      } catch (_error) {
        toast.error(t('agents.file-read-error'));
      }
    },
    [handleUpload, t]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        processFile(files[0]);
      }
    },
    [processFile]
  );

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setFileContent('');
    setUploadError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const errorMessage =
    uploadError === 'invalid_format'
      ? t('agents.upload-error-invalid-format')
      : null;

  return (
    <>
      <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
        <DialogContent
          size={mode === 'create' ? 'md' : 'sm'}
          showCloseButton
          onClose={handleClose}
          overlayVariant="dimmed"
        >
          <DialogHeader
            title={
              mode === 'create'
                ? t('agents.create-skill')
                : t('agents.add-skill')
            }
          />
          <DialogContentSection>
            <div className="flex flex-col gap-4">
              {mode === 'create' ? (
                <>
                  <p className="text-label-sm text-ds-text-neutral-muted-default">
                    {t('agents.compose-skill-hint')}
                  </p>
                  <Textarea
                    variant="none"
                    value={composeContent}
                    onChange={(e) => setComposeContent(e.target.value)}
                    className="min-h-[220px] resize-y font-mono text-body-sm"
                    spellCheck={false}
                    data-testid="skill-compose-input"
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={handleClose}
                    >
                      {t('layout.cancel')}
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      type="button"
                      disabled={savingCompose || !composeContent.trim()}
                      onClick={() => void handleSaveCompose()}
                      data-testid="skill-compose-save"
                    >
                      {t('agents.save-skill')}
                    </Button>
                  </div>
                </>
              ) : null}
              {mode === 'upload' ? (
                <div
                  className={`ease-[cubic-bezier(0.23,1,0.32,1)] relative cursor-pointer rounded-xl border-2 border-dashed p-5 transition-colors duration-200 ${
                    uploadError
                      ? 'border-ds-border-status-error-default-default bg-ds-bg-status-error-subtle-default'
                      : isDragging
                        ? 'border-ds-border-brand-default-focus bg-ds-bg-neutral-strong-default'
                        : 'border-ds-border-neutral-default-default hover:border-ds-border-neutral-strong-default hover:bg-ds-bg-neutral-default-default'
                  }`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".skill,.md,.zip"
                    onChange={handleFileSelect}
                    className="hidden"
                  />

                  {selectedFile ? (
                    <div className="flex flex-col items-center gap-4">
                      <div className="flex items-center gap-2">
                        <div
                          className={`flex flex-shrink-0 items-center justify-center rounded-lg p-1 ${
                            uploadError
                              ? 'bg-ds-bg-status-error-subtle-default'
                              : 'bg-ds-bg-neutral-strong-default'
                          }`}
                        >
                          <File
                            className={`h-4 w-4 ${
                              uploadError
                                ? 'text-ds-icon-status-error-default-default'
                                : 'text-ds-icon-neutral-default-default'
                            }`}
                          />
                        </div>
                        <div className="flex w-full min-w-0 flex-col">
                          <span
                            className={`truncate text-body-sm font-medium ${
                              uploadError
                                ? 'text-ds-text-status-error-strong-default'
                                : 'text-ds-text-neutral-default-default'
                            }`}
                          >
                            {selectedFile.name}
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveFile();
                          }}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>

                      <span
                        className={`text-label-sm ${
                          uploadError
                            ? 'text-ds-text-status-error-strong-default'
                            : 'text-ds-text-neutral-muted-default'
                        }`}
                      >
                        {uploadError
                          ? t('agents.reupload-file')
                          : `${(selectedFile.size / 1024).toFixed(1)} KB`}
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <div className="flex h-12 w-12 items-center justify-center">
                        <Upload className="h-6 w-6 text-ds-icon-neutral-muted-default" />
                      </div>
                      <div className="flex flex-col items-center gap-1 text-center">
                        <span className="text-body-sm font-medium text-ds-text-neutral-default-default">
                          {t('agents.drag-and-drop')}
                        </span>
                        <span className="mt-1 text-label-sm text-ds-text-neutral-muted-default">
                          {t('agents.or-click-to-browse')}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

              {/* Remote store verdict (validation findings, quota, staleness)
                  rendered inline so the author can fix the document in place */}
              {remoteNotice && (
                <div
                  className="flex items-center gap-4 rounded-xl border border-ds-border-status-error-default-default bg-ds-bg-status-error-subtle-default px-4 py-3"
                  role="alert"
                  data-testid="skill-remote-notice"
                >
                  <AlertCircle className="h-4 w-4 shrink-0 text-ds-icon-status-error-default-default" />
                  <span className="whitespace-pre-wrap break-words text-label-sm text-ds-text-status-error-strong-default">
                    {remoteNotice}
                  </span>
                </div>
              )}

              {/* Error notice */}
              {mode === 'upload' && uploadError && errorMessage && (
                <div
                  className="flex items-center gap-4 rounded-xl border border-ds-border-status-error-default-default bg-ds-bg-status-error-subtle-default px-4 py-3"
                  role="alert"
                >
                  <AlertCircle className="h-4 w-4 shrink-0 text-ds-icon-status-error-default-default" />
                  <span className="text-label-sm text-ds-text-status-error-strong-default">
                    {errorMessage}
                  </span>
                </div>
              )}

              {/* File Requirements */}
              {mode === 'upload' ? (
                <div className="rounded-xl bg-ds-bg-neutral-default-default p-4">
                  <span className="text-label-sm font-bold text-ds-text-neutral-default-default">
                    {t('agents.file-requirements')}
                  </span>
                  <span className="mt-2 flex items-start gap-2 text-label-sm text-ds-text-neutral-muted-default">
                    <span className="text-ds-text-neutral-muted-default">
                      •
                    </span>
                    <span>{t('agents.file-requirements-detail-1')}</span>
                  </span>
                  <span className="mt-1 flex items-start gap-2 text-label-sm text-ds-text-neutral-muted-default">
                    <span className="text-ds-text-neutral-muted-default">
                      •
                    </span>
                    <span>{t('agents.file-requirements-detail-2')}</span>
                  </span>
                </div>
              ) : null}
            </div>
          </DialogContentSection>
        </DialogContent>
      </Dialog>

      {/* Conflict confirmation dialog - rendered outside main dialog */}
      {conflictDialog && (
        <ConfirmModal
          isOpen={conflictDialog.open}
          onClose={handleConflictCancel}
          onConfirm={handleConflictConfirm}
          title={`Replace "${conflictDialog.skillName}" skill?`}
          message="There's an existing skill with the same name. Uploading this skill will replace the existing one, which can't be restored."
          confirmText="Update and Replace"
          cancelText="Cancel"
          confirmVariant="caution"
        />
      )}
    </>
  );
}
