import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 相对 base：构建产物可以直接丢到任何静态托管的子目录（GitHub Pages / Cloudflare Pages）
export default defineConfig({
  base: "./",
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
