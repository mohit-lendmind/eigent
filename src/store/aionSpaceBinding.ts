/**
 * Joins the renderer's own Space record to the Space the aion edge owns.
 *
 * The desktop mints a Space locally so the switcher opens one the instant it is
 * clicked, and aion is where a Space actually lives — the Projects filed under
 * it, its counts, and its survival past this renderer. `Space.aionSpaceId` is
 * the join between the two, and it is written here and nowhere else.
 *
 * Every write-through is best effort and none of them is on the critical path:
 * a Space still opens, still renames, and still runs when the edge refuses, so
 * a create is never held behind a round trip. What the caller gets instead of a
 * blocking await is `aionSpaceIdFor`, which settles the in-flight create before
 * answering — so a Project submitted moments after its Space was made still
 * files under it rather than landing unfiled by a race.
 */

import {
  createAionSpace,
  fileProjectInAionSpace,
  getAionSpacesMode,
  renameAionSpace,
} from './aionSpacesStore';
import { useSpaceStore } from './spaceStore';

/**
 * Creates in flight, keyed by local Space id. A reader awaits the entry rather
 * than the store, because the store holds nothing until the create returns.
 */
const pendingBinds = new Map<string, Promise<void>>();

async function spacesAreAionBacked(): Promise<boolean> {
  return (await getAionSpacesMode()).kind === 'remote';
}

/**
 * Mints the aion Space behind a local one and records the binding. Returns
 * immediately; `aionSpaceIdFor` is how a caller waits for the result.
 */
export function bindSpaceToAion(localSpaceId: string, name: string): void {
  const bind = (async () => {
    if (!(await spacesAreAionBacked())) return;
    const created = await createAionSpace(name);
    useSpaceStore
      .getState()
      .updateSpace(localSpaceId, { aionSpaceId: created.spaceId });
  })().catch((error: unknown) => {
    console.warn('[spaces] Failed to create the Space on aion:', error);
  });
  pendingBinds.set(localSpaceId, bind);
}

/** The aion Space id behind a local one, once any in-flight create has settled. */
export async function aionSpaceIdFor(
  localSpaceId?: string | null
): Promise<string | undefined> {
  if (!localSpaceId) return undefined;
  await pendingBinds.get(localSpaceId);
  return useSpaceStore.getState().spaces[localSpaceId]?.aionSpaceId;
}

/** Carries a local rename through to the Space the edge holds. */
export async function renameBoundSpace(
  localSpaceId: string,
  name: string
): Promise<void> {
  const aionSpaceId = await aionSpaceIdFor(localSpaceId);
  if (!aionSpaceId) {
    // Nothing on the edge answers to this Space, so there is no name there to
    // change. Bind it now under the name it just took, so a Space whose create
    // was refused still ends up where its Projects will look for it.
    bindSpaceToAion(localSpaceId, name);
    return;
  }
  try {
    await renameAionSpace(aionSpaceId, name);
  } catch (error: unknown) {
    console.warn('[spaces] Failed to rename the Space on aion:', error);
  }
}

/**
 * Files a freshly created aion Project under the Space the user was in.
 * Deliberately not awaited by the caller: filing is a property of the Project,
 * not a precondition for running it, and an edge that refuses the filing must
 * not take the turn down with it.
 */
export function fileProjectUnderBoundSpace(
  localSpaceId: string | null | undefined,
  aionProjectId: string
): void {
  void (async () => {
    const aionSpaceId = await aionSpaceIdFor(localSpaceId);
    if (!aionSpaceId) return;
    await fileProjectInAionSpace(aionProjectId, aionSpaceId);
  })().catch((error: unknown) => {
    console.warn('[spaces] Failed to file the project under its Space:', error);
  });
}
