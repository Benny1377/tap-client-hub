import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { safeNextPath } from "@/lib/safe-next";

/**
 * Auth callback handler for email confirmation and magic links.
 * Supabase redirects here after email verification; we exchange
 * the code for a session and redirect to the main app.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    // Exchange the auth code for a session
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            // For route handlers, we can't set cookies on the request —
            // we set them on the response instead.
          },
        },
      },
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(error.message)}`, origin),
      );
    }
  }

  // Redirect to the intended page
  return NextResponse.redirect(new URL(next, origin));
}
