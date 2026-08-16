// The tenant's Spaces, read from the aion edge. A Space is a grouping and
// nothing else: filing a Project changes what a listing shows, never what a run
// does, so nothing here touches a session, a run or an event cursor.
//
// Every row carries the count the server measured inside the write that
// returned it. This store therefore never derives a count from the Projects it
// happens to be holding — another client may have filed one since — and a
// mutation replaces the row it edited rather than patching a number.

import { supportsSpaces } from '@/api/aion/v1/compat';
import {
  EdgeTransport,
  type Space,
  type SpaceList,
} from '@/api/aion/v1/transport';
import { getAionRemoteConfig } from './aionChatBridge';

/**
 * How the Spaces surface should behave this renderer lifetime. `local` is a
 * desktop with no aion backend; `unsupported` is a compatible edge below the
 * 1.14 floor — shown as such, because an empty list would claim the tenant has
 * organized nothing when in fact this desktop cannot see; `error` is remote
 * mode that cannot serve the listing.
 */
export type AionSpacesMode =
  | { kind: 'local' }
  | { kind: 'remote' }
  | { kind: 'unsupported'; edgeApiVersion: string }
  | { kind: 'error'; message: string };

/**
 * A Space's status. `unknown` is a real value a server may send: a status this
 * client predates renders as unrecognized rather than degrading to `active`,
 * which would draw a shelved Space as though it were in service.
 */
export type AionSpaceStatus = 'active' | 'archived' | 'unknown';

export interface AionSpace {
  spaceId: string;
  name: string;
  description?: string;
  status: AionSpaceStatus;
  /**
   * How many Projects are filed here, closed ones included — a Space whose work
   * is finished still holds it. Server-measured, never counted on this side.
   */
  projectCount: number;
  userId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AionSpacePage {
  spaces: AionSpace[];
  /** Absent on the last page. */
  nextPageToken?: string;
}

interface RemoteContext {
  mode: AionSpacesMode;
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
    if (!supportsSpaces(status)) {
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

export async function getAionSpacesMode(): Promise<AionSpacesMode> {
  return (await getContext()).mode;
}

async function remoteTransport(): Promise<EdgeTransport> {
  const { mode, transport } = await getContext();
  if (!transport) {
    throw new Error(
      mode.kind === 'error'
        ? mode.message
        : 'The aion backend does not serve spaces.'
    );
  }
  return transport;
}

// Only the FIRST page is cached: it is what a switcher draws, and it is the one
// read that happens on every open. Later pages are a deliberate scroll and are
// always fetched, so a caller paging forward never re-renders a stale head.
let firstPage: Promise<AionSpacePage> | null = null;

/** Drops the cached first page so the next load re-reads it. */
export function invalidateAionSpaces(): void {
  firstPage = null;
}

export function loadAionSpaces(pageToken?: string): Promise<AionSpacePage> {
  if (pageToken) return fetchPage(pageToken);
  firstPage ??= fetchPage(undefined).catch((error: unknown) => {
    firstPage = null;
    throw error;
  });
  return firstPage;
}

async function fetchPage(pageToken?: string): Promise<AionSpacePage> {
  const transport = await remoteTransport();
  return toPage(await transport.listSpaces({ pageToken }));
}

function toPage(list: SpaceList): AionSpacePage {
  return {
    spaces: (list.spaces ?? []).map(toSpace),
    nextPageToken: list.next_page_token,
  };
}

function toSpace(space: Space): AionSpace {
  return {
    spaceId: space.space_id,
    name: space.name,
    description: space.description,
    status: toStatus(space.status),
    projectCount: space.project_count,
    userId: space.user_id,
    createdAt: space.created_at,
    updatedAt: space.updated_at,
  };
}

function toStatus(status: string): AionSpaceStatus {
  return status === 'active' || status === 'archived' ? status : 'unknown';
}

/**
 * Creates a Space and returns it. The listing is invalidated rather than
 * prepended to: the server orders newest first and this side does not own that
 * order, so re-reading is what keeps a paged list and its cursor consistent.
 */
export async function createAionSpace(
  name: string,
  description?: string
): Promise<AionSpace> {
  const transport = await remoteTransport();
  const created = await transport.createSpace({ name, description });
  invalidateAionSpaces();
  return toSpace(created);
}

/**
 * Replaces name and description whole — omitting the description clears it —
 * and answers with the edited row including its count, so a caller renames
 * without a second read.
 */
export async function renameAionSpace(
  spaceId: string,
  name: string,
  description?: string
): Promise<AionSpace> {
  const transport = await remoteTransport();
  const updated = await transport.updateSpace(spaceId, { name, description });
  invalidateAionSpaces();
  return toSpace(updated);
}

/** Puts a Space away. What it holds stays filed under it and stays listable. */
export async function archiveAionSpace(spaceId: string): Promise<AionSpace> {
  const transport = await remoteTransport();
  const archived = await transport.archiveSpace(spaceId);
  invalidateAionSpaces();
  return toSpace(archived);
}

export async function unarchiveAionSpace(spaceId: string): Promise<AionSpace> {
  const transport = await remoteTransport();
  const restored = await transport.unarchiveSpace(spaceId);
  invalidateAionSpaces();
  return toSpace(restored);
}

/**
 * Removes an empty Space. One that still holds Projects is refused by the edge
 * with `space_in_use`, which surfaces as the thrown problem rather than being
 * pre-checked here: the count this side holds was true when it was read, and
 * only the server's refusal is true when the delete lands.
 */
export async function deleteAionSpace(spaceId: string): Promise<void> {
  const transport = await remoteTransport();
  await transport.deleteSpace(spaceId);
  invalidateAionSpaces();
}

/**
 * Files a Project under a Space, or unfiles it when `spaceId` is undefined.
 * Resolves to the Space id the Project now carries, which is absent when it is
 * filed nowhere — a state a caller renders differently from a Space named "".
 */
export async function fileProjectInAionSpace(
  projectId: string,
  spaceId?: string
): Promise<string | undefined> {
  const transport = await remoteTransport();
  const project = spaceId
    ? await transport.setProjectSpace(projectId, spaceId)
    : await transport.clearProjectSpace(projectId);
  // Both ends moved: the Space the Project left and the one it joined each hold
  // a different number now, and neither count came back with the Project.
  invalidateAionSpaces();
  return project.space_id;
}
