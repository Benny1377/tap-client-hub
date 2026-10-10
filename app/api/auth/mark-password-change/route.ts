import { NextResponse } from "next/server";
import { resolveAccessIdentity } from "@/lib/access-server";

export async function POST() {
  const identity = await resolveAccessIdentity();
  if (!identity) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHENTICATED" }, { status: 401 });
  const response = NextResponse.json({ mustChangePassword: false });
  response.cookies.delete("tap_force_password");
  return response;
}
