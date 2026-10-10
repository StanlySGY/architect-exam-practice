import assert from "node:assert/strict";
import test from "node:test";
import { auditAnswerRisk } from "../scripts/audit-bank-answer-risk.mjs";

test("答案风险审计会标记量化与绝对化断言，但只生成只读复核候选", () => {
  const bank = {
    choices: [
      { id: "q1", term: "模拟卷", paper: "卷一", questionNo: 1, analysis: "此操作延迟约10-50ms，因此不影响业务延迟。" },
      { id: "q2", analysis: "互斥信号量初始值为1。" },
    ],
    cases: [{ id: "c1", subQuestions: [{ question_label: "问题1", reference_answer: "考试趋势：该考点每年必考。" }] }],
    essays: [{ id: "e1", writingPoints: "建议开展测试。" }],
  };
  const report = auditAnswerRisk(bank);
  assert.equal(report.readOnly, true);
  assert.equal(report.counts.scannedTextFields, 4);
  assert.equal(report.ruleCounts["unsupported-quantified-claim"], 1);
  assert.equal(report.ruleCounts["absolute-or-exam-trend-claim"], 2);
  assert.equal(report.findings.length, 3);
  assert.equal(report.findings.every((item) => item.guidance && item.item.id), true);
  assert.equal(report.findings.some((item) => item.item.id === "q2"), false);
});

test("答案风险审计区分来源字段存在与来源事实核验", () => {
  const withUrl = auditAnswerRisk({ choices: [{ id: "q1", analysis: "延迟为10-50ms。", sourceUrl: "https://example.com" }] });
  assert.equal(withUrl.reportVersion, 2);
  assert.equal(withUrl.findings[0].hasSourceLocator, true);
  assert.equal(withUrl.findings[0].sourceLocatorAssessment, "url-present-not-verified");
  const withPlaceholder = auditAnswerRisk({ choices: [{ id: "q2", analysis: "延迟为10-50ms。", sourceCitation: "待核验" }] });
  assert.equal(withPlaceholder.findings[0].hasSourceLocator, false);
  assert.equal(withPlaceholder.findings[0].sourceLocatorAssessment, "placeholder-only");
  const withoutSource = auditAnswerRisk({ choices: [{ id: "q3", analysis: "延迟为10-50ms。" }] });
  assert.equal(withoutSource.findings[0].sourceLocatorAssessment, "missing");
  assert.match(withUrl.note, /不代表答案错误/);
  assert.match(withUrl.note, /不证明来源可访问、权威/);
});
