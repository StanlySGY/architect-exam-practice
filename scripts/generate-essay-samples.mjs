// 生成论文 AI 参考范文：为指定论文题撰写结构完整的第一人称范文，
// 写入相邻题库 data/ai-essay-samples.json（ExamAssets 运行时挂载到论文卡片）。
// 生成的范文明确标注"AI 参考范文（非官方）"，仅供学习论文结构与写法。
// 用法：
//   NODE_USE_ENV_PROXY=1 node scripts/generate-essay-samples.mjs --list          # 列出候选
//   NODE_USE_ENV_PROXY=1 node scripts/generate-essay-samples.mjs --recent=3      # 最近 3 个考期的真题
//   NODE_USE_ENV_PROXY=1 node scripts/generate-essay-samples.mjs --id=essay-xxx  # 指定题目
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { QuestionGenerator } from "../src/generator.mjs";
import { PracticeService } from "../src/questions.mjs";
import { SQLiteStore } from "../src/store.mjs";
import { defaultBankDataDir } from "../src/exam-assets.mjs";

const root = resolve(fileURLToPath(import.meta.url), "../..");
const argumentsList = process.argv.slice(2);
const listOnly = argumentsList.includes("--list");
const recentCount = Number(
  argumentsList.find((arg) => arg.startsWith("--recent="))?.split("=")[1] ?? 0,
);
const idFlag = argumentsList.find((arg) => arg.startsWith("--id="))?.slice(5);

const store = new SQLiteStore(resolve(root, "data/state.sqlite"));
await store.init();
const service = new PracticeService({
  store,
  now: () => new Date().toISOString(),
});
await service.init();
const generator = new QuestionGenerator({ root, service });

const samplesFile = resolve(defaultBankDataDir(root), "ai-essay-samples.json");
const existing = await readFile(samplesFile, "utf8")
  .then((text) => JSON.parse(text))
  .catch(() => ({ schemaVersion: 1, samples: {} }));
const samples = existing.samples ?? {};

// 候选：全部论文题；默认优先"真题"，按考期倒序。
const allPapers = service.paperList().filter((paper) => !samples[paper.id]);
const realPapers = allPapers
  .filter((paper) => paper.sourceType === "real")
  .sort((left, right) => String(right.term ?? "").localeCompare(String(left.term ?? "")));

let selected;
if (idFlag) {
  selected = allPapers.filter((paper) => paper.id === idFlag);
  if (!selected.length) {
    console.error(`没有找到论文题 ${idFlag}（或已生成过范文）`);
    process.exit(1);
  }
} else if (recentCount) {
  selected = realPapers.slice(0, recentCount);
} else {
  selected = [];
  console.log("用法：--list 查看，--recent=N 生成最近 N 个考期的真题范文，--id=<id> 指定题目");
}

if (listOnly) {
  console.log(`真题论文（按考期倒序，共 ${realPapers.length} 道，已生成 ${Object.keys(samples).length} 篇）：`);
  for (const paper of realPapers.slice(0, 15)) {
    console.log(`  ${paper.id} | ${paper.term} | ${paper.title}${samples[paper.id] ? "（已有范文）" : ""}`);
  }
  process.exit(0);
}
if (!selected.length) {
  console.log("没有指定要生成的题目。");
  process.exit(0);
}

const schema = JSON.stringify({
  type: "object",
  properties: { content: { type: "string" } },
  required: ["content"],
});

let done = 0;
for (const paper of selected) {
  const writingPoints = (paper.writingPoints ?? []).join("\n");
  const runtimePrompt = [
    "你是软考系统架构设计师考试的论文写作教练。请按用户给的论题写一篇符合考试要求的参考范文。",
    "硬性要求：",
    "- 第一行只写\"摘要\"二字，另起一段写摘要（300-400 字），概括项目背景、本人职责、论文主线与实施效果。",
    '- 摘要之后另起标题"正文"，正文 2000-3000 字，用第一人称"我"叙述真实项目经验。',
    "- 正文必须依次覆盖论题要求的各个论述方面，并自然融入写作要点，不逐条罗列要点。",
    "- 项目细节要具体可信（规模、技术选型、数据、遇到的坑与解决），避免空话套话。",
    "- 结尾总结项目效果与不足，呼应摘要。",
    "只输出 JSON：{\"content\":\"全文\"}，全文内部用 \\n 分段。",
  ].join("\n");
  const userPrompt = [
    `论题：${paper.title}`,
    "",
    `论题要求：${paper.description ?? paper.prompt ?? ""}`,
    writingPoints ? `\n写作要点（须覆盖）：\n${writingPoints}` : "",
  ].join("\n");

  try {
    // 长文生成下流式响应偶发"内容为空"：非流式 + 提示词变体三选一重试。
    const streamBackup = process.env.ARCHITECT_LLM_STREAM;
    process.env.ARCHITECT_LLM_STREAM = "false";
    const promptVariants = [
      runtimePrompt,
      runtimePrompt + "\n\n请立即开始输出 JSON，不要输出任何其他内容。",
      "写一篇软考架构师论文范文，只输出 JSON：{\"content\":\"全文\"}。\n\n" + runtimePrompt,
    ];
    let raw = null;
    let lastError = null;
    try {
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
    } finally {
      if (streamBackup === undefined) delete process.env.ARCHITECT_LLM_STREAM;
      else process.env.ARCHITECT_LLM_STREAM = streamBackup;
    }
    if (raw === null) throw lastError;
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? raw);
    const content = String(parsed.content ?? "").trim();
    if (content.length < 1500) {
      console.error(`${paper.id} 范文过短（${content.length} 字），已跳过`);
      continue;
    }
    samples[paper.id] = {
      content,
      generatedAt: service.now(),
      model: process.env.ARCHITECT_LLM_MODEL ?? null,
      note: "AI 参考范文（非官方），仅供学习论文结构与写法；请勿在考试中照搬项目经历。",
    };
    done += 1;
    console.log(`已生成 ${paper.id}（${paper.term ?? ""} ${paper.title}）范文 ${content.length} 字`);
  } catch (error) {
    console.error(`${paper.id} 生成失败：${error.message} (${error.code || "?"})`);
  }
  // 中转限流（15 RPM）：间隔 5 秒。
  await new Promise((r) => setTimeout(r, 5_000));
}

if (done) {
  existing.schemaVersion = 1;
  existing.samples = samples;
  await writeFile(samplesFile, JSON.stringify(existing, null, 1));
  console.log(`已写入 ${samplesFile}（累计 ${Object.keys(samples).length} 篇）`);
} else {
  console.log("本次没有新范文。");
}
