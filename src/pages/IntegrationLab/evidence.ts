// Sanitized diagnostics export for the Integration Lab (doc 10 §10 M4-H).
// The builder's input is limited to authorized projections the Lab already
// renders — it is never handed the API key, and artifact download grants
// (presigned URLs) stay out of the export by construction. Timeline entries
// are reduced to their shape (type/kind/sequence/run), not their contents,
// so an evidence file can travel in a bug report without dragging along
// model output or tool results.

import type { ProjectUIState } from '@/api/aion/v1/reducer';
import type { SessionStatus } from '@/api/aion/v1/session';
import type {
  CommandReceipt,
  IntegrationStatus,
  ModelAliasCatalog,
} from '@/api/aion/v1/transport';

export interface LabEvidenceInput {
  capturedAt: string;
  edgeBaseUrl: string;
  clientEdgeApiVersion: string;
  integrationStatus: IntegrationStatus | null;
  statusError: string | null;
  models: ModelAliasCatalog | null;
  sessionStatus: SessionStatus | null;
  projectState: ProjectUIState | null;
  commandReceipts: CommandReceipt[];
}

export function buildLabEvidence(
  input: LabEvidenceInput
): Record<string, unknown> {
  const state = input.projectState;
  return {
    captured_at: input.capturedAt,
    edge_base_url: input.edgeBaseUrl,
    client_edge_api_version: input.clientEdgeApiVersion,
    integration_status: input.integrationStatus,
    status_error: input.statusError,
    model_aliases: input.models?.aliases.map((a) => a.alias) ?? null,
    session_status: input.sessionStatus,
    project:
      state === null
        ? null
        : {
            project_id: state.projectId,
            cursor: state.lastSequence,
            rehydrated_from: state.rehydratedFrom,
            gap_count: state.gapCount,
            suppressed_event_count: state.suppressedEventCount,
            active_run_id: state.activeRunId,
            runs: Object.values(state.runs),
            pending_approval_ids: Object.keys(state.pendingApprovals),
            artifact_ids: Object.keys(state.artifacts),
            timeline: state.timeline.map((entry) => ({
              type: entry.type,
              sequence: entry.sequence,
              run_id: entry.runId,
              ...('kind' in entry ? { kind: entry.kind } : {}),
            })),
          },
    command_receipts: input.commandReceipts,
  };
}
