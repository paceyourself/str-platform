import {
  destinationFromAuthState,
  loadAuthRoutingState,
  type PostAuthDestination,
} from "@/lib/auth-routing";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

function normalizePathname(pathname: string) {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function isDashboardPath(pathname: string) {
  const p = normalizePathname(pathname);
  return p === "/dashboard" || pathname.startsWith("/dashboard/");
}

function isPmPath(pathname: string) {
  const p = normalizePathname(pathname);
  return p === "/pm" || pathname.startsWith("/pm/");
}

function isLoginPath(pathname: string) {
  return normalizePathname(pathname) === "/login";
}

function isSignupPath(pathname: string) {
  return normalizePathname(pathname) === "/signup";
}

function redirectTo(request: NextRequest, pathname: PostAuthDestination) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  return NextResponse.redirect(url);
}

export default async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          supabaseResponse = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });
          Object.entries(headers).forEach(([key, value]) => {
            supabaseResponse.headers.set(key, value);
          });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // Unauthenticated — redirect to login
  if ((isDashboardPath(pathname) || isPmPath(pathname)) && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Authenticated — role-based routing
  if (user) {
    const needsRoleRouting =
      isLoginPath(pathname) ||
      isSignupPath(pathname) ||
      isDashboardPath(pathname) ||
      isPmPath(pathname);

    if (needsRoleRouting) {
      const state = await loadAuthRoutingState(supabase, user.id);
      const dest = destinationFromAuthState(state);

      if (isLoginPath(pathname) || isSignupPath(pathname)) {
        if (normalizePathname(pathname) !== dest) {
          return redirectTo(request, dest);
        }
        return supabaseResponse;
      }

      if (isDashboardPath(pathname)) {
        if (state.hasOwnerProfile) return supabaseResponse;
        if (state.hasPmClaim) return redirectTo(request, "/pm/dashboard");
        return redirectTo(request, "/signup");
      }

      if (isPmPath(pathname)) {
        if (state.hasPmClaim) return supabaseResponse;
        if (state.hasOwnerProfile) return redirectTo(request, "/dashboard");
        return redirectTo(request, "/signup");
      }
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};