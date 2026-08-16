/**
 * Joins the renderer's own Space record to the Space the aion edge owns.
 *
 * The desktop mints a Space locally so the switcher opens one the instant it is
 * clicked, and aion is where a Space actually lives — the Projects filed under
 * it, its counts, and its survival past this renderer and this machine.
 * `Space.aionSpaceId` is the join between the two, and it is written here and
 * nowhere else.
 *
 * Two rules shape everything below.
 *
 * A Space binds on first use, not on create. The switcher mints a placeholder
 * on every click and prunes the ones that are walked away from, so binding at
 * the click would mint an edge Space per abandoned click and then drop the
 * local record that pointed at it. Binding on the first rename or the first
 * filed Project means an abandoned Space was never anywhere but this renderer.
 *
 * Removal is the one direction that does not write through optimistically.
 * Creates, renames and filings are best effort and none of them is on the
 * critical path — a Space still opens, still renames and still runs when the
 * edge refuses. A delete is the opposite: the edge refuses to remove a Space
 * that still holds Projects, and a local record that vanished on a refused
 * delete would report work as gone while the server still holds it. So the
 * edge goes first and the local record follows only on success.
 */

import {
  createAionSpace,
  deleteAionSpace,
  fileProjectInAionSpace,
  getAionSpacesMode,
  loadAionSpaces,
  renameAionSpace,
  type AionSpace,
} from './aionSpacesStore';
import { SPACE_SCHEMA_VERSION, useSpaceStore, type Space } from './spaceStore';

/**
 * Creates in flight, keyed by local Space id. A reader awaits the entry rather
 * than the store, because the store holds nothing until the create returns, and
 * a second caller joins the entry rather than starting a create of its own.
 */
const pendingBinds = new Map<string, Promise<void>>();

/** A page walk is bounded so a server cursor that never terminates cannot spin. */
const maxHydrationPages = 20;

async function spacesAreAionBacked(): Promise<boolean> {
  return (await getAionSpacesMode()).kind === 'remote';
}

/**
 * The legacy Space is the one local record with no aion counterpart by
 * construction — only the hosted cloud could mint one, and it is read-only.
 * Binding it would put a Space on the edge that nothing can ever file into.
 */
function isBindable(space: Space | undefined): space is Space {
  return Boolean(
    space && space.sourceType !== 'legacy' && space.metadata?.legacy !== true
  );
}

/**
 * Mints the aion Space behind a local one and records the binding, joining an
 * in-flight create rather than starting a second one.
 */
function bindSpaceToAion(localSpaceId: string, name: string): Promise<void> {
  const existing = pendingBinds.get(localSpaceId);
  if (existing) return existing;

  const bind = (async () => {
    if (!(await spacesAreAionBacked())) return;
    if (!isBindable(useSpaceStore.getState().spaces[localSpaceId])) return;
    const created = await createAionSpace(name);
    if (!useSpaceStore.getState().spaces[localSpaceId]) {
      // The local Space was deleted while its create was in flight. Nothing
      // will ever point at what just came back, so remove it rather than
      // leaving a Space on the edge that this desktop cannot name.
      await deleteAionSpace(created.spaceId).catch((error: unknown) => {
        console.warn('[spaces] Failed to drop an orphaned aion Space:', error);
      });
      return;
    }
    useSpaceStore
      .getState()
      .updateSpace(localSpaceId, { aionSpaceId: created.spaceId });
  })()
    .catch((error: unknown) => {
      console.warn('[spaces] Failed to create the Space on aion:', error);
    })
    .finally(() => {
      // Entries are per create, not per Space: leaving them would grow the map
      // for the lifetime of the renderer, and a settled entry answers nothing
      // the store cannot answer.
      if (pendingBinds.get(localSpaceId) === bind) {
        pendingBinds.delete(localSpaceId);
      }
    });

  pendingBinds.set(localSpaceId, bind);
  return bind;
}

/** The aion Space id behind a local one, once any in-flight create has settled. */
export async function aionSpaceIdFor(
  localSpaceId?: string | null
): Promise<string | undefined> {
  if (!localSpaceId) return undefined;
  await pendingBinds.get(localSpaceId);
  return useSpaceStore.getState().spaces[localSpaceId]?.aionSpaceId;
}

/**
 * The aion Space id behind a local one, minting it if this is the first time
 * the Space has needed to exist anywhere but here.
 */
export async function ensureAionSpaceId(
  localSpaceId?: string | null
): Promise<string | undefined> {
  if (!localSpaceId) return undefined;
  const bound = await aionSpaceIdFor(localSpaceId);
  if (bound) return bound;
  const space = useSpaceStore.getState().spaces[localSpaceId];
  if (!isBindable(space)) return undefined;
  await bindSpaceToAion(localSpaceId, space.name);
  return useSpaceStore.getState().spaces[localSpaceId]?.aionSpaceId;
}

/** Carries a local rename through to the Space the edge holds. */
export async function renameBoundSpace(
  localSpaceId: string,
  name: string
): Promise<void> {
  const aionSpaceId = await aionSpaceIdFor(localSpaceId);
  if (!aionSpaceId) {
    // Nothing on the edge answers to this Space yet. Bind it now under the name
    // it just took — a deliberate rename is exactly the point at which a
    // placeholder stops being one.
    await bindSpaceToAion(localSpaceId, name);
    return;
  }
  try {
    await renameAionSpace(aionSpaceId, name);
  } catch (error: unknown) {
    console.warn('[spaces] Failed to rename the Space on aion:', error);
  }
}

/**
 * Removes a Space from the edge and then from this renderer. Rejects — leaving
 * the local record in place — when the edge refuses, which is what happens to a
 * Space that still holds Projects.
 */
export async function deleteBoundSpace(localSpaceId: string): Promise<void> {
  const aionSpaceId = await aionSpaceIdFor(localSpaceId);
  if (aionSpaceId) {
    await deleteAionSpace(aionSpaceId);
  }
  useSpaceStore.getState().deleteSpace(localSpaceId);
}

/**
 * Files a freshly created aion Project under the Space the user was in, binding
 * that Space if this is the first Project to land in it.
 *
 * Deliberately not awaited by the caller: filing is a property of the Project,
 * not a precondition for running it, and an edge that refuses the filing must
 * not take the turn down with it.
 */
export function fileProjectUnderBoundSpace(
  localSpaceId: string | null | undefined,
  aionProjectId: string
): void {
  void (async () => {
    const aionSpaceId = await ensureAionSpaceId(localSpaceId);
    if (!aionSpaceId) return;
    await fileProjectInAionSpace(aionProjectId, aionSpaceId);
  })().catch((error: unknown) => {
    console.warn('[spaces] Failed to file the project under its Space:', error);
  });
}

/** The local id a hydrated Space takes, derived so re-hydration is idempotent. */
function localIdForAionSpace(aionSpaceId: string): string {
  return `space_aion_${aionSpaceId}`;
}

function localStatusOf(space: AionSpace, current?: Space): Space['status'] {
  // A status this build predates leaves the local one alone rather than
  // guessing: rendering an unrecognized state as active would put a shelved
  // Space back in the switcher.
  if (space.status === 'unknown') return current?.status ?? 'active';
  return space.status === 'archived' ? 'archived' : 'active';
}

function toLocalSpace(space: AionSpace, current: Space | undefined): Space {
  const createdAt = Date.parse(space.createdAt);
  const updatedAt = Date.parse(space.updatedAt);
  return {
    // Everything the edge owns is taken from the edge; everything that is true
    // only of this machine — where the folder is, what kind of Space this is
    // locally — is kept.
    ...(current ?? {
      id: localIdForAionSpace(space.spaceId),
      sourceType: 'blank' as const,
      rootPath: null,
      rootFingerprint: null,
      schemaVersion: SPACE_SCHEMA_VERSION,
      createdAt: Number.isNaN(createdAt) ? Date.now() : createdAt,
    }),
    name: space.name,
    description: space.description,
    userId: space.userId ?? current?.userId,
    aionSpaceId: space.spaceId,
    status: localStatusOf(space, current),
    updatedAt: Number.isNaN(updatedAt) ? Date.now() : updatedAt,
  };
}

let hydration: Promise<void> | null = null;

/**
 * Brings this renderer's Space list in line with the tenant's.
 *
 * This is what makes a Space survive the machine that made it: the edge holds
 * the tenant's Spaces, and until they are read back a second desktop — or the
 * same one after its storage is cleared — shows none of them while the Projects
 * filed under them are right there in the list.
 *
 * Reconciliation is one-directional and deliberately timid. Every edge Space
 * gets a local record. A local record whose bound Space is gone from a listing
 * that was read in full is removed, because another client deleted it. A local
 * Space that is not bound to anything is never touched by this: it is either a
 * placeholder nobody has used yet or a folder Space whose binding is this
 * machine's alone, and neither is the edge's to delete.
 */
export function hydrateSpacesFromAion(force = false): Promise<void> {
  if (force) hydration = null;
  hydration ??= runHydration().catch((error: unknown) => {
    // A failed hydration is retryable and must not pin the renderer to an
    // empty list: drop the memo so the next caller reads again.
    hydration = null;
    console.warn('[spaces] Failed to read the tenant Spaces:', error);
  });
  return hydration;
}

async function runHydration(): Promise<void> {
  if (!(await spacesAreAionBacked())) return;

  const edgeSpaces: AionSpace[] = [];
  let pageToken: string | undefined;
  let complete = false;
  for (let page = 0; page < maxHydrationPages; page += 1) {
    const { spaces, nextPageToken } = await loadAionSpaces(pageToken);
    edgeSpaces.push(...spaces);
    if (!nextPageToken) {
      complete = true;
      break;
    }
    pageToken = nextPageToken;
  }

  const store = useSpaceStore.getState();
  const byAionId = new Map<string, Space>();
  for (const space of Object.values(store.spaces)) {
    if (space.aionSpaceId) byAionId.set(space.aionSpaceId, space);
  }

  store.upsertSpaces(
    edgeSpaces.map((space) => toLocalSpace(space, byAionId.get(space.spaceId)))
  );

  // Only a listing read to its last page can say a Space is absent. A partial
  // walk — a refused page, a cursor that ran past the cap — says nothing, and
  // acting on it would delete Spaces this desktop simply had not reached yet.
  if (!complete) return;

  const live = new Set(edgeSpaces.map((space) => space.spaceId));
  for (const [aionSpaceId, space] of byAionId) {
    if (!live.has(aionSpaceId)) {
      useSpaceStore.getState().deleteSpace(space.id);
    }
  }
}
