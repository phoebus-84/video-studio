// A small RFC 6902 subset (add, remove, replace) for invalid-fixture patches.
// Each invalid edit-timeline fixture is a valid base plus the one change that
// breaks one rule, so the fixture says exactly what it tests.

function parse(pointer) {
  return pointer.split("/").slice(1).map((k) => k.replace(/~1/g, "/").replace(/~0/g, "~"));
}

export function applyPatch(doc, patch) {
  const out = structuredClone(doc);
  for (const op of patch) {
    const keys = parse(op.path);
    const last = keys.pop();
    let parent = out;
    for (const k of keys) {
      if (parent === null || typeof parent !== "object" || !(k in parent)) {
        throw new Error(`patch path ${op.path} does not exist`);
      }
      parent = parent[k];
    }
    const index = Array.isArray(parent) ? (last === "-" ? parent.length : Number(last)) : last;
    if (op.op === "remove") {
      if (!(index in parent)) throw new Error(`patch path ${op.path} does not exist`);
      if (Array.isArray(parent)) parent.splice(index, 1);
      else delete parent[index];
    } else if (op.op === "replace") {
      if (!(index in parent)) throw new Error(`patch path ${op.path} does not exist`);
      parent[index] = op.value;
    } else if (op.op === "add") {
      if (Array.isArray(parent)) parent.splice(index, 0, op.value);
      else parent[index] = op.value;
    } else {
      throw new Error(`unsupported patch op ${op.op}`);
    }
  }
  return out;
}
