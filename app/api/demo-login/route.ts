import { cookies } from "next/headers";
import { NextResponse } from "next/server";

// Retired because the former shared-password flow allowed account takeover.
// Users must authenticate with their own Supabase Auth credentials.
export async function POST() {
  return NextResponse.json(
    { error: "Legacy demo sign-in is disabled. Use your individual account credentials." },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete("tap_demo_session");
  response.cookies.delete("tap_demo_user");
  response.cookies.delete("tap_demo_email");
  response.cookies.delete("tap_demo_role");
  response.cookies.delete("tap_modules");
  // The legacy endpoint is still the app's logout URL. Clear Supabase's
  // chunked HttpOnly auth cookies here so logout continues to work.
  const cookieStore = await cookies();
  for (const cookie of cookieStore.getAll()) {
    if (cookie.name.startsWith("sb-") || cookie.name.startsWith("supabase")) {
      response.cookies.set(cookie.name, "", { httpOnly: true, path: "/", maxAge: 0 });
    }
  }
  return response;
}
