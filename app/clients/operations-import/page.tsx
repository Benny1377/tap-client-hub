import OperationsClientImportForm from "@/components/operations-client-import-form";
import { resolveAccessIdentity } from "@/lib/access-server";

export const dynamic = "force-dynamic";

export default async function OperationsClientImportPage() {
  const identity = await resolveAccessIdentity();
  if (!identity) return <main className="p-8">Sign in to continue.</main>;
  if (identity.role !== "owner" && identity.role !== "admin") {
    return <main className="p-8">Only an Owner or Admin can import Operations client data.</main>;
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <a className="text-sm underline" href="/clients">Back to Clients</a>
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">Import Operations clients</h1>
        <p className="text-sm text-slate-500">Sandbox only. Existing clients are matched by an exact normalized name; ambiguous names stop the import. Source IDs make retries idempotent. Operations values update the matching client profile, and contacts are added or refreshed without changing Billing or Collections balances.</p>
      </header>
      <OperationsClientImportForm />
    </main>
  );
}
