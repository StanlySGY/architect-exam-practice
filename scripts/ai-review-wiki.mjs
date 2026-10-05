// 批量 AI 校对 Wiki 条目：逐条对照思维导图来源资料，修正/标记内容。
// 背景：条目全部由 LLM 依据导图生成，长期停留"待校对"。本脚本让模型
// 以"资料原文 vs 条目内容"做事实核对：
//   - ok        内容与资料一致           → 标记已校对；
//   - corrected 摘要/要点/误区有偏差     → 按资料修正后标记已校对；
//   - flag      与资料矛盾且无法自动修正 → 标记存疑，reason 写入 aiCheckNote。
// 每个条目都会写入 aiCheckedAt 与 aiCheckNote，供页面展示核对痕迹。
// 用法：NODE_USE_ENV_PROXY=1 node scripts/ai-review-wiki.mjs [--dry-run] [--include-reviewed] [--limit=N]
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { QuestionGenerator } from "../src/generator.mjs";
import { PracticeService } from "../src/questions.mjs";
import { SQLiteStore } from "../src/store.mjs";

const root = resolve(fileURLToPath(import.meta.url), "../..");
const dryRun = process.argv.includes("--dry-run");
const includeReviewed = process.argv.includes("--include-reviewed");
const limitFlag = Number(
  process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1] ?? 0,
);

const normalizeTitle = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");

const store = new SQLiteStore(resolve(root, "data/state.sqlite"));
await store.init();
const service = new PracticeService({
  store,
  now: () => new Date().toISOString(),
});
await service.init();
const generator = new QuestionGenerator({ root, service });

// 1. 备份。
const backup = await service.exportData();
if (!dryRun) {
  const backupPath = resolve(root, `data/wiki-ai-review-backup-${Date.now()}.json`);
  await writeFile(backupPath, JSON.stringify(backup));
  console.log(`已备份到 ${backupPath}`);
}

// 2. 按章节分组（一次调用核对整章条目，控制调用量），未校对过的条目才参与。
const groups = new Map();
for (const entry of service.wikiList()) {
  if (!includeReviewed && entry.status === "reviewed") continue;
  if (!groups.has(entry.chapter)) groups.set(entry.chapter, []);
  groups.get(entry.chapter).push(entry);
}
console.log(`待校对分组 ${groups.size} 组，共 ${[...groups.values()].flat().length} 条`);

const schema = JSON.stringify({
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          verdict: { type: "string", enum: ["ok", "corrected", "flag"] },
          summary: { type: "string" },
          key_points: { type: "array", items: { type: "string" } },
          common_mistakes: { type: "array", items: { type: "string" } },
          reason: { type: "string" },
        },
        required: ["title", "verdict", "reason"],
      },
    },
  },
  required: ["results"],
});

const verdictMap = {
  ok: "ok",
  一致: "ok",
  通过: "ok",
  corrected: "corrected",
  修正: "corrected",
  已修正: "corrected",
  flag: "flag",
  存疑: "flag",
  矛盾: "flag",
};

const counts = { ok: 0, corrected: 0, flag: 0, failed: 0 };
const failures = [];
let groupIndex = 0;

for (const [chapterId, entries] of groups) {
  if (limitFlag && groupIndex >= limitFlag) break;
  groupIndex += 1;
  const chapter = service
    .chapterList()
    .find((item) => item.id === Number(chapterId));
  if (!chapter) {
    failures.push(`分组 ${chapterId}: 章节不存在`);
    for (const entry of entries) counts.failed += 1;
    continue;
  }
  let material;
  try {
    material = await generator.extractMaterial(chapter, "all");
  } catch (error) {
    failures.push(`分组 ${chapterId}: ${error.message}`);
    for (const entry of entries) counts.failed += 1;
    continue;
  }

  const entriesPayload = entries.map((entry) => ({
    title: entry.title,
    summary: entry.summary,
    key_points: entry.keyPoints ?? [],
    common_mistakes: entry.commonMistakes ?? [],
  }));
  const runtimePrompt = [
    "你是软考系统架构设计师知识库的校对员。给你一段教材思维导图资料和若干基于它生成的知识点条目。",
    "逐条把条目内容与资料原文核对：事实、术语、归类、数字必须以资料为准。",
    "只依据给定资料判断，不要引入资料之外的知识补充条目内容。",
    "",
    "输出必须是 JSON 对象，键名严格使用英文，形状如下（verdict 只允许 ok / corrected / flag 三个值）：",
    '{"results":[{"title":"条目标题原文","verdict":"ok","summary":"修正后的摘要","key_points":["修正后要点"],"common_mistakes":["修正后误区"],"reason":"中文判定理由"}]}',
    "",
    "判定规则：",
    '- "ok"：条目内容与资料一致（表述不同但含义一致也算），summary/key_points/common_mistakes 可省略。',
    '- "corrected"：摘要/要点/误区与资料有出入但不严重，必须在返回里给出修正后的完整 summary、key_points、common_mistakes。',
    '- "flag"：条目与资料矛盾、或资料完全不支持该条目、或无法可靠修正，reason 写清矛盾点。',
  ].join("\n");
  const userPrompt = [
    `【资料（第 ${chapterId} 章 整章）】`,
    material.text,
    "",
    `【待校对条目，共 ${entriesPayload.length} 条】`,
    JSON.stringify(entriesPayload, null, 1),
    "",
    `请对以上 ${entriesPayload.length} 条逐条给出校对结果：results 数组长度必须等于 ${entriesPayload.length}，title 一律使用条目标题原文，verdict 只能取 ok / corrected / flag。`,
  ].join("\n");

  try {
    // 上游偶发"推理后停止、内容为空"：换措辞重试可穿透。
    const promptVariants = [
      runtimePrompt,
      runtimePrompt + "\n\n请立即开始输出 JSON，不要输出任何其他内容。",
      "校对知识点条目并返回 JSON。逐条对照资料，输出 {\"results\":[{\"title\":\"标题\",\"verdict\":\"ok|corrected|flag\",\"reason\":\"理由\"}]}。\n\n" + runtimePrompt,
    ];
    let raw = null;
    let lastError = null;
    for (const prompt of promptVariants) {
      try {
        raw = await generator.callModel({
          runtimePrompt: prompt,
          userPrompt,
          schema,
          timeoutMs: 600_000,
        });
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (raw === null) throw lastError;
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? raw);
    const pending = new Map(entries.map((entry) => [entry.title, entry]));
    for (const result of parsed.results ?? []) {
      const titleRaw = String(result.title ?? "").trim();
      let entry = pending.get(titleRaw);
      if (!entry) {
        // 模型偶发改写标题：退回归一化互相包含匹配兜底。
        const titleNorm = normalizeTitle(titleRaw);
        entry = [...pending.values()].find((candidate) => {
          const own = normalizeTitle(candidate.title);
          return own && titleNorm && (own.includes(titleNorm) || titleNorm.includes(own));
        });
      }
      if (!entry) {
        failures.push(`分组 ${chapterId}: 模型返回了未知条目「${titleRaw}」`);
        continue;
      }
      pending.delete(entry.title);
      const verdictRaw = String(result.verdict ?? "").trim().toLowerCase();
      const verdict = verdictMap[verdictRaw] ?? verdictMap[verdictRaw.replace(/\s/g, "")];
      if (!["ok", "corrected", "flag"].includes(verdict)) {
        failures.push(`分组 ${chapterId}: 「${entry.title}」判定无效 ${result.verdict}`);
        counts.failed += 1;
        continue;
      }
      const note = `AI 校对（${verdict}）：${String(result.reason ?? "").trim()}`.slice(0, 400);
      if (dryRun) {
        counts[verdict] += 1;
        continue;
      }
      if (verdict === "corrected") {
        await service.updateWikiEntry({
          entryId: entry.id,
          updates: {
            summary: String(result.summary ?? entry.summary).trim() || entry.summary,
            keyPoints: Array.isArray(result.key_points) && result.key_points.length
              ? result.key_points.map((p) => String(p).trim()).filter(Boolean)
              : entry.keyPoints,
            commonMistakes: Array.isArray(result.common_mistakes) && result.common_mistakes.length
              ? result.common_mistakes.map((p) => String(p).trim()).filter(Boolean)
              : entry.commonMistakes,
            aiCheckedAt: service.now(),
            aiCheckNote: note,
          },
        });
        await service.setWikiStatus({ entryId: entry.id, status: "reviewed" });
      } else if (verdict === "ok") {
        await service.updateWikiEntry({
          entryId: entry.id,
          updates: { aiCheckedAt: service.now(), aiCheckNote: note },
        });
        await service.setWikiStatus({ entryId: entry.id, status: "reviewed" });
      } else {
        await service.updateWikiEntry({
          entryId: entry.id,
          updates: { aiCheckedAt: service.now(), aiCheckNote: note },
        });
        await service.setWikiStatus({ entryId: entry.id, status: "flagged" });
      }
      counts[verdict] += 1;
    }
    if (pending.size) {
      failures.push(
        `分组 ${chapterId}: 模型漏答 ${pending.size} 条（${[...pending.values()].map((e) => e.title).join("、")}）`,
      );
      counts.failed += pending.size;
    }
    console.log(
      `[${groupIndex}/${groups.size}] 第 ${chapterId} 章: ${entries.length} 条 → 累计 ok ${counts.ok} / corrected ${counts.corrected} / flag ${counts.flag} / failed ${counts.failed}`,
    );
  } catch (error) {
    failures.push(
      `分组 ${chapterId}: ${error.message} (${error.code || "?"}${error.status ? " HTTP " + error.status : ""})`,
    );
    counts.failed += entries.length;
  }
}

console.log(
  `校对完成：ok ${counts.ok}，corrected ${counts.corrected}，flag ${counts.flag}，failed ${counts.failed}`,
);
if (failures.length) {
  console.error("需要关注：\n" + failures.slice(0, 20).join("\n"));
  if (failures.length > 20) console.error(`…等共 ${failures.length} 条`);
  process.exitCode = 1;
}
