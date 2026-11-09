export type OperationsImportClient = {
  source_client_id: string;
  client_name: string;
  client_code: string | null;
  group_name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  type: "Business" | "Personal";
};

export type OperationsImportContact = {
  source_contact_id: string;
  source_client_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
};

export type OperationsImportPayload = {
  clients: OperationsImportClient[];
  contacts: OperationsImportContact[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUIRED_HEADERS = [
  "source_client_id", "client_name", "client_code", "group_name", "address", "city", "state", "zip", "type", "status",
  "source_contact_id", "contact_category", "contact_name", "contact_email", "contact_phone", "is_primary",
];

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      value = "";
    } else value += char;
  }
  if (quoted) throw new Error("The CSV has an unclosed quoted value.");
  if (value.length || row.length) {
    row.push(value.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

const clean = (value: string | undefined) => {
  const result = (value || "").trim();
  return !result || result.toLowerCase() === "null" ? null : result;
};

export function parseOperationsClientCsv(text: string): OperationsImportPayload {
  if (text.length > 4_000_000) throw new Error("CSV is larger than the 4 MB import limit.");
  const [headerRow, ...dataRows] = parseCsv(text.replace(/^\uFEFF/, ""));
  if (!headerRow) throw new Error("The CSV is empty.");
  const headers = headerRow.map((header) => header.trim());
  if (headers.length !== REQUIRED_HEADERS.length || REQUIRED_HEADERS.some((header) => !headers.includes(header))) {
    throw new Error("Unexpected CSV columns. Use the Operations clients-and-contacts export format.");
  }

  const index = Object.fromEntries(headers.map((header, position) => [header, position])) as Record<string, number>;
  const clients = new Map<string, OperationsImportClient>();
  const contacts = new Map<string, OperationsImportContact>();
  const primaryCount = new Map<string, number>();

  for (const [rowNumber, cells] of dataRows.entries()) {
    if (cells.length !== headers.length) throw new Error(`CSV row ${rowNumber + 2} has ${cells.length} fields; expected ${headers.length}.`);
    const field = (name: string) => clean(cells[index[name]]);
    const sourceClientId = field("source_client_id") || "";
    const name = field("client_name") || "";
    const typeValue = (field("type") || "").toLowerCase();
    if (!UUID.test(sourceClientId) || !name) throw new Error(`CSV row ${rowNumber + 2} is missing a valid source client ID or client name.`);
    if (typeValue !== "business" && typeValue !== "personal") throw new Error(`CSV row ${rowNumber + 2} has an unsupported client type.`);
    if ((field("status") || "").toLowerCase() !== "active") throw new Error(`CSV row ${rowNumber + 2} is not an active client.`);

    const client: OperationsImportClient = {
      source_client_id: sourceClientId,
      client_name: name,
      client_code: field("client_code"),
      group_name: field("group_name"),
      address: field("address"),
      city: field("city"),
      state: field("state"),
      zip: field("zip"),
      type: typeValue === "personal" ? "Personal" : "Business",
    };
    const previousClient = clients.get(sourceClientId);
    if (previousClient && JSON.stringify(previousClient) !== JSON.stringify(client)) {
      throw new Error(`CSV rows for source client ${sourceClientId} disagree on client fields.`);
    }
    clients.set(sourceClientId, client);

    const sourceContactId = field("source_contact_id");
    const contactName = field("contact_name");
    if (sourceContactId) {
      if (!UUID.test(sourceContactId) || !contactName || (field("contact_category") || "").toLowerCase() !== "client") {
        throw new Error(`CSV row ${rowNumber + 2} has invalid contact information.`);
      }
      const primaryValue = (field("is_primary") || "").toLowerCase();
      if (!["true", "false", "t", "f", "1", "0"].includes(primaryValue)) {
        throw new Error(`CSV row ${rowNumber + 2} has an invalid primary-contact flag.`);
      }
      const contact: OperationsImportContact = {
        source_contact_id: sourceContactId,
        source_client_id: sourceClientId,
        name: contactName,
        email: field("contact_email"),
        phone: field("contact_phone"),
        is_primary: ["true", "t", "1"].includes(primaryValue),
      };
      const previousContact = contacts.get(sourceContactId);
      if (previousContact && JSON.stringify(previousContact) !== JSON.stringify(contact)) {
        throw new Error(`CSV rows for source contact ${sourceContactId} disagree.`);
      }
      contacts.set(sourceContactId, contact);
      if (!previousContact && contact.is_primary) primaryCount.set(sourceClientId, (primaryCount.get(sourceClientId) || 0) + 1);
    } else if (contactName || field("contact_email") || field("contact_phone")) {
      throw new Error(`CSV row ${rowNumber + 2} has contact details but no source contact ID.`);
    }
  }

  if (dataRows.length === 0) throw new Error("The CSV has no client rows.");
  if ([...primaryCount.values()].some((count) => count > 1)) throw new Error("At least one client has multiple primary contacts in the source file.");
  return { clients: [...clients.values()], contacts: [...contacts.values()] };
}
