import assert from 'node:assert/strict';
import test from 'node:test';
import { auditAnswerRisk } from '../scripts/audit-bank-answer-risk.mjs';
import { renderAnswerRiskMarkdown } from '../scripts/render-bank-answer-risk-report.mjs';

test('答案风险报告按复核类型分流，保留原始候选并声明不自动判错', () => {
  const report = auditAnswerRisk({
    choices: [
      { id: 'q-metric', analysis: '效果：TPS提升3倍，P99响应时间降至200ms以内。' },
      { id: 'q-formula', analysis: '可用性 = MTBF/(MTBF+MTTR) = 999/(999+1) = 99.9%。' },
      { id: 'q-prediction', analysis: '押题理由：该知识点每年必考，预计2026继续出现。' },
    ],
  });
  const rendered = renderAnswerRiskMarkdown(report);
  assert.equal(rendered.report.counts.findings, 3);
  assert.equal(rendered.triageCounts['outcome-metric-needs-evidence'], 1);
  assert.equal(rendered.triageCounts['technical-number-or-calculation-review'], 1);
  assert.equal(rendered.triageCounts['exam-prediction-needs-source'], 1);
  assert.match(rendered.markdown, /不代表题目、答案或解析错误/);
  assert.match(rendered.markdown, /来源定位状态不是核验结论/);
  assert.match(rendered.markdown, /来源定位字段状态：missing/);
  assert.equal(rendered.report.findings.some((item) => item.triageCategory === 'exam-prediction-needs-source'), true);
});
