import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { auditLearningContent } from "../scripts/audit-learning-content.mjs";

const content = JSON.parse(await readFile(new URL("../data/learning-content.json", import.meta.url), "utf8"));

test("学习内容审计能报告全文重复而不把重复误判为事实错误", () => {
  const report = auditLearningContent({ units: {
    a: { status: "partial", how: "按约束分析方案。", confusions: "认证不等于授权。" },
    b: { status: "partial", how: "按约束分析方案。", confusions: "授权不等于认证。" },
    c: { status: "verified", how: "按来源核对公式。", confusions: "认证不等于授权。" },
  } });
  assert.equal(report.readOnly, true);
  assert.equal(report.unitCount, 3);
  assert.equal(report.statusDistribution.partial, 2);
  assert.equal(report.duplicateFields.how.groups, 1);
  assert.deepEqual(report.duplicateFields.how.largestGroups[0].unitIds, ["a", "b"]);
  assert.equal(report.duplicateFields.confusions.groups, 1);
  assert.match(report.note, /不判断事实正确性/);
});

test("286个课程单元的当前审计报告确认六类字段无全文重复且无已知模板尾句残留", () => {
  const report = auditLearningContent(content);
  assert.equal(report.unitCount, 286);
  assert.equal(report.duplicateFields.how.groups, 0);
  assert.equal(report.duplicateFields.confusions.groups, 0);
  assert.equal(report.knownTemplateTailOccurrences.how.count, 0);
  assert.equal(report.knownTemplateTailOccurrences.confusions.count, 0);
  for (const field of ["why", "how", "confusions", "scenarios", "examFocus", "pitfalls"]) assert.equal(report.duplicateFields[field].groups, 0, field + " should have no full-text duplicates");
  for (const marker of Object.values(report.knownGenericTemplateMarkers)) assert.equal(marker.count, 0, "known generic template marker should be absent");
});
