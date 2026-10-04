// 一次性数据清理：Wiki related 数组去悬空 + 语义补链。
// 背景：LLM 生成条目时自由发挥"关联知识点"，大量名称在现有条目中不存在，
// 前端渲染为灰色死链，content-health 长期报 broken_related。
// 处理：
//   1. 移除按 wikiLint 同一判定（标题归一化精确匹配）解析不到的 related 名称，
//      保证清理后 content-health 的 broken_related 归零；
//   2. 有效关联不足 3 条的条目，用 hash-embed 余弦相似度（≥0.3）补足到 3 条，
//      只补现有条目的规范标题，不引入新的悬空引用。
// 用法：node scripts/clean-wiki-related.mjs [--dry-run]
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PracticeService } from "../src/questions.mjs";
import { SQLiteStore } from "../src/store.mjs";
import { normalizeComparableText } from "../src/service/helpers.mjs";

const root = resolve(fileURLToPath(import.meta.url), "../..");
const dryRun = process.argv.includes("--dry-run");

const store = new SQLiteStore(resolve(root, "data/state.sqlite"));
await store.init();
const service = new PracticeService({
  store,
  now: () => new Date().toISOString(),
});
await service.init();

const backup = await service.exportData();
if (!dryRun) {
  const backupPath = resolve(root, `data/wiki-clean-backup-${Date.now()}.json`);
  await writeFile(backupPath, JSON.stringify(backup));
  console.log(`已备份到 ${backupPath}`);
}

const lintTypeCounts = (lint) => {
  const counts = {};
  for (const issue of lint.issues) {
    for (const type of issue.issues) counts[type] = (counts[type] ?? 0) + 1;
  }
  return counts;
};

const lintBefore = service.wikiLint();
const existingTitles = new Set(
  service.wikiList().map((entry) => normalizeComparableText(entry.title)),
);
const removed = [];
const added = [];

for (const entry of service.wikiList()) {
  const related = entry.related ?? [];
  const kept = [];
  const seen = new Set();
  for (const name of related) {
    const key = normalizeComparableText(name);
    if (!key || seen.has(key)) continue;
    if (!existingTitles.has(key)) {
      removed.push(`「${entry.title}」:「${name}」`);
      continue;
    }
    seen.add(key);
    kept.push(name);
  }
  let next = kept;

  // 语义补链：仅当有效关联过少时，按嵌入余弦相似度补足。
  if (kept.length < 3) {
    const suggestions = service
      .relatedWikiSuggestions({ entryId: entry.id, limit: 8 })
      .filter((item) => item.score >= 0.3);
    const titles = new Set(kept);
    for (const suggestion of suggestions) {
      if (next.length >= 3) break;
      if (titles.has(suggestion.title)) continue;
      titles.add(suggestion.title);
      next = [...next, suggestion.title];
      added.push(`「${entry.title}」+「${suggestion.title}」(${suggestion.score})`);
    }
  }

  // 内容变化才写入；"移除死链 + 补链后长度恰好不变"同样需要落盘。
  const nextKey = next.join("\u0000");
  const relatedKey = related.join("\u0000");
  if (nextKey !== relatedKey && !dryRun) {
    await service.updateWikiEntry({ entryId: entry.id, updates: { related: next } });
  }
}

console.log(`移除悬空引用 ${removed.length} 处`);
for (const line of removed.slice(0, 15)) console.log(`  - ${line}`);
if (removed.length > 15) console.log(`  …等共 ${removed.length} 处`);
console.log(`语义补链 ${added.length} 处`);
for (const line of added.slice(0, 15)) console.log(`  - ${line}`);
if (added.length > 15) console.log(`  …等共 ${added.length} 处`);

const after = lintTypeCounts(service.wikiLint());
const before = lintTypeCounts(lintBefore);
console.log(
  `修复前：${lintBefore.total} 条目，broken_related ${before.broken_related ?? 0}，orphan ${before.orphan ?? 0}，duplicate_title ${before.duplicate_title ?? 0}，near_duplicate ${before.near_duplicate ?? 0}`,
);
console.log(
  `修复后：broken_related ${after.broken_related ?? 0}，orphan ${after.orphan ?? 0}，duplicate_title ${after.duplicate_title ?? 0}，near_duplicate ${after.near_duplicate ?? 0}`,
);
if (dryRun) console.log("（dry-run：未写入任何变更）");
