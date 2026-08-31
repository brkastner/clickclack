import type { User, Workspace } from "./types";

export type ProfileEditScope = {
  /** The viewer is looking at their own profile. */
  isSelf: boolean;
  /** display_name, handle, and avatar_url on the underlying user row. */
  canEditIdentity: boolean;
  /** Channel-scoped persona lanes (bot presentations). */
  canEditPersonas: boolean;
  /** Any editing affordance at all. */
  canEdit: boolean;
};

const NO_EDIT: ProfileEditScope = {
  isSelf: false,
  canEditIdentity: false,
  canEditPersonas: false,
  canEdit: false,
};

/**
 * Mirrors the server rules in store.UpdateBotProfile and the channel bot
 * presentation handlers:
 *
 * - A human's identity is editable only by that human, through account
 *   settings rather than this pane.
 * - A user-owned bot is editable only by its owner. A workspace owner does not
 *   outrank the bot's human owner.
 * - A service bot is editable by workspace managers.
 * - Persona lanes are channel configuration, so they follow manager
 *   permission rather than bot ownership.
 *
 * The client gate is a convenience only; the server re-checks every mutation.
 */
export function profileEditScope(
  profile: User,
  currentUser: User | null,
  role: Workspace["role"] | "",
): ProfileEditScope {
  if (!profile.id || profile.deleted_at) return NO_EDIT;

  const isSelf = Boolean(currentUser && currentUser.id === profile.id);
  if (isSelf) {
    return { isSelf: true, canEditIdentity: true, canEditPersonas: false, canEdit: true };
  }
  if (profile.kind !== "bot") return NO_EDIT;

  const isManager = role === "owner" || role === "moderator";
  const ownsBot = Boolean(
    currentUser && profile.owner_user_id && profile.owner_user_id === currentUser.id,
  );
  const canEditIdentity = profile.owner_user_id ? ownsBot : isManager;
  const canEditPersonas = isManager;

  return {
    isSelf: false,
    canEditIdentity,
    canEditPersonas,
    canEdit: canEditIdentity || canEditPersonas,
  };
}
