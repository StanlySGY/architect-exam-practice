// 一次性数据修复：先备份，再合并同名条目，最后修复断链的 related 引用。
// 断链修复分两级：
//   - LLM 可用时：字符串初筛（bigram ≥ 0.4）出候选后，逐条让模型做语义校验，只应用判定的正确映射；
//   - LLM 不可用时：只应用保守规则（互相包含且双方 ≥4 字，如「专业素质」→「架构师的专业素质」），
//     避免把「白盒测试」修成「黑盒测试」这类字面相似、语义相反的错误。
// 用法：node scripts/fix-wiki-related.mjs [--dry-run]
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { QuestionGenerator } from "../src/generator.mjs";
import { PracticeService } from "../src/questions.mjs";
import { SQLiteStore } from "../src/store.mjs";

const root = resolve(fileURLToPath(import.meta.url), "../..");
const dryRun = process.argv.includes("--dry-run");
const SUGGEST_THRESHOLD = 0.4;

const store = new SQLiteStore(resolve(root, "data/state.sqlite"));
await store.init();
const service = new PracticeService({
  store,
  now: () => new Date().toISOString(),
});
await service.init();
const generator = new QuestionGenerator({ root, service });

const normalize = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");

// 1. 备份：修复前把完整学习状态导出到 data/ 下。
const backup = service.exportData();
if (!dryRun) {
  const backupPath = resolve(root, `data/wiki-fix-backup-${Date.now()}.json`);
  await writeFile(backupPath, JSON.stringify(backup, null, 2));
  console.log(`已备份到 ${backupPath}`);
}

// 2. 合并同名条目：保留存储顺序最早的，其余并入后删除。同名同题，合并是安全的。
const merged = [];
for (const lint of service.wikiLint().issues) {
  if (!lint.issues.includes("duplicate_title") || !lint.mergeInto) continue;
  if (dryRun) {
    merged.push(`「${lint.title}」→ 并入最早条目`);
    continue;
  }
  await service.mergeWikiEntry({ entryId: lint.id, intoId: lint.mergeInto });
  merged.push(`「${lint.title}」`);
}

// 3. 收集断链修复候选（bigram ≥ 0.4 的字符串初筛）。
const proposals = [];
for (const lint of service.wikiLint().issues) {
  for (const suggestion of lint.suggestions ?? []) {
    proposals.push({
      entryId: lint.id,
      entryTitle: lint.title,
      name: suggestion.name,
      candidate: suggestion.candidate,
    });
  }
}

// 4. LLM 语义校验：只放行"候选条目与原引用确为同一概念"的映射。
//    优先走 .env 里配置的模型接口；接口不可达时改用本机 claude CLI，再不行退回保守规则。
let verdicts = null;
if (proposals.length) {
  const listing = proposals
    .map(
      (item, index) =>
        `${index + 1}. 「${item.entryTitle}」的引用「${item.name}」→ 候选条目「${item.candidate}」`,
    )
    .join("\n");
  const envBackup = {
    baseUrl: process.env.ARCHITECT_LLM_BASE_URL,
    provider: process.env.ARCHITECT_LLM_PROVIDER,
  };
  try {
    try {
      await generator.callModel({
        runtimePrompt: "回复 OK",
        userPrompt: "回复 OK",
        schema: "{}",
        timeoutMs: 60_000,
      });
    } catch (error) {
      // 模型接口不可达：切换到本机 claude CLI 通道重试。
      delete process.env.ARCHITECT_LLM_BASE_URL;
      process.env.ARCHITECT_LLM_PROVIDER = "claude-cli";
      await generator.callModel({
        runtimePrompt: "回复 OK",
        userPrompt: "回复 OK",
        schema: "{}",
        timeoutMs: 60_000,
      });
    }
    const raw = await generator.callModel({
      runtimePrompt:
        "你是软考系统架构设计师知识库的数据质量管理员。给你一批 Wiki 条目断链引用的修复候选映射，请逐条判断：候选条目与原引用名是否指向**同一个知识点/概念**。仅字面相似但含义不同（如 白盒测试→黑盒测试、数据库→图数据库）、上位/下位概念混淆、候选条目无法代表原引用意图的，一律判 false。只返回一个 JSON 对象：{\"verdicts\":[{\"index\":序号,\"ok\":true或false}]}，不要输出其他文字。",
      userPrompt: listing,
      schema: "{}",
      timeoutMs: 600_000,
    });
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? raw);
    verdicts = new Map(
      (parsed.verdicts ?? []).map((item) => [Number(item.index), Boolean(item.ok)]),
    );
    console.log(`LLM 语义校验完成：${proposals.length} 条候选`);
  } catch (error) {
    console.log(`LLM 不可用（${error.message}），退回保守包含规则`);
  } finally {
    if (envBackup.baseUrl === undefined) delete process.env.ARCHITECT_LLM_BASE_URL;
    else process.env.ARCHITECT_LLM_BASE_URL = envBackup.baseUrl;
    if (envBackup.provider === undefined) delete process.env.ARCHITECT_LLM_PROVIDER;
    else process.env.ARCHITECT_LLM_PROVIDER = envBackup.provider;
  }
}

// 5. 应用修复。
const fixed = [];
const rejected = [];
const unfixed = [];
for (const [index, item] of proposals.entries()) {
  const nameNorm = normalize(item.name);
  const candidateNorm = normalize(item.candidate);
  const conservative =
    nameNorm.length >= 4 &&
    candidateNorm.length >= 4 &&
    (candidateNorm.includes(nameNorm) || nameNorm.includes(candidateNorm));
  let ok = conservative;
  let via = "包含规则";
  if (verdicts) {
    ok = verdicts.get(index + 1) === true;
    via = "LLM 校验";
  }
  if (!ok) {
    rejected.push(`「${item.entryTitle}」:「${item.name}」→「${item.candidate}」（${via}未通过）`);
    continue;
  }
  if (dryRun) {
    fixed.push(`「${item.entryTitle}」:「${item.name}」→「${item.candidate}」（${via}）`);
    continue;
  }
  await service.fixWikiRelated({
    entryId: item.entryId,
    name: item.name,
    candidate: item.candidate,
  });
  fixed.push(`「${item.entryTitle}」:「${item.name}」→「${item.candidate}」（${via}）`);
}

// 6. 剩余断链（没有候选或被否决的），列出来供知识库自检里人工处理。
for (const lint of service.wikiLint().issues) {
  const entry = service.wikiList().find((item) => item.id === lint.id);
  if (!entry) continue;
  for (const name of entry.related ?? []) {
    if (!service.resolveWikiEntry(name, { threshold: SUGGEST_THRESHOLD })) {
      unfixed.push(`「${entry.title}」:「${name}」`);
    }
  }
}

console.log(`合并同名条目 ${merged.length} 组`);
for (const line of merged) console.log(`  - ${line}`);
console.log(`修复断链引用 ${fixed.length} 处`);
for (const line of fixed) console.log(`  - ${line}`);
console.log(`否决可疑映射 ${rejected.length} 处`);
for (const line of rejected) console.log(`  - ${line}`);
console.log(`仍无法自动修复的引用 ${unfixed.length} 处`);
for (const line of unfixed) console.log(`  - ${line}`);
const after = service.wikiLint();
console.log(
  `修复后：共 ${after.total} 个条目，${after.problems} 个仍有问题（多为缺溯源或确实无对应条目的引用）`,
);
