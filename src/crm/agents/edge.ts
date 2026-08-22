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

// The one seam every M2 agent module reaches the aion edge through. It rides
// the same getAionRemoteConfig → EdgeTransport pattern the chat bridge and the
// artifact store use, so an agent invocation talks to the same backend the rest
// of the desktop does. The gateway is the SUBSET of EdgeTransport the agents
// call — narrow enough that a test injects a plain object rather than standing
// up a real transport with a stub fetch.

import type { AttachmentUpload } from '@/api/aion/v1/transport';
import {
  EdgeTransport,
  type Artifact,
  type ArtifactAccess,
  type ArtifactList,
  type CommandReceipt,
  type CreateProjectRequest,
  type CreateScheduleRequest,
  type Project,
  type PutSkillRequest,
  type PutSkillResult,
  type Schedule,
  type ScheduleList,
  type SubmitCommandRequest,
  type UsageSummary,
} from '@/api/aion/v1/transport';
import { getAionRemoteConfig } from '@/store/aionChatBridge';

// Exactly the methods the agents call. EdgeTransport structurally satisfies it,
// so getAgentEdge can hand back a real transport while tests inject a stub.
export interface AgentEdge {
  createProject(request: CreateProjectRequest): Promise<Project>;
  submitCommand(
    projectId: string,
    request: SubmitCommandRequest
  ): Promise<CommandReceipt>;
  uploadAttachment(
    projectId: string,
    upload: AttachmentUpload
  ): Promise<Artifact>;
  listArtifacts(
    projectId: string,
    options?: { name?: string; pageSize?: number; pageToken?: string }
  ): Promise<ArtifactList>;
  getArtifact(
    projectId: string,
    artifactId: string,
    options?: { inline?: boolean }
  ): Promise<ArtifactAccess>;
  createSchedule(request: CreateScheduleRequest): Promise<Schedule>;
  listSchedules(options?: { projectId?: string }): Promise<ScheduleList>;
  putSkill(
    name: string,
    request: PutSkillRequest,
    ifMatchVersion?: number
  ): Promise<PutSkillResult>;
  getUsage(options?: {
    projectId?: string;
    since?: string;
    until?: string;
    pageSize?: number;
    pageToken?: string;
  }): Promise<UsageSummary>;
  respondToApproval(
    projectId: string,
    approvalId: string,
    request: { decision: 'allow' | 'deny'; response_text?: string }
  ): Promise<void>;
}

let override: AgentEdge | null = null;

/** Inject a gateway (tests) or clear it (null → back to the live transport). */
export function configureAgentEdge(next: AgentEdge | null): void {
  override = next;
}

/**
 * The edge every agent module talks to. An injected gateway wins; otherwise a
 * live EdgeTransport is built from the same remote config the rest of the
 * desktop uses. A missing/failed config throws — an agent invocation must fail
 * visibly, never fall back to a local brain.
 */
export async function getAgentEdge(): Promise<AgentEdge> {
  if (override) return override;
  const config = await getAionRemoteConfig();
  if (!config) {
    throw new Error(
      'The lendmind agents require the aion backend; this desktop is in local mode.'
    );
  }
  if ('error' in config) throw new Error(config.error);
  return new EdgeTransport({
    baseUrl: config.edgeBaseUrl,
    apiKey: config.apiKey,
  });
}
