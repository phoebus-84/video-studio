// Set a value at a JSON path such as $.tracks[1].items[0].props.text or $.assets["image-cat"].path.
// `null` deletes: the key from an object, the element from an array.

export function setPath(doc: unknown, path: string, value: unknown): void {
  const keys = [...path.slice(1).matchAll(/\.([A-Za-z_$][\w$]*)|\[(\d+)\]|\["([^"]+)"\]/g)]
    .map((m) => (m[1] !== undefined ? m[1] : m[3] !== undefined ? m[3] : Number(m[2])));
  if (!path.startsWith("$") || keys.length === 0) throw new Error(`not a JSON path: ${path}`);
  let at: any = doc;
  for (const key of keys.slice(0, -1)) {
    if (at[key] === undefined) throw new Error(`${path}: nothing at ${String(key)}`);
    at = at[key];
  }
  const last = keys.at(-1)!;
  if (value === null) {
    if (Array.isArray(at)) at.splice(last as number, 1);
    else delete at[last];
  } else at[last] = structuredClone(value);
}
