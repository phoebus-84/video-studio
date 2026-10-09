// Providers answer in HTML fragments (Commons' extmetadata above all): text a
// credit line can print, with hidden machine data (display:none) dropped.

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function plainText(html: unknown): string | undefined {
  if (typeof html !== "string") return undefined;
  const text = html
    .replace(/<([a-z]+)[^>]*display:\s*none[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === "#") {
        const n = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
      }
      return ENTITIES[code.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, " ")
    .trim();
  return text || undefined;
}

/** A credit line: «Title» by Creator (date), Institution. Licence, licence URL. */
export function creditLine(parts: { title: string; creator?: string; date?: string; institution?: string; licence: string; licenceUrl?: string }): string {
  let line = `«${parts.title}»`;
  if (parts.creator) line += ` by ${parts.creator}`;
  if (parts.date) line += ` (${parts.date})`;
  if (parts.institution) line += `, ${parts.institution}`;
  line += `. ${parts.licence}`;
  if (parts.licenceUrl) line += `, ${parts.licenceUrl}`;
  return line;
}
