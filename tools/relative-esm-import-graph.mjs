/* Resolve static relative ESM imports without bundling. */
import fs from "node:fs";
import path from "node:path";

function relativeModule(from, specifier) {
  if (!specifier.startsWith(".")) return null;
  const file = path.resolve(path.dirname(from), specifier);
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`${path.relative(process.cwd(), from)} imports missing ${specifier}`);
  }
  return file;
}

function imports(file) {
  const source = fs.readFileSync(file, "utf8");
  const specs = new Set();
  // Source modules keep declarations at top level. This deliberately ignores
  // import(), whose runtime argument is not part of static ESM graph.
  const declarations = [
    /^\s*import\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/gm,
    /^\s*export\s+(?:\*|\{[^}]*\})\s+from\s+["']([^"']+)["']/gm,
  ];
  for (const pattern of declarations) {
    for (const match of source.matchAll(pattern)) specs.add(match[1]);
  }
  return [...specs].sort();
}

export function relativeEsmImportGraph(root, entries) {
  root = path.resolve(root);
  const seen = new Set();
  const pending = entries.map(entry => path.resolve(root, entry)).sort().reverse();
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    if (!file.startsWith(root + path.sep)) throw new Error(`entry outside root: ${file}`);
    if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`missing entry: ${path.relative(root, file)}`);
    }
    seen.add(file);
    for (const specifier of imports(file)) {
      const dependency = relativeModule(file, specifier);
      if (dependency && !seen.has(dependency)) pending.push(dependency);
    }
    pending.sort().reverse();
  }
  return [...seen].map(file => path.relative(root, file).split(path.sep).join("/")).sort();
}
