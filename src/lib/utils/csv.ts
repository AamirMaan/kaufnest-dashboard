type CsvValue = string | number | null | undefined;

function escapeField(val: CsvValue): string {
  const s = val == null ? "" : String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function exportToCsv(
  filename: string,
  headers: string[],
  rows: CsvValue[][],
): void {
  const lines = [
    headers.map(escapeField).join(","),
    ...rows.map((row) => row.map(escapeField).join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

type Delimiter = "," | ";" | "\t";

/**
 * Detect the field delimiter from the header line by counting candidate
 * characters outside quoted sections. Highest count wins; comma on a tie
 * (German Excel exports typically use ";" because "," is the decimal
 * separator in the de locale).
 */
export function detectDelimiter(headerLine: string): Delimiter {
  const counts: Record<Delimiter, number> = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  for (let i = 0; i < headerLine.length; i++) {
    const ch = headerLine[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes && (ch === "," || ch === ";" || ch === "\t")) {
      counts[ch]++;
    }
  }
  let best: Delimiter = ",";
  for (const d of [";", "\t"] as Delimiter[]) {
    if (counts[d] > counts[best]) best = d;
  }
  return best;
}

function parseLine(line: string, delimiter: Delimiter): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = false; }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === delimiter) { fields.push(current.trim()); current = ""; }
      else { current += ch; }
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Split CSV text into logical rows, honouring newlines INSIDE quoted fields.
 * A naive `.split("\n")` breaks any field containing a line break, and real
 * exports do produce them — a German Amazon VAT ledger wraps long fee
 * descriptions across two lines inside one quoted cell.
 *
 * Quote characters are preserved so `parseLine` still sees a well-formed
 * field; this function only decides where a row ends.
 */
function splitRows(text: string): string[] {
  const rows: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      // An escaped "" inside a quoted field must not toggle the state.
      if (inQuotes && text[i + 1] === '"') {
        current += '""';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === "\n" && !inQuotes) {
      rows.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  rows.push(current);
  return rows;
}

export function parseCsvText(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = splitRows(
    text
      .replace(new RegExp("^\\uFEFF"), "") // strip UTF-8 BOM (Excel prepends it)
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n"),
  ).filter((l) => l.trim() !== "");
  if (lines.length < 2) return { headers: [], rows: [] };
  const delimiter = detectDelimiter(lines[0]);
  const headers = parseLine(lines[0], delimiter).map((h) => h.toLowerCase().trim());
  const rows = lines.slice(1).map((line) => {
    const values = parseLine(line, delimiter);
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));
  });
  return { headers, rows };
}
