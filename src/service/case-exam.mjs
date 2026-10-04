// case-exam 领域方法（拆分自原 questions.mjs，经继承链组装回 PracticeService）。
import { makeId, sample } from "../utils.mjs";
import {
  EXAM_GRACE_SECONDS,
  normalizeComparableText,
  resolveSourceNode,
  throwIfAborted,
} from "./helpers.mjs";
import { DataDomain } from "./data.mjs";

export class CaseExamDomain extends DataDomain {
  async addCases({
    chapter,
    section = null,
    cases,
    sourceNode = null,
    signal,
    dedupe = true,
  }) {
    throwIfAborted(signal);
    const chapterId = Number(chapter);
    const createdAt = this.now();
    const normalized = cases.map((item, index) => {
      if (!item.title?.trim() || !item.scenario?.trim() || !Array.isArray(item.questions)) {
        throw Object.assign(
          new Error(`Agent 返回的第 ${index + 1} 个案例格式无效`),
          { status: 502 },
        );
      }
      return {
        id: makeId(`case-c${chapterId}`),
        sourceType: "generated",
        source: "architect-agent/mindmap",
        chapter: chapterId,
        section,
        title: item.title.trim(),
        scenario: item.scenario.trim(),
        knowledgePoint: item.knowledge_point || `第 ${chapterId} 章`,
        sourceNode: resolveSourceNode(sourceNode, item.source_node),
        questions: item.questions.map((q, qi) => ({
          id: `${qi + 1}`,
          text: q.text?.trim() || "",
          points: Number(q.points) || 5,
          referenceAnswer: q.reference_answer?.trim() || "",
        })),
        createdAt,
      };
    });
    return this.store.update((state) => {
      throwIfAborted(signal);
      // 同章同名（按归一化标题）视为重复：批内与既有案例库都不重复才收入。
      // dedupe: false 供测试/数据修复场景绕过，正常生成路径始终开启。
      const seen = new Set();
      const accepted = [];
      for (const item of normalized) {
        if (dedupe) {
          const key = `${item.chapter}:${normalizeComparableText(item.title)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (
            state.caseQuestions.some(
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
      state.caseQuestions.push(...accepted);
      return accepted;
    });
  }

  caseList({ sourceType = "all", term = "all" } = {}) {
    let records = this.store.snapshot().caseQuestions;
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

  // 模拟卷创建后固定案例内容，避免题库重导入或编辑改变进行中的试卷。
  snapshotCase(caseItem) {
    return structuredClone(caseItem);
  }

  // 新版模拟卷优先使用卷内快照；旧记录没有快照时继续读取当前案例库。
  resolveCaseExamCases(exam, state = this.store.snapshot()) {
    const currentById = new Map(
      state.caseQuestions.map((item) => [item.id, item]),
    );
    const snapshots = Array.isArray(exam.caseSnapshots)
      ? exam.caseSnapshots
      : [];
    const snapshotById = new Map(
      snapshots.map((item) => [item.id, item]),
    );
    return (exam.caseIds ?? [])
      .map((caseId) => snapshotById.get(caseId) ?? currentById.get(caseId))
      .filter(Boolean);
  }

  casePage({ sourceType = "all", term = "all", limit = 4, offset = 0 } = {}) {
    const records = this.caseList({ sourceType, term });
    const pageSize = Math.max(1, Math.min(20, Number(limit) || 4));
    const start = Math.max(0, Number(offset) || 0);
    return {
      total: records.length,
      offset: start,
      limit: pageSize,
      records: records.slice(start, start + pageSize),
    };
  }

  // 剥离参考答案的公开案例载荷（练习与模拟卷通用）。
  publicCase(caseItem, drafts = null) {
    const payload = {
      ...caseItem,
      questions: (caseItem.questions ?? []).map((question) => ({
        id: question.id,
        text: question.text,
        points: question.points,
      })),
    };
    if (drafts) payload.drafts = drafts;
    return payload;
  }

  // 案例模拟卷：从案例库随机抽取若干道组成限时连做卷。
  async createCaseExam({ count = 3, durationMinutes = 90, term = null, sourceType = null } = {}) {
    const size = Math.max(1, Math.min(8, Number(count) || 3));
    const durationSeconds = Math.max(
      600,
      Math.min(4 * 60 * 60, Math.round(Number(durationMinutes) * 60) || 90 * 60),
    );
    let candidates;
    if (term) {
      candidates = this.store.snapshot().caseQuestions.filter(
        (item) =>
          item.term === term &&
          (sourceType ? item.sourceType === sourceType : true),
      );
      if (!candidates.length) {
        throw Object.assign(
          new Error(`没有找到 ${term} 的案例套卷题目`),
          { status: 409, code: "CASE_PAPER_EMPTY" },
        );
      }
      const selected = sample(candidates, Math.min(size, candidates.length), this.random);
      const id = makeId("case-exam");
      const createdAt = this.now();
      const exam = {
        id,
        caseIds: selected.map((item) => item.id),
        caseSnapshots: selected.map((item) => this.snapshotCase(item)),
        durationSeconds,
        startedAt: createdAt,
        drafts: {},
        grade: null,
        gradedAt: null,
        abandonedAt: null,
        createdAt,
      };
      await this.store.update((state) => {
        for (const existing of state.caseExams) {
          if (!existing.gradedAt && !existing.abandonedAt) {
            existing.abandonedAt = createdAt;
          }
        }
        state.caseExams.push(exam);
      });
      return this.caseExamPayload(exam, selected);
    }
    // existing random 3-pack
    candidates = this.store.snapshot().caseQuestions;
    if (candidates.length < 1) {
      throw Object.assign(new Error("案例库为空，请先生成案例分析题"), {
        status: 409,
        code: "CASE_BANK_EMPTY",
      });
    }
    const selected = sample(candidates, Math.min(size, candidates.length), this.random);
    const id = makeId("case-exam");
    const createdAt = this.now();
    const exam = {
      id,
      caseIds: selected.map((item) => item.id),
      caseSnapshots: selected.map((item) => this.snapshotCase(item)),
      durationSeconds,
      startedAt: createdAt,
      drafts: {},
      grade: null,
      gradedAt: null,
      abandonedAt: null,
      createdAt,
    };
    await this.store.update((state) => {
      for (const existing of state.caseExams) {
        if (!existing.gradedAt && !existing.abandonedAt) {
          existing.abandonedAt = createdAt;
        }
      }
      state.caseExams.push(exam);
    });
    return this.caseExamPayload(exam, selected);
  }

  caseExamPayload(exam, cases = this.resolveCaseExamCases(exam)) {
    const caseById = new Map(cases.map((item) => [item.id, item]));
    const payloadCases = (exam.caseIds ?? [])
      .map((caseId) => caseById.get(caseId))
      .filter(Boolean)
      .map((item) =>
        this.publicCase(item, {
          caseId: item.id,
          texts: { ...(exam.drafts?.[item.id] ?? {}) },
        }),
      );
    const publicExam = { ...exam };
    delete publicExam.caseSnapshots;
    return {
      ...publicExam,
      cases: payloadCases,
      remainingSeconds: this.remainingSecondsOf(exam),
    };
  }

  activeCaseExam() {
    const state = this.store.snapshot();
    const exam = state.caseExams
      .filter((item) => !item.gradedAt && !item.abandonedAt)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
    if (!exam) return null;
    const cases = this.resolveCaseExamCases(exam, state);
    return this.caseExamPayload(exam, cases);
  }

  // 返回评分所需的私有案例内容（含参考答案），供服务端交给评分器使用。
  caseExamForGrading(examId) {
    const state = this.store.snapshot();
    const exam = state.caseExams.find((item) => item.id === examId);
    if (!exam) return null;
    return {
      exam,
      cases: this.resolveCaseExamCases(exam, state),
    };
  }

  async saveCaseExamDraft({ examId, caseId, questionId, text }) {
    return this.store.update((state) => {
      const exam = state.caseExams.find((item) => item.id === examId);
      if (!exam)
        throw Object.assign(new Error("模拟卷不存在或已失效"), { status: 404 });
      if (exam.gradedAt || exam.abandonedAt)
        throw Object.assign(new Error("该模拟卷已结束"), { status: 409 });
      if (exam.startedAt && exam.durationSeconds) {
        const elapsed =
          (new Date(this.now()).getTime() -
            new Date(exam.startedAt).getTime()) /
          1000;
        if (elapsed > exam.durationSeconds + EXAM_GRACE_SECONDS) {
          throw Object.assign(
            new Error("考试时间已到，答案不再受理，请交卷"),
            { status: 409, code: "EXAM_TIME_OVER" },
          );
        }
      }
      if (!exam.caseIds.includes(caseId))
        throw Object.assign(new Error("案例不属于当前模拟卷"), { status: 400 });
      const caseItem = this.resolveCaseExamCases(exam, state).find(
        (item) => item.id === caseId,
      );
      if (!caseItem || !caseItem.questions.some((q) => q.id === questionId))
        throw Object.assign(new Error("小问不存在"), { status: 404 });
      exam.drafts ??= {};
      exam.drafts[caseId] ??= {};
      exam.drafts[caseId][questionId] = String(text ?? "");
      return { examId, caseId, questionId, saved: true };
    });
  }

  async abandonCaseExam(examId) {
    return this.store.update((state) => {
      const exam = state.caseExams.find((item) => item.id === examId);
      if (!exam)
        throw Object.assign(new Error("模拟卷不存在或已失效"), { status: 404 });
      if (exam.gradedAt)
        throw Object.assign(new Error("已判分的模拟卷不能放弃"), { status: 409 });
      exam.abandonedAt = this.now();
      return { examId, abandonedAt: exam.abandonedAt };
    });
  }

  async saveCaseExamGrade({ examId, grade }) {
    return this.store.update((state) => {
      const exam = state.caseExams.find((item) => item.id === examId);
      if (!exam)
        throw Object.assign(new Error("模拟卷不存在或已失效"), { status: 404 });
      if (exam.gradedAt)
        throw Object.assign(new Error("该模拟卷已判过分"), { status: 409 });
      if (exam.abandonedAt)
        throw Object.assign(new Error("该模拟卷已放弃"), { status: 409 });
      exam.grade = grade;
      exam.gradedAt = this.now();
      return { examId, gradedAt: exam.gradedAt };
    });
  }

  caseExamList() {
    const state = this.store.snapshot();
    return state.caseExams
      .toSorted((left, right) => right.startedAt.localeCompare(left.startedAt))
      .slice(0, 50)
      .map((exam) => ({
        id: exam.id,
        startedAt: exam.startedAt,
        gradedAt: exam.gradedAt,
        abandonedAt: exam.abandonedAt,
        durationSeconds: exam.durationSeconds,
        totalScore: exam.grade?.total_score ?? null,
        maxScore: exam.grade?.max_score ?? null,
        titles: (exam.caseIds ?? []).map((caseId) => {
          const caseItem = this.resolveCaseExamCases(exam, state).find(
            (item) => item.id === caseId,
          );
          return caseItem?.title ?? "已删除案例";
        }),
      }));
  }

  // 自测对照：逐问返回用户作答与参考答案（仅供旧版界面自查，不参与 AI 评分）。
  gradeCase({ caseId, answers = {} }) {
    const state = this.store.snapshot();
    const caseItem = state.caseQuestions.find((item) => item.id === caseId);
    if (!caseItem)
      throw Object.assign(new Error("案例不存在"), { status: 404 });
    const details = caseItem.questions.map((question) => {
      const userAnswer = String(answers[question.id] ?? "").trim();
      return {
        id: question.id,
        text: question.text,
        points: question.points,
        userAnswer,
        referenceAnswer: question.referenceAnswer,
        answered: Boolean(userAnswer),
      };
    });
    return { caseId, title: caseItem.title, details };
  }

  async saveCaseDraft({ caseId, questionId, text }) {
    return this.store.update((state) => {
      const caseItem = state.caseQuestions.find((item) => item.id === caseId);
      if (!caseItem)
        throw Object.assign(new Error("案例不存在"), { status: 404 });
      if (!caseItem.questions.some((q) => q.id === questionId))
        throw Object.assign(new Error("小问不存在"), { status: 404 });
      caseItem.drafts ??= {};
      caseItem.drafts[questionId] = String(text ?? "");
      return { caseId, questionId, saved: true };
    });
  }

  // 单案例 AI 评分持久化到案例记录（与模拟卷判分对齐）。
  async saveCaseGrade({ caseId, grade, answers = undefined }) {
    return this.store.update((state) => {
      const caseItem = state.caseQuestions.find((item) => item.id === caseId);
      if (!caseItem)
        throw Object.assign(new Error("案例不存在"), { status: 404 });
      if (answers && typeof answers === "object") {
        caseItem.drafts ??= {};
        for (const question of caseItem.questions ?? []) {
          if (Object.prototype.hasOwnProperty.call(answers, question.id)) {
            caseItem.drafts[question.id] = String(answers[question.id] ?? "");
          }
        }
      }
      caseItem.grade = grade;
      caseItem.gradedAt = grade.gradedAt ?? this.now();
      return { caseId, gradedAt: caseItem.gradedAt };
    });
  }
}
