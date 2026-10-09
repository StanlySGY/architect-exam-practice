import assert from "node:assert/strict";
import test from "node:test";
import { selectLearningReinforcementQuestions } from "../src/service/review.mjs";

function approved(id, extra = {}) {
  return {
    id,
    sourceType: "generated",
    reviewStatus: "approved",
    reviewedBy: "human-reviewer",
    reviewEvidence: "教材核验：测试",
    reviewedAt: "2026-10-09T00:00:00.000Z",
    chapter: 7,
    section: "7.1",
    sourceNode: "7.1 软件架构基础",
    knowledgePoint: "架构定义",
    ...extra,
  };
}

test("知识点巩固按 direct > section > chapter 选择，并排除未审校题", () => {
  const unit = { id: "7.1.1", title: "架构定义", sectionId: "7.1", chapter: 7 };
  const result = selectLearningReinforcementQuestions({
    unit,
    questions: [
      approved("chapter-1", { sourceNode: "第7章", section: "7.9", knowledgePoint: "其他" }),
      approved("section-1", { sourceNode: "7.1 软件架构基础", section: "7.1", knowledgePoint: "其他" }),
      approved("direct-1", { sourceNode: "7.1.1 架构定义", section: "7.1", knowledgePoint: "架构定义" }),
      approved("direct-2", { sourceNode: "7.1.1 架构定义", section: "7.1", knowledgePoint: "架构定义" }),
      approved("pending", { reviewStatus: "pending_review" }),
      approved("quarantined", { reviewStatus: "quarantined" }),
    ],
    limit: 5,
  });
  assert.deepEqual(result.map((q) => q.id), ["direct-1", "direct-2", "section-1", "chapter-1"]);
  assert.deepEqual(result.map((q) => q.selectionReason), ["direct", "direct", "section", "chapter"]);
});

test("知识点巩固不足5题时只返回实际合格题并去重", () => {
  const question = approved("only-one", {
    chapter: 2,
    section: "2.1",
    sourceNode: "2.1 计算机系统概述",
    knowledgePoint: "计算机系统",
  });
  const result = selectLearningReinforcementQuestions({
    unit: { id: "2.1.1", title: "计算机系统", sectionId: "2.1", chapter: 2 },
    questions: [question, { ...question }, { ...question, id: "pending", reviewStatus: "pending_review" }],
    limit: 5,
  });
  assert.deepEqual(result.map((q) => q.id), ["only-one"]);
});

test("知识点巩固默认最多5题且保留 selectionReason", () => {
  const unit = { id: "7.1.1", title: "架构定义", sectionId: "7.1", chapter: 7 };
  const questions = Array.from({ length: 8 }, (_, index) => approved("q-" + (index + 1), {
    sourceNode: "7.1.1 架构定义",
  }));
  const result = selectLearningReinforcementQuestions({ unit, questions });
  assert.equal(result.length, 5);
  assert.ok(result.every((q) => q.selectionReason === "direct"));
});
