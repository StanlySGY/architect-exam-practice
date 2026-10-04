// FSRS-6 间隔重复调度器（零依赖实现）。
// 公式与默认参数来自 open-spaced-repetition 的 FSRS-6 规范与 ts-fsrs 实现：
//   R(t,S) = (1 + factor·t/S)^(-w20)，factor = 0.9^(-1/w20) - 1（保证 R(S,S)=0.9）
//   I(r,S) = S·(r^(1/DECAY) - 1)/factor，DECAY = -w20
// 记忆状态为 D（难度 1-10）与 S（稳定度=90% 保持率对应的间隔天数）。
// 本实现采用 long-term 调度（无分钟级 learning steps），复习以天为单位。

export const FSRS_VERSION = "FSRS-6 (21 参数, open-spaced-repetition 规范)";

export const FSRS_DEFAULT_W = Object.freeze([
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666,
  0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912,
  0.0658, 0.1542,
]);

// Anki 评分：1=Again 再记 2=Hard 困难 3=Good 良好 4=Easy 简单
export const GRADE = Object.freeze({
  AGAIN: 1,
  HARD: 2,
  GOOD: 3,
  EASY: 4,
});

export const GRADE_NAMES = Object.freeze({
  1: "再记",
  2: "困难",
  3: "良好",
  4: "简单",
});

const S_MIN = 0.001;
const S_MAX = 36500;
const REQUEST_RETENTION = 0.9;
const MAXIMUM_INTERVAL = 36500;
// 掌握判定：调度间隔达到该天数即视为走完复习阶梯（对应旧版 1/3/7/14/30 的毕业档）。
export const MASTERED_INTERVAL_DAYS = 30;

const w = FSRS_DEFAULT_W;
const DECAY = -w[20];
const FACTOR = Math.exp(Math.log(0.9) / DECAY) - 1;
const INTERVAL_MODIFIER =
  (Math.pow(REQUEST_RETENTION, 1 / DECAY) - 1) / FACTOR;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round8 = (value) => Math.round(value * 1e8) / 1e8;

export function forgettingCurve(elapsedDays, stability) {
  if (stability <= 0) return 0;
  const t = Math.max(0, elapsedDays);
  return round8(Math.pow(1 + (FACTOR * t) / stability, DECAY));
}

export function intervalFor(stability) {
  return clamp(
    Math.round(stability * INTERVAL_MODIFIER),
    1,
    MAXIMUM_INTERVAL,
  );
}

function initStability(grade) {
  return Math.max(w[grade - 1], 0.1);
}

function initDifficulty(grade) {
  return round8(w[4] - Math.exp((grade - 1) * w[5]) + 1);
}

function nextDifficulty(d, grade) {
  const deltaD = -w[6] * (grade - 3);
  const damped = d + (deltaD * (10 - d)) / 9;
  const reverted = w[7] * initDifficulty(4) + (1 - w[7]) * damped;
  return clamp(round8(reverted), 1, 10);
}

function nextRecallStability(d, s, r, grade) {
  const hardPenalty = grade === GRADE.HARD ? w[15] : 1;
  const easyBonus = grade === GRADE.EASY ? w[16] : 1;
  const growth =
    Math.exp(w[8]) *
    (11 - d) *
    Math.pow(s, -w[9]) *
    (Math.exp((1 - r) * w[10]) - 1) *
    hardPenalty *
    easyBonus;
  return clamp(round8(s * (1 + growth)), S_MIN, S_MAX);
}

function nextForgetStability(d, s, r) {
  const value =
    w[11] *
    Math.pow(d, -w[12]) *
    (Math.pow(s + 1, w[13]) - 1) *
    Math.exp((1 - r) * w[14]);
  const ceiling = s / Math.exp(w[17] * w[18]);
  return clamp(round8(Math.min(Math.max(value, S_MIN), ceiling)), S_MIN, S_MAX);
}

function nextShortTermStability(s, grade) {
  const sinc = Math.pow(s, -w[19]) * Math.exp(w[17] * (grade - 3 + w[18]));
  const masked = grade >= GRADE.HARD ? Math.max(sinc, 1) : sinc;
  return clamp(round8(s * masked), S_MIN, S_MAX);
}

// 计算下一次记忆状态。memory 为 null/空时按首次评分初始化。
// elapsedDays 允许小数（同日内复习走 short-term 公式）。
export function nextMemoryState(memory, elapsedDays, grade) {
  if (!Number.isFinite(elapsedDays) || elapsedDays < 0) {
    throw new Error(`无效的间隔天数 ${elapsedDays}`);
  }
  if (!(grade >= 1 && grade <= 4)) {
    throw new Error(`无效的复习评分 ${grade}`);
  }
  const d = memory?.difficulty ?? 0;
  const s = memory?.stability ?? 0;
  if (!d || !s) {
    return {
      difficulty: clamp(initDifficulty(grade), 1, 10),
      stability: initStability(grade),
      reps: (memory?.reps ?? 0) + 1,
      lapses: (memory?.lapses ?? 0) + (grade === GRADE.AGAIN ? 1 : 0),
    };
  }
  const r = forgettingCurve(elapsedDays, s);
  let newS;
  if (elapsedDays === 0) {
    newS = nextShortTermStability(s, grade);
  } else if (grade === GRADE.AGAIN) {
    newS = nextForgetStability(d, s, r);
  } else {
    newS = nextRecallStability(d, s, r, grade);
  }
  return {
    difficulty: nextDifficulty(d, grade),
    stability: newS,
    reps: (memory?.reps ?? 0) + 1,
    lapses: (memory?.lapses ?? 0) + (grade === GRADE.AGAIN ? 1 : 0),
  };
}

export function retrievability(memory, elapsedDays) {
  if (!memory?.stability) return 0;
  return forgettingCurve(elapsedDays, memory.stability);
}

const DAY_MS = 86_400_000;

function elapsedDaysBetween(fromIso, toIso) {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, (to - from) / DAY_MS);
}

function addDaysIso(iso, days) {
  return new Date(Date.parse(iso) + days * DAY_MS).toISOString();
}

// 从旧版固定阶梯记录迁移 FSRS 状态：尽量保留已有进度与到期日。
export function memoryFromLadderRecord(record, nowIso = new Date().toISOString()) {
  const streak = Math.max(0, Number(record.correctStreak) || 0);
  const timesWrong = Math.max(0, Number(record.timesWrong) || 0);
  const ladderIntervals = [1, 3, 7, 14, 30];
  const stability =
    streak > 0
      ? ladderIntervals[Math.min(streak, ladderIntervals.length) - 1]
      : Math.max(0.5, 1 - Math.min(3, timesWrong) * 0.3);
  return {
    difficulty: clamp(5 + (timesWrong - 1) * 1.2, 1, 10),
    stability,
    reps: streak + (timesWrong > 0 ? 1 : 0),
    lapses: Math.max(0, timesWrong - 1),
  };
}

// 预览四个评分档位的调度结果（不落库）。
export function previewSchedule({ memory, lastReviewAt, nowIso }) {
  const elapsed = lastReviewAt
    ? elapsedDaysBetween(lastReviewAt, nowIso)
    : 0;
  const grades = [GRADE.AGAIN, GRADE.HARD, GRADE.GOOD, GRADE.EASY];
  return grades.map((grade) => {
    const next = nextMemoryState(memory, elapsed, grade);
    const days = intervalFor(next.stability);
    return {
      grade,
      name: GRADE_NAMES[grade],
      intervalDays: days,
      due: addDaysIso(nowIso, grade === GRADE.AGAIN ? 0 : days),
      stability: round8(next.stability),
    };
  });
}

// 复习评分落库：返回新的记忆状态与到期时间。
export function applyReview({ memory, lastReviewAt, grade, nowIso }) {
  const elapsed = lastReviewAt
    ? elapsedDaysBetween(lastReviewAt, nowIso)
    : 0;
  const next = nextMemoryState(memory, elapsed, grade);
  const intervalDays =
    grade === GRADE.AGAIN ? 0 : intervalFor(next.stability);
  return {
    memory: next,
    intervalDays,
    due: addDaysIso(nowIso, intervalDays),
    retrievability: elapsed >= 0 ? forgettingCurve(elapsed, memory?.stability ?? 0) : null,
  };
}

// 首次答错（进入错题本）时的初始记忆状态。
export function memoryForNewLapse(previousMemory, nowIso) {
  return nextMemoryState(previousMemory ?? null, 0, GRADE.AGAIN);
}
