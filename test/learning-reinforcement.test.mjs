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
    revision: 1,
    reviewedRevision: 1,
    reviewEvidenceType: "textbook",
    reviewEvidenceReference: "测试教材，第 1 章，第 1 页",
    reviewedFields: ["question", "options", "correctAnswer", "analysis"],
    chapter: 7,
    section: "7.1",
    sourceNode: "7.1 软件架构基础",
    knowledgePoint: "架构定义",
    ...extra,
  };
}

test("知识点巩固只接受精确知识点匹配，不用同小节父级或同章题目凑数", () => {
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
  assert.deepEqual(result.map((q) => q.id), ["direct-1", "direct-2"]);
  assert.deepEqual(result.map((q) => q.selectionReason), ["direct", "direct"]);
});

test("小节级学习单元允许精确小节题，不放宽到其他章节", () => {
  const unit = { id: "7.1", title: "软件架构基础", sectionId: "7.1", chapter: 7 };
  const result = selectLearningReinforcementQuestions({
    unit,
    questions: [
      approved("same-section", { knowledgePoint: "其他", sourceNode: "", section: "7.1" }),
      approved("other-section", { knowledgePoint: "其他", sourceNode: "7.2 架构风格", section: "7.2" }),
    ],
  });
  assert.deepEqual(result.map((q) => q.id), ["same-section"]);
  assert.equal(result[0].selectionReason, "section");
});

test("来源节点匹配知识点完整编号，不把相邻编号前缀误认为同一知识点", () => {
  const unit = { id: "7.1.1", title: "架构定义", sectionId: "7.1", chapter: 7 };
  const result = selectLearningReinforcementQuestions({
    unit,
    questions: [
      approved("exact-node", { knowledgePoint: "其他", sourceNode: "第7章 / 7.1.1 架构定义" }),
      approved("prefix-collision", { knowledgePoint: "其他", sourceNode: "7.1.10 架构复用" }),
    ],
  });
  assert.deepEqual(result.map((question) => question.id), ["exact-node"]);
});

test("知识点巩固不足5题时只返回实际合格题并去重", () => {
  const question = approved("only-one", {
    chapter: 2,
    section: "2.1",
    sourceNode: "2.1 计算机系统概述",
    knowledgePoint: "其他计算机知识点",
  });
  const result = selectLearningReinforcementQuestions({
    unit: { id: "2.1.1", title: "计算机系统", sectionId: "2.1", chapter: 2 },
    questions: [question, { ...question }, { ...question, id: "pending", reviewStatus: "pending_review" }],
    limit: 5,
  });
  assert.deepEqual(result, [], "父级小节/同章节题不能冒充叶子知识点巩固题");
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
