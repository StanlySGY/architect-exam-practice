import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditAnswerRisk } from './audit-bank-answer-risk.mjs';

function triage(item) {
  const context = item.context;
  if (item.rule === 'absolute-or-exam-trend-claim') {
    return /预计|押题|首次入考|必考|年年|每年|考试趋势/u.test(context) ? 'exam-prediction-needs-source' : 'absolute-language-needs-context';
  }
  if (/公式|计算|MTBF|MTTR|地址|字节|进程|资源|缓存|矩阵|参数|原模型|比例|上限|限制|主存|位数|选项/u.test(context)) return 'technical-number-or-calculation-review';
  if (/提升|提高|降低|减少|缩短|增长|增加|改善|节省|成本|效率|可用性|吞吐|响应时间|发布频率|命中率|准确率|QPS|TPS|P99|效果|支撑|达到|优化后|性能/u.test(context)) return 'outcome-metric-needs-evidence';
  return 'quantified-claim-context-review';
}

export function renderAnswerRiskMarkdown(report) {
  const groups = new Map();
  const triageCounts = {};
  for (const item of report.findings) {
    item.triageCategory = triage(item);
    triageCounts[item.triageCategory] = (triageCounts[item.triageCategory] ?? 0) + 1;
    const key = item.triageCategory + ' / ' + item.rule + ' / ' + item.item.kind;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const lines = ['# 题库答案风险候选复核队列', '', '- 报告版本：' + report.reportVersion, '- 只读：' + report.readOnly, '- 扫描记录：选择题 ' + report.counts.choices + '，案例题 ' + report.counts.cases + '，论文题 ' + report.counts.essays, '- 风险候选：' + report.counts.findings, '', '> 本报告由关键词规则生成，所有命中均为人工复核候选，不代表题目、答案或解析错误；未命中也不代表内容正确。只有可追溯的来源证据才能支持事实性修订。', '', '## 初步分流（启发式，非自动判错）', '', '| 分类 | 数量 |', '|---|---:|'];
  for (const [key, count] of Object.entries(triageCounts)) lines.push('| ' + key + ' | ' + count + ' |');
  lines.push('', '## 原始规则计数', '', '| 规则 | 命中数 |', '|---|---:|');
  for (const [rule, count] of Object.entries(report.ruleCounts)) lines.push('| ' + rule + ' | ' + count + ' |');
  for (const [group, items] of groups) {
    lines.push('', '## ' + group + '（' + items.length + ' 条）', '');
    for (const item of items) lines.push('### ' + item.item.id, '', '- 位置：' + [item.item.term, item.item.paper, item.item.field].filter(Boolean).join(' / '), '- 命中：' + item.matchedText, '- 精确来源字段存在：' + item.hasPreciseSource, '- 复核建议：' + item.guidance, '- 上下文：' + item.context, '');
  }
  return { markdown: lines.join('\n'), triageCounts, report: { ...report, findings: report.findings.map((item) => ({ ...item, triageCategory: triage(item) })), triageCounts } };
}

async function main() {
  const bankPath = resolve(process.argv[2] ?? '../architect-exam-bank/data/bank.json');
  const jsonOut = process.argv[3] ? resolve(process.argv[3]) : null;
  const mdOut = process.argv[4] ? resolve(process.argv[4]) : null;
  const bank = JSON.parse(await readFile(bankPath, 'utf8'));
  const report = auditAnswerRisk(bank);
  report.sourcePath = relative(process.cwd(), bankPath);
  const rendered = renderAnswerRiskMarkdown(report);
  if (jsonOut) { await mkdir(dirname(jsonOut), { recursive: true }); await writeFile(jsonOut, JSON.stringify(rendered.report, null, 2) + '\n'); }
  if (mdOut) { await mkdir(dirname(mdOut), { recursive: true }); await writeFile(mdOut, rendered.markdown.trimEnd()); }
  process.stdout.write(JSON.stringify({ ...report.counts, ruleCounts: report.ruleCounts, triageCounts: rendered.triageCounts, jsonOut, mdOut }, null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { process.stderr.write('答案风险报告生成失败：' + error.message + '\n'); process.exitCode = 1; });
