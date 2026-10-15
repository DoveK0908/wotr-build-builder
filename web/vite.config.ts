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
  },
});
