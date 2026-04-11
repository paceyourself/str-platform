import type { SupabaseClient } from "@supabase/supabase-js";

export type PostAuthDestination = "/dashboard" | "/pm/dashboard" | "/signup";

export type AuthRoutingState = {
  hasOwnerProfile: boolean;
  hasPmClaim: boolean;
};

/**
 * Loads owner + PM claim flags for routing (parallel queries, server-safe).
 */
export async function loadAuthRoutingState(
  supabase: SupabaseClient,
  userId: string
): Promise<AuthRoutingState> {
  const [ownerRes, pmRes] = await Promise.all([
    supabase.from("owner_profiles").select("id").eq("id", userId).maybeSingle(),
    supabase
      .from("pm_profiles")
      .select("id")
      .eq("claimed_by_user_id", userId)
      .maybeSingle(),
  ]);

  return {
    hasOwnerProfile: ownerRes.data != null,
    hasPmClaim: pmRes.data != null,
  };
}

/**
 * Default home after login:
 * - Owner (or owner + PM) → /dashboard
 * - PM with `claimed_by_user_id` set (pending approval or approved) → /pm/dashboard
 *   so pending users still reach the PM app; neither profile → /signup
 */
export function destinationFromAuthState(
  state: AuthRoutingState
): PostAuthDestination {
  if (state.hasOwnerProfile) return "/dashboard";
  if (state.hasPmClaim) return "/pm/dashboard";
  return "/signup";
}

export async function getPostAuthDestination(
  supabase: SupabaseClient,
  userId: string
): Promise<PostAuthDestination> {
  const state = await loadAuthRoutingState(supabase, userId);
  return destinationFromAuthState(state);
}
