// bank 领域方法（拆分自原 questions.mjs，经继承链组装回 PracticeService）。
import { isImported, normalizeComparableText } from "./helpers.mjs";
import { ReviewDomain } from "./review.mjs";

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
      })),
    };
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
        if (session.gradedAt || session.abandonedAt) continue;
        session.questionIds = session.questionIds.filter(
          (id) => id !== questionId,
        );
        if (session.checkedAnswers) delete session.checkedAnswers[questionId];
        if (!session.questionIds.length) session.abandonedAt = deletedAt;
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
