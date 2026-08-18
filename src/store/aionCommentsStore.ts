// Anchored comments on published artifacts, read from the aion edge. A
// comment is durable Project truth — it replays with the trajectory — so this
// module is a thin read/write surface over the edge routes, with the same
// once-per-renderer mode negotiation the artifact store uses. `addressed` is
// earned by the run that republishes the commented name and is never written
// from here; the caller's whole vocabulary is open ↔ dismissed.

import { supportsArtifactComments } from '@/api/aion/v1/compat';
import {
  EdgeTransport,
  type ArtifactComment,
  type ArtifactCommentCreate,
} from '@/api/aion/v1/transport';
import { getAionRemoteConfig } from './aionChatBridge';

export type AionCommentsMode =
  | { kind: 'local' }
  | { kind: 'remote' }
  | { kind: 'unsupported'; edgeApiVersion: string }
  | { kind: 'error'; message: string };

export type AionCommentStatus = 'open' | 'addressed' | 'dismissed';

/**
 * One comment. `startOffset` is a decimal string on the wire because it is
 * 64-bit; parsed once, here. The resolved pair is optional on the contract —
 * absent means the comment never left `open`, never the epoch.
 */
export interface AionComment {
  commentId: string;
  projectId: string;
  artifactId: string;
  quotedText: string;
  prefixContext: string;
  suffixContext: string;
  startOffset: number;
  body: string;
  status: AionCommentStatus | string;
  createdAt: string;
  resolvedAt?: string;
  resolvedByRunId?: string;
}

interface RemoteContext {
  mode: AionCommentsMode;
  transport: EdgeTransport | null;
}

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
    if (!supportsArtifactComments(status)) {
      return {
        mode: { kind: 'unsupported', edgeApiVersion: status.edge_api_version },
        transport: null,
      };
    }
    return { mode: { kind: 'remote' }, transport };
  } catch (error) {
    // Retryable: drop the cache so the next open renegotiates instead of
    // pinning the error forever.
    contextPromise = null;
    const message = error instanceof Error ? error.message : String(error);
    return { mode: { kind: 'error', message }, transport: null };
  }
}

export async function getAionCommentsMode(): Promise<AionCommentsMode> {
  return (await getContext()).mode;
}

async function remoteTransport(): Promise<EdgeTransport> {
  const { mode, transport } = await getContext();
  if (!transport) {
    throw new Error(
      mode.kind === 'error'
        ? mode.message
        : 'The aion backend does not serve artifact comments.'
    );
  }
  return transport;
}

// A rail renders a whole conversation, so the read walks every page — bounded,
// because a runaway token chain must not spin the panel forever.
const MAX_COMMENT_PAGES = 8;

/**
 * Every comment on ONE artifact version, oldest first. Uncached: the reason
 * to read at all is that someone commented or a run settled, and the list is
 * small by construction (the edge caps a rail's practical size well below the
 * page bound).
 */
export async function loadAionComments(
  projectId: string,
  artifactId: string
): Promise<AionComment[]> {
  const transport = await remoteTransport();
  const rows: AionComment[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_COMMENT_PAGES; page++) {
    const list = await transport.listComments(projectId, artifactId, {
      pageToken,
    });
    for (const row of list.comments ?? []) rows.push(toComment(row));
    pageToken = list.next_page_token;
    if (!pageToken) break;
  }
  return rows;
}

/** Records one anchored comment against a published artifact version. */
export async function createAionComment(
  projectId: string,
  artifactId: string,
  input: {
    quotedText: string;
    prefixContext: string;
    suffixContext: string;
    startOffset: number;
    body: string;
  }
): Promise<AionComment> {
  const transport = await remoteTransport();
  const body: ArtifactCommentCreate = {
    body: input.body,
    ...(input.quotedText ? { quoted_text: input.quotedText } : {}),
    ...(input.prefixContext ? { prefix_context: input.prefixContext } : {}),
    ...(input.suffixContext ? { suffix_context: input.suffixContext } : {}),
    ...(input.startOffset > 0
      ? { start_offset: String(input.startOffset) }
      : {}),
  };
  const response = await transport.createComment(projectId, artifactId, body);
  return toComment(response.comment);
}

/**
 * Moves one comment between the two caller-settable states. Reopening a
 * dismissed or addressed comment puts it back in the next revision's scope;
 * `addressed` itself is never a valid argument here — the edge refuses it.
 */
export async function setAionCommentStatus(
  projectId: string,
  commentId: string,
  status: 'open' | 'dismissed'
): Promise<AionComment> {
  const transport = await remoteTransport();
  const response = await transport.updateComment(projectId, commentId, status);
  return toComment(response.comment);
}

function toComment(comment: ArtifactComment): AionComment {
  return {
    commentId: comment.comment_id,
    projectId: comment.project_id,
    artifactId: comment.artifact_id,
    quotedText: comment.quoted_text,
    prefixContext: comment.prefix_context ?? '',
    suffixContext: comment.suffix_context ?? '',
    startOffset: offsetOf(comment.start_offset),
    body: comment.body,
    status: comment.status,
    createdAt: comment.created_at,
    resolvedAt: comment.resolved_at,
    resolvedByRunId: comment.resolved_by_run_id,
  };
}

/** A 64-bit offset arrives as a decimal string; unparseable reads as 0. */
function offsetOf(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

// Listeners keyed by Project, matching the artifact store: every reason to
// wake a rail (a settlement, a dismissal from another surface, a replayed
// event) arrives as an `artifact_comment` Project event the bridge is already
// consuming, well before any listing would be re-read.
const commentListeners = new Map<string, Set<() => void>>();

/** Called when a Project's comments are known to have changed. */
export function noteAionCommentsChanged(projectId: string): void {
  for (const listener of commentListeners.get(projectId) ?? []) listener();
}

/** Watches one Project for comment changes. Returns an unsubscribe. */
export function subscribeAionComments(
  projectId: string,
  listener: () => void
): () => void {
  let listeners = commentListeners.get(projectId);
  if (!listeners) {
    listeners = new Set();
    commentListeners.set(projectId, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) commentListeners.delete(projectId);
  };
}
