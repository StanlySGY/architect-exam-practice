// review 领域方法（拆分自原 questions.mjs，经继承链组装回 PracticeService）。
import { addDays } from "../utils.mjs";
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
        active: records.filter((record) => !record.mastered).length,
        due: records.filter(
          (record) => !record.mastered && record.nextReviewAt <= now,
        ).length,
        mastered: records.filter((record) => record.mastered).length,
      },
      total: records.length,
      offset: start,
      limit: pageSize ?? records.length,
      records: pageRecords.map((record) => {
        const current = map.get(record.questionId);
        const sourceNode =
          current?.sourceNode ?? record.questionSnapshot.sourceNode;
        const relatedWiki = this.relatedWikiEntries(
          {
            knowledgePoint: record.knowledgePoint || "",
            sourceNode,
          },
          state.wikiEntries ?? [],
        );
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
    const studyDays = new Set(
      attempts
        .filter((attempt) => Number(attempt.total) > Number(attempt.unanswered || 0))
        .map((attempt) => studyDay(dayFormatter, attempt.gradedAt)),
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

  async setMastered(questionId, mastered) {
    return this.store.update((state) => {
      const record = state.wrongBook[questionId];
      if (!record)
        throw Object.assign(new Error("错题记录不存在"), { status: 404 });
      record.mastered = Boolean(mastered);
      if (!mastered) {
        // 重新加入复习时从头走间隔阶梯。
        record.correctStreak = 0;
        record.nextReviewAt = this.now();
      }
      return { questionId, mastered: record.mastered };
    });
  }
}
