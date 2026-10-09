// bank 领域方法（拆分自原 questions.mjs，经继承链组装回 PracticeService）。
import { QUESTION_REVIEW_REASONS, isImported, normalizeComparableText, validateOptions, structureIssuesOf } from "./helpers.mjs";
import { ReviewDomain } from "./review.mjs";

// 题目难度诊断标签：基于题目自身作答统计（至少 5 次作答才判定）。
function difficultyFlagOf(question) {
  const stats = question.stats;
  if (!stats || stats.seen < 5) return null;
  const facility = stats.correct / stats.seen;
  if (facility >= 1) return "too_easy";
  if (facility <= 0.2) return "too_hard";
  return null;
}

export class BankDomain extends ReviewDomain {
  questionBank({
    query = "",
    chapter = "all",
    section = "all",
    difficulty = "all",
    status = "all",
    starred = "all",
    sourceType = "all",
    term = "all",
    limit = 50,
    offset = 0,
  } = {}) {
    const search = normalizeComparableText(query).slice(0, 200);
    const chapterId =
      chapter === "all" || chapter === "" ? null : Number(chapter);
    const pageSize = Math.max(1, Math.min(100, Number(limit) || 50));
    const start = Math.max(0, Number(offset) || 0);
    let records = this.allQuestions();
    if (chapterId !== null && Number.isFinite(chapterId)) {
      records = records.filter((question) => question.chapter === chapterId);
    }
    if (section !== "all" && section !== "") {
      records = records.filter((question) => question.section === section);
    }
    if (["easy", "medium", "hard"].includes(difficulty)) {
      records = records.filter(
        (question) => question.difficulty === difficulty,
      );
    }
    if (status === "active") {
      records = records.filter((question) => !question.disabledAt);
    } else if (status === "disabled") {
      records = records.filter((question) => question.disabledAt);
    }
    if (starred === "starred") {
      records = records.filter((question) => question.starred);
    }
    if (["generated", "real", "mock"].includes(sourceType)) {
      records = records.filter(
        (question) => (question.sourceType ?? "generated") === sourceType,
      );
    }
    if (term !== "all" && term !== "") {
      records = records.filter((question) => question.term === term);
    }
    if (search) {
      records = records.filter((question) => {
        const text = [
          question.question,
          question.knowledgePoint,
          question.analysis,
          question.term,
          question.paper,
          question.module,
          ...Object.values(question.options ?? {}),
        ]
          .map(normalizeComparableText)
          .join("");
        return text.includes(search);
      });
    }
    records = records.toSorted((left, right) =>
      String(right.createdAt ?? right.id).localeCompare(
        String(left.createdAt ?? left.id),
      ),
    );
    return {
      total: records.length,
      offset: start,
      limit: pageSize,
      records: records.slice(start, start + pageSize).map((question) => ({
        ...this.assets.attachChoice(question),
        status: question.disabledAt ? "disabled" : "active",
        stats: question.stats ?? null,
        eloRating: question.eloRating ?? null,
        revision: question.revision ?? 1,
        difficultyFlag: difficultyFlagOf(question),
      })),
    };
  }

  // 编辑生成题：旧版本快照存入 revisions（保留最近 5 版），revision 递增。
  async updateQuestion({ questionId, updates }) {
    return this.store.update((state) => {
      const question = this.questionMap(state).get(questionId);
      if (!question)
        throw Object.assign(new Error("题目不存在"), { status: 404 });
      if (isImported(question)) {
        throw Object.assign(
          new Error("导入的真题/模拟题只读，不能编辑"),
          { status: 409, code: "IMPORTED_QUESTION_READONLY" },
        );
      }
      const patch = {};
      if (typeof updates?.question === "string" && updates.question.trim())
        patch.question = updates.question.trim();
      if (validateOptions(updates?.options)) patch.options = updates.options;
      if (["A", "B", "C", "D"].includes(updates?.correctAnswer))
        patch.correctAnswer = updates.correctAnswer;
      if (typeof updates?.analysis === "string")
        patch.analysis = updates.analysis.trim() || "暂无解析";
      if (typeof updates?.knowledgePoint === "string")
        patch.knowledgePoint = updates.knowledgePoint.trim();
      if (["easy", "medium", "hard"].includes(updates?.difficulty))
        patch.difficulty = updates.difficulty;
      if (!Object.keys(patch).length) {
        throw Object.assign(new Error("没有可更新的题目字段"), { status: 400 });
      }
      question.revisions ??= [];
      question.revisions.unshift({
        revision: question.revision ?? 1,
        editedAt: this.now(),
        snapshot: {
          question: question.question,
          options: { ...question.options },
          correctAnswer: question.correctAnswer,
          analysis: question.analysis,
          knowledgePoint: question.knowledgePoint,
          difficulty: question.difficulty,
        },
      });
      question.revisions = question.revisions.slice(0, 5);
      Object.assign(question, patch);
      question.revision = (question.revision ?? 1) + 1;
      question.editedAt = this.now();
      // Any manual edit invalidates prior fact-check approval: the old evidence
      // refers to the previous question revision and must not authorize this one.
      question.reviewStatus = "pending_review";
      question.reviewReasons = [QUESTION_REVIEW_REASONS.NO_HUMAN_FACT_CHECK];
      delete question.reviewedBy;
      delete question.reviewEvidence;
      delete question.reviewedAt;
      delete question.reviewedRevision;
      delete question.reviewEvidenceType;
      delete question.reviewEvidenceReference;
      delete question.reviewedFields;
      return {
        questionId,
        revision: question.revision,
        updatedFields: Object.keys(patch),
      };
    });
  }

  async reviewQuestion({ questionId, reviewer, evidenceType, evidenceReference, evidenceNote, reviewedFields }) {
    const allowedTypes = new Set(["official_exam", "official_standard", "textbook", "secondary_source", "manual_note"]);
    const requiredFields = ["question", "options", "correctAnswer", "analysis"];
    const fields = Array.isArray(reviewedFields) ? [...new Set(reviewedFields)] : [];
    const validFields = new Set(["question", "options", "correctAnswer", "analysis", "knowledgeDetail"]);
    if (typeof reviewer !== "string" || !reviewer.trim() || reviewer.trim().length > 256) throw Object.assign(new Error("请填写有效的审校人"), { status: 400 });
    if (!allowedTypes.has(evidenceType) || evidenceType === "manual_note") throw Object.assign(new Error("正式批准必须选择可追溯的教材、官方原卷、官方标准或可靠二手来源"), { status: 400 });
    if (typeof evidenceReference !== "string" || !evidenceReference.trim() || evidenceReference.trim().length > 2000) throw Object.assign(new Error("请填写来源定位：URL，或书名/版本/页码/条款"), { status: 400 });
    if (typeof evidenceNote !== "string" || !evidenceNote.trim() || evidenceNote.trim().length > 4000) throw Object.assign(new Error("请填写核验结论或依据摘要"), { status: 400 });
    if (fields.some((field) => !validFields.has(field)) || !requiredFields.every((field) => fields.includes(field))) throw Object.assign(new Error("必须明确核验题干、选项、正确答案和解析；知识详解可另行勾选"), { status: 400 });
    return this.store.update((state) => {
      const question = this.questionMap(state).get(questionId);
      if (!question) throw Object.assign(new Error("题目不存在"), { status: 404 });
      if (isImported(question)) throw Object.assign(new Error("导入的真题/模拟题不适用生成题审校流程"), { status: 409, code: "IMPORTED_QUESTION_READONLY" });
      if ((question.sourceType ?? "generated") !== "generated") throw Object.assign(new Error("仅支持审校 AI 生成题"), { status: 409 });
      const structureIssues = structureIssuesOf(question, this.sourceNodeResolves(question));
      if (structureIssues.length) throw Object.assign(new Error(`题目结构仍有问题，不能批准：${structureIssues.join("、")}`), { status: 409, code: "QUESTION_NOT_REVIEWABLE" });
      question.reviewStatus = "approved";
      question.reviewReasons = [];
      question.reviewedBy = reviewer.trim();
      question.reviewEvidenceType = evidenceType;
      question.reviewEvidenceReference = evidenceReference.trim();
      question.reviewEvidence = evidenceNote.trim();
      question.reviewedFields = fields;
      question.reviewedAt = this.now();
      question.reviewedRevision = Number.isInteger(question.revision) && question.revision > 0 ? question.revision : 1;
      this.appendAudit(state, "questions.human-review", { questionId, revision: question.reviewedRevision, reviewer: question.reviewedBy, evidenceType, reviewedFields: fields, note: "记录了人工审校声明；系统不独立验证来源权威性或答案正确性。" });
      return { questionId, reviewStatus: question.reviewStatus, reviewedRevision: question.reviewedRevision, reviewedFields: fields };
    });
  }

  // 问题题处理状态机：open → acknowledged →（恢复时）resolved。
  async setIssueStatus({ questionId, status }) {
    if (!["open", "acknowledged"].includes(status)) {
      throw Object.assign(new Error("问题题状态无效"), { status: 400 });
    }
    return this.store.update((state) => {
      const issue = state.questionIssues[questionId];
      if (!issue)
        throw Object.assign(new Error("问题题记录不存在"), { status: 404 });
      if (issue.resolvedAt) {
        throw Object.assign(new Error("该问题题已恢复，状态不再变更"), {
          status: 409,
        });
      }
      issue.status = status;
      issue.statusAt = this.now();
      return { questionId, status };
    });
  }

  async deleteQuestion({ questionId, confirm }) {
    if (confirm !== "DELETE") {
      throw Object.assign(new Error("删除确认口令无效"), {
        status: 400,
        code: "CONFIRMATION_REQUIRED",
      });
    }
    return this.store.update((state) => {
      const index = state.generatedQuestions.findIndex(
        (question) => question.id === questionId,
      );
      if (index === -1)
        throw Object.assign(new Error("题目不存在"), { status: 404 });
      const question = state.generatedQuestions[index];
      if (isImported(question)) {
        throw Object.assign(new Error("导入的真题/模拟题不能永久删除"), {
          status: 409,
          code: "IMPORTED_QUESTION_READONLY",
        });
      }
      state.generatedQuestions.splice(index, 1);
      delete state.wrongBook[questionId];
      delete state.questionIssues[questionId];
      const deletedAt = this.now();
      for (const session of Object.values(state.sessions)) {
        const completed = Boolean(
          session.gradedAt ||
            session.abandonedAt ||
            ["abandoned", "submitted", "expired", "graded"].includes(session.status),
        );
        const hasSnapshot = Object.hasOwn(
          session.questionSnapshots ?? {},
          questionId,
        );
        if (completed && hasSnapshot) continue;
        session.questionIds = (session.questionIds ?? []).filter(
          (id) => id !== questionId,
        );
        for (const field of [
          "checkedAnswers",
          "answerRevisions",
          "confidences",
          "questionSnapshots",
        ]) {
          if (session[field]) delete session[field][questionId];
        }
        if (!completed && !session.questionIds.length) {
          session.abandonedAt = deletedAt;
          session.status = "abandoned";
        }
      }
      return { questionId, deleted: true };
    });
  }

  questionIssues() {
    const state = this.store.snapshot();
    const map = this.questionMap(state);
    return Object.values(state.questionIssues)
      .filter((issue) => !issue.resolvedAt)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((issue) => ({
        ...issue,
        status: issue.status ?? "open",
        question: map.get(issue.questionId)?.question ?? issue.question,
        chapter: map.get(issue.questionId)?.chapter ?? issue.chapter,
      }));
  }

  async reportQuestion({ questionId, note = "" }) {
    const normalizedNote = String(note).trim().slice(0, 500);
    return this.store.update((state) => {
      const question = this.questionMap(state).get(questionId);
      if (!question)
        throw Object.assign(new Error("题目不存在"), { status: 404 });
      const reportedAt = this.now();
      question.disabledAt = reportedAt;
      state.questionIssues[questionId] = {
        questionId,
        chapter: question.chapter,
        note: normalizedNote || "用户标记题目有问题",
        status: "open",
        createdAt: reportedAt,
        resolvedAt: null,
      };
      const wrongRecord = state.wrongBook[questionId];
      if (wrongRecord) {
        // 记住上报前的掌握状态，恢复题目时按原状态归还错题复习。
        wrongRecord.prevMastered = Boolean(wrongRecord.mastered);
        wrongRecord.mastered = true;
        wrongRecord.disabledByIssue = true;
      }
      return { questionId, disabledAt: reportedAt };
    });
  }

  async restoreQuestion(questionId) {
    return this.store.update((state) => {
      const question = this.questionMap(state).get(questionId);
      if (!question)
        throw Object.assign(new Error("题目不存在"), { status: 404 });
      question.disabledAt = null;
      const issue = state.questionIssues[questionId];
      if (issue) issue.resolvedAt = this.now();
      const wrongRecord = state.wrongBook[questionId];
      if (wrongRecord?.disabledByIssue) {
        wrongRecord.disabledByIssue = false;
        wrongRecord.mastered = Boolean(wrongRecord.prevMastered);
        delete wrongRecord.prevMastered;
      }
      return { questionId, restored: true };
    });
  }

  async setStarred(questionId, starred) {
    return this.store.update((state) => {
      const question = this.questionMap(state).get(questionId);
      if (!question)
        throw Object.assign(new Error("题目不存在"), { status: 404 });
      question.starred = Boolean(starred);
      return { questionId, starred: question.starred };
    });
  }
}
