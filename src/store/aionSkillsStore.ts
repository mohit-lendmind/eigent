// Remote skills provider (doc 10 §12 skills row): the
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
import {
  buildSkillMd,
  parseSkillScopeTag,
  type SkillMeta,
} from '@/lib/skillToolkit';
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
// any error-mode resolution clears the cache so reopening the screen retries.
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
      // Error modes never pin: drop the cache so the next open of the
      // Skills surface renegotiates instead of holding the error forever.
      contextPromise = null;
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

// Latest stored document per skill name, harvested alongside the versions.
// A put starts from this echo so a partial update (a content edit, a scope
// change) never strips fields it did not touch — Files, activation rules,
// other Metadata annotations.
const knownDocuments = new Map<string, Record<string, unknown>>();

export function invalidateAionSkillCatalog(): void {
  catalogPromise = null;
}

export function listAionSkills(): Promise<Skill[]> {
  catalogPromise ??= (async () => {
    const transport = await remoteTransport();
    const catalog = await transport.listSkills();
    const rows = catalog.skills ?? [];
    knownVersions.clear();
    knownDocuments.clear();
    for (const row of rows) {
      knownVersions.set(row.name, row.version);
      knownDocuments.set(row.name, row.document ?? {});
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
    scope: parseSkillScopeTag(metadataField(row.document, 'scope')),
    enabled: row.status === 'active',
    isExample: false,
  };
}

function stringField(document: Record<string, unknown>, key: string): string {
  const value = document[key];
  return typeof value === 'string' ? value : '';
}

function metadataOf(
  document: Record<string, unknown> | undefined
): Record<string, string> {
  const metadata = document?.Metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

function metadataField(
  document: Record<string, unknown>,
  key: string
): string {
  return metadataOf(document)[key] ?? '';
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
  metadata: Record<string, string> = {}
): Promise<PutSkillResult> {
  const transport = await remoteTransport();
  // The document starts from the last-seen stored echo so a partial update
  // never strips fields it did not touch. String annotations (entrypoint,
  // scope, extra frontmatter keys) ride the Metadata map — the store's strict
  // decoder rejects unknown TOP-LEVEL keys, so they must never be spread onto
  // the document root. An empty value clears its annotation.
  const stored = knownDocuments.get(meta.name);
  const document: Record<string, unknown> = {
    ...(stored ?? {}),
    Name: meta.name,
    Description: meta.description,
    PromptText: meta.body,
  };
  const mergedMetadata = { ...metadataOf(stored), ...metadata };
  for (const [key, value] of Object.entries(mergedMetadata)) {
    if (value.trim() === '') delete mergedMetadata[key];
  }
  if (Object.keys(mergedMetadata).length > 0) {
    document.Metadata = mergedMetadata;
  } else {
    delete document.Metadata;
  }
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
  knownDocuments.set(meta.name, result.skill.document ?? document);
  invalidateAionSkillCatalog();
  return result;
}

export async function deleteAionSkill(name: string): Promise<void> {
  const transport = await remoteTransport();
  await transport.deleteSkill(name);
  knownVersions.delete(name);
  knownDocuments.delete(name);
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
  if (skill.document) {
    knownDocuments.set(name, skill.document);
  }
  invalidateAionSkillCatalog();
}

// The one-time sync-up offers the user's local skills to the remote
// store. The first remote list REPLACES the persisted local rows in the
// skills store — so the pre-sync snapshot taken here is the only surviving
// copy of the local skills' content for the consent dialog to offer. The
// snapshot is persisted alongside the capture: a restart between the replace
// and the user's answer must not destroy that only copy.
// Names already present remotely are never candidates: after an app restart
// the persisted rows ARE the previous remote list, and offering those back
// as "local skills" would re-upload content the store already holds.
const SYNC_UP_SNAPSHOT_KEY = 'aion-skills-sync-up-snapshot';

let syncUpCandidates: Skill[] | null = null;

function readSyncUpSnapshot(): Skill[] | null {
  try {
    const raw = localStorage.getItem(SYNC_UP_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Skill[]) : null;
  } catch {
    return null;
  }
}

export function captureAionSyncUpCandidates(
  skills: Skill[],
  remoteNames: ReadonlySet<string>
): void {
  if (syncUpCandidates) return;
  // Re-filtering a restored snapshot by the current remote names drops
  // whatever a partially-completed earlier offer already uploaded.
  const restored = readSyncUpSnapshot()?.filter(
    (skill) => !remoteNames.has(skill.name)
  );
  syncUpCandidates =
    restored ??
    skills.filter(
      (skill) =>
        !skill.isExample &&
        skill.fileContent.trim() !== '' &&
        !remoteNames.has(skill.name)
    );
  if (syncUpCandidates.length > 0) {
    try {
      localStorage.setItem(
        SYNC_UP_SNAPSHOT_KEY,
        JSON.stringify(syncUpCandidates)
      );
    } catch {
      // Quota/serialization failure degrades to the in-memory copy — the
      // pre-snapshot behavior, no worse.
    }
  }
}

export function getAionSyncUpCandidates(): Skill[] {
  return syncUpCandidates ?? [];
}

/** The sync-up offer was answered (or dismissed): the snapshot is spent. */
export function clearAionSyncUpSnapshot(): void {
  try {
    localStorage.removeItem(SYNC_UP_SNAPSHOT_KEY);
  } catch {
    // Removal is best-effort; a lingering snapshot is filtered by remote
    // names on the next capture and never re-offered past the marker.
  }
}
