// What a Project produced, read from the aion edge. The listing is metadata
// only: a download URL is a time-boxed grant against a default-deny bucket, so
// it is minted when someone opens a row rather than N at a time for a page
// nobody clicks. Rows are published artifacts — a half still being written is
// absent rather than listed as a download that 404s.

import {
  supportsArtifactList,
  supportsArtifactViewer,
} from '@/api/aion/v1/compat';
import {
  EdgeTransport,
  type Artifact,
  type ArtifactList,
} from '@/api/aion/v1/transport';
import { getAionRemoteConfig } from './aionChatBridge';

/**
 * How the artifacts surface should behave this renderer lifetime. `local` is a
 * desktop with no aion backend; `unsupported` is a compatible edge below the
 * 1.13 listing floor — shown as such, because an empty list would claim the
 * Project produced nothing when in fact this desktop cannot enumerate;
 * `error` is remote mode that cannot serve the listing.
 */
export type AionArtifactsMode =
  | { kind: 'local' }
  | { kind: 'remote' }
  | { kind: 'unsupported'; edgeApiVersion: string }
  | { kind: 'error'; message: string };

/**
 * One published artifact. `sizeBytes` is a decimal string on the wire because
 * it is 64-bit; it is parsed once, here. `publishedAt` is optional on the
 * contract — absent means "not reported", never the epoch.
 */
export interface AionArtifact {
  artifactId: string;
  projectId: string;
  name: string;
  /** Which version of this name, counting from 1. Names repeat by design. */
  version: number;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  publishedAt?: string;
}

export interface AionArtifactPage {
  artifacts: AionArtifact[];
  /** Absent on the last page; the server read one row past to know. */
  nextPageToken?: string;
}

/** A minted read grant, and when it stops working. */
export interface AionArtifactGrant {
  artifact: AionArtifact;
  downloadUrl: string;
  expiresAt: string;
}

interface RemoteContext {
  mode: AionArtifactsMode;
  transport: EdgeTransport | null;
  /**
   * The 1.19 floor, negotiated in the same handshake. A listing works from
   * 1.13, so an edge between the two serves rows this desktop can enumerate
   * and cannot render — the viewer says so rather than drawing empty
   * documents.
   */
  viewerMode: AionArtifactsMode;
}

// Mode is negotiated once per renderer lifetime (matching the memory,
// connectors, usage, projects and skills stores); any error-mode resolution
// clears the cache so reopening the surface retries.
let contextPromise: Promise<RemoteContext> | null = null;

function getContext(): Promise<RemoteContext> {
  contextPromise ??= resolveContext();
  return contextPromise;
}

async function resolveContext(): Promise<RemoteContext> {
  try {
    const config = await getAionRemoteConfig();
    if (!config) {
      const local: AionArtifactsMode = { kind: 'local' };
      return { mode: local, transport: null, viewerMode: local };
    }
    if ('error' in config) {
      contextPromise = null;
      const failed: AionArtifactsMode = { kind: 'error', message: config.error };
      return { mode: failed, transport: null, viewerMode: failed };
    }
    const transport = new EdgeTransport({
      baseUrl: config.edgeBaseUrl,
      apiKey: config.apiKey,
    });
    const status = await transport.getIntegrationStatus();
    const belowFloor: AionArtifactsMode = {
      kind: 'unsupported',
      edgeApiVersion: status.edge_api_version,
    };
    if (!supportsArtifactList(status)) {
      return { mode: belowFloor, transport: null, viewerMode: belowFloor };
    }
    return {
      mode: { kind: 'remote' },
      transport,
      viewerMode: supportsArtifactViewer(status)
        ? { kind: 'remote' }
        : belowFloor,
    };
  } catch (error) {
    // A failed handshake is retryable: drop the cache so the next open
    // renegotiates instead of pinning the error forever.
    contextPromise = null;
    const message = error instanceof Error ? error.message : String(error);
    const failed: AionArtifactsMode = { kind: 'error', message };
    return { mode: failed, transport: null, viewerMode: failed };
  }
}

export async function getAionArtifactsMode(): Promise<AionArtifactsMode> {
  return (await getContext()).mode;
}

/**
 * How the artifact VIEWER should behave — the same negotiation against the
 * 1.19 floor, where the edge learned to serve bytes inline and to filter a
 * listing by name. Below it there is no document to render and no version
 * history to page through, so the surface reports unsupported rather than
 * showing a row whose content never arrives.
 */
export async function getAionArtifactViewerMode(): Promise<AionArtifactsMode> {
  return (await getContext()).viewerMode;
}

async function remoteTransport(): Promise<EdgeTransport> {
  const { mode, transport } = await getContext();
  if (!transport) {
    throw new Error(
      mode.kind === 'error'
        ? mode.message
        : 'The aion backend does not serve an artifact listing.'
    );
  }
  return transport;
}

// Only the FIRST page of each Project is cached. Later pages are addressed by a
// token the caller already holds, and caching them would have to be invalidated
// as a chain — while the reason to re-read at all is that the head moved.
const firstPages = new Map<string, Promise<AionArtifactPage>>();

/** Drops one Project's cached first page, or every Project when none is named. */
export function invalidateAionArtifacts(projectId?: string): void {
  if (projectId === undefined) {
    firstPages.clear();
    return;
  }
  firstPages.delete(projectId);
}

/**
 * One page of a Project's published artifacts, newest first. Called without a
 * token for the head of the list, which is the page worth caching: a Project
 * someone reopens has the same artifacts unless it produced new ones, and those
 * arrive at the head.
 */
export function loadAionArtifacts(
  projectId: string,
  pageToken?: string
): Promise<AionArtifactPage> {
  if (pageToken) return fetchPage(projectId, pageToken);
  const cached = firstPages.get(projectId);
  if (cached) return cached;
  const pending = fetchPage(projectId).catch((error: unknown) => {
    firstPages.delete(projectId);
    throw error;
  });
  firstPages.set(projectId, pending);
  return pending;
}

async function fetchPage(
  projectId: string,
  pageToken?: string
): Promise<AionArtifactPage> {
  const transport = await remoteTransport();
  return toPage(await transport.listArtifacts(projectId, { pageToken }));
}

function toPage(list: ArtifactList): AionArtifactPage {
  return {
    artifacts: (list.artifacts ?? []).map(toArtifact),
    nextPageToken: list.next_page_token,
  };
}

function toArtifact(artifact: Artifact): AionArtifact {
  return {
    artifactId: artifact.artifact_id,
    projectId: artifact.project_id,
    name: artifact.name,
    version: artifact.version,
    mediaType: artifact.media_type,
    sizeBytes: byteCount(artifact.size_bytes),
    sha256: artifact.sha256,
    createdAt: artifact.created_at,
    publishedAt: artifact.published_at,
  };
}

/**
 * A 64-bit byte count arrives as a decimal string. A value this side cannot
 * parse is reported as 0 rather than NaN: every reader is arithmetic or a size
 * label, and NaN would render as a broken row instead of a conservative one.
 */
function byteCount(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Mints the read grant for one artifact. Deliberately uncached: the URL carries
 * its own expiry, and handing back a grant whose clock has run out would fail
 * at the moment of download instead of at the moment of asking.
 */
export async function grantAionArtifact(
  projectId: string,
  artifactId: string
): Promise<AionArtifactGrant> {
  const transport = await remoteTransport();
  const access = await transport.getArtifact(projectId, artifactId);
  return {
    artifact: toArtifact(access.artifact),
    downloadUrl: access.download_url,
    expiresAt: access.expires_at,
  };
}

/**
 * One artifact's bytes, alongside the download grant that is the only way to
 * read the ones this pane cannot render. `content` absent with `truncated`
 * set means the edge refused to inline it — too large, or not text — never
 * that it sent a prefix.
 */
export interface AionArtifactContent {
  artifact: AionArtifact;
  downloadUrl: string;
  expiresAt: string;
  content?: string;
  truncated: boolean;
}

/**
 * Reads an artifact for display: metadata, a download grant, and the bytes
 * when the edge will serve them inline. Deliberately uncached alongside
 * grantAionArtifact — the grant inside it expires, and an artifact is read
 * when someone opens it rather than repeatedly.
 */
export async function readAionArtifact(
  projectId: string,
  artifactId: string
): Promise<AionArtifactContent> {
  const transport = await remoteTransport();
  const access = await transport.getArtifact(projectId, artifactId, {
    inline: true,
  });
  return {
    artifact: toArtifact(access.artifact),
    downloadUrl: access.download_url,
    expiresAt: access.expires_at,
    content: access.content,
    truncated: access.content_truncated === true,
  };
}

/**
 * Every published version of one name, newest first. Uncached because this is
 * the read whose whole point is that a name grew a version: caching it would
 * serve the history a viewer opened with rather than the one it has.
 *
 * A name repeats within a Project by design, and nothing records that v2
 * supersedes v1 — the shared name is the only link — so ordering by version
 * is what makes the sequence a history.
 */
export async function loadAionArtifactVersions(
  projectId: string,
  name: string
): Promise<AionArtifact[]> {
  const transport = await remoteTransport();
  const page = toPage(await transport.listArtifacts(projectId, { name }));
  return [...page.artifacts].sort((a, b) => b.version - a.version);
}

// Listeners are keyed by Project so a session panel watching one Project is
// not woken by another's runs. Invalidation and notification are one call:
// every reason to tell a listener is also a reason the cached page is stale.
const artifactListeners = new Map<string, Set<() => void>>();

/**
 * Called when a Project is known to have published something — the desktop
 * learns this from the artifact_created events it is already consuming, well
 * before any listing would be re-read. Drops the cached page and wakes every
 * watcher of that Project.
 */
export function noteAionArtifactsChanged(projectId: string): void {
  invalidateAionArtifacts(projectId);
  for (const listener of artifactListeners.get(projectId) ?? []) listener();
}

/** Watches one Project for published artifacts. Returns an unsubscribe. */
export function subscribeAionArtifacts(
  projectId: string,
  listener: () => void
): () => void {
  let listeners = artifactListeners.get(projectId);
  if (!listeners) {
    listeners = new Set();
    artifactListeners.set(projectId, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) artifactListeners.delete(projectId);
  };
}
