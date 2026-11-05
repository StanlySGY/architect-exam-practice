import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditAnswerRisk } from './audit-bank-answer-risk.mjs';

function triage(item) {
  const context = item.context;
  const matchIndex = Math.max(0, context.indexOf(item.matchedText));
  const localBefore = context.slice(Math.max(0, matchIndex - 56), matchIndex);
  const localAfter = context.slice(matchIndex, Math.min(context.length, matchIndex + item.matchedText.length + 48));
  const claimContext = localBefore + localAfter;
  if (item.rule === 'absolute-or-exam-trend-claim') {
    return /预计|押题|首次入考|必考|年年|每年|考试趋势/u.test(claimContext) ? 'exam-prediction-needs-source' : 'absolute-language-needs-context';
  }
  const explicitRequirement = /(?:要求|目标|应当|应能够|必须|约束|需满足|不得超过|不大于|至少达到|阈值为).{0,24}$/u.test(localBefore)
    || /^(?:\s*(?:需|要求|目标|阈值|SLA))/u.test(localAfter.slice(item.matchedText.length));
  const designConfiguration = /(?:过期时间|超时时间|重试间隔|心跳间隔|故障阈值|重置时间|分片数|并发数|TTL).{0,18}(?:如|例如|设置|设为|配置为|为)?\s*$/iu.test(localBefore)
    || /(?:设置|设为|配置为).{0,14}$/u.test(localBefore);
  if (explicitRequirement || designConfiguration) {
    return 'scenario-requirement-or-design-parameter';
  }
  if (/公式|计算|MTBF|MTTR|地址|字节|进程|资源|缓存|矩阵|参数|原模型|比例|上限|限制|主存|位数|选项|AWS Lambda|执行时间限制|MFU|分支覆盖|维护/u.test(claimContext)) return 'technical-number-or-calculation-review';
  if (/效果|核心成果|实施效果|实测|实测数据|准确率|可用性达到|吞吐量达到|支撑百万|实现.*?\d/u.test(localBefore)) return 'outcome-metric-needs-evidence';
  if (/提升|提高|降低|减少|缩短|增长|增加|改善|节省|成本|效率|可用性|吞吐|响应时间|发布频率|命中率|准确率|QPS|TPS|P99|支撑|达到|优化后|性能|处理.{0,14}(?:TB|GB|文档|文件|数据|请求)/u.test(claimContext)) return 'outcome-metric-needs-evidence';
  return 'quantified-claim-context-review';
}

export function renderAnswerRiskMarkdown(report) {
  const triageCounts = {};
  const uniqueFindings = [];
  const seenFindingKeys = new Set();
  for (const sourceItem of report.findings) {
    const key = [sourceItem.item.kind, sourceItem.item.id, sourceItem.rule, sourceItem.matchedText, sourceItem.context].join('|');
    if (seenFindingKeys.has(key)) continue;
    seenFindingKeys.add(key);
    const item = { ...sourceItem, triageCategory: triage(sourceItem) };
    uniqueFindings.push(item);
    triageCounts[item.triageCategory] = (triageCounts[item.triageCategory] ?? 0) + 1;
  }
  const parents = new Map();
  for (const item of uniqueFindings) {
    const parentId = item.item.parentId ?? item.item.id.split(':问题')[0];
    const key = item.item.kind + '|' + parentId;
    if (!parents.has(key)) parents.set(key, { kind: item.item.kind, parentId, recordIds: new Set(), contexts: new Map() });
    const parent = parents.get(key);
    parent.recordIds.add(item.item.id);
    if (!parent.contexts.has(item.context)) parent.contexts.set(item.context, []);
    parent.contexts.get(item.context).push(item);
  }
  const kindLabels = { choice: '选择题', case: '案例题', essay: '论文题' };
  const lines = [
    '# 题库答案风险候选复核队列', '',
    '- 报告版本：' + report.reportVersion,
    '- 只读：' + report.readOnly,
    '- 扫描记录：选择题 ' + report.counts.choices + '，案例题 ' + report.counts.cases + '，论文题 ' + report.counts.essays,
    '- 原始规则命中：' + report.counts.findings,
    '- 去重后命中：' + uniqueFindings.length,
    '- 不同题目/子问题记录：' + report.counts.uniqueFindingRecords,
    '- 不同父级题目：' + report.counts.uniqueParentItems,
    '- 含多个命中子问题的父题：' + report.counts.repeatedParentItems,
    '- 完全重复命中抑制：' + (report.counts.findings - uniqueFindings.length), '',
    '> 本报告由关键词规则生成，所有命中均为人工复核候选，不代表题目、答案或解析错误；未命中也不代表内容正确。只有可追溯的来源证据才能支持事实性修订。来源定位状态不是核验结论；URL/文本存在不代表来源权威或支持命题。案例按父题聚合，同一段上下文只展示一次。', '',
    '## 初步分流（启发式，非自动判错）', '', '| 分类 | 数量 |', '|---|---:|',
  ];
  for (const [key, count] of Object.entries(triageCounts)) lines.push('| ' + key + ' | ' + count + ' |');
  lines.push('', '## 原始规则计数', '', '| 规则 | 原始命中数 |', '|---|---:|');
  for (const [rule, count] of Object.entries(report.ruleCounts)) lines.push('| ' + rule + ' | ' + count + ' |');
  for (const kind of ['choice', 'case', 'essay']) {
    const kindParents = [...parents.values()].filter(parent => parent.kind === kind);
    const hitCount = kindParents.reduce((sum, parent) => sum + [...parent.contexts.values()].reduce((total, hits) => total + hits.length, 0), 0);
    lines.push('', '## ' + kindLabels[kind] + '（' + kindParents.length + ' 个父级题目 / ' + hitCount + ' 条去重命中）', '');
    for (const parent of kindParents) {
      const parentHits = [...parent.contexts.values()].flat();
      lines.push('### ' + parent.parentId + '（' + parent.recordIds.size + (kind === 'case' ? ' 个子问题 / ' : ' 条记录 / ') + parentHits.length + ' 条命中）', '');
      let contextIndex = 0;
      for (const [context, hits] of parent.contexts) {
        contextIndex += 1;
        lines.push('#### 上下文 ' + contextIndex, '', '- 命中位置：' + [...new Set(hits.map(item => item.item.questionNo ?? item.item.field).filter(Boolean))].join('、'), '- 风险命中：');
        for (const item of hits) lines.push('  - ' + item.rule + '：' + item.matchedText + '（' + item.triageCategory + '；来源定位字段状态：' + item.sourceLocatorAssessment + '）');
        lines.push('- 复核建议：' + [...new Set(hits.map(item => item.guidance))].join('；'), '- 上下文：' + context, '');
      }
    }
  }
  const findingReviewGrouping = {
    uniqueFindingsDisplayed: uniqueFindings.length,
    uniqueFindingRecords: report.counts.uniqueFindingRecords,
    uniqueParentItems: report.counts.uniqueParentItems,
    repeatedParentItems: report.counts.repeatedParentItems,
    exactDuplicateFindingsSuppressed: report.counts.findings - uniqueFindings.length,
    contextGroupsDisplayed: [...parents.values()].reduce((sum, parent) => sum + parent.contexts.size, 0),
  };
  return {
    markdown: lines.join('\n'),
    triageCounts,
    findingReviewGrouping,
    report: { ...report, findings: report.findings.map(item => ({ ...item, triageCategory: triage(item) })), triageCounts, findingReviewGrouping },
  };
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
