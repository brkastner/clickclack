import type { User, Workspace } from "./types";

export type ProfileEditScope = {
  isSelf: boolean;
  canEditIdentity: boolean;
  canEdit: boolean;
};

const NO_EDIT: ProfileEditScope = {
  isSelf: false,
  canEditIdentity: false,
  canEdit: false,
};

export function profileEditScope(
  profile: User,
  currentUser: User | null,
  role: Workspace["role"] | "",
): ProfileEditScope {
  if (!profile.id || profile.deleted_at) return NO_EDIT;
  const isSelf = Boolean(currentUser && currentUser.id === profile.id);
  if (isSelf) return { isSelf: true, canEditIdentity: true, canEdit: true };
  if (profile.kind !== "bot") return NO_EDIT;

  const isManager = role === "owner" || role === "moderator";
  const ownsBot = Boolean(
    currentUser && profile.owner_user_id && profile.owner_user_id === currentUser.id,
  );
  const canEditIdentity = profile.owner_user_id ? ownsBot : isManager;
  return { isSelf: false, canEditIdentity, canEdit: canEditIdentity };
}
