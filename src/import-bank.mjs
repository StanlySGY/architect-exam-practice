import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const DEFAULT_BANK_RELATIVE = "../architect-exam-bank/data/bank.json";

const MODULE_CHAPTER = {
  architecture: 7,
  software_engineering: 5,
  computer_foundation: 2,
  database: 6,
  security: 4,
  network: 17,
  project_management: 5,
  english: 1,
  legal_ip: 1,
  new_technology: 11,
  embedded: 16,
  other: 3,
};

export function defaultBankFile(root = process.cwd()) {
  return process.env.ARCHITECT_BANK_FILE
    ? resolve(root, process.env.ARCHITECT_BANK_FILE)
    : resolve(root, DEFAULT_BANK_RELATIVE);
}

export function mapModule(moduleName) {
  return MODULE_CHAPTER[moduleName] ?? MODULE_CHAPTER.other;
}

export function mapDifficulty(value) {
  const stars = String(value ?? "").trim();
  if (!stars) return "medium";
  const count = [...stars].filter((char) => char === "★").length;
  if (count <= 1) return "easy";
  if (count <= 3) return "medium";
  return "hard";
}

export function compareExamTerms(left, right) {
  const leftKey = examTermKey(left);
  const rightKey = examTermKey(right);
  if (leftKey && rightKey) {
    for (let index = 0; index < leftKey.length; index += 1) {
      const difference = leftKey[index] - rightKey[index];
      if (difference) return difference;
    }
  } else if (leftKey) return -1;
  else if (rightKey) return 1;
  return String(left || "").localeCompare(String(right || ""), "zh-Hans-CN", {
    numeric: true,
  });
}

function examTermKey(value) {
  const term = String(value || "");
  const year = Number(term.match(/(20\d{2})年/u)?.[1]);
  if (!year) return null;
  const phase = term.includes("上半年")
    ? 1
    : term.includes("下半年")
      ? 2
      : Number(term.match(/年\s*(\d{1,2})月/u)?.[1] || 0);
  const arabicBatch = Number(
    term.match(/(?:第\s*)?(\d+)\s*(?:批次|模拟卷)/u)?.[1] || 0,
  );
  const chineseBatch = term.match(/第?([一二三四五六七八九十])批次/u)?.[1] || "";
  const batch = arabicBatch || "一二三四五六七八九十".indexOf(chineseBatch) + 1 || 0;
  return [year, phase, batch];
}

export function splitWritingPoints(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)、]|（\d+）)\s*/, "").trim())
    .filter(Boolean);
}

function sourceTypeOf(raw) {
  return raw.sourceType === "mock" || raw.source_type === "mock" ? "mock" : "real";
}

export function mapChoice(raw, createdAt) {
  const options = raw.options ?? {};
  const answer = String(raw.answer ?? raw.correctAnswer ?? "")
    .trim()
    .toUpperCase();
  return {
    id: String(raw.id),
    sourceType: sourceTypeOf(raw),
    source: "architect-practice",
    chapter: mapModule(raw.module),
    section: null,
    difficulty: mapDifficulty(raw.difficulty),
    knowledgePoint: raw.knowledge || raw.module || "综合知识",
    question: String(raw.stem ?? raw.question ?? "").trim(),
    options,
    correctAnswer: answer,
    analysis: String(raw.analysis ?? "").trim() || "暂无解析",
    term: raw.term || null,
    paper: raw.paper || null,
    questionNo: Number(raw.questionNo || raw.question_no) || null,
    module: raw.module || "other",
    sourceFile: raw.sourceFile || raw.source_file || null,
    createdAt,
  };
}

export function mapCase(raw, createdAt) {
  const subQuestions = Array.isArray(raw.subQuestions) ? raw.subQuestions : [];
  const defaultPoints = subQuestions.length
    ? Math.max(1, Math.round(25 / subQuestions.length))
    : 25;
  const title = String(raw.title ?? "").trim();
  const scenario = String(raw.description ?? "").trim() || title;
  return {
    id: String(raw.id),
    sourceType: sourceTypeOf(raw),
    source: "architect-practice",
    chapter: mapModule(raw.module),
    section: null,
    title,
    scenario,
    knowledgePoint: raw.module || "案例分析",
    questions: subQuestions.map((item, index) => ({
      id: String(item.question_label || index + 1),
      text: String(item.prompt ?? item.text ?? "").trim(),
      points: Number(item.points) || defaultPoints,
      referenceAnswer: String(item.reference_answer ?? item.referenceAnswer ?? "").trim(),
    })),
    term: raw.term || null,
    paper: raw.paper || null,
    module: raw.module || "other",
    sourceFile: raw.sourceFile || raw.source_file || null,
    createdAt,
  };
}

export function mapPaper(raw, createdAt) {
  return {
    id: String(raw.id),
    sourceType: sourceTypeOf(raw),
    source: "architect-practice",
    chapter: mapModule(raw.module) || 20,
    section: null,
    title: String(raw.title ?? "").trim(),
    description: String(raw.prompt ?? raw.description ?? "").trim(),
    knowledgePoint: raw.module || "论文写作",
    writingPoints: splitWritingPoints(raw.writingPoints ?? raw.writing_points),
    draft: "",
    grade: null,
    term: raw.term || null,
    paper: raw.paper || null,
    module: raw.module || "other",
    sourceFile: raw.sourceFile || raw.source_file || null,
    createdAt,
  };
}

function isValidChoice(item) {
  return (
    item.id &&
    item.question &&
    item.options &&
    ["A", "B", "C", "D"].every(
      (key) => typeof item.options[key] === "string" && item.options[key].trim(),
    ) &&
    ["A", "B", "C", "D"].includes(item.correctAnswer)
  );
}

function isValidCase(item) {
  return item.id && item.title && item.scenario && Array.isArray(item.questions);
}

function isValidPaper(item) {
  return item.id && item.title && item.description;
}

export function mapArchitectBank(raw, createdAt = new Date().toISOString()) {
  const choices = Array.isArray(raw?.choices) ? raw.choices : [];
  const cases = Array.isArray(raw?.cases) ? raw.cases : [];
  const essays = Array.isArray(raw?.essays) ? raw.essays : [];
  return {
    questions: choices.map((item) => mapChoice(item, createdAt)).filter(isValidChoice),
    cases: cases.map((item) => mapCase(item, createdAt)).filter(isValidCase),
    papers: essays.map((item) => mapPaper(item, createdAt)).filter(isValidPaper),
  };
}

export async function readArchitectBank(file) {
  let raw;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw Object.assign(new Error(`找不到真题库文件：${file}`), {
        status: 404,
        code: "BANK_FILE_MISSING",
      });
    }
    throw Object.assign(new Error(`无法读取真题库：${error.message}`), {
      status: 400,
      code: "INVALID_BANK",
      cause: error,
    });
  }
  return mapArchitectBank(raw);
}

export const MODULE_LABELS = {
  architecture: "架构设计",
  software_engineering: "软件工程",
  computer_foundation: "计算机基础",
  database: "数据库",
  security: "信息安全",
  network: "网络",
  project_management: "项目管理",
  english: "英语",
  legal_ip: "法律与知识产权",
  new_technology: "新兴技术",
  embedded: "嵌入式",
  other: "其他",
};

export function mapModuleLabel(moduleName) {
  return MODULE_LABELS[moduleName] || MODULE_LABELS.other;
}

export function catalogFromImported({ questions = [], cases = [], papers = [] }) {
  const rows = new Map();
  const bump = (item, field) => {
    const term = item.term || "未知考期";
    const sourceType = item.sourceType === "mock" ? "mock" : "real";
    const key = `${sourceType}:${term}`;
    if (!rows.has(key)) {
      rows.set(key, {
        term,
        sourceType,
        paper: item.paper || null,
        questions: 0,
        cases: 0,
        papers: 0,
        expectedQuestions: sourceType === "real" ? 75 : 0,
        missingQuestionNos: [],
      });
    }
    const row = rows.get(key);
    row[field] += 1;
    if (!row.paper && item.paper) row.paper = item.paper;
  };
  for (const item of questions) bump(item, "questions");
  for (const item of cases) bump(item, "cases");
  for (const item of papers) bump(item, "papers");
  for (const row of rows.values()) {
    if (row.sourceType !== "real") continue;
    const present = new Set(
      questions
        .filter(
          (item) =>
            (item.term || "未知考期") === row.term &&
            item.sourceType !== "mock" &&
            item.questionNo,
        )
        .map((item) => item.questionNo),
    );
    row.missingQuestionNos = [];
    for (let number = 1; number <= row.expectedQuestions; number += 1) {
      if (!present.has(number)) row.missingQuestionNos.push(number);
    }
  }
  return [...rows.values()].sort((left, right) => {
    const typeOrder = Number(left.sourceType === "mock") - Number(right.sourceType === "mock");
    if (typeOrder) return typeOrder;
    return compareExamTerms(right.term, left.term);
  });
}
