/** RFC 4180 cell escaping + spreadsheet formula injection protection. */
export function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildCsv(rows: unknown[][]): string {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
