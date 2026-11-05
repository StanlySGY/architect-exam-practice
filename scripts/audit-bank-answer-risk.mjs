import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RULES = [
  { code: "unsupported-quantified-claim", label: "需要核对来源的量化断言", pattern: /(?:\d+(?:\.\d+)?\s*(?:-|–|至|到)\s*\d+(?:\.\d+)?\s*(?:ms|毫秒|秒|分钟|小时|%|％|GB|TB|MB|倍|条|次|年|天)|\d+(?:\.\d+)?\s*(?:ms|毫秒|秒|分钟|小时|%|％|GB|TB|MB|倍|条\/秒|次\/秒))/iu, guidance: "核对数字的可追溯依据、测量条件和适用范围；无依据时删除或标明是假设。" },
  { code: "absolute-or-exam-trend-claim", label: "绝对化或考试趋势断言", pattern: /(?:每年必考|历年必考|考试趋势|唯一(?:的)?(?:方式|方法|方案|原因)|绝对(?:安全|可靠|不会)|完全(?:不(?!同)|无需|避免)|一定(?:能够|会|不会)|必然(?:导致|发生)|保证(?:不|一定|必然)|不影响(?:业务|性能|延迟))/iu, guidance: "核对来源与前提；无依据的绝对化表述应改为有条件、可验证的说法。" },
];

function textFields(bank) {
  const rows = [];
  const choices = bank?.choices ?? [];
  const normalizedStems = choices.map(item => String(item.stem ?? item.question ?? "").replace(/\s+/gu, " ").trim());
  const stemCounts = new Map();
  for (const stem of normalizedStems) {
    if (stem.length >= 120) stemCounts.set(stem, (stemCounts.get(stem) ?? 0) + 1);
  }
  for (const [index, item] of choices.entries()) {
    const stem = normalizedStems[index];
    const repeatedLongStem = stem.length >= 120 && stemCounts.get(stem) > 1;
    const parentId = repeatedLongStem
      ? `shared-stem-${createHash("sha256").update(stem).digest("hex").slice(0, 12)}`
      : String(item.id ?? "");
    rows.push({ id: String(item.id ?? ""), parentId, kind: "choice", term: item.term ?? null, paper: item.paper ?? null, questionNo: item.questionNo ?? null, field: "analysis", text: String(item.analysis ?? ""), answerSource: item.answerSource ?? null, sources: [item.sourceUrl, item.sourcePage, item.sourceReference, item.sourceCitation, item.sourceLocation] });
  }
  for (const item of bank?.cases ?? []) for (const sub of item.subQuestions ?? []) rows.push({ id: String(item.id ?? "") + ":" + String(sub.question_label ?? "?"), kind: "case", term: item.term ?? null, paper: item.paper ?? null, questionNo: sub.question_label ?? null, field: "reference_answer", text: String(sub.reference_answer ?? sub.referenceAnswer ?? ""), answerSource: item.answerSource ?? null, sources: [item.sourceUrl, item.sourcePage, item.sourceReference, item.sourceCitation, item.sourceLocation] });
  for (const item of bank?.essays ?? []) rows.push({ id: String(item.id ?? ""), kind: "essay", term: item.term ?? null, paper: item.paper ?? null, questionNo: null, field: "writingPoints", text: String(item.writingPoints ?? item.writing_points ?? ""), answerSource: item.answerSource ?? null, sources: [item.sourceUrl, item.sourcePage, item.sourceReference, item.sourceCitation, item.sourceLocation] });
  return rows;
}

function assessSourceLocator(values) {
  const present = values.map((value) => String(value ?? "").trim()).filter(Boolean);
  const meaningful = present.filter((value) => !/^(?:n\/?a|none|待补充来源|待核验|待补充|无|暂无|未知|不详|tbd|todo|placeholder)$/iu.test(value));
  if (meaningful.some((value) => /^https?:\/\//iu.test(value))) return { hasSourceLocator: true, sourceLocatorAssessment: "url-present-not-verified" };
  if (meaningful.length) return { hasSourceLocator: true, sourceLocatorAssessment: "locator-text-present-needs-validation" };
  return { hasSourceLocator: false, sourceLocatorAssessment: present.length ? "placeholder-only" : "missing" };
}

function firstRelevantMatch(text, rule) {
  const flags = rule.pattern.flags.includes("g") ? rule.pattern.flags : rule.pattern.flags + "g";
  const pattern = new RegExp(rule.pattern.source, flags);
  for (const match of text.matchAll(pattern)) {
    const value = match[0];
    const index = match.index ?? 0;
    // A year-to-year date range is context, not a performance/quantity claim.
    if (rule.code === "unsupported-quantified-claim" && /^(?:19|20)\d{2}\s*(?:-|–|至|到)\s*(?:19|20)\d{2}\s*年$/u.test(value)) continue;
    if (rule.code === "unsupported-quantified-claim") {
      const prefix = text.slice(Math.max(0, index - 18), index);
      // Source reconstruction/confidence percentages describe the provenance
      // of a recalled exam paper, not a technical claim in its answer.
      if (/(?:真题|试题|题目|答案).{0,8}(?:复原程度|还原程度|复原率|还原率)\s*[:：]?\s*$/u.test(prefix)) continue;
      // A quantity explicitly negated in the same phrase is not a positive
      // numeric assertion (for example: "不是简单的 2 倍关系").
      if (/(?:不是|并非|并不|不应|不能|不可以|不可能|不代表|不一定|未必|并未|无需|没有|无须).{0,12}$/u.test(prefix)) continue;
    }
    if (rule.code === "absolute-or-exam-trend-claim") {
      const prefix = text.slice(Math.max(0, index - 16), index);
      // Do not flag a claim that explicitly warns against treating the phrase as guaranteed.
      if (/(?:不保证|不能保证|并不意味着|不代表|未必|不一定).{0,10}$/u.test(prefix)) continue;
    }
    return { match: value, index };
  }
  return null;
}

export function auditAnswerRisk(bank) {
  const rows = textFields(bank);
  const findings = [];
  const ruleCounts = Object.fromEntries(RULES.map((rule) => [rule.code, 0]));
  for (const row of rows) for (const rule of RULES) {
    const result = firstRelevantMatch(row.text, rule);
    if (!result) continue;
    ruleCounts[rule.code] += 1;
    const { match, index } = result;
    const sourceLocator = assessSourceLocator(row.sources);
    const parentId = row.parentId ?? (row.kind === "case" ? row.id.split(":问题")[0] : row.id);
    findings.push({ rule: rule.code, label: rule.label, item: { id: row.id, parentId, kind: row.kind, term: row.term, paper: row.paper, questionNo: row.questionNo, field: row.field }, matchedText: match, context: row.text.slice(Math.max(0, index - 100), Math.min(row.text.length, index + match.length + 120)).replace(/\s+/g, " ").trim(), ...sourceLocator, answerSource: row.answerSource, guidance: rule.guidance });
  }
  const uniqueRecords = new Set(findings.map(item => `${item.item.kind}|${item.item.id}`));
  const uniqueParents = new Set(findings.map(item => `${item.item.kind}|${item.item.parentId}`));
  const parentRecordCounts = new Map();
  for (const item of findings) {
    const key = `${item.item.kind}|${item.item.parentId}`;
    parentRecordCounts.set(key, (parentRecordCounts.get(key) ?? new Set()).add(item.item.id));
  }
  const exactFindingKeys = new Set(findings.map(item => [item.item.kind, item.item.id, item.rule, item.matchedText, item.context].join("|")));
  return {
    reportVersion: 4,
    readOnly: true,
    counts: {
      choices: (bank?.choices ?? []).length,
      cases: (bank?.cases ?? []).length,
      essays: (bank?.essays ?? []).length,
      scannedTextFields: rows.length,
      findings: findings.length,
      uniqueFindingRecords: uniqueRecords.size,
      uniqueParentItems: uniqueParents.size,
      repeatedParentItems: [...parentRecordCounts.values()].filter(records => records.size > 1).length,
      exactDuplicateFindings: findings.length - exactFindingKeys.size,
    },
    ruleCounts,
    note: "关键词审计仅生成需要人工复核的候选，不代表答案错误；未命中也不代表答案正确。来源字段状态只反映字段是否缺失/占位或存在 URL/文本，不证明来源可访问、权威、精确或支持该命题。扫描已过滤年份区间和明确的量词否定语境，仍可能存在误报与漏报；脚本不修改题库。案例按父题 ID 分组展示，同一上下文在报告中只显示一次；原始 findings 保留全部命中。",
    findings,
  };
}

async function main() {
  const sourcePath = resolve(process.argv[2] ?? "../architect-exam-bank/data/bank.json");
  const bank = JSON.parse(await readFile(sourcePath, "utf8"));
  const report = auditAnswerRisk(bank);
  report.sourcePath = sourcePath;
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { process.stderr.write("答案风险候选审计失败：" + error.message + "\n"); process.exitCode = 1; });
