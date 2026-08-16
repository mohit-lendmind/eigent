// What a Project produced, read from the aion edge. The listing is metadata
// only: a download URL is a time-boxed grant against a default-deny bucket, so
// it is minted when someone opens a row rather than N at a time for a page
// nobody clicks. Rows are published artifacts — a half still being written is
// absent rather than listed as a download that 404s.

import { supportsArtifactList } from '@/api/aion/v1/compat';
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
      return { mode: { kind: 'local' }, transport: null };
    }
    if ('error' in config) {
      contextPromise = null;
      return { mode: { kind: 'error', message: config.error }, transport: null };
    }
    const transport = new EdgeTransport({
      baseUrl: config.edgeBaseUrl,
      apiKey: config.apiKey,
    });
    const status = await transport.getIntegrationStatus();
    if (!supportsArtifactList(status)) {
      return {
        mode: { kind: 'unsupported', edgeApiVersion: status.edge_api_version },
        transport: null,
      };
    }
    return { mode: { kind: 'remote' }, transport };
  } catch (error) {
    // A failed handshake is retryable: drop the cache so the next open
    // renegotiates instead of pinning the error forever.
    contextPromise = null;
    const message = error instanceof Error ? error.message : String(error);
    return { mode: { kind: 'error', message }, transport: null };
  }
}

export async function getAionArtifactsMode(): Promise<AionArtifactsMode> {
  return (await getContext()).mode;
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
