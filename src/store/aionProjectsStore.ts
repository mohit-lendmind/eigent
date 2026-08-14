// The tenant's Projects, read from the aion edge instead of the legacy hosted
// cloud. The edge is the source of truth here: a Project exists because the ops
// plane recorded it, so the list survives a reinstall, a second machine, and a
// renderer restart. This module owns the transport, the page walk, and the
// row ⇄ UI-type mapping; the surface reads the mode union and never guesses.

import { supportsProjectList } from '@/api/aion/v1/compat';
import { EdgeTransport, type ProjectSnapshot } from '@/api/aion/v1/transport';
import { getAionRemoteConfig } from './aionChatBridge';

/**
 * How the Projects surface should behave this renderer lifetime. `local` keeps
 * the legacy hosted-cloud path byte-identical; `unsupported` is a compatible
 * edge below the 1.6 project-list floor, shown as such because "you have no
 * projects" and "this backend cannot list your projects" are opposite facts;
 * `error` is remote mode that cannot serve the list — shown, never silently
 * degraded to the legacy path.
 */
export type AionProjectsMode =
  | { kind: 'local' }
  | { kind: 'remote' }
  | { kind: 'unsupported'; edgeApiVersion: string }
  | { kind: 'error'; message: string };

/** One list row as the Projects surface renders it. */
export interface AionProject {
  projectId: string;
  title: string;
  modelAlias: string;
  /** 'active' | 'closed' — the contract's Project status, open set. */
  status: string;
  createdAt: number;
  updatedAt: number;
  /** The run in flight, absent when the Project has nothing running. */
  activeRun?: { runId: string; runEpoch: string; status: string };
  /** Last event sequence, the cursor a resumed subscription starts from. */
  lastSequence: string;
}

export interface AionProjectPage {
  projects: AionProject[];
  /** Absent on the last page; pass it back to load the next one. */
  nextPageToken?: string;
}

interface RemoteContext {
  mode: AionProjectsMode;
  transport: EdgeTransport | null;
}

// Mode is negotiated once per renderer lifetime (matching the chat bridge and
// the skills store); any error-mode resolution clears the cache so reopening
// the surface retries.
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
    if (!supportsProjectList(status)) {
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

export async function getAionProjectsMode(): Promise<AionProjectsMode> {
  return (await getContext()).mode;
}

async function remoteTransport(): Promise<EdgeTransport> {
  const { mode, transport } = await getContext();
  if (!transport) {
    throw new Error(
      mode.kind === 'error'
        ? mode.message
        : 'The aion backend does not serve the project list.'
    );
  }
  return transport;
}

// First-page promise-cache with explicit invalidation, so concurrent opens
// share one fetch. Later pages are never cached: they are only ever fetched in
// response to the user asking for more.
let firstPagePromise: Promise<AionProjectPage> | null = null;

export function invalidateAionProjects(): void {
  firstPagePromise = null;
}

/**
 * The newest page of Projects. Called without a token it serves (and caches)
 * the first page; with a token from a prior page it walks forward. A token is
 * only ever present when the edge said there are entries behind it, so a "load
 * more" never lands on an empty page.
 */
export function listAionProjects(
  options: { pageToken?: string; pageSize?: number } = {}
): Promise<AionProjectPage> {
  if (options.pageToken) {
    return fetchPage(options);
  }
  firstPagePromise ??= fetchPage(options).catch((error) => {
    firstPagePromise = null;
    throw error;
  });
  return firstPagePromise;
}

async function fetchPage(options: {
  pageToken?: string;
  pageSize?: number;
}): Promise<AionProjectPage> {
  const transport = await remoteTransport();
  const page = await transport.listProjects({
    pageToken: options.pageToken,
    pageSize: options.pageSize,
  });
  return {
    projects: (page.projects ?? []).map(toUiProject),
    ...(page.next_page_token ? { nextPageToken: page.next_page_token } : {}),
  };
}

/** One snapshot projected onto the UI type the Projects surface renders. */
function toUiProject(snapshot: ProjectSnapshot): AionProject {
  const project = snapshot.project;
  const run = snapshot.active_run;
  return {
    projectId: project.project_id,
    title: project.title,
    modelAlias: project.model_alias,
    status: project.status,
    createdAt: epochMillis(project.created_at),
    updatedAt: epochMillis(project.updated_at),
    // Absent stays absent: no active_run means nothing is in flight, which is
    // a different fact from a run whose status this build does not know.
    ...(run
      ? {
          activeRun: {
            runId: run.run_id,
            runEpoch: run.run_epoch,
            status: run.status,
          },
        }
      : {}),
    lastSequence: snapshot.last_sequence,
  };
}

function epochMillis(timestamp: string | undefined): number {
  const parsed = Date.parse(String(timestamp ?? ''));
  return Number.isNaN(parsed) ? 0 : parsed;
}
