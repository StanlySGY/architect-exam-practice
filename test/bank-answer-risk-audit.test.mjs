import assert from "node:assert/strict";
import test from "node:test";
import { auditAnswerRisk } from "../scripts/audit-bank-answer-risk.mjs";
import { renderAnswerRiskMarkdown } from "../scripts/render-bank-answer-risk-report.mjs";

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

test("风险扫描忽略年份区间、否定语境和“完全不同”措辞", () => {
  const report = auditAnswerRisk({ choices: [
    { id: "year-range", analysis: "RAG是2025-2026年热门技术方向。" },
    { id: "source-reconstruction", analysis: "资料来源：CSDN，2024上半年真题复原程度90%，仅用于标注题干来源完整性。" },
    { id: "negated-quantity", analysis: "量子计算的运算加速不是简单的2倍关系。" },
    { id: "qualified", analysis: "责任链模式不保证请求一定会被处理；所有处理者都不处理时请求会被丢弃。" },
    { id: "note", analysis: "该回忆版内容与批次一完全不同。" },
    { id: "real-absolute", analysis: "该方案完全不影响业务延迟。" },
  ] });
  assert.equal(report.findings.some((item) => item.item.id === "year-range"), false);
  assert.equal(report.findings.some((item) => item.item.id === "source-reconstruction"), false);
  assert.equal(report.findings.some((item) => item.item.id === "negated-quantity"), false);
  assert.equal(report.findings.some((item) => item.item.id === "qualified"), false);
  assert.equal(report.findings.some((item) => item.item.id === "note"), false);
  assert.equal(report.findings.some((item) => item.item.id === "real-absolute" && item.rule === "absolute-or-exam-trend-claim"), true);
});

test("答案风险审计区分来源字段存在与来源事实核验", () => {
  const withUrl = auditAnswerRisk({ choices: [{ id: "q1", analysis: "延迟为10-50ms。", sourceUrl: "https://example.com" }] });
  assert.equal(withUrl.reportVersion, 4);
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

test("案例风险候选按父题聚合，同一上下文只展示一次", () => {
  const answer = "本场景给定接口响应时间目标为5秒以内，超过后触发超时处理。";
  const report = auditAnswerRisk({ cases: [{
    id: "case-parent-1",
    subQuestions: [
      { question_label: "问题1", reference_answer: answer },
      { question_label: "问题2", reference_answer: answer },
    ],
  }] });
  assert.equal(report.findings.length, 2);
  assert.equal(report.counts.uniqueFindingRecords, 2);
  assert.equal(report.counts.uniqueParentItems, 1);
  assert.equal(report.counts.repeatedParentItems, 1);
  assert.ok(report.findings.every(item => item.item.parentId === "case-parent-1"));

  const rendered = renderAnswerRiskMarkdown(report);
  assert.equal((rendered.markdown.match(/### case-parent-1/g) ?? []).length, 1);
  assert.equal((rendered.markdown.match(/本场景给定接口响应时间目标为5秒以内/g) ?? []).length, 1);
  assert.equal(rendered.findingReviewGrouping.contextGroupsDisplayed, 1);
});

test("报告展示时抑制完全重复命中，同时保留原始扫描计数", () => {
  const report = auditAnswerRisk({ choices: [{ id: "choice-1", analysis: "响应时间目标为5秒。" }] });
  report.findings.push({ ...report.findings[0] });
  report.counts.findings += 1;
  const rendered = renderAnswerRiskMarkdown(report);
  assert.equal(report.findings.length, 2);
  assert.equal(rendered.findingReviewGrouping.uniqueFindingsDisplayed, 1);
  assert.equal(rendered.findingReviewGrouping.exactDuplicateFindingsSuppressed, 1);
});

test("明确的题目需求指标被分流为场景约束，不直接视为实测成果", () => {
  const report = auditAnswerRisk({ choices: [{
    id: "scenario-target",
    analysis: "本题要求系统应能够防止99%的黑客攻击，但这不是系统已达到的实测结果。",
  }] });
  const rendered = renderAnswerRiskMarkdown(report);
  assert.equal(rendered.triageCounts['scenario-requirement-or-design-parameter'], 1);
  assert.equal(rendered.triageCounts['outcome-metric-needs-evidence'] ?? 0, 0);
});

test("共享长题干的多空选择题按同一父级综合题聚合", () => {
  const stem = '某大型电子交易清算系统在架构设计阶段识别了性能、可用性和安全性三个质量属性场景，并要求数据传递时延、主备切换及网络攻击防护达到给定目标。系统将根据使用部门的负载、业务优先级和运行环境分别制定约束，评审人员需要结合相同系统背景分析各项质量属性及其设计策略。请根据场景选择对应的质量属性和架构策略。';
  const report = auditAnswerRisk({ choices: [
    { id: 'real-2019-12', term: '2019年下半年', paper: '2019年下半年', questionNo: 12, stem, analysis: '系统应能够防止99%的黑客攻击。' },
    { id: 'real-2019-13', term: '2019年下半年', paper: '2019年下半年', questionNo: 13, stem, analysis: '系统应能够防止99%的黑客攻击。' },
  ] });
  assert.equal(report.findings.length, 2);
  assert.equal(report.counts.uniqueFindingRecords, 2);
  assert.equal(report.counts.uniqueParentItems, 1);
  assert.equal(report.counts.repeatedParentItems, 1);
  assert.equal(report.findings[0].item.parentId, report.findings[1].item.parentId);
  const rendered = renderAnswerRiskMarkdown(report);
  assert.equal((rendered.markdown.match(/### shared-stem-/g) ?? []).length, 1);
});

test("产品限制、历史性能实例和配置示例被分流到不同审核类型", () => {
  const report = auditAnswerRisk({ choices: [
    { id: 'aws-limit', analysis: 'FaaS执行时间通常有限制（如AWS Lambda 15分钟）。' },
    { id: 'historical-throughput', analysis: '某公开案例使用数百上千台云实例在36小时内处理TB级文档数据。' },
    { id: 'ttl-config', analysis: '使用Redis设置合理的过期时间（如24小时），避免键值永久占用内存。' },
  ] });
  const rendered = renderAnswerRiskMarkdown(report);
  const byId = new Map(rendered.report.findings.map(item => [item.item.id, item.triageCategory]));
  assert.equal(byId.get('aws-limit'), 'technical-number-or-calculation-review');
  assert.equal(byId.get('historical-throughput'), 'outcome-metric-needs-evidence');
  assert.equal(byId.get('ttl-config'), 'scenario-requirement-or-design-parameter');
});

test("论文中的需求目标与实施效果指标按命中语境分开分流", () => {
  const report = auditAnswerRisk({ essays: [
    { id: 'target', writingPoints: '先确定可靠性目标（如 MTBF ≥ 1000小时），再收集测试数据进行验证。' },
    { id: 'result', writingPoints: '实施效果：经过压测，系统可用性达到99.99%，吞吐量提升40%。' },
  ] });
  const rendered = renderAnswerRiskMarkdown(report);
  const byId = new Map(rendered.report.findings.map(item => [item.item.id, item.triageCategory]));
  assert.equal(byId.get('target'), 'scenario-requirement-or-design-parameter');
  assert.equal(byId.get('result'), 'outcome-metric-needs-evidence');
});
