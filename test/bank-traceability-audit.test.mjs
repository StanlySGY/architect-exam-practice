import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { auditBank, auditSourcePaths } from "../scripts/audit-bank-traceability.mjs";

test("只读题库审计区分结构完整、出处缺失和重复题干候选", () => {
  const report = auditBank({
    source: { note: "答案均为非官方整理。" },
    choices: [
      { id: "a", sourceType: "mock", term: "卷一", paper: "卷一", stem: "同题", options: { A: "甲", B: "乙", C: "丙", D: "丁" }, answer: "A", analysis: "解析", sourceFile: "a.md" },
      { id: "b", sourceType: "mock", term: "卷二", paper: "卷二", stem: "同题", options: { A: "甲", B: "丙", C: "乙", D: "丁" }, answer: "A", analysis: "解析", sourceFile: "b.md" },
    ],
    cases: [{ sourceFile: "case.md" }],
    essays: [{ sourceFile: "essay.md", answerSource: "glm-5.2-reviewed" }],
  });
  assert.equal(report.readOnly, true);
  assert.equal(report.choices.missingSourceFile, 0);
  assert.equal(report.choices.missingPreciseSourceReference, 2);
  assert.equal(report.choices.answerTrustMetadataComplete, 0);
  assert.equal(report.choices.repeatedMockStemGroupsAcrossPapers, 1);
  assert.equal(report.choices.exactSameStemAndOptionsGroupsAcrossPapers, 0);
  assert.equal(report.cases.answerSourceMissing, 1);
  assert.equal(report.essays.glmReviewedLabel, 1);
  assert.ok(report.warnings.some((warning) => warning.includes("非官方整理")));
});

test("来源路径审计区分远程 URL、可解析文件、未解析路径和越界路径", () => {
  const root = resolve(import.meta.dirname, "..");
  const report = auditSourcePaths({
    choices: [
      { sourceFile: "package.json" },
      { sourceFile: "data/no-such-source.md" },
      { sourceFile: "https://example.com/source.md" },
      { sourceFile: "../architect-exam-bank/data/bank.json" },
      {},
    ],
    cases: [],
    essays: [],
  }, root);
  assert.equal(report.choices.records, 5);
  assert.equal(report.choices.recordsWithSourceFile, 4);
  assert.equal(report.choices.remoteUrlRecords, 1);
  assert.equal(report.choices.localPathRecords, 3);
  assert.equal(report.choices.pathTraversalRecords, 1);
  assert.equal(report.choices.pathTraversalUniquePaths, 1);
  assert.equal(report.choices.unresolvedLocalPathRecords, 1);
  assert.equal(report.choices.unresolvedUniqueLocalPaths, 1);
});