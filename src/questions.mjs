import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  chapterIds,
  findChapter,
  findSection,
  nodePath,
  readMindMap,
  sectionsOfChapter,
} from "./mindmap.mjs";
import {
  catalogFromImported,
  defaultBankFile,
  readArchitectBank,
} from "./import-bank.mjs";
import { ExamAssets } from "./exam-assets.mjs";
import { addDays, makeId, sample } from "./utils.mjs";

const IMPORTED_SOURCE_TYPES = new Set(["real", "mock"]);

function isImported(item) {
  return IMPORTED_SOURCE_TYPES.has(item?.sourceType);
}

function keepImported(items = []) {
  return items.filter(isImported);
}

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

function presentQuestion(question, assets) {
  const safe = publicQuestion(assets.attachChoice(question));
  delete safe.aiAnalysis;
  return safe;
}

function answerFeedback(question, answer, assets) {
  const attached = assets.attachChoice(question);
  return {
    id: question.id,
    userAnswer: answer,
    correctAnswer: question.correctAnswer,
    isCorrect: answer === question.correctAnswer,
    analysis: question.analysis,
    commonMistake: question.commonMistake,
    memoryTip: question.memoryTip,
    figure: attached.figure ?? null,
    figureMissing: Boolean(attached.figureMissing),
    aiAnalysis: attached.aiAnalysis ?? null,
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

// 将模型返回的 source_node 解析为导图节点路径。sourceNode 是当前章节/小节节点，
// 用于在导图内定位；找不到时退回模型提供的原文，保证来源信息始终可展示。
function resolveSourceNode(sourceNode, rawSourceNode) {
  const raw = String(rawSourceNode ?? "").trim();
  if (sourceNode && raw) {
    const path = nodePath(sourceNode, raw);
    if (path) return path.join(" › ");
  }
  return raw || null;
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
    this.assets = new ExamAssets({ root });
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
    await this.assets.load();
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
        (question) =>
          question.chapter === chapter.id &&
          !question.disabledAt &&
          (question.sourceType ?? "generated") === "generated",
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
        question.chapter === Number(chapterId) &&
        !question.disabledAt &&
        (question.sourceType ?? "generated") === "generated",
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
        : "generated",
    });
  }

  // 模拟卷作答：与练习即时判题不同，允许反复改答案，且不返回任何反馈。
  async saveExamAnswer({ sessionId, questionId, answer }) {
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
      if (session.mode !== "exam-mcq")
        throw Object.assign(new Error("该会话不是模拟考试"), { status: 400 });
      if (session.abandonedAt)
        throw Object.assign(new Error("该练习已经放弃"), { status: 409 });
      if (session.gradedAt)
        throw Object.assign(new Error("该练习已经提交过"), { status: 409 });
      if (!session.questionIds.includes(questionId)) {
        throw Object.assign(new Error("题目不属于当前练习"), { status: 400 });
      }
      session.checkedAnswers ??= {};
      session.checkedAnswers[questionId] = answer;
      return { questionId, answer, saved: true };
    });
  }

  remainingSecondsOf(item, now = this.now()) {
    if (!item?.startedAt || !item?.durationSeconds) return null;
    const elapsed =
      (new Date(now).getTime() - new Date(item.startedAt).getTime()) / 1000;
    return Math.max(0, Math.round(item.durationSeconds - elapsed));
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
      createdAt,
      gradedAt: null,
      abandonedAt: null,
    };
    if (mode === "exam-mcq") {
      session.durationSeconds = durationSeconds;
      session.startedAt = createdAt;
    }
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
        sourceType: "generated",
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
        sourceNode: resolveSourceNode(sourceNode, item.source_node),
        createdAt,
      };
    });
    return this.store.update((state) => {
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
    const map = this.questionMap(state);
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
      records: records.map((record) => {
        const current = map.get(record.questionId);
        const sourceNode =
          current?.sourceNode ?? record.questionSnapshot.sourceNode;
        const relatedWiki = this.relatedWikiEntries({
          knowledgePoint: record.knowledgePoint || "",
          sourceNode,
        });
        return {
          ...record,
          questionSnapshot: undefined,
          question: record.questionSnapshot.question,
          options: record.questionSnapshot.options,
          correctAnswer: record.questionSnapshot.correctAnswer,
          analysis: record.questionSnapshot.analysis,
          // 优先取当前题库的来源节点，回退到判卷时的快照，兼容回填前的旧错题。
          sourceNode,
          wikiEntries: relatedWiki,
        };
      }),
    };
  }

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
    // 知识点掌握度：按知识点聚合错题本，统计待掌握/已掌握题数，用于可视化薄弱点。
    const mastery = new Map();
    for (const record of wrongRecords) {
      if (record.disabledByIssue) continue;
      const name = record.knowledgePoint || "未分类知识点";
      const current = mastery.get(name) ?? {
        knowledgePoint: name,
        chapter: record.chapter,
        active: 0,
        mastered: 0,
        total: 0,
      };
      current.total += 1;
      if (record.mastered) current.mastered += 1;
      else current.active += 1;
      mastery.set(name, current);
    }
    const knowledgeMastery = [...mastery.values()]
      .sort(
        (left, right) =>
          right.active - left.active ||
          right.total - left.total ||
          left.knowledgePoint.localeCompare(right.knowledgePoint),
      )
      .slice(0, 20);
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
      knowledgeMastery,
      review,
    };
  }

  // 学习计划：每日目标 + 今日进度 + 连续打卡天数。
  getStudyPlan() {
    const state = this.store.snapshot();
    const settings = state.settings ?? {};
    const dailyGoal = Number(settings.dailyGoal) || 0;
    const today = String(this.now()).slice(0, 10);
    const answeredByDay = new Map();
    for (const attempt of state.attempts) {
      if (!attempt.gradedAt) continue;
      const day = String(attempt.gradedAt).slice(0, 10);
      answeredByDay.set(day, (answeredByDay.get(day) ?? 0) + Number(attempt.total || 0));
    }
    const todayAnswered = answeredByDay.get(today) ?? 0;
    // 连续打卡：从今天（或昨天，若今天未达标）往前数连续有作答的天数。
    let streak = 0;
    if (dailyGoal > 0) {
      const cursor = new Date(`${today}T00:00:00Z`);
      if (todayAnswered < dailyGoal) {
        cursor.setUTCDate(cursor.getUTCDate() - 1);
      }
      while ((answeredByDay.get(cursor.toISOString().slice(0, 10)) ?? 0) >= dailyGoal) {
        streak += 1;
        cursor.setUTCDate(cursor.getUTCDate() - 1);
      }
    }
    return {
      dailyGoal,
      todayAnswered,
      todayDone: dailyGoal > 0 && todayAnswered >= dailyGoal,
      streak,
      totalAnswered: [...answeredByDay.values()].reduce((sum, n) => sum + n, 0),
    };
  }

  studyMaterials() {
    return this.assets.studyMaterials();
  }

  studyMaterial(id) {
    return this.assets.studyMaterial(id);
  }

  diagnosisExport() {
    const state = this.store.snapshot();
    const questions = this.questionMap(state);
    const modules = new Map();
    for (const session of Object.values(state.sessions)) {
      if (!session.gradedAt) continue;
      for (const questionId of session.questionIds ?? []) {
        const answer = session.checkedAnswers?.[questionId];
        if (!answer) continue;
        const question = questions.get(questionId);
        if (!question) continue;
        const key =
          question.module ||
          question.knowledgePoint ||
          `第 ${question.chapter} 章`;
        const current = modules.get(key) ?? { total: 0, correct: 0, wrong: 0 };
        current.total += 1;
        if (answer === question.correctAnswer) current.correct += 1;
        else current.wrong += 1;
        modules.set(key, current);
      }
    }
    const byModule = Object.fromEntries(
      [...modules.entries()].map(([key, stat]) => [
        key,
        {
          ...stat,
          accuracy: stat.total ? stat.correct / stat.total : 0,
        },
      ]),
    );
    const recentWrong = Object.values(state.wrongBook)
      .filter((record) => !record.mastered && !record.disabledByIssue)
      .sort((left, right) =>
        String(right.lastWrongAt).localeCompare(String(left.lastWrongAt)),
      )
      .slice(0, 50)
      .map((record) => {
        const question =
          questions.get(record.questionId) ?? record.questionSnapshot ?? {};
        const attached = this.assets.attachChoice(question);
        return {
          id: record.questionId,
          module:
            question.module ||
            question.knowledgePoint ||
            `第 ${question.chapter ?? "—"} 章`,
          timesWrong: record.timesWrong ?? 0,
          lastWrongAt: record.lastWrongAt ?? null,
          stem: attached.question ?? "",
          options: question.options ?? null,
          correctAnswer: question.correctAnswer ?? null,
          analysis: question.analysis ?? null,
          figureMissing: Boolean(attached.figureMissing),
        };
      });
    return {
      schemaVersion: 1,
      generatedAt: this.now(),
      subject: "系统架构设计师",
      app: "ruankao-chapter-practice",
      statistics: this.statistics(),
      studyPlan: this.getStudyPlan(),
      learner: {
        byModule,
        bookmarkedQuestionIds: this.allQuestions(state)
          .filter((question) => question.starred)
          .map((question) => question.id),
        recentWrong,
      },
      aiInstructions: [
        "只针对系统架构设计师，不要扩展到其他软考科目。",
        "先按模块正确率找短板，不要只看单题。",
        "图示缺失时不要编造图中位置、连线或数值。",
        "结合学习计划和错题，给出下一周可执行的复习安排。",
      ],
    };
  }

  async setDailyGoal(goal) {
    const value = Math.max(0, Math.min(500, Number(goal) || 0));
    return this.store.update((state) => {
      state.settings ??= {};
      state.settings.dailyGoal = value;
      return { dailyGoal: value };
    });
  }

  dataSummary(state = this.store.snapshot()) {
    const sessions = Object.values(state.sessions);
    const questions = state.generatedQuestions;
    const cases = state.caseQuestions;
    const papers = state.paperQuestions;
    const byType = (items) => ({
      generated: items.filter((item) => (item.sourceType ?? "generated") === "generated").length,
      real: items.filter((item) => item.sourceType === "real").length,
      mock: items.filter((item) => item.sourceType === "mock").length,
    });
    return {
      questions: questions.length,
      generatedQuestions: byType(questions).generated,
      realQuestions: byType(questions).real,
      mockQuestions: byType(questions).mock,
      wrongQuestions: Object.keys(state.wrongBook).length,
      attempts: state.attempts.length,
      activeSessions: sessions.filter(
        (session) => !session.gradedAt && !session.abandonedAt,
      ).length,
      questionIssues: Object.values(state.questionIssues).filter(
        (issue) => !issue.resolvedAt,
      ).length,
      cases: cases.length,
      generatedCases: byType(cases).generated,
      realCases: byType(cases).real,
      mockCases: byType(cases).mock,
      papers: papers.length,
      generatedPapers: byType(papers).generated,
      realPapers: byType(papers).real,
      mockPapers: byType(papers).mock,
      wikiEntries: state.wikiEntries.length,
      caseExams: state.caseExams.length,
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
      state.settings = structuredClone(backup.data.settings ?? {});
      state.caseQuestions = structuredClone(backup.data.caseQuestions ?? []);
      state.paperQuestions = structuredClone(backup.data.paperQuestions ?? []);
      state.wikiEntries = structuredClone(backup.data.wikiEntries ?? []);
      state.caseExams = structuredClone(backup.data.caseExams ?? []);
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
        state.generatedQuestions = keepImported(state.generatedQuestions);
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
      if (scope === "all") {
        state.caseQuestions = keepImported(state.caseQuestions);
        state.paperQuestions = keepImported(state.paperQuestions);
        state.wikiEntries = [];
        state.caseExams = [];
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

  async setStarred(questionId, starred) {
    return this.store.update((state) => {
      const question = this.questionMap(state).get(questionId);
      if (!question)
        throw Object.assign(new Error("题目不存在"), { status: 404 });
      question.starred = Boolean(starred);
      return { questionId, starred: question.starred };
    });
  }

  async addCases({ chapter, section = null, cases, sourceNode = null }) {
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
        source: "ruankao-agent/mindmap",
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
      state.caseQuestions.push(...normalized);
      return normalized;
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

  caseExamPayload(exam, cases) {
    const caseById = new Map(cases.map((item) => [item.id, item]));
    const payloadCases = exam.caseIds
      .map((caseId) => caseById.get(caseId))
      .filter(Boolean)
      .map((item) =>
        this.publicCase(item, {
          caseId: item.id,
          texts: { ...(exam.drafts?.[item.id] ?? {}) },
        }),
      );
    return {
      ...exam,
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
    const caseById = new Map(
      state.caseQuestions.map((item) => [item.id, item]),
    );
    const cases = exam.caseIds.map((caseId) => caseById.get(caseId)).filter(Boolean);
    return this.caseExamPayload(exam, cases);
  }

  async saveCaseExamDraft({ examId, caseId, questionId, text }) {
    return this.store.update((state) => {
      const exam = state.caseExams.find((item) => item.id === examId);
      if (!exam)
        throw Object.assign(new Error("模拟卷不存在或已失效"), { status: 404 });
      if (exam.gradedAt || exam.abandonedAt)
        throw Object.assign(new Error("该模拟卷已结束"), { status: 409 });
      if (!exam.caseIds.includes(caseId))
        throw Object.assign(new Error("案例不属于当前模拟卷"), { status: 400 });
      const caseItem = state.caseQuestions.find((item) => item.id === caseId);
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
      exam.grade = grade;
      exam.gradedAt = this.now();
      return { examId, gradedAt: exam.gradedAt };
    });
  }

  caseExamList() {
    const state = this.store.snapshot();
    const caseById = new Map(state.caseQuestions.map((item) => [item.id, item]));
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
        titles: exam.caseIds.map((caseId) => caseById.get(caseId)?.title ?? "已删除案例"),
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

  async addPapers({ chapter, section = null, papers, sourceNode = null }) {
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
        source: "ruankao-agent/mindmap",
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
      state.paperQuestions.push(...normalized);
      return normalized;
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

  realExamCatalog(state = this.store.snapshot()) {
    return catalogFromImported({
      questions: state.generatedQuestions.filter(isImported),
      cases: state.caseQuestions.filter(isImported),
      papers: state.paperQuestions.filter(isImported),
    });
  }

  async importArchitectBank({ file } = {}) {
    const bankFile = file ? resolve(this.root, file) : defaultBankFile(this.root);
    const mapped = await readArchitectBank(bankFile);
    const createdAt = this.now();
    return this.store.update((state) => {
      const questionsById = new Map(
        state.generatedQuestions.map((item) => [item.id, item]),
      );
      let questionsAdded = 0;
      let questionsUpdated = 0;
      for (const item of mapped.questions) {
        const next = { ...item, createdAt: questionsById.get(item.id)?.createdAt ?? createdAt };
        if (questionsById.has(item.id)) {
          const index = state.generatedQuestions.findIndex((row) => row.id === item.id);
          const previous = state.generatedQuestions[index];
          state.generatedQuestions[index] = {
            ...previous,
            ...next,
            starred: previous.starred,
            disabledAt: previous.disabledAt,
            createdAt: previous.createdAt ?? createdAt,
          };
          questionsUpdated += 1;
        } else {
          state.generatedQuestions.push(next);
          questionsAdded += 1;
        }
      }
      const casesById = new Map(state.caseQuestions.map((item) => [item.id, item]));
      let casesAdded = 0;
      let casesUpdated = 0;
      for (const item of mapped.cases) {
        if (casesById.has(item.id)) {
          const index = state.caseQuestions.findIndex((row) => row.id === item.id);
          const previous = state.caseQuestions[index];
          state.caseQuestions[index] = {
            ...previous,
            ...item,
            drafts: previous.drafts,
            grade: previous.grade,
            createdAt: previous.createdAt ?? createdAt,
          };
          casesUpdated += 1;
        } else {
          state.caseQuestions.push({ ...item, createdAt });
          casesAdded += 1;
        }
      }
      const papersById = new Map(state.paperQuestions.map((item) => [item.id, item]));
      let papersAdded = 0;
      let papersUpdated = 0;
      for (const item of mapped.papers) {
        if (papersById.has(item.id)) {
          const index = state.paperQuestions.findIndex((row) => row.id === item.id);
          const previous = state.paperQuestions[index];
          state.paperQuestions[index] = {
            ...previous,
            ...item,
            draft: previous.draft,
            grade: previous.grade,
            mock: previous.mock,
            createdAt: previous.createdAt ?? createdAt,
          };
          papersUpdated += 1;
        } else {
          state.paperQuestions.push({ ...item, createdAt });
          papersAdded += 1;
        }
      }
      return {
        file: bankFile,
        questions: {
          total: mapped.questions.length,
          added: questionsAdded,
          updated: questionsUpdated,
        },
        cases: {
          total: mapped.cases.length,
          added: casesAdded,
          updated: casesUpdated,
        },
        papers: {
          total: mapped.papers.length,
          added: papersAdded,
          updated: papersUpdated,
        },
        catalog: this.realExamCatalog(state),
        summary: this.dataSummary(state),
      };
    });
  }

  async savePaperDraft({ paperId, draft }) {
    return this.store.update((state) => {
      const paper = state.paperQuestions.find((item) => item.id === paperId);
      if (!paper)
        throw Object.assign(new Error("论文题目不存在"), { status: 404 });
      paper.draft = String(draft ?? "");
      return { paperId, saved: true };
    });
  }

  async savePaperGrade({ paperId, grade }) {
    return this.store.update((state) => {
      const paper = state.paperQuestions.find((item) => item.id === paperId);
      if (!paper)
        throw Object.assign(new Error("论文题目不存在"), { status: 404 });
      paper.grade = grade;
      return { paperId, saved: true };
    });
  }

  // 论文模拟计时：按服务端开始时间计算 120 分钟倒计时，刷新安全。
  async setPaperMockStart({ paperId }) {
    return this.store.update((state) => {
      const paper = state.paperQuestions.find((item) => item.id === paperId);
      if (!paper)
        throw Object.assign(new Error("论文题目不存在"), { status: 404 });
      paper.mock = {
        startedAt: this.now(),
        durationSeconds: 120 * 60,
      };
      return { paperId, mock: paper.mock };
    });
  }

  async addWikiEntries({ chapter, section = null, entries, sourceNode = null }) {
    const chapterId = Number(chapter);
    const createdAt = this.now();
    const normalized = entries.map((item, index) => {
      if (!item.title?.trim() || !item.summary?.trim()) {
        throw Object.assign(
          new Error(`Agent 返回的第 ${index + 1} 个知识点格式无效`),
          { status: 502 },
        );
      }
      return {
        id: makeId(`wiki-c${chapterId}`),
        chapter: chapterId,
        section,
        title: item.title.trim(),
        summary: item.summary.trim(),
        keyPoints: Array.isArray(item.key_points)
          ? item.key_points.map((p) => String(p).trim()).filter(Boolean)
          : [],
        commonMistakes: Array.isArray(item.common_mistakes)
          ? item.common_mistakes.map((p) => String(p).trim()).filter(Boolean)
          : [],
        related: Array.isArray(item.related)
          ? item.related.map((p) => String(p).trim()).filter(Boolean)
          : [],
        sourceNode: resolveSourceNode(sourceNode, item.source_node),
        status: "draft",
        createdAt,
        updatedAt: createdAt,
      };
    });
    return this.store.update((state) => {
      state.wikiEntries.push(...normalized);
      return normalized;
    });
  }

  wikiList() {
    const state = this.store.snapshot();
    const entries = state.wikiEntries;
    // 建立标题 -> 条目 的映射，用于双向链接匹配。
    const byTitle = new Map();
    for (const entry of entries) {
      byTitle.set(normalizeComparableText(entry.title), entry);
    }
    return entries.map((entry) => {
      // links：与 related 一一对应，related 能解析到现有条目的返回其 id，否则为 null。
      const links = (entry.related ?? []).map(
        (name) => this.resolveWikiEntry(name, { entries })?.id ?? null,
      );
      // backlinks：引用当前条目的其他条目。
      const backlinks = entries
        .filter((other) => other.id !== entry.id)
        .filter((other) =>
          (other.related ?? []).some(
            (name) =>
              normalizeComparableText(name) ===
              normalizeComparableText(entry.title),
          ),
        )
        .map((other) => ({ id: other.id, title: other.title }));
      return { ...entry, links, backlinks };
    });
  }

  // 名称 → 条目解析：精确匹配优先，其次互相包含（≥4 字），最后 bigram 相似度兜底。
  resolveWikiEntry(name, { entries = null, threshold = 0.6 } = {}) {
    const nameNorm = normalizeComparableText(name);
    if (!nameNorm) return null;
    const pool = entries ?? this.store.snapshot().wikiEntries ?? [];
    for (const entry of pool) {
      if (normalizeComparableText(entry.title) === nameNorm) return entry;
    }
    for (const entry of pool) {
      const titleNorm = normalizeComparableText(entry.title);
      if (
        nameNorm.length >= 4 &&
        titleNorm.length >= 4 &&
        (titleNorm.includes(nameNorm) || nameNorm.includes(titleNorm))
      ) {
        return entry;
      }
    }
    let best = null;
    if (nameNorm.length >= 4) {
      for (const entry of pool) {
        const score = bigramSimilarity(
          nameNorm,
          normalizeComparableText(entry.title),
        );
        if (score >= threshold && (!best || score > best.score)) {
          best = { entry, score };
        }
      }
    }
    return best?.entry ?? null;
  }

  // 按知识点标题为判分结果匹配 Wiki 条目：先精确匹配，再用模糊匹配补位。
  matchWikiEntries(titles = [], limit = 3) {
    const entries = this.store.snapshot().wikiEntries ?? [];
    const norms = (Array.isArray(titles) ? titles : [])
      .map((title) => normalizeComparableText(title))
      .filter(Boolean);
    const matched = [];
    const seen = new Set();
    const pick = (predicate) => {
      for (const entry of entries) {
        if (seen.has(entry.id)) continue;
        const titleNorm = normalizeComparableText(entry.title);
        if (!titleNorm) continue;
        if (predicate(titleNorm)) {
          seen.add(entry.id);
          matched.push({ id: entry.id, title: entry.title });
        }
      }
    };
    pick((titleNorm) => norms.some((kp) => kp === titleNorm));
    pick(
      (titleNorm) =>
        titleNorm.length >= 4 &&
        norms.some(
          (kp) =>
            kp.length >= 4 && (titleNorm.includes(kp) || kp.includes(titleNorm)),
        ),
    );
    pick(
      (titleNorm) =>
        titleNorm.length >= 4 &&
        norms.some(
          (kp) =>
            kp.length >= 4 && bigramSimilarity(kp, titleNorm) >= 0.6,
        ),
    );
    return matched.slice(0, limit);
  }

  // 为知识点/来源节点匹配相关 Wiki 条目（错题本与判分共用）。
  relatedWikiEntries({ knowledgePoint = "", sourceNode = "", limit = 3 } = {}) {
    const wikiEntries = this.store.snapshot().wikiEntries ?? [];
    const kpNorm = normalizeComparableText(knowledgePoint);
    const sourceNorm = normalizeComparableText(sourceNode);
    return wikiEntries
      .filter((entry) => {
        const titleNorm = normalizeComparableText(entry.title);
        const entrySourceNorm = normalizeComparableText(entry.sourceNode);
        if (kpNorm && titleNorm === kpNorm) return true;
        if (sourceNorm && entrySourceNorm === sourceNorm) return true;
        // 模糊匹配：知识点标题与 Wiki 条目标题互相包含（长度足够时）。
        if (kpNorm && titleNorm) {
          if (kpNorm.length >= 4 && titleNorm.includes(kpNorm)) return true;
          if (titleNorm.length >= 4 && kpNorm.includes(titleNorm)) return true;
        }
        return false;
      })
      .slice(0, limit)
      .map((entry) => ({ id: entry.id, title: entry.title }));
  }

  // Wiki 自检（Lint）：同名条目、断链引用、孤立条目、缺溯源，并给出修复建议。
  wikiLint() {
    const entries = this.store.snapshot().wikiEntries ?? [];
    const byTitle = new Map();
    const firstByTitle = new Map();
    for (const entry of entries) {
      const titleNorm = normalizeComparableText(entry.title);
      byTitle.set(titleNorm, (byTitle.get(titleNorm) ?? 0) + 1);
      if (!firstByTitle.has(titleNorm)) firstByTitle.set(titleNorm, entry.id);
    }
    const issues = [];
    for (const entry of entries) {
      const titleNorm = normalizeComparableText(entry.title);
      const related = entry.related ?? [];
      const resolved = related.filter((name) =>
        byTitle.has(normalizeComparableText(name)),
      );
      const entryIssues = [];
      const suggestions = [];
      if ((byTitle.get(titleNorm) ?? 0) > 1) {
        entryIssues.push("duplicate_title");
      }
      if (related.length > resolved.length) {
        entryIssues.push("broken_related");
        for (const name of related) {
          if (byTitle.has(normalizeComparableText(name))) continue;
          const candidate = this.resolveWikiEntry(name, {
            entries,
            threshold: 0.4,
          });
          if (candidate && candidate.id !== entry.id) {
            suggestions.push({
              name,
              candidate: candidate.title,
              id: candidate.id,
            });
          }
        }
      }
      if (!entry.sourceNode) entryIssues.push("missing_source");
      const hasOutbound = resolved.some(
        (name) => firstByTitle.get(normalizeComparableText(name)) !== entry.id,
      );
      const hasInbound = entries.some(
        (other) =>
          other.id !== entry.id &&
          (other.related ?? []).some(
            (name) => normalizeComparableText(name) === titleNorm,
          ),
      );
      if (!hasInbound && !hasOutbound) entryIssues.push("orphan");
      if (entryIssues.length) {
        const mergeInto =
          byTitle.get(titleNorm) > 1 && firstByTitle.get(titleNorm) !== entry.id
            ? firstByTitle.get(titleNorm)
            : null;
        issues.push({
          id: entry.id,
          title: entry.title,
          issues: entryIssues,
          suggestions,
          mergeInto,
        });
      }
    }
    return { total: entries.length, problems: issues.length, issues };
  }

  // 修复断链引用：把解析不到的 related 名称替换为建议的现有条目标题。
  async fixWikiRelated({ entryId, name, candidate }) {
    return this.store.update((state) => {
      const entry = state.wikiEntries.find((item) => item.id === entryId);
      if (!entry)
        throw Object.assign(new Error("知识点不存在"), { status: 404 });
      const index = (entry.related ?? []).findIndex(
        (item) =>
          normalizeComparableText(item) === normalizeComparableText(name),
      );
      if (index === -1) {
        throw Object.assign(new Error("未找到要修复的引用"), { status: 400 });
      }
      entry.related[index] = String(candidate ?? "").trim();
      entry.updatedAt = this.now();
      return { entryId, fixed: true };
    });
  }

  // 同名条目合并：把来源条目的内容并入目标条目后删除来源。
  async mergeWikiEntry({ entryId, intoId }) {
    if (entryId === intoId) {
      throw Object.assign(new Error("不能合并到自身"), { status: 400 });
    }
    return this.store.update((state) => {
      const source = state.wikiEntries.find((item) => item.id === entryId);
      const target = state.wikiEntries.find((item) => item.id === intoId);
      if (!source || !target) {
        throw Object.assign(new Error("知识点不存在"), { status: 404 });
      }
      // 去重按归一化文本比较：只差标点/空格的近似重复要点只保留首个变体。
      const dedupe = (list) => {
        const seen = new Set();
        const result = [];
        for (const item of Array.isArray(list) ? list : []) {
          const text = String(item).trim();
          if (!text) continue;
          const key = normalizeComparableText(text);
          if (seen.has(key)) continue;
          seen.add(key);
          result.push(text);
        }
        return result;
      };
      target.keyPoints = dedupe([
        ...(target.keyPoints ?? []),
        ...(source.keyPoints ?? []),
      ]);
      target.commonMistakes = dedupe([
        ...(target.commonMistakes ?? []),
        ...(source.commonMistakes ?? []),
      ]);
      target.related = dedupe([
        ...(target.related ?? []),
        ...(source.related ?? []),
      ]).filter(
        (name) =>
          normalizeComparableText(name) !== normalizeComparableText(target.title),
      );
      if (!target.sourceNode && source.sourceNode) {
        target.sourceNode = source.sourceNode;
      }
      state.wikiEntries = state.wikiEntries.filter(
        (item) => item.id !== entryId,
      );
      target.updatedAt = this.now();
      return { merged: entryId, into: intoId };
    });
  }

  // 单案例 AI 评分持久化到案例记录（与模拟卷判分对齐）。
  async saveCaseGrade({ caseId, grade }) {
    return this.store.update((state) => {
      const caseItem = state.caseQuestions.find((item) => item.id === caseId);
      if (!caseItem)
        throw Object.assign(new Error("案例不存在"), { status: 404 });
      caseItem.grade = grade;
      caseItem.gradedAt = grade.gradedAt ?? this.now();
      return { caseId, gradedAt: caseItem.gradedAt };
    });
  }

  async updateWikiEntry({ entryId, updates }) {
    return this.store.update((state) => {
      const entry = state.wikiEntries.find((item) => item.id === entryId);
      if (!entry)
        throw Object.assign(new Error("知识点不存在"), { status: 404 });
      if (typeof updates.title === "string") entry.title = updates.title.trim();
      if (typeof updates.summary === "string")
        entry.summary = updates.summary.trim();
      if (Array.isArray(updates.keyPoints))
        entry.keyPoints = updates.keyPoints.map((p) => String(p).trim()).filter(Boolean);
      if (Array.isArray(updates.commonMistakes))
        entry.commonMistakes = updates.commonMistakes.map((p) => String(p).trim()).filter(Boolean);
      if (Array.isArray(updates.related))
        entry.related = updates.related.map((p) => String(p).trim()).filter(Boolean);
      entry.updatedAt = this.now();
      return { entryId, saved: true };
    });
  }

  async setWikiStatus({ entryId, status }) {
    if (!["draft", "reviewed", "flagged"].includes(status)) {
      throw Object.assign(new Error("状态无效"), { status: 400 });
    }
    return this.store.update((state) => {
      const entry = state.wikiEntries.find((item) => item.id === entryId);
      if (!entry)
        throw Object.assign(new Error("知识点不存在"), { status: 404 });
      entry.status = status;
      entry.updatedAt = this.now();
      return { entryId, status };
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
