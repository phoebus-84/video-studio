#!/usr/bin/env node

/**
 * Generate TypeScript bindings from JSON Schemas.
 *
 * Usage:
 *   node scripts/generate-ts-bindings.mjs          # generate to bindings/ts/
 *   node scripts/generate-ts-bindings.mjs --check  # check for drift
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { resolve, relative, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const schemasDir = resolve(root, "schemas/v1alpha1");
const outDir = resolve(root, "bindings/ts");

const checkMode = process.argv.includes("--check");

// ── Load all schemas ────────────────────────────────────────────────────────

const schemas = {};
const schemaFiles = readdirSync(schemasDir).filter((f) => f.endsWith(".schema.json"));
for (const file of schemaFiles) {
  const schema = JSON.parse(readFileSync(resolve(schemasDir, file), "utf-8"));
  const name = file.replace(".schema.json", "");
  schemas[name] = { file, schema, name };
}

// ── Build cross-reference map ───────────────────────────────────────────────

// Map: $id → { file, defs }
const idToSchema = {};
for (const [name, entry] of Object.entries(schemas)) {
  const $id = entry.schema.$id;
  if ($id) {
    idToSchema[$id] = { name, defs: new Set(Object.keys(entry.schema.$defs ?? {})) };
  }
}

// Also map by basename for short refs like "identity.schema.json"
const baseToName = {};
for (const [name, entry] of Object.entries(schemas)) {
  baseToName[entry.file] = name;
}

/** Resolve a $ref to { schemaName, defName } or null if external/unresolvable. */
function resolveRef($ref, currentSchema) {
  const parts = $ref.split("#");
  const idPart = parts[0];
  const pointerPart = parts[1] ?? "";

  if (!pointerPart.startsWith("/$defs/")) return null;

  const defName = pointerPart.replace("/$defs/", "");

  if (!idPart || idPart === "") {
    // Same-schema ref
    return { schemaName: currentSchema, defName, external: false };
  }

  // Cross-schema ref — look up by $id or filename
  const idSchema = idToSchema[idPart];
  if (idSchema) {
    return { schemaName: idSchema.name, defName, external: true };
  }

  // Try by filename
  const filename = basename(idPart);
  const baseSchema = baseToName[filename];
  if (baseSchema) {
    return { schemaName: baseSchema, defName, external: true };
  }

  return null;
}

// ── TypeScript type generation ──────────────────────────────────────────────

/** Convert a JSON Schema type to a TypeScript type string. */
function toTsType(schema, context, required = true) {
  if (schema === undefined || schema === null) return "unknown";

  // Handle $ref
  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, context.schemaName);
    if (!resolved) return "unknown";
    if (resolved.external) {
      // Add to imports
      context.imports.add(resolved.schemaName);
      return resolved.defName;
    }
    return resolved.defName;
  }

  // Handle allOf — intersection
  if (schema.allOf) {
    const types = schema.allOf
      .filter((s) => !(s.if || s.then)) // skip if/then sub-schemas
      .map((s) => toTsType(s, context, required));
    const nonUnknown = types.filter((t) => t !== "unknown");
    return nonUnknown.length > 0 ? nonUnknown.join(" & ") : "unknown";
  }

  // Handle oneOf — union
  if (schema.oneOf) {
    return schema.oneOf.map((s) => toTsType(s, context, required)).join(" | ");
  }

  // Handle anyOf — union (treat same as oneOf for simplicity)
  if (schema.anyOf) {
    return schema.anyOf.map((s) => toTsType(s, context, required)).join(" | ");
  }

  // Handle const — literal
  if (schema.const !== undefined) {
    return JSON.stringify(schema.const);
  }

  // Handle enum
  if (schema.enum) {
    return schema.enum.map((v) => JSON.stringify(v)).join(" | ");
  }

  // Handle type
  const type = schema.type;
  if (type === "string") return "string";
  if (type === "number") return "number";
  if (type === "integer") return "number";
  if (type === "boolean") return "boolean";
  if (type === "null") return "null";

  // Handle array
  if (type === "array") {
    if (schema.items) {
      const itemType = toTsType(schema.items, context, true);
      return `${itemType}[]`;
    }
    return "unknown[]";
  }

  // Handle object — generate inline type
  if (type === "object" && schema.properties) {
    return generateInlineObject(schema, context);
  }

  // Fallback for objects without properties
  if (type === "object") return "Record<string, unknown>";

  // Handle multiple types
  if (Array.isArray(type)) {
    return type.map((t) => {
      if (t === "object" && schema.properties) return generateInlineObject(schema, context);
      if (t === "string") return "string";
      if (t === "number") return "number";
      if (t === "integer") return "number";
      if (t === "boolean") return "boolean";
      if (t === "null") return "null";
      return "unknown";
    }).join(" | ");
  }

  return "unknown";
}

/** Generate an inline object type string. */
function generateInlineObject(schema, context) {
  if (!schema.properties) return "Record<string, unknown>";

  const requiredSet = new Set(schema.required ?? []);
  const props = [];

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    const isRequired = requiredSet.has(key);
    const tsType = toTsType(propSchema, context, isRequired);
    const opt = isRequired ? "" : "?";
    // Add JSDoc if description exists
    const desc = propSchema.description ? `/** ${propSchema.description.replace(/\*\//g, "* /")} */\n    ` : "";
    props.push(`${desc}${safeKey(key)}${opt}: ${tsType};`);
  }

  return `{\n    ${props.join("\n    ")}\n  }`;
}

/** Generate a TypeScript interface from a $def schema. */
function generateInterface(defName, schema, context) {
  if (!schema.properties) {
    // It might be just a type alias (enum, pattern, etc.)
    const tsType = toTsType(schema, context, true);
    return `export type ${defName} = ${tsType};\n`;
  }

  const requiredSet = new Set(schema.required ?? []);
  const props = [];

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    const isRequired = requiredSet.has(key);
    const tsType = toTsType(propSchema, context, isRequired);
    const opt = isRequired ? "" : "?";
    const desc = propSchema.description ? `  /** ${propSchema.description.replace(/\*\//g, "* /")} */\n` : "";
    props.push(`${desc}  ${safeKey(key)}${opt}: ${tsType};`);
  }

  // If the schema has additionalProperties: false, add an index signature blocker
  // Actually, TypeScript interfaces don't support this natively — we skip it

  return `export interface ${defName} {\n${props.join("\n")}\n}\n`;
}

/** Generate imports for cross-schema refs. */
function generateImports(context, currentFile) {
  const lines = [];
  const externalSchemas = [...context.imports].filter((s) => s !== context.schemaName);
  if (externalSchemas.length > 0) {
    for (const ext of externalSchemas) {
      const importFile = `./${ext}`;
      lines.push(`import type { ${[...context.usedDefs.get(ext) ?? []].join(", ")} } from "${importFile}";`);
    }
  }
  return lines.join("\n");
}

/** Make a key safe for TypeScript (avoid reserved words, handle special chars). */
function safeKey(key) {
  // TypeScript reserved words that could clash
  const reserved = new Set(["delete", "export", "import", "type", "enum", "const", "let", "var",
    "function", "class", "interface", "extends", "implements", "new", "null", "undefined",
    "public", "private", "protected", "static", "readonly"]);
  if (reserved.has(key) || !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)) {
    return `"${key}"`;
  }
  return key;
}

// ── Main generation ─────────────────────────────────────────────────────────

function generateBindings(outputPath) {
  mkdirSync(outputPath, { recursive: true });

  for (const [name, entry] of Object.entries(schemas)) {
    const schema = entry.schema;
    const defs = schema.$defs ?? {};

    const context = {
      schemaName: name,
      imports: new Set(),
      usedDefs: new Map(), // schemaName → Set<defName>
    };

    const lines = [];
    lines.push("/**");
    lines.push(` * TypeScript bindings generated from ${entry.file}`);
    lines.push(` * Schema: ${schema.$id}`);
    lines.push(" * Auto-generated — do not edit directly.");
    lines.push(" */");
    lines.push("");

    // Generate interfaces for each $def
    for (const [defName, defSchema] of Object.entries(defs)) {
      // Track which defs are used from which schemas
      // We do this after generating to know what imports are needed
      lines.push(generateInterface(defName, defSchema, { ...context }));
    }

    // Prepending imports (we need to figure out exact imports — simplify:
    // just import everything from external schemas that are referenced)
    const imports = [];
    const externalRefs = [...context.imports].filter((s) => s !== name);
    for (const ext of externalRefs) {
      // Find all defs referenced from this external schema
      // For simplicity, we'll just import the whole module
      // Actually, let's scan the generated lines for references to external defs
      const extSchema = schemas[ext];
      if (!extSchema) continue;
      const extDefs = Object.keys(extSchema.schema.$defs ?? {});
      // Only import defs that are actually used
      const usedInFile = [];
      for (const extDef of extDefs) {
        // Quick check: is this def name referenced anywhere in our generated lines?
        const allText = lines.join("\n");
        // Use word boundary check to avoid partial matches
        const re = new RegExp(`\\b${extDef}\\b`);
        if (re.test(allText)) {
          usedInFile.push(extDef);
        }
      }
      if (usedInFile.length > 0) {
        imports.push(`import type { ${usedInFile.join(", ")} } from "./${ext}";`);
      }
    }
    if (imports.length > 0) {
      // Insert after the JSDoc comment block (after the closing ` */` line)
      let insertIdx = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === "*/") {
          insertIdx = i + 1;
          break;
        }
      }
      lines.splice(insertIdx, 0, "", ...imports);
    }

    writeFileSync(resolve(outputPath, `${name}.ts`), lines.join("\n"), "utf-8");
  }
}

// ── Run ──────────────────────────────────────────────────────────────────────

if (checkMode) {
  const tmpOut = resolve(tmpdir(), `contracts-bindings-${Date.now()}`);
  generateBindings(tmpOut);

  // Diff against current bindings/ts/
  try {
    execSync(`diff -rq ${tmpOut} ${outDir}`, { stdio: "pipe" });
    console.log("PASS TypeScript bindings are up to date");
  } catch (err) {
    if (err.status === 1) {
      console.error("FAIL TypeScript bindings are out of date. Run:");
      console.error("  npm run bindings:generate");
      console.error("\nDiff:");
      console.error(err.stdout?.toString());
      process.exit(1);
    }
    throw err;
  }
} else {
  generateBindings(outDir);
  console.log("TypeScript bindings generated in bindings/ts/");
}
