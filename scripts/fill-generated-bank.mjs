import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chapterOutline, findChapter, findSection, readMindMap } from "../src/mindmap.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const argumentsList = process.argv.slice(2);
const apply = argumentsList.includes("--apply");
const target = Number(argumentsList.find((arg) => arg.startsWith("--target="))?.split("=")[1] ?? 20);
const selectedChapter = Number(argumentsList.find((arg) => arg.startsWith("--chapter="))?.split("=")[1] ?? 0);
const baseUrl = new URL(process.env.BANK_BASE_URL || "http://127.0.0.1:3210");

if (!Number.isInteger(target) || target < 1 || target > 60) throw new Error("--target 必须在 1 到 60 之间");
if (!(["127.0.0.1", "localhost", "[::1]"].includes(baseUrl.hostname) && baseUrl.protocol === "http:")) {
  throw new Error("只能连接本机 HTTP 服务，避免意外暴露学习数据");
}

async function request(path, body) {
  const response = await fetch(new URL(path, baseUrl), {
    ...(body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(body === undefined ? 30_000 : 750_000),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || `HTTP ${response.status}`);
    error.code = data.code;
    throw error;
  }
  return data;
}

function validateQuestions(questions, chapterNode, allowedNode, beforeIds) {
  const invalid = [];
  for (const question of questions.filter((item) => !beforeIds.has(item.id))) {
    const options = Object.values(question.options ?? {});
    const sourceParts = question.sourceNode?.split(" › ").map((part) => part.trim()) ?? [];
    let source = sourceParts[0] === chapterNode.text ? chapterNode : null;
    for (const part of sourceParts.slice(1)) {
      source = source?.children.find((child) => child.text === part) ?? null;
    }
    const inScope = allowedNode === chapterNode
      ? sourceParts[0] === chapterNode.text
      : sourceParts[0] === chapterNode.text && sourceParts[1] === allowedNode?.text;
    if (
      !question.question?.trim() ||
      options.length !== 4 ||
      options.some((option) => !String(option).trim()) ||
      new Set(options.map((option) => String(option).trim())).size !== 4 ||
      !["A", "B", "C", "D"].includes(question.correctAnswer) ||
      !question.analysis?.trim() ||
      !source ||
      !inScope
    ) invalid.push(question.id);
  }
  return invalid;
}

async function chapterQuestions(chapterId) {
  const { records, total } = await request(`/api/questions?chapter=${chapterId}&sourceType=generated&limit=100`);
  if (total > 100) throw new Error(`第 ${chapterId} 章超出校验上限，请先检查题库`);
  return records;
}

async function removeQuestion(questionId) {
  const response = await fetch(new URL(`/api/questions/${encodeURIComponent(questionId)}`, baseUrl), {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirm: "DELETE" }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`删除来源无效的新题失败：${questionId}（HTTP ${response.status}）`);
}

async function generateWhenAvailable(body, chapterId) {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const before = await chapterQuestions(chapterId);
    try {
      return { result: await request("/api/generate", body), before };
    } catch (error) {
      if (error.code !== "LLM_GENERATION_BUSY" || attempt === 20) throw error;
      console.log(`模型正被其他任务使用；等待 15 秒后重试（${attempt}/20）`);
      await new Promise((resolve) => setTimeout(resolve, 15_000));
    }
  }
}

const { chapters } = await request("/api/chapters");
const mindMap = await readMindMap(join(projectRoot, "architect.mm"));
const tasks = chapters.filter((chapter) => !selectedChapter || chapter.id === selectedChapter);
if (!tasks.length) throw new Error(`没有找到第 ${selectedChapter} 章`);

if (!apply) {
  for (const chapter of tasks) {
    console.log(`第 ${chapter.id} 章 ${chapter.title}: ${chapter.counts.all}/${target} 道生成题`);
  }
  console.log("只读预览；确认后使用 --apply 补齐。生成题为 AI 草稿，重要知识点仍需人工核查。 ");
  process.exit(0);
}

const status = await request("/api/model-status");
if (!status.configured) throw new Error("模型未配置，不能补题");
const backup = await request("/api/data/export");
if (backup.format !== "architect-practice-backup" || !Array.isArray(backup.data?.generatedQuestions)) {
  throw new Error("无法验证完整备份，已取消补题");
}
const backupDir = join(homedir(), ".local", "share", "architect-exam-practice", "backups");
await mkdir(backupDir, { recursive: true });
const backupPath = join(backupDir, `${new Date().toISOString().replaceAll(":", "-")}-before-bank-fill.json`);
const serializedBackup = JSON.stringify(backup);
await writeFile(backupPath, serializedBackup, { mode: 0o600, flag: "wx" });
const verifiedBackup = await readFile(backupPath, "utf8");
if (verifiedBackup !== serializedBackup) {
  throw new Error("备份校验失败，已取消补题");
}
console.log(`已备份 ${backup.data.generatedQuestions.length} 道原题：${backupPath}`);

const failures = [];
for (const chapter of tasks) {
  let remaining = Math.max(0, target - chapter.counts.all);
  if (!remaining) continue;
  const chapterNode = findChapter(mindMap, chapter.id);
  if (!chapterNode) {
    failures.push(`第 ${chapter.id} 章导图缺失`);
    continue;
  }
  const { sections } = await request(`/api/sections?chapter=${chapter.id}`);
  const availableSections = sections.filter((section) => {
    const sectionNode = findSection(chapterNode, section.id);
    return sectionNode && chapterOutline(sectionNode).length >= 300;
  });
  const batches = Math.min(12, Math.ceil(remaining / 5) + 4);
  for (let index = 0; index < batches && remaining > 0; index += 1) {
    const ranked = availableSections.toSorted((left, right) => left.counts.all - right.counts.all);
    const section = ranked[index % Math.min(4, ranked.length)]?.id ?? "all";
    const difficulty = index % 4 === 0 ? "easy" : index % 4 === 3 ? "hard" : "medium";
    const count = Math.min(5, remaining);
    try {
      const { result, before } = await generateWhenAvailable({ chapter: chapter.id, section, difficulty, count }, chapter.id);
      const after = await chapterQuestions(chapter.id);
      const allowedNode = section === "all" ? chapterNode : findSection(chapterNode, section);
      const invalid = validateQuestions(after, chapterNode, allowedNode, new Set(before.map((item) => item.id)));
      for (const questionId of invalid) await removeQuestion(questionId);
      const delta = after.filter((item) => !before.some((prior) => prior.id === item.id)).length;
      remaining = Math.max(0, target - (after.filter((item) => !item.disabledAt).length - invalid.length));
      console.log(`第 ${chapter.id} 章 ${section} ${difficulty}: +${delta - invalid.length}，剩余 ${remaining}；去重 ${result.duplicatesSkipped ?? 0}，无效来源 ${invalid.length}`);
      if (invalid.length) {
        console.log(`已移除本批来源无法核对的题目：${invalid.join(", ")}`);
      }
    } catch (error) {
      failures.push(`第 ${chapter.id} 章 ${section} ${difficulty} 生成失败：${error.code || error.message}`);
      break;
    }
  }
  if (remaining) failures.push(`第 ${chapter.id} 章尚缺 ${remaining} 道生成题`);
}

console.log("最终各章数量：");
for (const chapter of (await request("/api/chapters")).chapters) {
  console.log(`第 ${chapter.id} 章 ${chapter.counts.all} 道`);
}
if (failures.length) {
  console.error("未完成或需要核查：\n" + failures.join("\n"));
  process.exitCode = 1;
}
