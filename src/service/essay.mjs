// essay 领域方法（拆分自原 questions.mjs，经继承链组装回 PracticeService）。
import { makeId } from "../utils.mjs";
import {
  EXAM_GRACE_SECONDS,
  normalizeComparableText,
  resolveSourceNode,
  throwIfAborted,
} from "./helpers.mjs";
import { CaseExamDomain } from "./case-exam.mjs";

export class EssayDomain extends CaseExamDomain {
  async addPapers({
    chapter,
    section = null,
    papers,
    sourceNode = null,
    signal,
    dedupe = true,
  }) {
    throwIfAborted(signal);
    const chapterId = Number(chapter);
    const createdAt = this.now();
    const normalized = papers.map((item, index) => {
      if (!item.title?.trim() || !item.description?.trim()) {
        throw Object.assign(
          new Error(`Agent 返回的第 ${index + 1} 个论文题格式无效`),
          { status: 502 },
        );
      }
      return {
        id: makeId(`paper-c${chapterId}`),
        sourceType: "generated",
        source: "architect-agent/mindmap",
        chapter: chapterId,
        section,
        title: item.title.trim(),
        description: item.description.trim(),
        knowledgePoint: item.knowledge_point || `第 ${chapterId} 章`,
        sourceNode: resolveSourceNode(sourceNode, item.source_node),
        writingPoints: Array.isArray(item.writing_points)
          ? item.writing_points.map((point) => String(point).trim()).filter(Boolean)
          : [],
        draft: "",
        grade: null,
        createdAt,
      };
    });
    return this.store.update((state) => {
      throwIfAborted(signal);
      // 同章同名（按归一化标题）视为重复：批内与既有论文库都不重复才收入。
      // dedupe: false 供测试/数据修复场景绕过，正常生成路径始终开启。
      const seen = new Set();
      const accepted = [];
      for (const item of normalized) {
        if (dedupe) {
          const key = `${item.chapter}:${normalizeComparableText(item.title)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (
            state.paperQuestions.some(
              (existing) =>
                `${existing.chapter}:${normalizeComparableText(existing.title)}` ===
                key,
            )
          ) {
            continue;
          }
        }
        accepted.push(item);
      }
      state.paperQuestions.push(...accepted);
      return accepted;
    });
  }

  paperList({ sourceType = "all", term = "all" } = {}) {
    let records = this.store.snapshot().paperQuestions;
    if (["generated", "real", "mock"].includes(sourceType)) {
      records = records.filter(
        (item) => (item.sourceType ?? "generated") === sourceType,
      );
    }
    if (term !== "all" && term !== "") {
      records = records.filter((item) => item.term === term);
    }
    return records;
  }

  paperPage({ sourceType = "all", term = "all", limit = 4, offset = 0 } = {}) {
    const records = this.paperList({ sourceType, term });
    const pageSize = Math.max(1, Math.min(20, Number(limit) || 4));
    const start = Math.max(0, Number(offset) || 0);
    return {
      total: records.length,
      offset: start,
      limit: pageSize,
      records: records.slice(start, start + pageSize),
    };
  }

  async savePaperDraft({ paperId, draft }) {
    return this.store.update((state) => {
      const paper = state.paperQuestions.find((item) => item.id === paperId);
      if (!paper)
        throw Object.assign(new Error("论文题目不存在"), { status: 404 });
      this.assertPaperMockOpen(paper);
      paper.draft = String(draft ?? "");
      return { paperId, saved: true };
    });
  }

  // allowAfterDeadline 供"入口已校验、模型耗时超过宽限"的评分落库使用：
  // 已提交仍拒绝，但不再因评分期间的超时丢弃已完成评分。
  async savePaperGrade({
    paperId,
    grade,
    draft,
    allowAfterDeadline = false,
  }) {
    return this.store.update((state) => {
      const paper = state.paperQuestions.find((item) => item.id === paperId);
      if (!paper)
        throw Object.assign(new Error("论文题目不存在"), { status: 404 });
      if (paper.mock?.submittedAt) {
        throw Object.assign(new Error("该论文模拟已经提交过"), {
          status: 409,
          code: "ESSAY_ALREADY_SUBMITTED",
        });
      }
      if (
        !allowAfterDeadline &&
        paper.mock &&
        this.isPastDeadline(paper.mock, this.now(), EXAM_GRACE_SECONDS)
      ) {
        throw Object.assign(new Error("论文模拟已超时，不再接受保存或评分"), {
          status: 409,
          code: "ESSAY_TIME_OVER",
        });
      }
      if (draft !== undefined) paper.draft = String(draft ?? "");
      paper.grade = grade;
      if (paper.mock) {
        paper.mock.submittedAt = grade?.gradedAt || this.now();
        paper.mock.submissionStatus = "submitted";
      }
      return { paperId, saved: true };
    });
  }

  // 论文模拟计时：按服务端开始时间计算 120 分钟倒计时，刷新安全。
  async setPaperMockStart({ paperId }) {
    return this.store.update((state) => {
      const paper = state.paperQuestions.find((item) => item.id === paperId);
      if (!paper)
        throw Object.assign(new Error("论文题目不存在"), { status: 404 });
      if (paper.mock) {
        throw Object.assign(new Error("该论文模拟已经开始，不能重置计时"), {
          status: 409,
          code: "ESSAY_MOCK_ALREADY_STARTED",
        });
      }
      const startedAt = this.now();
      paper.mock = {
        startedAt,
        durationSeconds: 120 * 60,
        deadlineAt: new Date(
          new Date(startedAt).getTime() + 120 * 60 * 1000,
        ).toISOString(),
      };
      return { paperId, mock: paper.mock };
    });
  }

  assertPaperMockOpen(paperOrId) {
    const paper = typeof paperOrId === "object"
      ? paperOrId
      : this.paperList().find((item) => item.id === paperOrId);
    if (!paper)
      throw Object.assign(new Error("论文题目不存在"), { status: 404 });
    if (paper.mock?.submittedAt) {
      throw Object.assign(new Error("该论文模拟已经提交过"), {
        status: 409,
        code: "ESSAY_ALREADY_SUBMITTED",
      });
    }
    if (paper.mock && this.isPastDeadline(paper.mock, this.now(), EXAM_GRACE_SECONDS)) {
      throw Object.assign(new Error("论文模拟已超时，不再接受保存或评分"), {
        status: 409,
        code: "ESSAY_TIME_OVER",
      });
    }
    return paper;
  }
}
