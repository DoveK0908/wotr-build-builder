import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 相对 base：构建产物可以直接丢到任何静态托管的子目录（GitHub Pages / Cloudflare Pages）
const BUILD = new Date().toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" });

export default defineConfig({
  base: "./",
  // 界面右下角显示构建时间：用户报「改了没生效」时先对一下这个戳，判断是不是缓存
  define: { __BUILD__: JSON.stringify(BUILD) },
  plugins: [react()],
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
    strictPort: false,
    // Windows 上编辑器/脚本的原子写入临时目录会被锁住，把点开头与构建产物排除掉，
    // 否则文件监听会抛 EBUSY 把 dev server 打死。
    watch: {
      ignored: ["**/.*/**", "**/dist/**", "**/.smoke/**", "**/node_modules/**"],
    },
  },
});
