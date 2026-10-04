// review 领域方法（拆分自原 questions.mjs，经继承链组装回 PracticeService）。
import { addDays } from "../utils.mjs";
import {
  intervalFor,
  retrievability,
  memoryFromLadderRecord,
} from "../fsrs.mjs";
import { MASTERED_STREAK } from "./sessions.mjs";
import { SessionsDomain } from "./sessions.mjs";

function studyDay(formatter, timestamp) {
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(timestamp)).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export class ReviewDomain extends SessionsDomain {
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

    // 零学习记录的新手：先给一条"读教材 → 练手 → 摸底"的入门路径，
    // 否则学习队列只有按错题/薄弱章节推导的条目，对全新用户没有引导价值。
    // 选项按题库现状收缩：还没有生成题时，练手/摸底换成导入真题库和生成章节题。
    const hasLearningHistory =
      (state.attempts ?? []).length > 0 ||
      Object.keys(state.wrongBook ?? {}).length > 0 ||
      activeSessions.length > 0;
    const beginnerOptions = [];
    let showBeginnerPath = false;
    if (!hasLearningHistory) {
      showBeginnerPath = true;
      const questions = this.allQuestions(state);
      const generatedQuestions = questions.filter(
        (question) =>
          (question.sourceType ?? "generated") === "generated" &&
          !question.disabledAt,
      );
      const chapterOneCount = generatedQuestions.filter(
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
      if (generatedQuestions.length) {
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
          : "① 读教材第 1 章建立整体框架 → ② 导入真题库或按章节生成题目 → ③ 题目就绪后开始练手和摸底。综合知识覆盖全部 20 章，案例与论文重点在第 12–20 章。",
        action: { type: "beginner-path", options: beginnerOptions },
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
          !question.disabledAt &&
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

    const questions = this.allQuestions(state);
    const generatedQuestions = questions.filter(
      (question) =>
        (question.sourceType ?? "generated") === "generated" &&
        !question.disabledAt,
    );
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
        title: "准备第一轮章节练习",
        description:
          "当前没有可用的生成题，可配置模型、生成章节题或导入真题。",
        action: {
          type: "setup-question-bank",
          options: [
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
