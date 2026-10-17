import type { Db } from "./types";

/**
 * 数据文件放在 public/data/ 下：开发时由 vite 直接托管，
 * 构建后原样复制进 dist/data/（base 是相对路径，所以用 "./data/..."）。
 */
const FILES = [
  "rules.json",
  "classes.json",
  "archetypes.json",
  "races.json",
  "backgrounds.json",
  "mythic.json",
  "spellbooks.json",
  "spellLists.json",
  "spells.json",
  "icons.json", // 蓝图 id → 图标文件名（覆盖率有限，缺图标的回退成首字徽记）
  "features.json", // 约 8 MB，最大的一个，放最后
  "presets.json",
  "proficiencies.json",
  "upgrades.json",
  "meta.json",
] as const;

/** 每个文件解出来的键名 */
const KEYS: Record<string, keyof Db> = {
  "rules.json": "rules",
  "classes.json": "classes",
  "archetypes.json": "archetypes",
  "races.json": "races",
  "backgrounds.json": "backgrounds",
  "mythic.json": "mythic",
  "spellbooks.json": "spellbooks",
  "spellLists.json": "spellLists",
  "spells.json": "spells",
  "icons.json": "icons",
  "features.json": "features",
  "presets.json": "presets",
  "proficiencies.json": "proficiencies",
  "upgrades.json": "upgrades",
  "meta.json": "meta",
};

export interface LoadProgress {
  file: string;
  done: number;
  total: number;
}

export async function loadDb(onProgress?: (p: LoadProgress) => void): Promise<Db> {
  const db: Partial<Db> = {};
  let done = 0;
  const total = FILES.length;
  // 小文件先到先渲染，大文件随后补上：并发发请求，按顺序 await
  const promises = FILES.map(async (f) => {
    const url = `./data/${f}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`加载 ${url} 失败：${res.status} ${res.statusText}`);
    const json = await res.json();
    (db as Record<string, unknown>)[KEYS[f]] = json;
    done += 1;
    onProgress?.({ file: f, done, total });
  });
  await Promise.all(promises);
  return db as Db;
}

export function fmtBytes(n: number): string {
  if (n > 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
  return Math.round(n / 1024) + " KB";
}
