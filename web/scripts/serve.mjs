/* 极简静态服务器：把 vite 打好的 dist/ 当站点发布（零依赖，只用 node 内置模块）。
   用法：
     node scripts/serve.mjs                 # 127.0.0.1:5200
     node scripts/serve.mjs --port 8081     # 换端口
     node scripts/serve.mjs --host 0.0.0.0  # 让同一局域网里的手机/平板也能开
     node scripts/serve.mjs --dir dist      # 换目录
*/
import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const PORT = Number(arg("--port", "5200"));
const HOST = arg("--host", "127.0.0.1");
const ROOT = resolve(process.cwd(), arg("--dir", "dist"));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

if (!existsSync(ROOT)) {
  console.error(`找不到目录：${ROOT}\n先跑一次构建：node node_modules/vite/bin/vite.js build`);
  process.exit(1);
}

const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || "/").split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const file = normalize(join(ROOT, p));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  const target = existsSync(file) && statSync(file).isDirectory() ? join(file, "index.html") : file;
  if (!existsSync(target)) {
    // SPA 回退：未知路径给 index.html（本项目是 hash 路由，用不到也没坏处）
    const idx = join(ROOT, "index.html");
    if (existsSync(idx)) {
      res.writeHead(200, { "content-type": TYPES[".html"] });
      createReadStream(idx).pipe(res);
      return;
    }
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, {
    "content-type": TYPES[extname(target).toLowerCase()] || "application/octet-stream",
    "cache-control": "no-cache",
  });
  createReadStream(target).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`静态站点已启动：http://${HOST}:${PORT}/  （目录 ${ROOT}）`);
});
