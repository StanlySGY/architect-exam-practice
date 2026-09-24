// 一次性数据维护：清理条目内只差标点/空格的近似重复要点，并修正已知的术语措辞问题。
// 用法：node scripts/maintain-wiki.mjs
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PracticeService } from "../src/questions.mjs";
import { SQLiteStore } from "../src/store.mjs";

const root = resolve(fileURLToPath(import.meta.url), "../..");
const store = new SQLiteStore(resolve(root, "data/state.sqlite"));
await store.init();
const service = new PracticeService({
  store,
  now: () => new Date().toISOString(),
});
await service.init();

const normalize = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");

// 1. 去重每个条目的 keyPoints / commonMistakes（归一化后相同只保留首个变体）。
let cleaned = 0;
for (const entry of service.wikiList()) {
  const dedupe = (list) => {
    const seen = new Set();
    const result = [];
    for (const item of Array.isArray(list) ? list : []) {
      const text = String(item).trim();
      if (!text) continue;
      const key = normalize(text);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(text);
    }
    return result;
  };
  const keyPoints = dedupe(entry.keyPoints);
  const commonMistakes = dedupe(entry.commonMistakes);
  if (
    keyPoints.length !== (entry.keyPoints ?? []).length ||
    commonMistakes.length !== (entry.commonMistakes ?? []).length
  ) {
    await service.updateWikiEntry({
      entryId: entry.id,
      updates: { keyPoints, commonMistakes },
    });
    cleaned += 1;
    console.log(
      `已去重 「${entry.title}」 要点 ${(entry.keyPoints ?? []).length}→${keyPoints.length}，误区 ${(entry.commonMistakes ?? []).length}→${commonMistakes.length}`,
    );
  }
}

// 2. 术语修正：BLP 模型的简单安全性质与 *性质 读写对象是"客体"，不是"主体"。
const blp = service
  .wikiList()
  .find((entry) => entry.title.includes("Bell-LaPadula"));
if (blp) {
  const corrected = (blp.keyPoints ?? []).map((point) =>
    point
      .replace("安全级别不高于自身的主体（不上读）", "安全级别不高于自身密级的客体（不上读）")
      .replace("安全级别不低于自身的主体（不下写）", "安全级别不低于自身密级的客体（不下写）"),
  );
  if (corrected.some((point, index) => point !== blp.keyPoints[index])) {
    await service.updateWikiEntry({
      entryId: blp.id,
      updates: { keyPoints: corrected },
    });
    console.log(`已修正 「${blp.title}」 的主体/客体术语`);
  }
}

console.log(`维护完成：清理 ${cleaned} 个条目`);
