/* 公网发布版构建的最后一步：把 vite 从 public/ 整包拷进来的游戏素材删掉。
   （vite 会无条件复制 publicDir，所以「不含游戏素材」得在这里保证，见 web/.env.public 的 VITE_ART=0）
   用法：node scripts/strip-art.mjs [--dir dist] */
import { existsSync, rmSync, statSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const i = argv.indexOf("--dir");
const DIST = resolve(process.cwd(), i >= 0 && argv[i + 1] ? argv[i + 1] : "dist");

const size = (dir) => {
  let n = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else n += statSync(p).size;
    }
  };
  walk(dir);
  return n;
};

const targets = [join(DIST, "assets", "ui"), join(DIST, "assets", "icons")];
let freed = 0;
for (const t of targets) {
  if (existsSync(t)) {
    const mb = size(t) / 1048576;
    rmSync(t, { recursive: true, force: true });
    freed += mb;
    console.log(`删掉 ${t}（${mb.toFixed(1)} MB）`);
  }
}
if (!freed) console.log(`没有游戏素材目录可删（${DIST}）`);
console.log(`公网发布版已就绪：${DIST}（不含游戏贴图与图标）`);

// 浏览器端只用 features-0..3.json 分片，单体的 features.json 只给本地工具用，别塞进产物
const bigFeatures = join(DIST, "data", "features.json");
if (existsSync(bigFeatures)) {
  const mb = statSync(bigFeatures).size / 1048576;
  rmSync(bigFeatures, { force: true });
  console.log(`  删掉 data/features.json（${mb.toFixed(1)} MB，浏览器改用 4 个分片）`);
}
