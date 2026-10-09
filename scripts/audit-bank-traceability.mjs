import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const normalize = (value) =>
  String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();

function distribution(items, pick) {
  const counts = {};
  for (const item of items) {
    const key = String(pick(item) ?? "(missing)");
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort((left, right) => right[1] - left[1]),
  );
}

function groupsBy(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

function summarizeSubjective(items) {
  return {
    total: items.length,
    sourceFileMissing: items.filter((item) => !String(item.sourceFile ?? "").trim()).length,
    answerSourceDistribution: distribution(items, (item) => item.answerSource),
    answerSourceMissing: items.filter((item) => !String(item.answerSource ?? "").trim()).length,
    glmReviewedLabel: items.filter((item) => item.answerSource === "glm-5.2-reviewed").length,
  };
}

export function auditBank(bank, { sourcePath = null } = {}) {
  const choices = Array.isArray(bank?.choices) ? bank.choices : [];
  const cases = Array.isArray(bank?.cases) ? bank.cases : [];
  const essays = Array.isArray(bank?.essays) ? bank.essays : [];
  const mockChoices = choices.filter((item) => item.sourceType === "mock");
  const optionKey = (item) =>
    ["A", "B", "C", "D"].map((key) => normalize(item.options?.[key])).join("|");
  const repeatedMockStems = groupsBy(mockChoices, (item) => normalize(item.stem))
    .filter((group) => new Set(group.map((item) => String(item.term) + "|" + String(item.paper))).size > 1);
  const exactItemsAcrossPapers = groupsBy(choices, (item) => normalize(item.stem) + "##" + optionKey(item))
    .filter((group) => new Set(group.map((item) => String(item.sourceType) + "|" + String(item.term) + "|" + String(item.paper))).size > 1);
  const sharedStemOptionGroupsWithinPaper = groupsBy(choices, (item) => normalize(item.stem) + "##" + optionKey(item))
    .filter((group) => new Set(group.map((item) => String(item.sourceType) + "|" + String(item.term) + "|" + String(item.paper))).size === 1);

  const sourceNote = String(bank?.source?.note ?? "");
  const report = {
    reportVersion: 1,
    sourcePath,
    readOnly: true,
    manifestGeneratedAt: bank?.manifest?.generated_at ?? null,
    declaredSource: bank?.source ?? null,
    counts: { choices: choices.length, cases: cases.length, essays: essays.length },
    choices: {
      total: choices.length,
      sourceTypeDistribution: distribution(choices, (item) => item.sourceType),
      missingSourceFile: choices.filter((item) => !String(item.sourceFile ?? "").trim()).length,
      missingPreciseSourceReference: choices.filter((item) => !["sourceUrl", "sourcePage", "sourceReference", "sourceCitation", "sourceLocation"].some((key) => String(item[key] ?? "").trim())).length,
      answerTrustMetadataComplete: choices.filter((item) => String(item.answerTrust ?? "").trim() && String(item.answerTrustLabel ?? "").trim()).length,
      missingAnalysis: choices.filter((item) => !String(item.analysis ?? "").trim()).length,
      missingOptions: choices.filter((item) => !item.options || ["A", "B", "C", "D"].some((key) => !String(item.options[key] ?? "").trim())).length,
      invalidAnswer: choices.filter((item) => !["A", "B", "C", "D"].includes(String(item.answer ?? "").trim())).length,
      answerDistribution: distribution(choices, (item) => item.answer),
      repeatedMockStemGroupsAcrossPapers: repeatedMockStems.length,
      repeatedMockStemExamples: repeatedMockStems.slice(0, 10).map((group) => group.map((item) => ({
        id: item.id, term: item.term, paper: item.paper, questionNo: item.questionNo, answer: item.answer, stem: String(item.stem ?? "").slice(0, 100),
      }))),
      exactSameStemAndOptionsGroupsAcrossPapers: exactItemsAcrossPapers.length,
      sharedStemAndOptionsGroupsWithinPaper: sharedStemOptionGroupsWithinPaper.length,
    },
    cases: summarizeSubjective(cases),
    essays: summarizeSubjective(essays),
    warnings: [],
  };

  if (/non.?official|非官方/i.test(sourceNote)) report.warnings.push("题库元数据明确声明答案为非官方整理；结构完整不等于答案经过官方核验。");
  if (report.choices.missingPreciseSourceReference) report.warnings.push("选择题缺少题目级 URL、页码或条款定位；sourceFile 仅提供路径标记，不能替代精确出处。");
  if (report.choices.answerTrustMetadataComplete < choices.length) report.warnings.push("选择题没有完整的 answerTrust 元数据，不能按题目区分官方答案、第三方整理或未核验状态。");
  if (report.choices.repeatedMockStemGroupsAcrossPapers) report.warnings.push("模拟卷之间存在重复题干候选；脚本不自动删除，需比较选项、答案和知识考点。");
  if (cases.some((item) => !String(item.answerSource ?? "").trim()) || essays.some((item) => !String(item.answerSource ?? "").trim())) report.warnings.push("部分案例/论文没有 answerSource 标记；这表示来源元数据缺失，不直接推断答案缺失或错误。");
  return report;
}

export function auditSourcePaths(bank, sourceRoot) {
  const result = {};
  for (const kind of ["choices", "cases", "essays"]) {
    const items = Array.isArray(bank?.[kind]) ? bank[kind] : [];
    const withPath = items.filter((item) => String(item.sourceFile ?? "").trim());
    const uniquePaths = [...new Set(withPath.map((item) => item.sourceFile))];
    const unresolvedRecords = withPath.filter((item) => !existsSync(resolve(sourceRoot, item.sourceFile)));
    const unresolvedPaths = uniquePaths.filter((sourceFile) => !existsSync(resolve(sourceRoot, sourceFile)));
    result[kind] = {
      records: items.length,
      recordsWithSourceFile: withPath.length,
      uniqueSourcePaths: uniquePaths.length,
      unresolvedRecords: unresolvedRecords.length,
      unresolvedUniquePaths: unresolvedPaths.length,
      unresolvedPathExamples: unresolvedPaths.slice(0, 10),
    };
  }
  return result;
}

async function main() {
  const sourcePath = process.argv[2]
    ? resolve(process.cwd(), process.argv[2])
    : resolve(import.meta.dirname, "../../architect-exam-bank/data/bank.json");
  const sourceRoot = process.argv[3]
    ? resolve(process.cwd(), process.argv[3])
    : resolve(dirname(sourcePath), "..");
  const bank = JSON.parse(await readFile(sourcePath, "utf8"));
  const report = auditBank(bank, { sourcePath });
  report.sourceRoot = sourceRoot;
  report.sourceFilePathResolution = auditSourcePaths(bank, sourceRoot);
  if (Object.values(report.sourceFilePathResolution).some((section) => section.unresolvedRecords > 0)) {
    report.warnings.push("部分 sourceFile 路径无法在当前 sourceRoot 下解析；它们可能是上游仓库相对路径，或源文件未随当前仓库提供。路径标记本身不证明源文件可访问。");
  }
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write("题库可追溯性审计失败：" + error.message + "\n");
    process.exitCode = 1;
  });
}
