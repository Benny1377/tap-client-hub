import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export type PdfTextLine = { page: number; text: string; cells: string[] };
export type ParsedCollectionsPdf = {
  report_type: "aging_summary" | "aging_detail" | "unknown";
  source_as_of: string | null;
  page_count: number;
  lines: PdfTextLine[];
};

const DATE = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/;
const LONG_DATE = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i;
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/;

function isoDate(text: string): string | null {
  const iso = ISO_DATE.exec(text);
  if (iso) {
    const date = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00Z`);
    return Number.isNaN(date.valueOf()) ? null : `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  const match = DATE.exec(text);
  const longMatch = LONG_DATE.exec(text);
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const month = match ? Number(match[1]) - 1 : longMatch ? months.indexOf(longMatch[1].toLowerCase()) : -1;
  const day = match ? Number(match[2]) : longMatch ? Number(longMatch[2]) : 0;
  const yearText = match?.[3] || longMatch?.[3] || "";
  if (month < 0 || !yearText) return null;
  const year = Number(yearText.length === 2 ? `20${yearText}` : yearText);
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  return `${year.toString().padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export async function parseCollectionsPdf(bytes: Uint8Array): Promise<ParsedCollectionsPdf> {
  const task = getDocument({ data: bytes, useSystemFonts: true });
  const pdf = await task.promise;
  if (pdf.numPages < 1 || pdf.numPages > 250) {
    await task.destroy();
    throw new Error("PDF_PAGE_LIMIT_EXCEEDED");
  }
  const lines: PdfTextLine[] = [];
  const flattened: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const groups: Array<{ y: number; items: Array<{ x: number; text: string }> }> = [];
      for (const raw of content.items) {
        if (!("str" in raw) || !raw.str.trim()) continue;
        const item = raw as typeof raw & { transform: number[] };
        const y = item.transform[5];
        const x = item.transform[4];
        let group = groups.find((candidate) => Math.abs(candidate.y - y) < 2.5);
        if (!group) { group = { y, items: [] }; groups.push(group); }
        group.items.push({ x, text: item.str.trim() });
      }
      groups.sort((a, b) => b.y - a.y);
      for (const group of groups) {
        const cells = group.items.sort((a, b) => a.x - b.x).map((item) => item.text);
        const text = cells.join(" | ");
        if (text.trim()) {
          if (text.length > 12000 || lines.length >= 20000) throw new Error("PDF_TEXT_LIMIT_EXCEEDED");
          lines.push({ page: pageNumber, text, cells }); flattened.push(text);
        }
      }
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  const reportText = flattened.join("\n");
  const normalized = reportText.toLowerCase();
  const report_type = normalized.includes("a/r aging quickzoom") || normalized.includes("transaction type") && normalized.includes("open balance")
    ? "aging_detail"
    : normalized.includes("a/r aging summary") || normalized.includes("customer") && normalized.includes("current") && normalized.includes("over 90")
      ? "aging_summary" : "unknown";
  const asOfMatch = /(?:as of|as-of|through)\s*:?\s*((?:\d{1,2}\/\d{1,2}\/\d{2,4})|(?:\d{4}-\d{2}-\d{2})|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})/i.exec(reportText);
  return { report_type, source_as_of: asOfMatch ? isoDate(asOfMatch[1]) : null, page_count: pdf.numPages, lines };
}
