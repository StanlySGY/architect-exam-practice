// review 领域方法（拆分自原 questions.mjs，经继承链组装回 PracticeService）。
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { addDays } from "../utils.mjs";
import { findChapter } from "../mindmap.mjs";
import {
  intervalFor,
  retrievability,
  memoryFromLadderRecord,
} from "../fsrs.mjs";
import { MASTERED_STREAK } from "./sessions.mjs";
import { SessionsDomain } from "./sessions.mjs";
import { isQuestionEligibleForFormalStudy } from "./helpers.mjs";

const NUMBERED_NODE = /^(\d+(?:\.\d+)*)(?:\s+(.+))$/;
function parseLearningNode(node) {
  const text = String(node?.text ?? "").trim();
  const numbered = text.match(NUMBERED_NODE);
  if (numbered) return { id: numbered[1], title: numbered[2] };
  // 保留 1NF、4G/5G 等以数字开头但不是完整章节编号的术语。
  const shorthand = text.match(/^(\d+)(?=[A-Za-z])/);
  return shorthand ? { id: shorthand[1], title: text, shorthand: true } : null;
}
function canonicalLearningNodeId(parsed, chapter, parentId) {
  if (parsed.id.includes(".")) return parsed.id;
  return String(parentId ?? chapter) + "." + parsed.id;
}
const LEARNING_NODE_OVERRIDES = [
  { parentId: "19.3.5", sourceText: "19.3.5 缺点", title: "缺点", details: "需要维护批处理与速度层两套逻辑，协调结果一致性、资源与计算口径，通常增加开发和运维复杂度。" },
  { parentId: "19.4.4", sourceText: "19.4.4 优点", title: "优点", details: "架构简单、代码统一，实时处理路径直接；减少批流双路径维护和结果协调成本。" },
  { parentId: "19.4.4", sourceText: "19.4.4 缺点", title: "缺点", details: "依赖事件日志保留与重放能力；历史全量重算可能成本较高，复杂全量算法和随机历史查询不如批处理自然。" },
];
function nextUniqueLearningId(id, occupied) {
  const match = id.match(/^(.*\.)(\d+)$/);
  if (match) {
    let index = Number(match[2]) + 1;
    let candidate = match[1] + index;
    while (occupied.has(candidate)) candidate = match[1] + (++index);
    return candidate;
  }
  let index = 1;
  let candidate = id + "." + index;
  while (occupied.has(candidate)) candidate = id + "." + (++index);
  return candidate;
}
function collectLearningUnits(node, chapter, chapterTitle, parentId, units, override = null, forcedId = null) {
  const parsed = parseLearningNode(node);
  if (!parsed) return;
  const nodeId = forcedId ?? canonicalLearningNodeId(parsed, chapter, parentId);
  const numbered = (node.children ?? []).filter((child) => parseLearningNode(child));
  if (numbered.length) {
    const rawSiblingIds = new Set(numbered.map((child) => canonicalLearningNodeId(parseLearningNode(child), chapter, nodeId)));
    const assignedSiblingIds = new Set();
    for (let index = 0; index < numbered.length; index++) {
      const child = numbered[index];
      const childParsed = parseLearningNode(child);
      let childId = canonicalLearningNodeId(childParsed, chapter, nodeId);
      if (childId === nodeId) childId = nodeId + "." + (index + 1);
      if (assignedSiblingIds.has(childId)) childId = nextUniqueLearningId(childId, new Set([...rawSiblingIds, ...assignedSiblingIds]));
      assignedSiblingIds.add(childId);
      const sourceText = String(child.text ?? "").trim();
      const childOverride = LEARNING_NODE_OVERRIDES.find((item) => item.parentId === nodeId && item.sourceText === sourceText) ?? null;
      collectLearningUnits(child, chapter, chapterTitle, nodeId, units, childOverride, childId);
    }
    return;
  }
  const keyPoints = (node.children ?? []).filter((child) => !parseLearningNode(child)).map((child) => String(child.text ?? "").trim()).filter(Boolean).slice(0, 12);
  const details = override?.details ?? String(node.details ?? "").trim();
  units.push({
    id: nodeId, chapter, chapterTitle, sectionId: nodeId.split(".").slice(0, 2).join("."), parentId: parentId ?? null,
    title: override?.title ?? parsed.title, sourceTitle: String(node.text ?? "").trim(), details, keyPoints,
    source: { type: "mindmap", path: "architect.mm", status: "needs-review" },
    contentStatus: details || keyPoints.length ? "partial" : "missing",
    teaching: { what: details || null, why: null, how: null, confusions: null, scenarios: null, examples: null, examFocus: null, pitfalls: null },
    checks: [
      { id: "explain", prompt: "不用看资料，能否用自己的话解释这个知识点？" },
      { id: "use", prompt: "能否说出它解决什么问题、什么时候适用？" },
      { id: "example", prompt: "能否给出一个实际系统中的例子？" },
    ],
    order: units.length,
  });
}

function learningTeaching(unit) {
  const t = unit.teaching ?? {};
  return { what: t.what || unit.details || (unit.keyPoints.length ? unit.keyPoints.join("；") : null), why: t.why || null, how: t.how || null, confusions: t.confusions || null, scenarios: t.scenarios || null, examples: t.examples || null, examFocus: t.examFocus || null, pitfalls: t.pitfalls || null };
}

export function selectLearningReinforcementQuestions({ unit, questions, limit = 5 }) {
  const max = Math.max(1, Math.min(20, Number(limit) || 5));
  const title = String(unit?.title ?? "").trim();
  const id = String(unit?.id ?? "").trim();
  const sectionId = String(unit?.sectionId ?? id.split(".").slice(0, 2).join(".")).trim();
  const chapter = Number(unit?.chapter);
  const eligible = (questions ?? []).filter((question) => isQuestionEligibleForFormalStudy(question));
  const scored = eligible.map((question) => {
    const source = String(question.sourceNode ?? "").trim();
    const kp = String(question.knowledgePoint ?? "").trim();
    const qSection = String(question.section ?? "").trim();
    const qChapter = Number(question.chapter);
    let score = -1;
    let selectionReason = "chapter";
    if ((source && (source.includes(id) || source.includes(title))) || (kp && (kp === title || kp.includes(title) || title.includes(kp)))) {
      score = 300; selectionReason = "direct";
    } else if (qSection === sectionId || (source && source.includes(sectionId))) {
      score = 200; selectionReason = "section";
    } else if (qChapter === chapter) {
      score = 100; selectionReason = "chapter";
    }
    return { question, score, selectionReason };
  }).filter((item) => item.score >= 0).sort((a, b) => b.score - a.score || String(a.question.id).localeCompare(String(b.question.id)));
  const seen = new Set();
  const result = [];
  for (const item of scored) {
    if (seen.has(item.question.id)) continue;
    seen.add(item.question.id);
    result.push({ ...item.question, selectionReason: item.selectionReason });
    if (result.length >= max) break;
  }
  return result;
}

function mergeLearningContent(unit, content) {
  const authored = content?.units?.[unit.id];
  if (!authored || typeof authored !== "object" || authored.source?.path === "data/chapters.json" || ["4.4.2", "6.2.3", "17.2.3", "19.3.5", "19.4.4"].includes(unit.id)) {
    // 章节/小节总览不能冒充叶子知识点的专属课程内容。
    return {
      ...unit,
      contentStatus: "missing",
      contentSource: { type: "mindmap-fallback", path: "architect.mm", status: "missing" },
    };
  }
  const teaching = {
    ...unit.teaching,
    ...Object.fromEntries(Object.entries(authored).filter(([key, value]) =>
      key !== "status" && key !== "source" && value !== null && String(value).trim() !== "")),
  };
  return {
    ...unit,
    teaching,
    contentStatus: authored.status === "verified" ? "verified" : authored.status === "partial" ? "partial" : unit.contentStatus,
    contentSource: { type: "course-content", path: "data/learning-content.json", status: authored.status ?? "partial" },
  };
}

function studyDay(formatter, timestamp) {
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(timestamp)).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export class ReviewDomain extends SessionsDomain {
  async init() {
    await super.init();
    try {
      const raw = await readFile(resolve(this.root, "data/learning-content.json"), "utf8");
      this.learningContent = JSON.parse(raw);
    } catch (error) {
      if (error.code === "ENOENT") this.learningContent = { units: {} };
      else throw new Error("无法解析 data/learning-content.json: " + error.message, { cause: error });
    }
  }

  // limit 为 null 时返回全量记录（保持旧调用方兼容）；传入 limit 时按页切片。
  wrongQuestions({ limit = null, offset = 0 } = {}) {
    const state = this.store.snapshot();
    const now = this.now();
    const map = this.questionMap(state);
    const records = Object.values(state.wrongBook).sort((left, right) =>
      right.lastWrongAt.localeCompare(left.lastWrongAt),
    );
    const pageSize =
      limit === null ? null : Math.max(1, Math.min(100, Number(limit) || 50));
    const start = Math.max(0, Number(offset) || 0);
    const pageRecords =
      pageSize === null ? records : records.slice(start, start + pageSize);
    return {
      summary: {
        total: records.length,
        active: records.filter(
          (record) => !record.mastered && !record.disabledByIssue,
        ).length,
        due: records.filter(
          (record) =>
            !record.mastered &&
            !record.disabledByIssue &&
            record.nextReviewAt <= now,
        ).length,
        mastered: records.filter(
          (record) => record.mastered && !record.disabledByIssue,
        ).length,
      },
      total: records.length,
      offset: start,
      limit: pageSize ?? records.length,
      records: pageRecords.map((record) => {
        const current = map.get(record.questionId);
        const question = record.questionSnapshot ?? current ?? {};
        const sourceNode =
          current?.sourceNode ?? record.questionSnapshot?.sourceNode ?? null;
        const relatedWiki = this.relatedWikiEntries(
          {
            knowledgePoint: record.knowledgePoint || "",
            sourceNode,
          },
          state.wikiEntries ?? [],
        );
        // FSRS 记忆状态：老记录在读取时按旧阶梯迁移，保证 UI 能展示保持率与间隔。
        const memory = record.memory ?? memoryFromLadderRecord(record);
        const elapsed = Math.max(
          0,
          (Date.parse(now) - Date.parse(record.lastReviewAt ?? record.lastWrongAt)) /
            86_400_000,
        );
        return {
          ...record,
          questionSnapshot: undefined,
          question: question.question ?? "题目内容已不可用",
          options: question.options ?? {},
          correctAnswer: question.correctAnswer ?? null,
          analysis: question.analysis ?? "暂无解析",
          // 优先取当前题库的来源节点，回退到判卷时的快照，兼容回填前的旧错题。
          sourceNode,
          wikiEntries: relatedWiki,
          memory: {
            stability: Math.round(memory.stability * 10) / 10,
            difficulty: Math.round(memory.difficulty * 10) / 10,
            reps: memory.reps ?? 0,
            lapses: memory.lapses ?? 0,
          },
          retrievability: Math.round(retrievability(memory, elapsed) * 1000) / 1000,
          scheduledIntervalDays: intervalFor(memory.stability),
          graduation: MASTERED_STREAK,
        };
      }),
    };
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
    const dayFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: process.env.ARCHITECT_STUDY_TIME_ZONE || "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const answeredByDay = this.answeredCountsByDay(state, dayFormatter);
    const studyDays = [...answeredByDay.values()].filter(
      (count) => count > 0,
    ).length;
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
      ...this.learningInsights(state, dayFormatter, chapterStats),
    };
  }

  // 每日作答题数（按学习时区归日），热力图与每日目标共用。
  answeredCountsByDay(state, dayFormatter) {
    const answeredByDay = new Map();
    for (const attempt of state.attempts) {
      if (!attempt.gradedAt) continue;
      const answered = Math.max(
        0,
        Number(attempt.total || 0) - Number(attempt.unanswered || 0),
      );
      if (!answered) continue;
      const day = studyDay(dayFormatter, attempt.gradedAt);
      answeredByDay.set(day, (answeredByDay.get(day) ?? 0) + answered);
    }
    return answeredByDay;
  }

  // 学习洞察：打卡热力图、章节掌握度、FSRS 记忆指标、错因分类与题目难度诊断。
  learningInsights(state, dayFormatter, chapterStats) {
    const answeredByDay = this.answeredCountsByDay(state, dayFormatter);
    const nowIso = this.now();
    const today = studyDay(dayFormatter, nowIso);
    // 打卡热力图：最近 182 天（26 周）。
    const heatmap = [];
    const cursor = new Date(`${today}T00:00:00Z`);
    for (let index = 0; index < 182; index += 1) {
      const key = cursor.toISOString().slice(0, 10);
      heatmap.unshift({ date: key, count: answeredByDay.get(key) ?? 0 });
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    // FSRS 记忆指标：活跃错题的平均保持率 + 未来 7 天到期负载。
    const activeRecords = Object.values(state.wrongBook).filter(
      (record) => !record.mastered && !record.disabledByIssue,
    );
    let retentionSum = 0;
    for (const record of activeRecords) {
      const memory = record.memory ?? memoryFromLadderRecord(record);
      const elapsed = Math.max(
        0,
        (Date.parse(nowIso) -
          Date.parse(record.lastReviewAt ?? record.lastWrongAt)) /
          86_400_000,
      );
      retentionSum += retrievability(memory, elapsed);
    }
    const upcoming = [];
    const upcomingDistinct = [];
    const upcomingCursor = new Date(`${today}T00:00:00Z`);
    for (let offset = 0; offset < 7; offset += 1) {
      const dayIso = upcomingCursor.toISOString().slice(0, 10);
      const dueCount = activeRecords.filter((record) => {
        const dueAt = record.nextReviewAt;
        if (!dueAt || !Number.isFinite(Date.parse(dueAt))) return false;
        const due = studyDay(dayFormatter, dueAt);
        return Boolean(due) && (due <= dayIso || (offset === 0 && due <= nowIso));
      }).length;
      upcoming.push({ date: dayIso, due: dueCount });
      const distinctDueCount = activeRecords.filter((record) => {
        const dueAt = record.nextReviewAt;
        if (!dueAt || !Number.isFinite(Date.parse(dueAt))) return false;
        const due = studyDay(dayFormatter, dueAt);
        return Boolean(due) && (offset === 0 ? due <= dayIso : due === dayIso);
      }).length;
      upcomingDistinct.push({ date: dayIso, due: distinctDueCount });
      upcomingCursor.setUTCDate(upcomingCursor.getUTCDate() + 1);
    }
    // 章节掌握度阶梯：0 未入门 → 1 起步 → 2 熟练 → 3 已掌握。
    const wrongByChapter = new Map();
    for (const record of Object.values(state.wrongBook)) {
      if (record.disabledByIssue || !record.chapter) continue;
      const current = wrongByChapter.get(record.chapter) ?? {
        active: 0,
        mastered: 0,
      };
      if (record.mastered) current.mastered += 1;
      else current.active += 1;
      wrongByChapter.set(record.chapter, current);
    }
    const chapterMastery = chapterStats.map((chapter) => {
      const wrong = wrongByChapter.get(chapter.chapter) ?? {
        active: 0,
        mastered: 0,
      };
      const level =
        chapter.accuracy >= 85 && wrong.active === 0
          ? 3
          : chapter.accuracy >= 70
            ? 2
            : chapter.accuracy >= 50
              ? 1
              : 0;
      return { ...chapter, ...wrong, level };
    });
    // 错因分类：自信地错 = 误解，心虚地错 = 知识缺口。
    let confidentWrong = 0;
    let unsureWrong = 0;
    for (const record of Object.values(state.wrongBook)) {
      if (record.mastered) continue;
      if (record.lastConfidence === 3) confidentWrong += 1;
      else if (record.lastConfidence === 1) unsureWrong += 1;
    }
    // 题目难度诊断：基于题目自身作答统计（Elo 同步更新）。
    const diagnostics = [];
    for (const question of this.allQuestions(state)) {
      const stats = question.stats;
      if (!stats || stats.seen < 5) continue;
      const facility = stats.correct / stats.seen;
      if (facility >= 1) diagnostics.push({ id: question.id, question: question.question, seen: stats.seen, facility, flag: "too_easy" });
      else if (facility <= 0.2) diagnostics.push({ id: question.id, question: question.question, seen: stats.seen, facility, flag: "too_hard" });
    }
    return {
      heatmap,
      chapterMastery,
      memory: {
        retention: activeRecords.length
          ? Math.round((retentionSum / activeRecords.length) * 1000) / 10
          : null,
        tracked: activeRecords.length,
        upcoming,
        upcomingDistinct,
      },
      errorTaxonomy: { confidentWrong, unsureWrong },
      itemDiagnostics: diagnostics
        .sort((left, right) => right.seen - left.seen)
        .slice(0, 20),
    };
  }

  // 考试准备度：把现有学习统计转换成考试决策指标，而不是再造一套学习记录。
  examReadiness() {
    const state = this.store.snapshot();
    const statistics = this.statistics();
    const questions = this.allQuestions(state).filter((question) => !question.disabledAt);
    const real = questions.filter((question) => question.sourceType === "real");
    const generated = questions.filter((question) => (question.sourceType ?? "generated") === "generated");
    const attemptedQuestions = new Set();
    for (const attempt of state.attempts ?? []) {
      for (const detail of attempt.details ?? []) {
        if (detail.questionId) attemptedQuestions.add(detail.questionId);
      }
    }
    for (const question of questions) {
      if (Number(question.stats?.seen) > 0) attemptedQuestions.add(question.id);
    }
    const coverage = questions.length ? Math.round((attemptedQuestions.size / questions.length) * 100) : 0;
    const accuracy = Number(statistics.summary.accuracy || 0);
    const weakPoints = (statistics.weakKnowledgePoints ?? []).map((item) => ({
      ...item,
      risk: Math.min(100, Math.round(item.timesWrong * 12 + (item.questionCount ? 100 / item.questionCount : 40))),
      action: "复习" + item.knowledgePoint + "并重新做错题",
    }));
    const weakChapters = (statistics.chapterMastery ?? [])
      .filter((item) => item.total > 0)
      .map((item) => ({
        chapter: item.chapter,
        title: item.title,
        accuracy: item.accuracy,
        activeWrong: item.active,
        level: item.level,
        risk: Math.max(0, Math.min(100, Math.round((100 - item.accuracy) * 0.7 + item.active * 4))),
        action: "专项练习第 " + item.chapter + " 章",
      }))
      .sort((a, b) => b.risk - a.risk);
    const chapterScore = weakChapters.length
      ? Math.round(weakChapters.reduce((sum, item) => sum + item.accuracy, 0) / weakChapters.length)
      : null;
    const mockAttempts = (state.attempts ?? []).filter(
      (attempt) => attempt.mode === "exam-mcq" && Number(attempt.total) > 0,
    );
    const mockAccuracy = mockAttempts.length
      ? Math.round(
          mockAttempts.reduce((sum, attempt) => sum + Number(attempt.percentage || 0), 0) /
            mockAttempts.length,
        )
      : null;
    const readinessScore = Math.round(
      accuracy * 0.4 +
      (chapterScore ?? accuracy) * 0.25 +
      (mockAccuracy ?? accuracy) * 0.2 +
      coverage * 0.15,
    );
    const level =
      readinessScore >= 85 ? "冲刺" :
      readinessScore >= 70 ? "稳步提升" :
      readinessScore >= 55 ? "基础构建" : "起步";
    const queue = this.studyQueue({ limit: 5 });
    return {
      level,
      score: readinessScore,
      disclaimer: "准备度是本地学习数据的训练指标，不是官方通过概率。",
      coverage: {
        attempted: attemptedQuestions.size,
        total: questions.length,
        percent: coverage,
        realQuestions: real.length,
        generatedQuestions: generated.length,
      },
      dimensions: {
        overallAccuracy: accuracy,
        chapterAccuracy: chapterScore,
        mockAccuracy,
        reviewDue: statistics.review?.due ?? 0,
      },
      weakPoints: weakPoints.slice(0, 8),
      weakChapters: weakChapters.slice(0, 8),
      nextActions: (queue.items ?? []).slice(0, 4).map((item) => ({
        id: item.id,
        title: item.title,
        description: item.description,
        kind: item.kind,
        action: item.action,
      })),
    };
  }

  learningUnits() {
    if (!this.mindMap) return [];
    const units = [];
    for (const chapter of this.chapters) {
      const chapterNode = findChapter(this.mindMap, chapter.id);
      for (const child of chapterNode?.children ?? []) {
        if (parseLearningNode(child)) collectLearningUnits(child, chapter.id, chapter.title, null, units);
      }
    }
    return units.map((unit, order) => ({ ...mergeLearningContent(unit, this.learningContent), order }));
  }

  learningUnit(unitId) {
    return this.learningUnits().find((unit) => unit.id === String(unitId)) ?? null;
  }

  learningPlan() {
    const state = this.store.snapshot();
    const progress = state.learningProgress ?? {};
    const units = this.learningUnits().map((unit) => {
      const record = progress[unit.id] ?? {};
      const checks = unit.checks.map((check) => ({ ...check, completed: Boolean(record.checks?.[check.id]) }));
      return { ...unit, status: record.status ?? "not-started", startedAt: record.startedAt ?? null, completedAt: record.completedAt ?? null, confidence: record.confidence ?? null, readingCompletedAt: record.readingCompletedAt ?? null, checksCompletedAt: record.checksCompletedAt ?? null, checks };
    });
    const current = units.find((unit) => unit.status === "learning")
      ?? units.find((unit) => !unit.completedAt)
      ?? null;
    const completed = units.filter((unit) => Boolean(unit.completedAt)).length;
    const consolidating = units.filter((unit) => unit.status === "consolidating").length;
    const currentIndex = current ? current.order + 1 : units.length;
    return {
      total: units.length,
      completed,
      consolidating,
      percent: units.length ? Math.round((completed / units.length) * 100) : 0,
      current: current ? {
        ...current,
        teaching: learningTeaching(current),
        coreKnowledge: learningTeaching(current).what || "本知识点的教材内容尚未补齐。",
        examFocus: learningTeaching(current).examFocus || "待补：根据教材与真题核验后填写。",
        commonConfusions: learningTeaching(current).confusions || "待补：待补充相邻概念的区别、边界和易错点。",
        selfChecks: current.checks,
        checksCompleted: current.checks.filter((check) => check.completed).length,
        checksTotal: current.checks.length,
        contentStatus: current.contentStatus,
        contentSource: current.contentSource ?? current.source,
        practiceAction: { type: "start-practice", chapter: current.chapter, section: current.id, difficulty: "mixed", count: 5 },
      } : null,
      position: current ? (currentIndex + "/" + units.length) : (units.length + "/" + units.length),
      disclaimer: "学习进度表示你是否完成了系统学习单元，不等同于考试掌握度或官方通过概率。",
    };
  }

  async startLearning(unitId) {
    const unit = this.learningUnit(unitId);
    if (!unit) throw Object.assign(new Error("学习单元不存在"), { status: 404 });
    const now = this.now();
    await this.store.update((state) => {
      const previous = state.learningProgress[unit.id] ?? {};
      state.learningProgress[unit.id] = { ...previous, status: previous.status === "mastered" ? "mastered" : "learning", startedAt: previous.startedAt ?? now, updatedAt: now };
    });
    return this.learningPlan();
  }

  learningReinforcement(unitId, limit = 5) {
    const unit = this.learningUnit(unitId);
    if (!unit) throw Object.assign(new Error("学习单元不存在"), { status: 404 });
    const state = this.store.snapshot();
    const questions = selectLearningReinforcementQuestions({ unit, questions: this.allQuestions(state), limit });
    return { unitId: unit.id, unitTitle: unit.title, count: questions.length, questions };
  }

  async completeLearning(unitId, confidence = null) {
    const unit = this.learningUnit(unitId);
    if (!unit) throw Object.assign(new Error("学习单元不存在"), { status: 404 });
    const now = this.now();
    const normalizedConfidence = Number(confidence);
    await this.store.update((state) => {
      const previous = state.learningProgress[unit.id] ?? {};
      state.learningProgress[unit.id] = { ...previous, status: "consolidating", startedAt: previous.startedAt ?? now, completedAt: now, readingCompletedAt: now, updatedAt: now, confidence: Number.isFinite(normalizedConfidence) && normalizedConfidence >= 1 && normalizedConfidence <= 3 ? Math.round(normalizedConfidence) : null };
    });
    return this.learningPlan();
  }

  async recordLearningCheck(unitId, checkId, completed = true) {
    const unit = this.learningUnit(unitId);
    if (!unit) throw Object.assign(new Error("学习单元不存在"), { status: 404 });
    if (!unit.checks.some((check) => check.id === String(checkId))) throw Object.assign(new Error("学习检查项不存在"), { status: 400 });
    const now = this.now();
    await this.store.update((state) => {
      const previous = state.learningProgress[unit.id] ?? {};
      const checks = { ...(previous.checks ?? {}) };
      if (completed) checks[String(checkId)] = true; else delete checks[String(checkId)];
      const allCompleted = unit.checks.every((check) => checks[check.id]);
      state.learningProgress[unit.id] = { ...previous, status: previous.status ?? "learning", startedAt: previous.startedAt ?? now, checks, checksCompletedAt: allCompleted ? (previous.checksCompletedAt ?? now) : null, updatedAt: now };
    });
    return this.learningPlan();
  }

  // 学习计划：每日目标 + 今日进度 + 连续打卡天数。
  getStudyPlan() {
    const state = this.store.snapshot();
    const settings = state.settings ?? {};
    const dailyGoal = Number(settings.dailyGoal) || 0;
    const dayFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: process.env.ARCHITECT_STUDY_TIME_ZONE || "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const today = studyDay(dayFormatter, this.now());
    const answeredByDay = new Map();
    for (const attempt of state.attempts) {
      if (!attempt.gradedAt) continue;
      const answered = Math.max(
        0,
        Number(attempt.total || 0) - Number(attempt.unanswered || 0),
      );
      if (!answered) continue;
      const day = studyDay(dayFormatter, attempt.gradedAt);
      answeredByDay.set(day, (answeredByDay.get(day) ?? 0) + answered);
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

  // 将恢复、间隔复习和薄弱章节收束成首页可执行的下一步。
  // 这里只返回动作元数据，不把完整会话题目再次暴露给首页。
  studyQueue({ limit = 5 } = {}) {
    const state = this.store.snapshot();
    const now = this.now();
    const nowMs = Date.parse(now);
    const questionMap = this.questionMap(state);
    const maxItems = Math.max(1, Math.min(10, Number(limit) || 5));
    const items = [];
    const activeSessions = Object.values(state.sessions ?? {})
      .filter((session) => !session.gradedAt && !session.abandonedAt)
      .sort((left, right) =>
        String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")),
      );
    for (const session of activeSessions) {
      const mode = session.mode === "review"
        ? "review"
        : session.mode === "exam-mcq"
          ? "exam-mcq"
          : "practice";
      const title = mode === "review"
        ? "继续错题回顾"
        : mode === "exam-mcq"
          ? "继续模拟考试"
          : session.chapter
            ? "继续第 " + session.chapter + " 章练习"
            : "继续未完成练习";
      items.push({
        id: "session:" + session.id,
        kind: "resume-session",
        priority: 1,
        title,
        description:
          Object.keys(session.checkedAnswers ?? {}).length +
          "/" +
          (session.questionIds?.length ?? 0) +
          " 道已作答",
        action: { type: "resume-session", sessionId: session.id },
        createdAt: session.createdAt ?? null,
        mode,
        chapter: session.chapter ?? null,
        section: session.section ?? null,
        total: session.questionIds?.length ?? 0,
      });
    }

    const learning = this.learningPlan();
    if (learning.current && activeSessions.length === 0) {
      items.push({
        id: "learning:" + learning.current.id,
        kind: "learning",
        priority: 0,
        title: "学习 " + learning.current.id + " · " + learning.current.title,
        description: learning.position + " · " + (learning.current.status === "learning" ? "继续学习" : "先学知识，再做 5 题巩固"),
        action: { type: "start-learning", unitId: learning.current.id },
      });
    }

    // 零学习记录的新手：先给一条"读教材 → 练手 → 摸底"的入门路径，
    // 否则学习队列只有按错题/薄弱章节推导的条目，对全新用户没有引导价值。
    // 选项按题库现状收缩：还没有生成题时，练手/摸底换成导入真题库和生成章节题。
    const hasLearningHistory =
      (state.attempts ?? []).length > 0 ||
      Object.keys(state.wrongBook ?? {}).length > 0 ||
      activeSessions.length > 0;
    const beginnerOptions = [];
    let showBeginnerPath = false;
    const questions = this.allQuestions(state);
    const availableGeneratedQuestions = questions.filter(
      (question) =>
        (question.sourceType ?? "generated") === "generated" &&
        isQuestionEligibleForFormalStudy(question),
    );
    const availableImportedQuestions = questions.filter(
      (question) =>
        (question.sourceType ?? "generated") !== "generated" &&
        isQuestionEligibleForFormalStudy(question),
    );
    if (!hasLearningHistory) {
      showBeginnerPath = true;
      const chapterOneCount = availableGeneratedQuestions.filter(
        (question) => question.chapter === 1,
      ).length;
      beginnerOptions.push({
        type: "open-materials",
        materialId: "textbook-第01章-绪论",
        label: "读教材第 1 章",
      });
      if (chapterOneCount) {
        beginnerOptions.push({
          type: "start-practice",
          chapter: 1,
          section: "all",
          difficulty: "mixed",
          count: 10,
          label: "练第 1 章 10 题",
        });
      }
      if (availableGeneratedQuestions.length || availableImportedQuestions.length) {
        beginnerOptions.push({ type: "open-mock", label: "做摸底模拟卷" });
      } else {
        beginnerOptions.push(
          { type: "import-bank", label: "导入真题库" },
          { type: "generate", label: "生成章节题" },
        );
      }
      items.push({
        id: "beginner:path",
        kind: "setup",
        priority: 0,
        title: "第一次备考？从这里开始",
        description: chapterOneCount
          ? "① 读教材第 1 章建立整体框架 → ② 练 10 道第 1 章题上手 → ③ 做一次 75 题摸底卷看整体水平。综合知识覆盖全部 20 章，案例与论文重点在第 12–20 章。"
          : availableImportedQuestions.length
            ? "① 读教材第 1 章建立整体框架 → ② 用已导入题库做真题套卷或摸底模拟。章节练习只使用通过人工核验的生成题。综合知识覆盖全部 20 章，案例与论文重点在第 12–20 章。"
            : "① 读教材第 1 章建立整体框架 → ② 导入真题库或生成并核验章节题 → ③ 题目就绪后开始练手和摸底。未通过人工核验的生成题不会进入正式练习。综合知识覆盖全部 20 章，案例与论文重点在第 12–20 章。",
        action: { type: "beginner:path", options: beginnerOptions },
      });
    }

    const dueRecords = Object.values(state.wrongBook ?? {})
      .filter((record) => {
        const dueAt = Date.parse(record.nextReviewAt ?? "");
        const question =
          questionMap.get(record.questionId) ?? record.questionSnapshot;
        return (
          !record.mastered &&
          !record.disabledByIssue &&
          Boolean(question) &&
          isQuestionEligibleForFormalStudy(question) &&
          Number.isFinite(dueAt) &&
          (!Number.isFinite(nowMs) || dueAt <= nowMs)
        );
      })
      .sort((left, right) =>
        String(left.nextReviewAt).localeCompare(String(right.nextReviewAt)),
      );
    if (dueRecords.length) {
      items.push({
        id: "review:due",
        kind: "review",
        priority: 2,
        title: "复习到期错题",
        description: dueRecords.length + " 道错题等待回顾",
        action: { type: "start-review", limit: Math.min(30, dueRecords.length) },
        count: dueRecords.length,
      });
    }

    const activeCaseExams = (state.caseExams ?? [])
      .filter((exam) => !exam.gradedAt && !exam.abandonedAt)
      .sort((left, right) =>
        String(right.startedAt ?? "").localeCompare(String(left.startedAt ?? "")),
      );
    for (const exam of activeCaseExams) {
      items.push({
        id: "case-exam:" + exam.id,
        kind: "resume-case-exam",
        priority: 1,
        title: "继续案例模拟",
        description:
          Object.values(exam.drafts ?? {}).reduce(
            (sum, drafts) =>
              sum + Object.values(drafts ?? {}).filter(Boolean).length,
            0,
          ) + " 个小问已有草稿",
        action: { type: "resume-case-exam", examId: exam.id },
        createdAt: exam.startedAt ?? null,
        count: exam.caseIds?.length ?? 0,
      });
    }

    const generatedQuestions = availableGeneratedQuestions;
    const chapterStats = this.statistics().chapters;
    const activeWrongByChapter = new Map();
    for (const record of Object.values(state.wrongBook ?? {})) {
      if (record.mastered || record.disabledByIssue || !record.chapter) continue;
      const chapter = Number(record.chapter);
      activeWrongByChapter.set(
        chapter,
        (activeWrongByChapter.get(chapter) ?? 0) + 1,
      );
    }
    const weakChapter = this.chapterList()
      .filter((chapter) => chapter.counts.all > 0)
      .map((chapter) => {
        const stat = chapterStats.find((item) => item.chapter === chapter.id);
        const activeWrong = activeWrongByChapter.get(chapter.id) ?? 0;
        const accuracy = stat?.accuracy ?? null;
        const score =
          activeWrong * 3 + (accuracy === null ? 0 : 100 - accuracy);
        return { chapter, stat, activeWrong, accuracy, score };
      })
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.activeWrong - left.activeWrong ||
          (left.accuracy ?? 101) - (right.accuracy ?? 101) ||
          left.chapter.id - right.chapter.id,
      )[0];
    if (weakChapter) {
      const reason = weakChapter.activeWrong
        ? "有 " + weakChapter.activeWrong + " 道未掌握错题"
        : weakChapter.accuracy === null
          ? "还没有章节练习记录"
          : "历史正确率 " + weakChapter.accuracy + "%";
      items.push({
        id: "chapter:" + weakChapter.chapter.id,
        kind: "practice",
        priority: 3,
        title:
          "练习第 " +
          weakChapter.chapter.id +
          " 章 · " +
          weakChapter.chapter.title,
        description:
          reason +
          " · " +
          weakChapter.chapter.counts.all +
          " 道生成题可用",
        action: {
          type: "start-practice",
          chapter: weakChapter.chapter.id,
          section: "all",
          difficulty: "mixed",
          count: Math.min(10, weakChapter.chapter.counts.all),
        },
        chapter: weakChapter.chapter.id,
        accuracy: weakChapter.accuracy,
        activeWrong: weakChapter.activeWrong,
      });
    }

    // 新手的入门路径里已包含导入/生成选项，避免同一屏出现重复的准备条目。
    if (!generatedQuestions.length && !showBeginnerPath) {
      items.push({
        id: "setup:question-bank",
        kind: "setup",
        priority: 4,
        title: availableImportedQuestions.length
          ? "章节题待核验 · 可以先做真题"
          : "准备第一轮章节练习",
        description: availableImportedQuestions.length
          ? "当前没有通过人工核验的生成题，暂不能进行章节练习；已导入的真题和模拟题仍可在模拟考试页使用。"
          : "当前没有通过人工核验的生成题，可配置模型、生成章节题或导入真题。",
        action: {
          type: "setup-question-bank",
          options: availableImportedQuestions.length
            ? [
                { type: "open-mock", label: "进入真题/模拟考试" },
                { type: "open-bank", label: "审校生成题" },
                { type: "generate", label: "生成章节题" },
              ]
            : [
                { type: "configure-model", label: "配置模型" },
                { type: "generate", label: "生成章节题" },
                { type: "import-bank", label: "导入真题库" },
              ],
        },
      });
    }

    items.sort((left, right) => {
      const leftDate = Date.parse(left.createdAt ?? "");
      const rightDate = Date.parse(right.createdAt ?? "");
      // priority 0 是合法的最高级，不能用 `|| 99` 兜底（0 是假值会被覆盖）。
      const priorityOf = (value) => {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : 99;
      };
      const leftPriority = priorityOf(left.priority);
      const rightPriority = priorityOf(right.priority);
      return (
        leftPriority - rightPriority ||
        (Number.isFinite(rightDate) ? rightDate : 0) -
          (Number.isFinite(leftDate) ? leftDate : 0) ||
        left.id.localeCompare(right.id)
      );
    });
    return {
      generatedAt: now,
      next: items[0] ?? null,
      items: items.slice(0, maxItems),
      counts: {
        activeSessions: activeSessions.length,
        activeCaseExams: activeCaseExams.length,
        dueReviews: dueRecords.length,
        generatedQuestions: generatedQuestions.length,
        availableChapters: this.chapterList().filter(
          (chapter) => chapter.counts.all > 0,
        ).length,
      },
    };
  }

  async setMastered(questionId, mastered) {
    return this.store.update((state) => {
      const record = state.wrongBook[questionId];
      if (!record)
        throw Object.assign(new Error("错题记录不存在"), { status: 404 });
      if (record.disabledByIssue) {
        throw Object.assign(new Error("题目已停用，请先在问题题列表中恢复"), {
          status: 409,
          code: "QUESTION_DISABLED",
        });
      }
      record.mastered = Boolean(mastered);
      if (!mastered) {
        // 重新加入复习：清空连对 streak，FSRS 记忆状态归零重新开始。
        record.correctStreak = 0;
        record.nextReviewAt = this.now();
        record.lastReviewAt = this.now();
        record.memory = null;
      }
      return { questionId, mastered: record.mastered };
    });
  }
}
