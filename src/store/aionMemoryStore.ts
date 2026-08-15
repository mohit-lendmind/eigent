// What the agent remembers between sessions, read from the aion edge. The
// listing is a table of contents and deliberately carries no document text: a
// scope is bounded per document, so rendering an index must not cost the whole
// scope. Text arrives one document at a time, or from a search.
//
// The scope is a served name, not a free-form one. Every catalog the edge
// returns publishes the set it answers for, so this store keeps that set and
// only ever asks for a name it was given — a scope outside it is refused, and
// the refusal names which profiles a deployment runs.

import { supportsMemory } from '@/api/aion/v1/compat';
import {
  EdgeTransport,
  type MemoryCatalog,
  type MemoryDoc,
  type MemorySearchHit,
} from '@/api/aion/v1/transport';
import { getAionRemoteConfig } from './aionChatBridge';

/**
 * How the Memory surface should behave this renderer lifetime. `local` is a
 * desktop with no aion backend; `unsupported` is a compatible edge below the
 * 1.12 memory floor — shown as such, because an empty list would claim the
 * agent remembers nothing about you when in fact this desktop cannot see;
 * `error` is remote mode that cannot serve the catalog.
 */
export type AionMemoryMode =
  | { kind: 'local' }
  | { kind: 'remote' }
  | { kind: 'unsupported'; edgeApiVersion: string }
  | { kind: 'error'; message: string };

/**
 * One stored document. `content` is present only on a single-document read or a
 * search hit; on a listing row it is absent, which means "not returned here",
 * never "empty". The counters are decimal strings on the wire because they are
 * 64-bit; they are parsed once, here, so no screen re-derives them.
 */
export interface AionMemoryDoc {
  scope: string;
  key: string;
  bytes: number;
  content?: string;
  createdAt?: string;
  updatedAt?: string;
  updatedBySession?: string;
}

/** How full the scope is. Every figure is served, so none is optional. */
export interface AionMemoryUsage {
  docCount: number;
  totalBytes: number;
  capDocBytes: number;
  capDocsPerScope: number;
  capScopeBytes: number;
}

export interface AionMemoryCatalog {
  /** The scope these rows came from. */
  scope: string;
  /** Every scope this deployment serves, most-default first. */
  scopes: string[];
  docs: AionMemoryDoc[];
  usage: AionMemoryUsage;
}

/** What a scope-wide forget removed, together with the emptied catalog. */
export interface AionMemoryCleared {
  /**
   * How many documents the server removed. Reported rather than derived from
   * the listing this side already had: another writer may have added or removed
   * a document since it was read, so a subtraction here would be a guess.
   */
  deleted: number;
  catalog: AionMemoryCatalog;
}

export interface AionMemoryHit {
  doc: AionMemoryDoc;
  /** The server's relevance figure. Order the server returned is the ranking;
   *  scores are not comparable across queries, so never re-sort on this. */
  score: number;
}

interface RemoteContext {
  mode: AionMemoryMode;
  transport: EdgeTransport | null;
}

// Mode is negotiated once per renderer lifetime (matching the connectors,
// usage, projects and skills stores); any error-mode resolution clears the
// cache so reopening the surface retries.
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
    if (!supportsMemory(status)) {
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

export async function getAionMemoryMode(): Promise<AionMemoryMode> {
  return (await getContext()).mode;
}

async function remoteTransport(): Promise<EdgeTransport> {
  const { mode, transport } = await getContext();
  if (!transport) {
    throw new Error(
      mode.kind === 'error'
        ? mode.message
        : 'The aion backend does not serve memory.'
    );
  }
  return transport;
}

// Keyed by scope, because a user switching scopes and switching back should not
// re-read what is already in hand. Every mutation invalidates its own scope
// only: writing in one scope tells you nothing about another.
const catalogs = new Map<string, Promise<AionMemoryCatalog>>();

/** Drops one scope's cached listing, or every scope when none is named. */
export function invalidateAionMemory(scope?: string): void {
  if (scope === undefined) {
    catalogs.clear();
    return;
  }
  catalogs.delete(scope);
}

/**
 * The scope's index plus how full it is. Called with no scope for the
 * deployment's default — which is what a client that has never seen a catalog
 * has to do, since the served set only arrives with one.
 */
export function loadAionMemory(scope?: string): Promise<AionMemoryCatalog> {
  const cacheKey = scope ?? '';
  const cached = catalogs.get(cacheKey);
  if (cached) return cached;
  const pending = fetchCatalog(scope).catch((error: unknown) => {
    catalogs.delete(cacheKey);
    throw error;
  });
  catalogs.set(cacheKey, pending);
  return pending;
}

async function fetchCatalog(scope?: string): Promise<AionMemoryCatalog> {
  const transport = await remoteTransport();
  return toCatalog(await transport.listMemory({ scope }));
}

function toCatalog(catalog: MemoryCatalog): AionMemoryCatalog {
  return {
    scope: catalog.scope,
    scopes: catalog.scopes ?? [],
    docs: (catalog.docs ?? []).map(toDoc),
    usage: {
      docCount: count(catalog.usage.doc_count),
      totalBytes: count(catalog.usage.total_bytes),
      capDocBytes: count(catalog.usage.cap_doc_bytes),
      capDocsPerScope: count(catalog.usage.cap_docs_per_scope),
      capScopeBytes: count(catalog.usage.cap_scope_bytes),
    },
  };
}

function toDoc(doc: MemoryDoc): AionMemoryDoc {
  return {
    scope: doc.scope,
    key: doc.key,
    bytes: count(doc.bytes),
    content: doc.content,
    createdAt: doc.created_at,
    updatedAt: doc.updated_at,
    updatedBySession: doc.updated_by_session,
  };
}

function toHit(hit: MemorySearchHit): AionMemoryHit {
  return { doc: toDoc(hit.doc), score: hit.score };
}

/**
 * A 64-bit counter arrives as a decimal string. A value this side cannot parse
 * is reported as 0 rather than NaN: every reader of these figures is arithmetic
 * or a progress bar, and NaN would render as a broken layout instead of a
 * conservative number.
 */
function count(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** One document with its text. */
export async function readAionMemory(
  key: string,
  scope?: string
): Promise<AionMemoryDoc> {
  const transport = await remoteTransport();
  return toDoc(await transport.getMemory(key, { scope }));
}

/**
 * Ranked documents for a query, most relevant first and each with its content.
 * Deliberately uncached: a search is a question about right now, and serving a
 * stale answer for a query someone just typed is worse than asking again.
 */
export async function searchAionMemory(
  query: string,
  options: { scope?: string; k?: number } = {}
): Promise<AionMemoryHit[]> {
  const transport = await remoteTransport();
  const result = await transport.searchMemory(query, options);
  return (result.hits ?? []).map(toHit);
}

/**
 * Writes a document whole. Resolves to the refreshed catalog, because usage is
 * the reason to look after a write: the scope the user just added to is the one
 * that might now be full.
 */
export async function writeAionMemory(
  key: string,
  content: string,
  scope?: string
): Promise<AionMemoryCatalog> {
  const transport = await remoteTransport();
  await transport.putMemory(key, content, { scope });
  return refresh(scope);
}

/** Forgets one document. Idempotent server-side. */
export async function forgetAionMemory(
  key: string,
  scope?: string
): Promise<AionMemoryCatalog> {
  const transport = await remoteTransport();
  await transport.deleteMemory(key, { scope });
  return refresh(scope);
}

/** Forgets the whole scope. */
export async function clearAionMemory(
  scope?: string
): Promise<AionMemoryCleared> {
  const transport = await remoteTransport();
  const result = await transport.clearMemory({ scope });
  return { deleted: result.deleted, catalog: await refresh(scope) };
}

/**
 * Re-reads after a mutation, dropping every cached scope rather than the one
 * named. A caller may address the default scope either by its name or by
 * omitting it, and those cache under different keys — so clearing only the key
 * the caller used would leave the same listing, now stale, under the other.
 */
async function refresh(scope?: string): Promise<AionMemoryCatalog> {
  catalogs.clear();
  return loadAionMemory(scope);
}
