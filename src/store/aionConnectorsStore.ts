// The tenant's connector catalog and the caller's own grants, read from the
// aion edge. Two wire fields carry facts this surface must keep apart:
// `connected` is whether the caller holds a grant, `connectable` is whether a
// grant can be obtained here at all. A server with no connector vault serves
// the same catalog with every oauth row `connectable: false` — offering a
// Connect button there would fail every time for a reason the user cannot fix.
//
// Grants live in the cell, not here. Connect hands back a consent URL for the
// caller to open and the flow completes on the cell's own callback listener, so
// the only way to learn the outcome is to re-read the catalog.

import { supportsConnectors } from '@/api/aion/v1/compat';
import { EdgeTransport, type Connector } from '@/api/aion/v1/transport';
import { useEffect, useState } from 'react';
import { getAionRemoteConfig } from './aionChatBridge';

/**
 * How the Connections surface should behave this renderer lifetime. `local` is
 * a desktop with no aion backend; `unsupported` is a compatible edge below the
 * 1.9 connectors floor, shown as such because an empty list would claim this
 * tenant has no integrations; `error` is remote mode that cannot serve the
 * catalog — shown, never degraded to an empty list.
 */
export type AionConnectorsMode =
  | { kind: 'local' }
  | { kind: 'remote' }
  | { kind: 'unsupported'; edgeApiVersion: string }
  | { kind: 'error'; message: string };

export interface AionConnector {
  connectorId: string;
  displayName: string;
  /** `oauth` | `static_env` | `none` — an open set; treat unknown as not oauth. */
  authKind: string;
  /** Catalog state; this route serves `active` rows only today. */
  status: string;
  connected: boolean;
  connectable: boolean;
}

/**
 * What a row should offer. `unavailable` is the case worth naming: the
 * connector is in the catalog and is an oauth connector, but this server has no
 * vault to hold a grant — which is an operator fact, not a user action.
 * `provisioned` covers the kinds that need no per-user grant at all, so they
 * are usable but have nothing to disconnect.
 */
export type AionConnectorState =
  | { kind: 'connected' }
  | { kind: 'disconnected' }
  | { kind: 'unavailable' }
  | { kind: 'provisioned' };

export function connectorState(connector: AionConnector): AionConnectorState {
  if (connector.authKind !== 'oauth') {
    return { kind: 'provisioned' };
  }
  if (connector.connected) {
    return { kind: 'connected' };
  }
  return connector.connectable ? { kind: 'disconnected' } : { kind: 'unavailable' };
}

interface RemoteContext {
  mode: AionConnectorsMode;
  transport: EdgeTransport | null;
}

// Mode is negotiated once per renderer lifetime (matching the usage, projects
// and skills stores); any error-mode resolution clears the cache so reopening
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
      return { mode: { kind: 'error', message: config.error }, transport: null };
    }
    const transport = new EdgeTransport({
      baseUrl: config.edgeBaseUrl,
      apiKey: config.apiKey,
    });
    const status = await transport.getIntegrationStatus();
    if (!supportsConnectors(status)) {
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

export async function getAionConnectorsMode(): Promise<AionConnectorsMode> {
  return (await getContext()).mode;
}

async function remoteTransport(): Promise<EdgeTransport> {
  const { mode, transport } = await getContext();
  if (!transport) {
    throw new Error(
      mode.kind === 'error'
        ? mode.message
        : 'The aion backend does not serve connectors.'
    );
  }
  return transport;
}

// Promise-cache with explicit invalidation, so concurrent opens share one
// fetch. Every mutation below invalidates it: the catalog is the only place a
// grant's existence is observable.
let catalogPromise: Promise<AionConnector[]> | null = null;

export function invalidateAionConnectors(): void {
  catalogPromise = null;
}

export function loadAionConnectors(): Promise<AionConnector[]> {
  catalogPromise ??= fetchCatalog().catch((error) => {
    catalogPromise = null;
    throw error;
  });
  return catalogPromise;
}

async function fetchCatalog(): Promise<AionConnector[]> {
  const transport = await remoteTransport();
  const catalog = await transport.listConnectors();
  return (catalog.connectors ?? []).map(toConnector);
}

function toConnector(connector: Connector): AionConnector {
  return {
    connectorId: connector.connector_id,
    displayName: connector.display_name,
    authKind: connector.auth_kind,
    status: connector.status,
    connected: connector.connected === true,
    connectable: connector.connectable === true,
  };
}

/**
 * Starts a brokered OAuth flow and returns the consent URL to open. The grant
 * does not exist when this resolves — it lands on the cell's callback listener
 * — so a caller opens the URL and then re-reads the catalog to learn whether it
 * completed. The catalog cache is dropped here so that re-read cannot be
 * answered from a snapshot taken before the flow.
 */
export async function connectAionConnector(
  connectorId: string
): Promise<string> {
  const transport = await remoteTransport();
  const authorization = await transport.initiateConnectorAuth(connectorId);
  invalidateAionConnectors();
  return authorization.authorization_url;
}

/**
 * Revokes the caller's grant. Soft revoke server-side: the row stays in the
 * catalog and can be connected again, which is why this resolves to the
 * refreshed catalog rather than removing anything.
 */
export async function disconnectAionConnector(
  connectorId: string
): Promise<AionConnector[]> {
  const transport = await remoteTransport();
  await transport.disconnectConnector(connectorId);
  invalidateAionConnectors();
  return loadAionConnectors();
}

/**
 * Display names of the connectors this caller has actually granted. Used to
 * recognise a connector's tools by name when they appear in a trajectory —
 * a read-only view of the catalog, so a failure resolves to no names rather
 * than an error the caller has nothing to do with.
 */
export function useAionConnectorNames(): string[] {
  const [names, setNames] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadAionConnectors()
      .then((catalog) => {
        if (cancelled) return;
        setNames(
          catalog.filter((c) => c.connected).map((c) => c.displayName)
        );
      })
      .catch(() => {
        if (!cancelled) setNames([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return names;
}
