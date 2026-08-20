import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  chapterIds,
  findChapter,
  findSection,
  readMindMap,
  sectionsOfChapter,
} from "./mindmap.mjs";
import { addDays, makeId, sample } from "./utils.mjs";

const DIFFICULTIES = new Set(["easy", "medium", "hard", "mixed"]);
const REVIEW_INTERVALS = [1, 3, 7, 14, 30];
const BACKUP_FORMAT = "ruankao-practice-backup";
const BACKUP_VERSION = 1;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateBackupData(data) {
  if (
    !isRecord(data) ||
    !Array.isArray(data.generatedQuestions) ||
    !isRecord(data.sessions) ||
    !Array.isArray(data.attempts) ||
    !isRecord(data.wrongBook) ||
    (data.questionIssues !== undefined && !isRecord(data.questionIssues))
  ) {
    throw Object.assign(new Error("备份数据结构无效"), {
      status: 400,
      code: "INVALID_BACKUP",
    });
  }
  for (const question of data.generatedQuestions) {
    if (
      !question?.id ||
      !question.question ||
      !validateOptions(question.options) ||
      !["A", "B", "C", "D"].includes(question.correctAnswer)
    ) {
      throw Object.assign(new Error("备份中包含格式无效的题目"), {
        status: 400,
        code: "INVALID_BACKUP",
      });
    }
  }
}

function publicQuestion(question) {
  const {
    correctAnswer,
    analysis,
    knowledgeDetail,
    commonMistake,
    memoryTip,
    ...safe
  } = question;
  return safe;
}

function answerFeedback(question, answer) {
  return {
    id: question.id,
    userAnswer: answer,
    correctAnswer: question.correctAnswer,
    isCorrect: answer === question.correctAnswer,
    analysis: question.analysis,
    commonMistake: question.commonMistake,
    memoryTip: question.memoryTip,
  };
}

function validateOptions(options) {
  return (
    options &&
    ["A", "B", "C", "D"].every(
      (key) => typeof options[key] === "string" && options[key].trim(),
    )
  );
}

function normalizeComparableText(value = "") {
  return String(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function bigramSimilarity(left, right) {
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return 0;
  const leftPairs = new Set();
  const rightPairs = new Set();
  for (let index = 0; index < left.length - 1; index += 1) {
    leftPairs.add(left.slice(index, index + 2));
  }
  for (let index = 0; index < right.length - 1; index += 1) {
    rightPairs.add(right.slice(index, index + 2));
  }
  let overlap = 0;
  for (const pair of leftPairs) {
    if (rightPairs.has(pair)) overlap += 1;
  }
  return (2 * overlap) / (leftPairs.size + rightPairs.size);
}

function optionText(question) {
  return ["A", "B", "C", "D"]
    .map((key) => normalizeComparableText(question.options?.[key]))
    .sort()
    .join("|");
}

function questionsAreDuplicate(left, right) {
  const leftText = normalizeComparableText(left.question);
  const rightText = normalizeComparableText(right.question);
  if (!leftText || !rightText) return false;
  if (leftText === rightText) return true;
  if (Math.min(leftText.length, rightText.length) < 10) return false;
  const questionScore = bigramSimilarity(leftText, rightText);
  if (questionScore >= 0.9) return true;
  return (
    questionScore >= 0.72 &&
    bigramSimilarity(optionText(left), optionText(right)) >= 0.82
  );
}

function uniqueAgainst(questions, existing) {
  const accepted = [];
  for (const question of questions) {
    const seen = [...existing, ...accepted].some((candidate) =>
      questionsAreDuplicate(question, candidate),
    );
    if (!seen) accepted.push(question);
  }
  return accepted;
}

export class PracticeService {
  constructor({
    store,
    root = process.cwd(),
    now = () => new Date().toISOString(),
    random = Math.random,
  }) {
    this.store = store;
    this.root = root;
    this.now = now;
    this.random = random;
    this.chapters = [];
    this.seedQuestions = [];
  }

  async init() {
    const chaptersRaw = await readFile(
      resolve(this.root, "data/chapters.json"),
      "utf8",
    );
    try {
      this.chapters = JSON.parse(chaptersRaw);
    } catch (error) {
      throw new Error(`无法解析 data/chapters.json: ${error.message}`, {
        cause: error,
      });
    }
  }

  allQuestions(state = this.store.snapshot()) {
    return state.generatedQuestions;
  }

  questionMap(state = this.store.snapshot()) {
    return new Map(
      this.allQuestions(state).map((question) => [question.id, question]),
    );
  }

  chapterList() {
    const questions = this.allQuestions();
    return this.chapters.map((chapter) => {
      const available = questions.filter(
        (question) => question.chapter === chapter.id && !question.disabledAt,
      );
      return {
        ...chapter,
        counts: {
          all: available.length,
          easy: available.filter((question) => question.difficulty === "easy")
            .length,
          medium: available.filter(
            (question) => question.difficulty === "medium",
          ).length,
          hard: available.filter((question) => question.difficulty === "hard")
            .length,
        },
      };
    });
  }

  async mindMapChapterNode(chapterId) {
    const mindMap = await readMindMap(
      resolve(this.root, process.env.RUANKAO_MINDMAP || "ruankao.mm"),
    );
    return mindMap ? findChapter(mindMap, Number(chapterId)) : null;
  }

  async mindMapChapterIds() {
    const mindMap = await readMindMap(
      resolve(this.root, process.env.RUANKAO_MINDMAP || "ruankao.mm"),
    );
    return mindMap ? chapterIds(mindMap) : new Set();
  }

  async chapterListWithSources() {
    const mappedChapters = await this.mindMapChapterIds();
    return this.chapterList().map((chapter) => ({
      ...chapter,
      source: mappedChapters.has(chapter.id) ? "mindmap" : "unavailable",
    }));
  }

  async sections(chapterId) {
    const mindMap = await readMindMap(
      resolve(this.root, process.env.RUANKAO_MINDMAP || "ruankao.mm"),
    );
    const chapterNode = mindMap
      ? findChapter(mindMap, Number(chapterId))
      : null;
    if (!chapterNode) return [];
    const counts = this.allQuestions().filter(
      (question) =>
        question.chapter === Number(chapterId) && !question.disabledAt,
    );
    return sectionsOfChapter(chapterNode, Number(chapterId)).map((section) => {
      const available = counts.filter(
        (question) => question.section === section.id,
      );
      return {
        id: section.id,
        title: section.title,
        counts: {
          all: available.length,
          easy: available.filter((question) => question.difficulty === "easy")
            .length,
          medium: available.filter(
            (question) => question.difficulty === "medium",
          ).length,
          hard: available.filter((question) => question.difficulty === "hard")
            .length,
        },
      };
    });
  }

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

  async saveSession({ chapter, section = null, difficulty, mode, questions }) {
    const id = makeId("session");
    const createdAt = this.now();
    const session = {
      id,
      chapter,
      section,
      difficulty,
      mode,
      questionIds: questions.map((question) => question.id),
      checkedAnswers: {},
      createdAt,
      gradedAt: null,
      abandonedAt: null,
    };
    await this.store.update((state) => {
      for (const existing of Object.values(state.sessions)) {
        if (!existing.gradedAt && !existing.abandonedAt) {
          existing.abandonedAt = createdAt;
        }
      }
      state.sessions[id] = session;
    });
    return {
      ...session,
      questions: questions.map(publicQuestion),
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
    const checks = {};
    for (const [questionId, answer] of Object.entries(answers)) {
      const question = map.get(questionId);
      if (question) checks[questionId] = answerFeedback(question, answer);
    }
    return {
      ...session,
      questions: questions.map(publicQuestion),
      answers,
      checks,
      total: questions.length,
    };
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
      return { ok: true, id: sessionId, abandonedAt: session.abandonedAt };
    });
  }

  generatedQuestionPrompts(chapter, limit = 80) {
    return this.allQuestions()
      .filter((question) => question.chapter === Number(chapter))
      .slice(-limit)
      .map((question) => question.question);
  }

  filterUniqueGeneratedQuestions(chapter, questions, additional = []) {
    const existing = this.allQuestions().filter(
      (question) => question.chapter === Number(chapter),
    );
    return uniqueAgainst(questions, [...existing, ...additional]);
  }

  async addGeneratedQuestions({
    chapter,
    section = null,
    difficulty,
    questions,
    source = "mindmap",
  }) {
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
        source: `ruankao-agent/${source}`,
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
        createdAt,
      };
    });
    return this.store.update((state) => {
      const existing = state.generatedQuestions.filter(
        (question) => question.chapter === chapterId,
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
      return answerFeedback(question, answer);
    });
  }

  async grade({ sessionId, answers = {} }) {
    const state = this.store.snapshot();
    const session = state.sessions[sessionId];
    if (!session)
      throw Object.assign(new Error("练习会话不存在或已失效"), { status: 404 });
    if (session.abandonedAt)
      throw Object.assign(new Error("该练习已经放弃"), { status: 409 });
    if (session.gradedAt)
      throw Object.assign(new Error("该练习已经提交过"), { status: 409 });
    const map = this.questionMap(state);
    const questions = session.questionIds
      .map((id) => map.get(id))
      .filter(Boolean);
    const gradedAt = this.now();
    const details = questions.map((question) => {
      const userAnswer =
        session.checkedAnswers?.[question.id] ?? answers[question.id] ?? null;
      return {
        id: question.id,
        question: question.question,
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
      correct,
      incorrect: details.length - correct - unanswered,
      unanswered,
      total: details.length,
      percentage: details.length
        ? Math.round((correct / details.length) * 100)
        : 0,
      gradedAt,
    };
    await this.store.update((draft) => {
      draft.sessions[sessionId].gradedAt = gradedAt;
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
          const streak = existing.correctStreak + 1;
          existing.correctStreak = streak;
          existing.mastered = streak >= 2;
          existing.nextReviewAt = addDays(
            gradedAt,
            REVIEW_INTERVALS[Math.min(streak - 1, REVIEW_INTERVALS.length - 1)],
          );
        }
      }
    });
    return { ...attempt, details };
  }

  wrongQuestions() {
    const state = this.store.snapshot();
    const now = this.now();
    const records = Object.values(state.wrongBook).sort((left, right) =>
      right.lastWrongAt.localeCompare(left.lastWrongAt),
    );
    return {
      summary: {
        total: records.length,
        active: records.filter((record) => !record.mastered).length,
        due: records.filter(
          (record) => !record.mastered && record.nextReviewAt <= now,
        ).length,
        mastered: records.filter((record) => record.mastered).length,
      },
      records: records.map((record) => ({
        ...record,
        questionSnapshot: undefined,
        question: record.questionSnapshot.question,
        options: record.questionSnapshot.options,
        correctAnswer: record.questionSnapshot.correctAnswer,
        analysis: record.questionSnapshot.analysis,
      })),
    };
  }

  questionBank({
    query = "",
    chapter = "all",
    section = "all",
    difficulty = "all",
    status = "all",
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
    if (search) {
      records = records.filter((question) => {
        const text = [
          question.question,
          question.knowledgePoint,
          question.analysis,
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
        ...question,
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

  statistics() {
    const state = this.store.snapshot();
    const attempts = state.attempts.filter(
      (attempt) => Number(attempt.total) > 0 && attempt.gradedAt,
    );
    const totalQuestions = attempts.reduce(
      (sum, attempt) => sum + Number(attempt.total || 0),
      0,
    );
    const correct = attempts.reduce(
      (sum, attempt) => sum + Number(attempt.correct || 0),
      0,
    );
    const studyDays = new Set(
      attempts.map((attempt) => String(attempt.gradedAt).slice(0, 10)),
    ).size;
    const chapters = new Map();
    for (const attempt of attempts) {
      if (!attempt.chapter) continue;
      const chapterId = Number(attempt.chapter);
      const current = chapters.get(chapterId) ?? {
        chapter: chapterId,
        title:
          this.chapters.find((chapter) => chapter.id === chapterId)?.title ??
          `第 ${chapterId} 章`,
        attempts: 0,
        total: 0,
        correct: 0,
      };
      current.attempts += 1;
      current.total += Number(attempt.total || 0);
      current.correct += Number(attempt.correct || 0);
      chapters.set(chapterId, current);
    }
    const chapterStats = [...chapters.values()]
      .map((chapter) => ({
        ...chapter,
        accuracy: chapter.total
          ? Math.round((chapter.correct / chapter.total) * 100)
          : 0,
      }))
      .sort((left, right) => left.chapter - right.chapter);
    const weakPoints = new Map();
    for (const record of Object.values(state.wrongBook)) {
      if (record.mastered || record.disabledByIssue) continue;
      const name = record.knowledgePoint || "未分类知识点";
      const current = weakPoints.get(name) ?? {
        knowledgePoint: name,
        timesWrong: 0,
        questionCount: 0,
        lastWrongAt: record.lastWrongAt,
      };
      current.timesWrong += Number(record.timesWrong || 0);
      current.questionCount += 1;
      if (record.lastWrongAt > current.lastWrongAt) {
        current.lastWrongAt = record.lastWrongAt;
      }
      weakPoints.set(name, current);
    }
    const wrongRecords = Object.values(state.wrongBook);
    const reviewRecords = wrongRecords.filter(
      (record) => !record.disabledByIssue,
    );
    const review = {
      total: reviewRecords.length,
      active: reviewRecords.filter((record) => !record.mastered).length,
      mastered: reviewRecords.filter((record) => record.mastered).length,
      due: reviewRecords.filter(
        (record) => !record.mastered && record.nextReviewAt <= this.now(),
      ).length,
    };
    return {
      summary: {
        attempts: attempts.length,
        totalQuestions,
        correct,
        accuracy: totalQuestions
          ? Math.round((correct / totalQuestions) * 100)
          : 0,
        studyDays,
      },
      chapters: chapterStats,
      trend: attempts
        .slice(0, 12)
        .toReversed()
        .map((attempt) => ({
          id: attempt.id,
          mode: attempt.mode,
          chapter: attempt.chapter,
          percentage: Number(attempt.percentage || 0),
          correct: Number(attempt.correct || 0),
          total: Number(attempt.total || 0),
          gradedAt: attempt.gradedAt,
        })),
      weakKnowledgePoints: [...weakPoints.values()]
        .sort(
          (left, right) =>
            right.timesWrong - left.timesWrong ||
            right.lastWrongAt.localeCompare(left.lastWrongAt),
        )
        .slice(0, 8),
      review,
    };
  }

  dataSummary(state = this.store.snapshot()) {
    const sessions = Object.values(state.sessions);
    return {
      questions: state.generatedQuestions.length,
      wrongQuestions: Object.keys(state.wrongBook).length,
      attempts: state.attempts.length,
      activeSessions: sessions.filter(
        (session) => !session.gradedAt && !session.abandonedAt,
      ).length,
      questionIssues: Object.values(state.questionIssues).filter(
        (issue) => !issue.resolvedAt,
      ).length,
    };
  }

  exportData() {
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: this.now(),
      data: this.store.snapshot(),
    };
  }

  async importData({ backup, confirm }) {
    if (confirm !== "IMPORT") {
      throw Object.assign(new Error("导入确认口令无效"), {
        status: 400,
        code: "CONFIRMATION_REQUIRED",
      });
    }
    if (
      !isRecord(backup) ||
      backup.format !== BACKUP_FORMAT ||
      backup.version !== BACKUP_VERSION
    ) {
      throw Object.assign(new Error("不是受支持的软考练习备份文件"), {
        status: 400,
        code: "INVALID_BACKUP",
      });
    }
    validateBackupData(backup.data);
    return this.store.update((state) => {
      state.version = Number(backup.data.version) || 1;
      state.generatedQuestions = structuredClone(
        backup.data.generatedQuestions,
      );
      state.sessions = structuredClone(backup.data.sessions);
      state.attempts = structuredClone(backup.data.attempts);
      state.wrongBook = structuredClone(backup.data.wrongBook);
      state.questionIssues = structuredClone(backup.data.questionIssues ?? {});
      return this.dataSummary(state);
    });
  }

  async clearData({ scope, confirm }) {
    if (confirm !== "CLEAR") {
      throw Object.assign(new Error("清空确认口令无效"), {
        status: 400,
        code: "CONFIRMATION_REQUIRED",
      });
    }
    const supported = new Set(["questions", "wrongBook", "attempts", "all"]);
    if (!supported.has(scope)) {
      throw Object.assign(new Error("清空范围无效"), { status: 400 });
    }
    return this.store.update((state) => {
      if (scope === "questions" || scope === "all") {
        state.generatedQuestions = [];
        state.sessions = {};
        state.wrongBook = {};
        state.questionIssues = {};
      }
      if (scope === "wrongBook" || scope === "all") state.wrongBook = {};
      if (scope === "attempts" || scope === "all") {
        state.attempts = [];
        if (scope === "attempts") {
          state.sessions = Object.fromEntries(
            Object.entries(state.sessions).filter(
              ([, session]) => !session.gradedAt && !session.abandonedAt,
            ),
          );
        }
      }
      return this.dataSummary(state);
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
      return { questionId, restored: true };
    });
  }

  attempts() {
    return this.store.snapshot().attempts.slice(0, 100);
  }

  async setMastered(questionId, mastered) {
    return this.store.update((state) => {
      const record = state.wrongBook[questionId];
      if (!record)
        throw Object.assign(new Error("错题记录不存在"), { status: 404 });
      record.mastered = Boolean(mastered);
      if (!mastered) record.nextReviewAt = this.now();
      return { questionId, mastered: record.mastered };
    });
  }
}
