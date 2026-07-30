import type { Profile } from "@/types";

type GuardProfile = Pick<Profile, "id" | "role" | "status">;

export interface DeactivateGuardResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Whether `target` can be deactivated by the current super_admin. Blocks:
 * - deactivating an already-deactivated user
 * - a super_admin deactivating their own account (would lock them out with
 *   no way to self-reactivate)
 * - deactivating the last remaining active super_admin in the tenant (would
 *   leave nobody able to manage users at all)
 */
export function canDeactivateUser(
  target: GuardProfile,
  currentUserId: string,
  allUsers: GuardProfile[]
): DeactivateGuardResult {
  if (target.status === "deactivated") {
    return { allowed: false, reason: "This user is already deactivated." };
  }
  if (target.id === currentUserId) {
    return { allowed: false, reason: "You cannot deactivate your own account." };
  }
  if (target.role === "super_admin") {
    const activeSuperAdmins = allUsers.filter(
      (u) => u.role === "super_admin" && u.status === "active"
    );
    if (activeSuperAdmins.length <= 1) {
      return { allowed: false, reason: "At least one active super admin is required." };
    }
  }
  return { allowed: true };
}
