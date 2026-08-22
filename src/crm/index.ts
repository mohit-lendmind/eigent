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

export { EMPTY_ARRAY, EMPTY_MAP, EMPTY_OBJECT } from './domain/emptyConstants';
export {
  EMPLOYED_FIELD_KEYS,
  SELF_EMPLOYED_FIELD_KEYS,
  requiredKeysForSection,
  type AnyFactFindFieldKey,
  type EmployedFieldKey,
  type SelfEmployedFieldKey,
} from './domain/factFindSchema';
export { newCrmId, type CrmIdPrefix } from './domain/ids';
export {
  formatGbp,
  parseGbp,
  toPence,
  type FormatGbpOptions,
} from './domain/money';
export {
  STAGES,
  STAGE_MAP,
  nextStage,
  stageIndex,
  type StageDescriptor,
} from './domain/stages';
export * from './domain/types';
export { CRM_SCHEMA_VERSION } from './domain/types';

export {
  CRM_CASES_PERSIST_VERSION,
  CRM_CASES_STORE_KEY,
  computeApplicantCompleteness,
  computeCaseCompleteness,
  computeSectionCompleteness,
  getCrmCasesStore,
  useCrmCasesStore,
  type CrmCasesState,
} from './casesStore';
export {
  CRM_CLIENTS_PERSIST_VERSION,
  CRM_CLIENTS_STORE_KEY,
  getCrmClientsStore,
  useCrmClientsStore,
  type CrmClientsState,
} from './clientsStore';
export {
  CRM_DOCUMENTS_PERSIST_VERSION,
  CRM_DOCUMENTS_STORE_KEY,
  getCrmDocumentsStore,
  useCrmDocumentsStore,
  type ChecklistOwner,
  type CrmDocumentsState,
} from './documentsStore';
export {
  CRM_WORKSTREAM_PERSIST_VERSION,
  CRM_WORKSTREAM_STORE_KEY,
  STREAM_ENTRIES_PER_CASE_CAP,
  getCrmWorkstreamStore,
  useCrmWorkstreamStore,
  type CrmWorkstreamState,
} from './workstreamStore';

export {
  crmIntegrityRepair,
  getLastRepairReport,
  scheduleIntegrityRepair,
} from './integrity';

export {
  STAGE_ORDER,
  selectCaseCompleteness,
  selectCaseStreamSections,
  selectDetSynCounts,
  selectNeedsYou,
  selectNeedsYouCount,
  selectOpenConflicts,
  selectPipelineCounts,
  selectRetentionUrgency,
  type CaseStreamSections,
  type DetSynCounts,
} from './selectors';

export { seedCrmGoldenPath, type SeedOptions } from './seed';

export {
  canonicalise,
  clearAllCrmState,
  exportCaseFile,
  exportCaseFileV2,
  importCaseFile,
  type CaseFileExportEnvelopeV2,
  type CaseFileExportV2,
  type ExportFailure,
  type ImportFailure,
  type ImportSuccess,
} from './caseFile';

export {
  computeEntryHash,
  settleHashOf,
  sha256HexCanonical,
  verifyChain,
} from './hashChain';

// Importing the outbox module for its side effect wires the event-log side-bus
// so desktop store writes can enqueue without a static store→fold import.
export {
  OUTBOX_LWW_KINDS,
  OUTBOX_MAX_UNSETTLED,
  configureOutboxCarrier,
  flushOutbox,
  recordLocalEvent,
  type LocalEventCandidate,
  type LocalEventRefusal,
  type OutboxCarrier,
} from './fold/outbox';

export * from './agentContracts';
