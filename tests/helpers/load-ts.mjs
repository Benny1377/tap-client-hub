// Minimal TS/TSX module loader for dependency-free UI tests. Transpiles source
// files with the project's TypeScript, resolves the "@/" alias, and loads
// packages (react, react-dom/server) from node_modules in this realm.
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const nodeRequire = createRequire(import.meta.url);
export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cache = new Map();

function resolveFile(base) {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`Cannot resolve ${base}`);
}

function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const output = ts.transpileModule(readFileSync(file, "utf8"), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  cache.set(file, mod);
  const localRequire = (id) => {
    if (id.startsWith("@/")) return load(resolveFile(join(root, id.slice(2))));
    if (id.startsWith(".")) return load(resolveFile(resolve(dirname(file), id)));
    return nodeRequire(id);
  };
  new Function("require", "module", "exports", output)(localRequire, mod, mod.exports);
  return mod.exports;
}

/** Load a project module by its "@/..." or root-relative path. */
export function loadTs(path) {
  return load(resolveFile(join(root, path.replace(/^@\//, ""))));
}
