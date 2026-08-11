// Remote skills provider (SkillStore train, doc 10 §12 skills row): the
// second implementation behind the skillsStore surface. In remote mode the
// edge SkillStore is the single source of truth — the local ~/.eigent/skills
// scan never runs — and every mutation is a contract call (PUT / DELETE /
// status) whose result refreshes the catalog. The skillsStore methods branch
// once on the mode resolved here; this module owns the transport, the
// catalog cache, and the row ⇄ UI-type mapping.

import { supportsSkills } from '@/api/aion/v1/compat';
import {
  EdgeTransport,
  type PutSkillResult,
  type Skill as AionSkillRow,
} from '@/api/aion/v1/transport';
import { buildSkillMd, type SkillMeta } from '@/lib/skillToolkit';
import { getAionRemoteConfig } from './aionChatBridge';
import type { Skill } from './skillsStore';

/**
 * How the Skills surface should behave this renderer lifetime. `local` keeps
 * the legacy filesystem path byte-identical; `unsupported` is the visible
 * read-only "backend too old" state (a 1.x edge below the 1.4 skills floor);
 * `error` is remote mode that cannot serve skills (misconfiguration or an
 * unreachable edge) — shown, never silently degraded to local.
 */
export type AionSkillsMode =
  | { kind: 'local' }
  | { kind: 'remote' }
  | { kind: 'unsupported'; edgeApiVersion: string }
  | { kind: 'error'; message: string };

interface RemoteContext {
  mode: AionSkillsMode;
  transport: EdgeTransport | null;
}

// Mode is negotiated once per renderer lifetime (matching the chat bridge);
// a failed status fetch clears the cache so reopening the screen retries.
let contextPromise: Promise<RemoteContext> | null = null;

function getContext(): Promise<RemoteContext> {
  contextPromise ??= resolveContext();
  return contextPromise;
}

async function resolveContext(): Promise<RemoteContext> {
  try {
    const config = await getAionRemoteConfig();
    if (!config) {
      return { mode: { kind: 'local' }, transport: null };
    }
    if ('error' in config) {
      return {
        mode: { kind: 'error', message: config.error },
        transport: null,
      };
    }
    const transport = new EdgeTransport({
      baseUrl: config.edgeBaseUrl,
      apiKey: config.apiKey,
    });
    const status = await transport.getIntegrationStatus();
    if (!supportsSkills(status)) {
      return {
        mode: { kind: 'unsupported', edgeApiVersion: status.edge_api_version },
        transport: null,
      };
    }
    return { mode: { kind: 'remote' }, transport };
  } catch (error) {
    // A failed handshake is retryable: drop the cache so the next open of
    // the Skills surface renegotiates instead of pinning the error forever.
    contextPromise = null;
    const message = error instanceof Error ? error.message : String(error);
    return { mode: { kind: 'error', message }, transport: null };
  }
}

export async function getAionSkillsMode(): Promise<AionSkillsMode> {
  return (await getContext()).mode;
}

async function remoteTransport(): Promise<EdgeTransport> {
  const { mode, transport } = await getContext();
  if (!transport) {
    throw new Error(
      mode.kind === 'error'
        ? mode.message
        : 'The aion backend does not serve the skills surface.'
    );
  }
  return transport;
}

// Catalog promise-cache with explicit invalidation after every mutation, so
// concurrent opens share one fetch and a PUT/DELETE/status is always followed
// by a fresh list rather than a stale snapshot.
let catalogPromise: Promise<Skill[]> | null = null;

// Latest store version per skill name, harvested from list and put results —
// the If-Match value that makes a subsequent overwrite optimistic-concurrency
// safe instead of last-writer-wins.
const knownVersions = new Map<string, number>();

export function invalidateAionSkillCatalog(): void {
  catalogPromise = null;
}

export function listAionSkills(): Promise<Skill[]> {
  catalogPromise ??= (async () => {
    const transport = await remoteTransport();
    const catalog = await transport.listSkills();
    const rows = catalog.skills ?? [];
    knownVersions.clear();
    for (const row of rows) {
      knownVersions.set(row.name, row.version);
    }
    return rows
      .map(toUiSkill)
      .sort((a, b) => a.name.localeCompare(b.name));
  })().catch((error) => {
    catalogPromise = null;
    throw error;
  });
  return catalogPromise;
}

/** One stored row projected onto the UI type the Skills surfaces render. */
function toUiSkill(row: AionSkillRow): Skill {
  const name = row.name;
  const description = stringField(row.document, 'Description');
  const promptText = stringField(row.document, 'PromptText');
  const createdAt = Date.parse(String(row.created_at ?? ''));
  return {
    id: `aion-${name}`,
    name,
    description,
    filePath: `${name}/SKILL.md`,
    fileContent: buildSkillMd(name, description, promptText),
    skillDirName: name,
    addedAt: Number.isNaN(createdAt) ? 0 : createdAt,
    // Scope stays UI-global until the SK-D worker-scoping train writes
    // metadata tags; the store rows carry no scope yet.
    scope: { isGlobal: true, selectedAgents: [] },
    enabled: row.status === 'active',
    isExample: false,
  };
}

function stringField(document: Record<string, unknown>, key: string): string {
  const value = document[key];
  return typeof value === 'string' ? value : '';
}

/** A skill file for the document's Files list (base64 content, unix mode). */
export interface AionSkillFile {
  path: string;
  contentBase64: string;
}

/**
 * Stores one skill document. If-Match rides along whenever the current store
 * version is known (from the last list), so a concurrent edit surfaces as the
 * typed `skill_stale` problem instead of being silently overwritten.
 */
export async function putAionSkill(
  meta: SkillMeta,
  files: AionSkillFile[] = [],
  extras: Record<string, string> = {}
): Promise<PutSkillResult> {
  const transport = await remoteTransport();
  // Extra frontmatter keys ride along verbatim (the contract accepts
  // snake_case input keys); canonical fields always win, and the store names
  // inert extras back in ignored_fields.
  const document: Record<string, unknown> = {
    ...extras,
    Name: meta.name,
    Description: meta.description,
    PromptText: meta.body,
  };
  if (files.length > 0) {
    document.Files = files.map((file) => ({
      Path: file.path,
      Content: file.contentBase64,
      Mode: 0o644,
    }));
  }
  const result = await transport.putSkill(
    meta.name,
    { document, origin: 'desktop_ui' },
    knownVersions.get(meta.name)
  );
  knownVersions.set(meta.name, result.skill.version);
  invalidateAionSkillCatalog();
  return result;
}

export async function deleteAionSkill(name: string): Promise<void> {
  const transport = await remoteTransport();
  await transport.deleteSkill(name);
  knownVersions.delete(name);
  invalidateAionSkillCatalog();
}

export async function setAionSkillEnabled(
  name: string,
  enabled: boolean
): Promise<void> {
  const transport = await remoteTransport();
  const skill = await transport.setSkillStatus(name, {
    status: enabled ? 'active' : 'disabled',
  });
  knownVersions.set(name, skill.version);
  invalidateAionSkillCatalog();
}

// The one-time sync-up (plan C5) offers the user's local skills to the remote
// store. The first remote list REPLACES the persisted local rows in the
// skills store — so the pre-sync snapshot taken here is the only surviving
// copy of the local skills' content for the consent dialog to offer.
// Names already present remotely are never candidates: after an app restart
// the persisted rows ARE the previous remote list, and offering those back
// as "local skills" would re-upload content the store already holds.
let syncUpCandidates: Skill[] | null = null;

export function captureAionSyncUpCandidates(
  skills: Skill[],
  remoteNames: ReadonlySet<string>
): void {
  syncUpCandidates ??= skills.filter(
    (skill) =>
      !skill.isExample &&
      skill.fileContent.trim() !== '' &&
      !remoteNames.has(skill.name)
  );
}

export function getAionSyncUpCandidates(): Skill[] {
  return syncUpCandidates ?? [];
}
