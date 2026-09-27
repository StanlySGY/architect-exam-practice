// sessions 领域方法（拆分自原 questions.mjs，经继承链组装回 PracticeService）。
import { findSection } from "../mindmap.mjs";
import { addDays, makeId, sample } from "../utils.mjs";
import {
  DIFFICULTIES,
  EXAM_GRACE_SECONDS,
  REVIEW_INTERVALS,
  isImported,
  presentQuestion,
  answerFeedback,
  validateOptions,
  uniqueAgainst,
  resolveSourceNode,
  isRecord,
  throwIfAborted,
} from "./helpers.mjs";
import { PracticeServiceBase } from "./base.mjs";

export class SessionsDomain extends PracticeServiceBase {
  async createSession({
    chapter,
    section = "all",
    difficulty = "mixed",
    count = 10,
  }) {
    const chapterId = Number(chapter);
    const chapterNode = await this.mindMapChapterNode(chapterId);
    if (!chapterNode) {
      throw Object.assign(
        new Error(`第 ${chapterId} 章尚未加入思维导图，请先完成该章导图`),
        { status: 409, code: "MINDMAP_CHAPTER_MISSING" },
      );
    }
    const sectionId = section === "all" || !section ? null : String(section);
    if (sectionId && !findSection(chapterNode, sectionId)) {
      throw Object.assign(new Error(`第 ${sectionId} 小节尚未加入思维导图`), {
        status: 409,
        code: "MINDMAP_SECTION_MISSING",
      });
    }
    const size = Math.max(1, Math.min(30, Number(count) || 10));
    if (!this.chapters.some((item) => item.id === chapterId))
      throw Object.assign(new Error("章节不存在"), { status: 400 });
    if (!DIFFICULTIES.has(difficulty))
      throw Object.assign(new Error("难度参数无效"), { status: 400 });
    const candidates = uniqueAgainst(
      this.allQuestions().filter(
        (question) =>
          question.chapter === chapterId &&
          !question.disabledAt &&
          (question.sourceType ?? "generated") === "generated" &&
          (!sectionId || question.section === sectionId) &&
          (difficulty === "mixed" || question.difficulty === difficulty),
      ),
      [],
    );
    if (!candidates.length) {
      throw Object.assign(
        new Error("该章节和难度暂无题目，请先使用 Agent 生成"),
        { status: 409, code: "QUESTION_BANK_EMPTY" },
      );
    }
    const selected = sample(
      candidates,
      Math.min(size, candidates.length),
      this.random,
    );
    return this.saveSession({
      chapter: chapterId,
      section: sectionId,
      difficulty,
      mode: "practice",
      questions: selected,
    });
  }

  async createReviewSession({ limit = 10, includeNotDue = false } = {}) {
    const state = this.store.snapshot();
    const now = this.now();
    const map = this.questionMap(state);
    const records = Object.values(state.wrongBook)
      .filter(
        (record) =>
          !record.mastered && (includeNotDue || record.nextReviewAt <= now),
      )
      .sort((left, right) =>
        left.nextReviewAt.localeCompare(right.nextReviewAt),
      );
    const questions = records
      .slice(0, Math.max(1, Math.min(30, Number(limit) || 10)))
      .map((record) => map.get(record.questionId) ?? record.questionSnapshot)
      .filter((question) => question && !question.disabledAt);
    if (!questions.length)
      throw Object.assign(new Error("当前没有到期的错题"), {
        status: 409,
        code: "NO_DUE_QUESTIONS",
      });
    return this.saveSession({
      chapter: null,
      difficulty: "mixed",
      mode: "review",
      questions,
    });
  }

  // 综合知识模拟卷：跨章随机抽生成题；传入 term 时按真题/模拟卷题号顺序组套卷。
  async createMockExamSession({
    count = 75,
    durationMinutes = 150,
    term = null,
    sourceType = null,
  } = {}) {
    const durationSeconds = Math.max(
      300,
      Math.min(240 * 60, Math.round(Number(durationMinutes) * 60) || 150 * 60),
    );
    const examTerm = term && term !== "all" ? String(term) : null;
    const examSourceType =
      sourceType === "real" || sourceType === "mock" ? sourceType : null;
    let selected;
    let randomSourceType = null;
    if (examTerm) {
      selected = this.allQuestions()
        .filter(
          (question) =>
            !question.disabledAt &&
            question.term === examTerm &&
            (examSourceType
              ? question.sourceType === examSourceType
              : isImported(question)),
        )
        .toSorted(
          (left, right) =>
            Number(left.questionNo || 0) - Number(right.questionNo || 0) ||
            String(left.id).localeCompare(String(right.id), "zh-Hans-CN", {
              numeric: true,
            }),
        );
      if (!selected.length) {
        throw Object.assign(new Error(`没有找到 ${examTerm} 的套卷题目`), {
          status: 409,
          code: "EXAM_PAPER_EMPTY",
        });
      }
    } else {
      const size = Math.max(1, Math.min(75, Number(count) || 75));
      const generated = this.allQuestions().filter(
        (question) =>
          !question.disabledAt &&
          (question.sourceType ?? "generated") === "generated",
      );
      const candidates = generated.length
        ? generated
        : this.allQuestions().filter((question) => !question.disabledAt);
      randomSourceType = generated.length ? "generated" : null;
      if (!candidates.length) {
        throw Object.assign(
          new Error("题库为空，请先在各章节生成题目或导入真题后再模拟考试"),
          { status: 409, code: "QUESTION_BANK_EMPTY" },
        );
      }
      selected = sample(candidates, Math.min(size, candidates.length), this.random);
    }
    return this.saveSession({
      chapter: null,
      section: null,
      difficulty: "mixed",
      mode: "exam-mcq",
      durationSeconds,
      questions: selected,
      term: examTerm || selected[0]?.term || null,
      paper: selected[0]?.paper || null,
      sourceType: examTerm
        ? examSourceType || selected[0]?.sourceType || "real"
        : randomSourceType,
    });
  }

  // 模拟卷作答：与练习即时判题不同，允许反复改答案，且不返回任何反馈。
  async saveExamAnswer({ sessionId, questionId, answer, revision = null }) {
    if (!["A", "B", "C", "D"].includes(answer)) {
      throw Object.assign(new Error("答案必须是 A、B、C 或 D"), {
        status: 400,
      });
    }
    if (
      revision !== null &&
      (!Number.isInteger(revision) || revision < 1)
    ) {
      throw Object.assign(new Error("答案版本号无效"), {
        status: 400,
        code: "ANSWER_REVISION_INVALID",
      });
    }
    return this.store.update((state) => {
      const session = state.sessions[sessionId];
      if (!session)
        throw Object.assign(new Error("练习会话不存在或已失效"), {
          status: 404,
        });
      if (session.mode !== "exam-mcq")
        throw Object.assign(new Error("该会话不是模拟考试"), { status: 400 });
      if (session.abandonedAt)
        throw Object.assign(new Error("该练习已经放弃"), { status: 409 });
      if (session.gradedAt)
        throw Object.assign(new Error("该练习已经提交过"), { status: 409 });
      if (this.isPastDeadline(session, this.now(), EXAM_GRACE_SECONDS)) {
        throw Object.assign(new Error("考试时间已到，答案不再受理，请交卷"), {
          status: 409,
          code: "EXAM_TIME_OVER",
        });
      }
      if (!session.questionIds.includes(questionId)) {
        throw Object.assign(new Error("题目不属于当前练习"), { status: 400 });
      }
      session.checkedAnswers ??= {};
      session.answerRevisions ??= {};
      const currentRevision = Number(session.answerRevisions[questionId]) || 0;
      if (revision !== null && revision < currentRevision) {
        return {
          questionId,
          answer: session.checkedAnswers[questionId] ?? null,
          revision: currentRevision,
          saved: false,
          stale: true,
        };
      }
      if (revision !== null && revision === currentRevision) {
        if (session.checkedAnswers[questionId] !== answer) {
          return {
            questionId,
            answer: session.checkedAnswers[questionId] ?? null,
            revision: currentRevision,
            saved: false,
            stale: true,
          };
        }
        return {
          questionId,
          answer,
          revision: currentRevision,
          saved: true,
          idempotent: true,
        };
      }
      session.checkedAnswers[questionId] = answer;
      const nextRevision = revision ?? currentRevision + 1;
      session.answerRevisions[questionId] = nextRevision;
      return { questionId, answer, revision: nextRevision, saved: true };
    });
  }

  async saveSession({
    chapter,
    section = null,
    difficulty,
    mode,
    questions,
    durationSeconds = null,
    term = null,
    paper = null,
    sourceType = null,
  }) {
    const id = makeId("session");
    const createdAt = this.now();
    const session = {
      id,
      chapter,
      section,
      difficulty,
      mode,
      term,
      paper,
      sourceType,
      questionIds: questions.map((question) => question.id),
      checkedAnswers: {},
      answerRevisions: {},
      createdAt,
      gradedAt: null,
      abandonedAt: null,
      status: "active",
    };
    if (mode === "exam-mcq") {
      session.durationSeconds = durationSeconds;
      session.startedAt = createdAt;
      session.deadlineAt = new Date(
        new Date(createdAt).getTime() + durationSeconds * 1000,
      ).toISOString();
    }
    await this.store.update((state) => {
      for (const existing of Object.values(state.sessions)) {
        if (!existing.gradedAt && !existing.abandonedAt) {
          existing.abandonedAt = createdAt;
          existing.status = "abandoned";
        }
      }
      state.sessions[id] = session;
    });
    return {
      ...session,
      questions: questions.map((question) =>
        presentQuestion(question, this.assets),
      ),
      total: questions.length,
    };
  }

  activeSession() {
    const state = this.store.snapshot();
    const session = Object.values(state.sessions)
      .filter((item) => !item.gradedAt && !item.abandonedAt)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    if (!session) return null;
    const map = this.questionMap(state);
    const questions = session.questionIds
      .map((id) => map.get(id))
      .filter(Boolean);
    const answers = { ...(session.checkedAnswers ?? {}) };
    const payload = {
      ...session,
      questions: questions.map((question) =>
        presentQuestion(question, this.assets),
      ),
      answers,
      total: questions.length,
    };
    if (session.mode === "exam-mcq") {
      // 模拟考试：判卷前不返回任何反馈；剩余时间按服务端开始时间计算，刷新安全。
      payload.checks = {};
      payload.remainingSeconds = this.remainingSecondsOf(session);
    } else {
      const checks = {};
      for (const [questionId, answer] of Object.entries(answers)) {
        const question = map.get(questionId);
        if (question)
          checks[questionId] = answerFeedback(question, answer, this.assets);
      }
      payload.checks = checks;
    }
    return payload;
  }

  async abandonSession(sessionId) {
    return this.store.update((state) => {
      const session = state.sessions[sessionId];
      if (!session)
        throw Object.assign(new Error("练习会话不存在或已失效"), {
          status: 404,
        });
      if (session.gradedAt)
        throw Object.assign(new Error("已提交的练习不能放弃"), { status: 409 });
      session.abandonedAt = this.now();
      session.status = "abandoned";
      return { ok: true, id: sessionId, abandonedAt: session.abandonedAt };
    });
  }

  generatedQuestionPrompts(chapter, limit = 80) {
    return this.allQuestions()
      .filter(
        (question) =>
          question.chapter === Number(chapter) && !isImported(question),
      )
      .slice(-limit)
      .map((question) => question.question);
  }

  filterUniqueGeneratedQuestions(chapter, questions, additional = []) {
    const existing = this.allQuestions().filter(
      (question) => question.chapter === Number(chapter) && !isImported(question),
    );
    return uniqueAgainst(questions, [...existing, ...additional]);
  }

  async addGeneratedQuestions({
    chapter,
    section = null,
    difficulty,
    questions,
    source = "mindmap",
    sourceNode = null,
    signal,
  }) {
    throwIfAborted(signal);
    const chapterId = Number(chapter);
    if (!this.chapters.some((item) => item.id === chapterId))
      throw Object.assign(new Error("章节不存在"), { status: 400 });
    if (!["easy", "medium", "hard"].includes(difficulty))
      throw Object.assign(new Error("生成题目必须指定简单、中等或困难"), {
        status: 400,
      });
    const createdAt = this.now();
    const normalized = questions.map((item, index) => {
      if (
        !item.question?.trim() ||
        !validateOptions(item.options) ||
        !["A", "B", "C", "D"].includes(item.correct_answer)
      ) {
        throw Object.assign(
          new Error(`Agent 返回的第 ${index + 1} 题格式无效`),
          { status: 502 },
        );
      }
      return {
        id: makeId(`agent-c${chapterId}`),
        sourceType: "generated",
        source: `architect-agent/${source}`,
        chapter: chapterId,
        section,
        difficulty,
        knowledgePoint: item.knowledge_point || `第 ${chapterId} 章`,
        question: item.question.trim(),
        options: item.options,
        correctAnswer: item.correct_answer,
        analysis: item.analysis?.trim() || "暂无解析",
        knowledgeDetail: item.knowledge_detail?.trim() || "",
        commonMistake: item.common_mistake?.trim() || "",
        memoryTip: item.memory_tip?.trim() || "",
        sourceNode: resolveSourceNode(sourceNode, item.source_node),
        createdAt,
      };
    });
    return this.store.update((state) => {
      throwIfAborted(signal);
      const existing = state.generatedQuestions.filter(
        (question) => question.chapter === chapterId && !isImported(question),
      );
      const accepted = uniqueAgainst(normalized, existing);
      state.generatedQuestions.push(...accepted);
      return accepted;
    });
  }

  async checkAnswer({ sessionId, questionId, answer }) {
    if (!["A", "B", "C", "D"].includes(answer)) {
      throw Object.assign(new Error("答案必须是 A、B、C 或 D"), {
        status: 400,
      });
    }
    return this.store.update((state) => {
      const session = state.sessions[sessionId];
      if (!session)
        throw Object.assign(new Error("练习会话不存在或已失效"), {
          status: 404,
        });
      if (session.abandonedAt)
        throw Object.assign(new Error("该练习已经放弃"), { status: 409 });
      if (session.gradedAt)
        throw Object.assign(new Error("该练习已经提交过"), { status: 409 });
      if (session.mode === "exam-mcq") {
        // 模拟卷交卷前不返回任何反馈；统一判分走 /api/grade。
        throw Object.assign(
          new Error("模拟考试交卷前不显示对错，请交卷后查看判分结果"),
          { status: 400, code: "EXAM_NO_FEEDBACK" },
        );
      }
      if (!session.questionIds.includes(questionId)) {
        throw Object.assign(new Error("题目不属于当前练习"), { status: 400 });
      }
      session.checkedAnswers ??= {};
      if (Object.hasOwn(session.checkedAnswers, questionId)) {
        throw Object.assign(new Error("该题已经作答，不能修改答案"), {
          status: 409,
          code: "ANSWER_LOCKED",
        });
      }
      const question = this.questionMap(state).get(questionId);
      if (!question)
        throw Object.assign(new Error("题目不存在"), { status: 404 });
      session.checkedAnswers[questionId] = answer;
      return answerFeedback(question, answer, this.assets);
    });
  }

  async grade({ sessionId, answers = {} }) {
    const submittedAnswers = isRecord(answers) ? answers : {};
    return this.store.update((draft) => {
      const session = draft.sessions[sessionId];
      if (!session)
        throw Object.assign(new Error("练习会话不存在或已失效"), { status: 404 });
      if (session.abandonedAt)
        throw Object.assign(new Error("该练习已经放弃"), { status: 409 });
      // update() 串行执行；把检查放在事务内，只有第一个请求能完成状态转换。
      if (session.gradedAt || session.status === "graded")
        throw Object.assign(new Error("该练习已经提交过"), {
          status: 409,
          code: "SESSION_ALREADY_GRADED",
        });
      const gradedAt = this.now();
      const timedOut =
        session.mode === "exam-mcq" &&
        this.isPastDeadline(session, gradedAt, EXAM_GRACE_SECONDS);
      const serverAnswers = session.checkedAnswers ?? {};
      if (timedOut) {
        for (const [questionId, answer] of Object.entries(submittedAnswers)) {
          if (
            ["A", "B", "C", "D"].includes(answer) &&
            serverAnswers[questionId] !== answer
          ) {
            throw Object.assign(
              new Error("考试已超时，只能按截止前已保存的答案判卷"),
              { status: 409, code: "EXAM_TIME_OVER" },
            );
          }
        }
      }
      const map = this.questionMap(draft);
      const questions = session.questionIds
        .map((id) => map.get(id))
        .filter(Boolean);
      const details = questions.map((question) => {
        // 超时后只读服务端已保存答案；正常练习保留客户端补交兼容行为。
        const userAnswer =
          serverAnswers[question.id] ??
          (timedOut
            ? null
            : ["A", "B", "C", "D"].includes(submittedAnswers[question.id])
              ? submittedAnswers[question.id]
              : null);
        const attached = this.assets.attachChoice(question);
        return {
          id: question.id,
          question: attached.question,
          options: question.options,
          knowledgePoint: question.knowledgePoint,
          difficulty: question.difficulty,
          userAnswer,
          correctAnswer: question.correctAnswer,
          isCorrect: userAnswer === question.correctAnswer,
          analysis: question.analysis,
          knowledgeDetail: question.knowledgeDetail,
          commonMistake: question.commonMistake,
          memoryTip: question.memoryTip,
          sourceNode: question.sourceNode,
          figure: attached.figure ?? null,
          figureMissing: Boolean(attached.figureMissing),
          aiAnalysis: attached.aiAnalysis ?? null,
        };
      });
      const correct = details.filter((detail) => detail.isCorrect).length;
      const unanswered = details.filter((detail) => !detail.userAnswer).length;
      const attempt = {
        id: makeId("attempt"),
        sessionId,
        mode: session.mode,
        chapter: session.chapter,
        section: session.section,
        difficulty: session.difficulty,
        term: session.term ?? null,
        paper: session.paper ?? null,
        sourceType: session.sourceType ?? null,
        correct,
        incorrect: details.length - correct - unanswered,
        unanswered,
        total: details.length,
        percentage: details.length
          ? Math.round((correct / details.length) * 100)
          : 0,
        gradedAt,
        submittedAt: gradedAt,
        deadlineAt: session.deadlineAt ?? this.deadlineAtOf(session),
        submissionStatus: timedOut ? "expired" : "submitted",
      };
      session.gradedAt = gradedAt;
      session.submittedAt = gradedAt;
      session.status = "graded";
      session.submissionStatus = timedOut ? "expired" : "submitted";
      session.deadlineAt ??= this.deadlineAtOf(session);
      draft.attempts.unshift(attempt);
      for (const [index, detail] of details.entries()) {
        const question = questions[index];
        const existing = draft.wrongBook[detail.id];
        if (!detail.isCorrect) {
          draft.wrongBook[detail.id] = {
            questionId: detail.id,
            chapter: question.chapter,
            section: question.section,
            difficulty: question.difficulty,
            knowledgePoint: question.knowledgePoint,
            timesWrong: (existing?.timesWrong ?? 0) + 1,
            correctStreak: 0,
            firstWrongAt: existing?.firstWrongAt ?? gradedAt,
            lastWrongAt: gradedAt,
            nextReviewAt: gradedAt,
            mastered: false,
            questionSnapshot: question,
          };
        } else if (session.mode === "review" && existing) {
          // 间隔阶梯 1/3/7/14/30 天走完（连续 5 次复习答对）后才标记掌握，
          // 让每个间隔档位都有真实的巩固作用。
          const streak = existing.correctStreak + 1;
          existing.correctStreak = streak;
          existing.mastered = streak >= REVIEW_INTERVALS.length;
          existing.nextReviewAt = addDays(
            gradedAt,
            REVIEW_INTERVALS[Math.min(streak - 1, REVIEW_INTERVALS.length - 1)],
          );
        }
      }
      return { ...attempt, details };
    });
  }
}
