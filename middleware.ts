import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();


  // Check deactivation for logged-in users accessing owner or PM dashboard
  if (user && (
    request.nextUrl.pathname.startsWith("/dashboard") ||
    request.nextUrl.pathname.startsWith("/pm/dashboard")
  )) {
    const { data: ownerProfile } = await supabase
      .from("owner_profiles")
      .select("deactivated_at")
      .eq("id", user.id)
      .maybeSingle();

    if (ownerProfile?.deactivated_at) {
      await supabase.auth.signOut();
      return NextResponse.redirect(new URL("/login?reason=deactivated", request.url));
    }

    // For PM dashboard also check pm_profiles
    if (request.nextUrl.pathname.startsWith("/pm/dashboard")) {
      const { data: pmProfile } = await supabase
        .from("pm_profiles")
        .select("deactivated_at")
        .eq("claimed_by_user_id", user.id)
        .maybeSingle();

      if (pmProfile?.deactivated_at) {
        await supabase.auth.signOut();
        return NextResponse.redirect(new URL("/login?reason=deactivated", request.url));
      }
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/pm/dashboard/:path*",
    "/admin/:path*",
    "/onboarding/:path*",
  ],
};