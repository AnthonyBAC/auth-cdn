import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getMfaState } from "@/lib/auth/mfa";
import { getSupabaseConfig } from "@/lib/supabase/config";

type CookieToSet = {
  name: string;
  value: string;
  options: CookieOptions;
};

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, key, isConfigured } = getSupabaseConfig();
  const privatePath = request.nextUrl.pathname.startsWith("/workspaces") || request.nextUrl.pathname.startsWith("/boards");
  const mfaChallengePath = request.nextUrl.pathname === "/login/mfa";

  if (!isConfigured) {
    if (privatePath) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/login";
      redirectUrl.searchParams.set("redirectTo", request.nextUrl.pathname);
      return NextResponse.redirect(redirectUrl);
    }

    return response;
  }

  const supabase = createServerClient(url!, key!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      }
    }
  });

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (privatePath && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectTo", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  if (user) {
    const mfaState = await getMfaState(supabase);

    if (privatePath && mfaState.needsChallenge) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/login/mfa";
      redirectUrl.searchParams.set("redirectTo", request.nextUrl.pathname);
      return NextResponse.redirect(redirectUrl);
    }

    if (mfaChallengePath && !mfaState.needsChallenge) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/workspaces";
      return NextResponse.redirect(redirectUrl);
    }
  }

  if (mfaChallengePath && !user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
