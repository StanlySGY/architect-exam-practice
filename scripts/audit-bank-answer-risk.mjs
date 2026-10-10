import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RULES = [
  { code: "unsupported-quantified-claim", label: "需要核对来源的量化断言", pattern: /(?:\d+(?:\.\d+)?\s*(?:-|–|至|到)\s*\d+(?:\.\d+)?\s*(?:ms|毫秒|秒|分钟|小时|%|％|GB|TB|MB|倍|条|次|年|天)|\d+(?:\.\d+)?\s*(?:ms|毫秒|秒|分钟|小时|%|％|GB|TB|MB|倍|条\/秒|次\/秒))/iu, guidance: "核对数字的可追溯依据、测量条件和适用范围；无依据时删除或标明是假设。" },
  { code: "absolute-or-exam-trend-claim", label: "绝对化或考试趋势断言", pattern: /(?:每年必考|历年必考|考试趋势|唯一(?:的)?(?:方式|方法|方案|原因)|绝对(?:安全|可靠|不会)|完全(?:不|无需|避免)|一定(?:能够|会|不会)|必然(?:导致|发生)|保证(?:不|一定|必然)|不影响(?:业务|性能|延迟))/iu, guidance: "核对来源与前提；无依据的绝对化表述应改为有条件、可验证的说法。" },
];

function textFields(bank) {
  const rows = [];
  for (const item of bank?.choices ?? []) rows.push({ id: String(item.id ?? ""), kind: "choice", term: item.term ?? null, paper: item.paper ?? null, questionNo: item.questionNo ?? null, field: "analysis", text: String(item.analysis ?? ""), answerSource: item.answerSource ?? null, sources: [item.sourceUrl, item.sourcePage, item.sourceReference, item.sourceCitation, item.sourceLocation] });
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

export function auditAnswerRisk(bank) {
  const rows = textFields(bank);
  const findings = [];
  const ruleCounts = Object.fromEntries(RULES.map((rule) => [rule.code, 0]));
  for (const row of rows) for (const rule of RULES) {
    const match = rule.pattern.exec(row.text);
    if (!match) continue;
    ruleCounts[rule.code] += 1;
    const index = match.index;
    const sourceLocator = assessSourceLocator(row.sources);
    findings.push({ rule: rule.code, label: rule.label, item: { id: row.id, kind: row.kind, term: row.term, paper: row.paper, questionNo: row.questionNo, field: row.field }, matchedText: match[0], context: row.text.slice(Math.max(0, index - 100), Math.min(row.text.length, index + match[0].length + 120)).replace(/\s+/g, " ").trim(), ...sourceLocator, answerSource: row.answerSource, guidance: rule.guidance });
  }
  return { reportVersion: 2, readOnly: true, counts: { choices: (bank?.choices ?? []).length, cases: (bank?.cases ?? []).length, essays: (bank?.essays ?? []).length, scannedTextFields: rows.length, findings: findings.length }, ruleCounts, note: "关键词审计仅生成需要人工复核的候选，不代表答案错误；未命中也不代表答案正确。来源字段状态只反映字段是否缺失/占位或存在 URL/文本，不证明来源可访问、权威、精确或支持该命题。脚本不修改题库。", findings };
}

async function main() {
  const sourcePath = resolve(process.argv[2] ?? "../architect-exam-bank/data/bank.json");
  const bank = JSON.parse(await readFile(sourcePath, "utf8"));
  const report = auditAnswerRisk(bank);
  report.sourcePath = sourcePath;
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { process.stderr.write("答案风险候选审计失败：" + error.message + "\n"); process.exitCode = 1; });
