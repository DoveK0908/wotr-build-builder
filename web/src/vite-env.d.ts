/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "0" 表示这次构建不含从游戏里提取的素材（公网发布版，见 .env.public） */
  readonly VITE_ART?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
