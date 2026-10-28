import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireClientDataEditAccess, requireClientDataViewAccess } from "@/lib/access-server";

export const dynamic = "force-dynamic";

type ContactInput = { id?: unknown; clientId?: unknown; category?: unknown; name?: unknown; email?: unknown; phone?: unknown; isPrimary?: unknown };
type ContactRow = { category: string | null; client: { status?: string | null } | { status?: string | null }[] | null };
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

export async function GET() {
  const access = await requireClientDataViewAccess();
  if (access.status) return NextResponse.json({ error: access.status === 401 ? "Unauthorized" : "Forbidden" }, { status: access.status });
  try {
    const admin = createAdminClient();
    const contactRows: ContactRow[] = [];
    for (let start = 0; ; start += 1000) {
      const { data: batch, error } = await admin.from("contacts").select("id, client_id, category, name, email, phone, is_primary, client:clients(id, name, cid:client_code, type, group_name, address, city, state, zip, status)").order("name", { ascending: true }).order("id", { ascending: true }).range(start, start + 999);
      if (error) throw error;
      contactRows.push(...(batch || []));
      if (!batch || batch.length < 1000) break;
    }
    const { data: clients, error: clientsError } = await admin.from("clients").select("id, name, cid:client_code").eq("status", "active").order("name", { ascending: true });
    if (clientsError) throw clientsError;
    const contacts = contactRows.filter((contact) => {
      const client = Array.isArray(contact.client) ? contact.client[0] : contact.client;
      return contact.category === "internal" || contact.category === "unassigned" || client?.status === "active";
    });
    return NextResponse.json({ contacts, clients: clients || [] }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load contacts" }, { status: 500 }); }
}

export async function POST(request: Request) {
  const access = await requireClientDataEditAccess();
  if (access.status) return NextResponse.json({ error: access.status === 401 ? "Unauthorized" : "Forbidden" }, { status: access.status });
  try {
    const body = await request.json() as ContactInput;
    const clientId = text(body.clientId), category = text(body.category) || "client", name = text(body.name), email = text(body.email), phone = text(body.phone), isPrimary = body.isPrimary === true;
    if (!name) return NextResponse.json({ error: "Contact name is required." }, { status: 400 });
    if (category !== "client" && category !== "internal" && category !== "unassigned") return NextResponse.json({ error: "Category must be Client, Unassigned, or TAP Internal." }, { status: 400 });
    const admin = createAdminClient();
    if (category === "client") {
      if (!clientId) return NextResponse.json({ error: "Select a current active TAP client." }, { status: 400 });
      const { data: client, error: clientError } = await admin.from("clients").select("id").eq("id", clientId).eq("status", "active").maybeSingle();
      if (clientError) throw clientError;
      if (!client) return NextResponse.json({ error: "Select a current active TAP client." }, { status: 400 });
    }
    const { data, error } = await admin.from("contacts").insert({ client_id: category === "client" ? clientId : null, category, name, email: email || null, phone: phone || null, is_primary: category === "unassigned" ? false : isPrimary }).select("id, client_id, category, name, email, phone, is_primary").single();
    if (error) throw error;
    return NextResponse.json({ contact: data }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to add contact" }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  const access = await requireClientDataEditAccess();
  if (access.status) return NextResponse.json({ error: access.status === 401 ? "Unauthorized" : "Forbidden" }, { status: access.status });
  try {
    const body = await request.json() as ContactInput;
    const id = text(body.id), clientId = text(body.clientId), category = text(body.category) || "client", name = text(body.name), email = text(body.email), phone = text(body.phone);
    if (!id || !name) return NextResponse.json({ error: "Contact ID and name are required." }, { status: 400 });
    if (category !== "client" && category !== "internal" && category !== "unassigned") return NextResponse.json({ error: "Category must be Client, Unassigned, or TAP Internal." }, { status: 400 });
    const admin = createAdminClient();
    if (category === "client") {
      if (!clientId) return NextResponse.json({ error: "Select a current active TAP client." }, { status: 400 });
      const { data: client, error: clientError } = await admin.from("clients").select("id").eq("id", clientId).eq("status", "active").maybeSingle();
      if (clientError) throw clientError;
      if (!client) return NextResponse.json({ error: "Select a current active TAP client." }, { status: 400 });
    }
    const { data, error } = await admin.from("contacts").update({ client_id: category === "client" ? clientId : null, category, name, email: email || null, phone: phone || null, is_primary: category === "unassigned" ? false : body.isPrimary === true, updated_at: new Date().toISOString() }).eq("id", id).select("id, client_id, category, name, email, phone, is_primary").single();
    if (error) throw error;
    return NextResponse.json({ contact: data });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update contact" }, { status: 500 }); }
}

export async function DELETE(request: Request) {
  const access = await requireClientDataEditAccess();
  if (access.status) return NextResponse.json({ error: access.status === 401 ? "Unauthorized" : "Forbidden" }, { status: access.status });
  try {
    const id = text(new URL(request.url).searchParams.get("id"));
    if (!id) return NextResponse.json({ error: "Contact ID is required." }, { status: 400 });
    const { error } = await createAdminClient().from("contacts").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ deleted: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to delete contact" }, { status: 500 }); }
}
