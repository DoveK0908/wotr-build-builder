/**
 * 跑 scripts/smoke-entry.ts：用 esbuild 打包成 CJS 再在当前 Node 里执行。
 * 用法：node scripts/smoke.mjs
 */
import { build } from "esbuild";
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const outDir = path.join(root, ".smoke");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "smoke.cjs");

await build({
  entryPoints: [path.join(root, "scripts", "smoke-entry.ts")],
  outfile: outFile,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  logLevel: "warning",
});

const require = createRequire(import.meta.url);

// store.ts 在模块加载时会读 location / localStorage，这里给个最小垫片
globalThis.location = { hash: "", href: "http://localhost/", search: "" };
globalThis.localStorage = {
  _d: new Map(),
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; },
  setItem(k, v) { this._d.set(k, String(v)); },
  removeItem(k) { this._d.delete(k); },
};
globalThis.window = globalThis;

const mod = require(outFile);
mod.run(path.join(root, "public", "data"));
