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

// An in-memory stand-in for the aion edge, exposing exactly the AgentEdge
// surface. It models the behaviour the M2 code depends on: uploadAttachment
// mints the NEXT version of a name (append-only, CAS-ish), listArtifacts pages
// every version newest-first, and inline getArtifact returns the stored bytes as
// text. Enough for the plumbing tests to round-trip artifacts and commands
// without a network.

import type {
  Artifact,
  ArtifactAccess,
  ArtifactList,
  AttachmentUpload,
  CommandReceipt,
  CreateProjectRequest,
  CreateScheduleRequest,
  Project,
  PutSkillRequest,
  PutSkillResult,
  Schedule,
  ScheduleList,
  SubmitCommandRequest,
  UsageSummary,
} from '@/api/aion/v1/transport';
import type { AgentEdge } from '@/crm/agents/edge';

interface StoredArtifact extends Artifact {
  contentText: string;
}

export interface SubmittedCommand {
  projectId: string;
  request: SubmitCommandRequest;
}

export interface PutSkillCall {
  name: string;
  request: PutSkillRequest;
}

function decodeBase64Utf8(data: string): string {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export class FakeEdge implements AgentEdge {
  readonly projects = new Map<string, StoredArtifact[]>();
  readonly commands: SubmittedCommand[] = [];
  readonly skills: PutSkillCall[] = [];
  readonly schedules: Schedule[] = [];
  readonly approvals: {
    projectId: string;
    approvalId: string;
    decision: string;
  }[] = [];

  private projectSeq = 0;
  private artifactSeq = 0;
  private commandSeq = 0;
  private runSeq = 0;
  private scheduleSeq = 0;

  /** Create a project with a caller-chosen id (so a test can seed known ids). */
  seedProject(projectId: string): void {
    if (!this.projects.has(projectId)) this.projects.set(projectId, []);
  }

  createProject(_request: CreateProjectRequest): Promise<Project> {
    const projectId = `proj_${(this.projectSeq += 1)}`;
    this.projects.set(projectId, []);
    return Promise.resolve({
      project_id: projectId,
      title: _request.title,
      model_alias: _request.model_alias,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as Project);
  }

  uploadAttachment(
    projectId: string,
    upload: AttachmentUpload
  ): Promise<Artifact> {
    this.seedProject(projectId);
    const list = this.projects.get(projectId)!;
    const priorVersions = list.filter((a) => a.name === upload.name).length;
    const contentText = decodeBase64Utf8(upload.data_base64);
    const artifact: StoredArtifact = {
      artifact_id: `art_${(this.artifactSeq += 1)}`,
      project_id: projectId,
      name: upload.name,
      version: priorVersions + 1,
      media_type: upload.media_type,
      size_bytes: String(contentText.length),
      sha256: `sha_${upload.name}_${priorVersions + 1}`,
      created_at: new Date().toISOString(),
      contentText,
    };
    list.push(artifact);
    return Promise.resolve(stripContent(artifact));
  }

  listArtifacts(
    projectId: string,
    options: { name?: string; pageSize?: number; pageToken?: string } = {}
  ): Promise<ArtifactList> {
    const list = this.projects.get(projectId) ?? [];
    const filtered = options.name
      ? list.filter((a) => a.name === options.name)
      : list;
    // Newest first, as the real listing serves.
    const artifacts = [...filtered].reverse().map(stripContent);
    return Promise.resolve({ artifacts });
  }

  getArtifact(
    projectId: string,
    artifactId: string,
    options: { inline?: boolean } = {}
  ): Promise<ArtifactAccess> {
    const list = this.projects.get(projectId) ?? [];
    const found = list.find((a) => a.artifact_id === artifactId);
    if (!found) {
      return Promise.reject(new Error(`no artifact ${artifactId}`));
    }
    const access: ArtifactAccess = {
      artifact: stripContent(found),
      download_url: `https://example.invalid/${artifactId}`,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
    if (options.inline) {
      access.content = found.contentText;
      access.content_truncated = false;
    }
    return Promise.resolve(access);
  }

  submitCommand(
    projectId: string,
    request: SubmitCommandRequest
  ): Promise<CommandReceipt> {
    this.commands.push({ projectId, request });
    const receipt: CommandReceipt = {
      command_id: request.command_id,
      run_id: `run_${(this.runSeq += 1)}`,
      run_epoch: '1',
      accepted_sequence: String((this.commandSeq += 1)),
    };
    return Promise.resolve(receipt);
  }

  putSkill(name: string, request: PutSkillRequest): Promise<PutSkillResult> {
    this.skills.push({ name, request });
    return Promise.resolve({
      skill: {
        name,
        version: 1,
        status: 'active',
        activation: 'manual',
        document: request.document,
        content_hash: `hash_${name}`,
      },
      changed: true,
      ignored_fields: [],
    } as PutSkillResult);
  }

  createSchedule(request: CreateScheduleRequest): Promise<Schedule> {
    const schedule = {
      schedule_id: `sch_${(this.scheduleSeq += 1)}`,
      project_id: request.project_id,
      cron: request.cron,
      task: request.task,
      single_shot: request.single_shot ?? false,
      status: 'active',
      attempts: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as Schedule;
    this.schedules.push(schedule);
    return Promise.resolve(schedule);
  }

  listSchedules(_options: { projectId?: string } = {}): Promise<ScheduleList> {
    return Promise.resolve({ schedules: [...this.schedules] });
  }

  getUsage(): Promise<UsageSummary> {
    return Promise.resolve({
      totals: {
        cost_micro_usd: '0',
        provider_calls: 0,
        runs_settled: 0,
        runs_unrecorded: 0,
        runs_without_tokens: 0,
      },
      runs: [],
    } as unknown as UsageSummary);
  }

  respondToApproval(
    projectId: string,
    approvalId: string,
    request: { decision: 'allow' | 'deny'; response_text?: string }
  ): Promise<void> {
    this.approvals.push({ projectId, approvalId, decision: request.decision });
    return Promise.resolve();
  }
}

function stripContent(artifact: StoredArtifact): Artifact {
  const { contentText: _drop, ...rest } = artifact;
  return rest;
}
