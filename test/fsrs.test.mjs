import test from "node:test";
import assert from "node:assert/strict";
import {
  applyReview,
  forgettingCurve,
  intervalFor,
  memoryForNewLapse,
  memoryFromLadderRecord,
  previewSchedule,
  retrievability,
  GRADE,
} from "../src/fsrs.mjs";

const NOW = "2026-09-28T00:00:00.000Z";

test("FSRS 遗忘曲线在稳定度处保持率恰为 90%", () => {
  const r = forgettingCurve(7, 7);
  assert.ok(Math.abs(r - 0.9) < 1e-6, `R(S,S)=${r}`);
  assert.ok(forgettingCurve(0, 7) === 1);
  assert.ok(forgettingCurve(14, 7) < 0.9);
});

test("FSRS 间隔随稳定度单调增长", () => {
  assert.equal(intervalFor(0.5), 1);
  assert.ok(intervalFor(10) > intervalFor(5));
  assert.ok(intervalFor(36500) <= 36500);
});

test("首次答错初始化记忆状态并立刻到期", () => {
  const { memory, intervalDays, due } = applyReview({
    memory: null,
    lastReviewAt: null,
    grade: GRADE.AGAIN,
    nowIso: NOW,
  });
  assert.ok(memory.stability > 0);
  assert.ok(memory.difficulty >= 1 && memory.difficulty <= 10);
  assert.equal(memory.lapses, 1);
  assert.equal(intervalDays, 0);
  assert.equal(due, NOW);
});

test("复习答对(良好)间隔大于答错(再记)", () => {
  const seed = memoryForNewLapse(null, NOW);
  const good = applyReview({
    memory: seed,
    lastReviewAt: NOW,
    grade: GRADE.GOOD,
    nowIso: "2026-09-29T00:00:00.000Z",
  });
  const again = applyReview({
    memory: seed,
    lastReviewAt: NOW,
    grade: GRADE.AGAIN,
    nowIso: "2026-09-29T00:00:00.000Z",
  });
  assert.ok(good.intervalDays >= 1);
  assert.equal(again.intervalDays, 0);
  assert.ok(good.memory.stability > again.memory.stability);
  assert.equal(again.memory.lapses, seed.lapses + 1);
});

test("连续多日复习答对,间隔单调增长且明显长于首次", () => {
  let memory = memoryForNewLapse(null, NOW);
  let last = NOW;
  const intervals = [];
  for (let i = 1; i <= 10; i += 1) {
    const reviewAt = addDays(NOW, i);
    const next = applyReview({
      memory,
      lastReviewAt: last,
      grade: GRADE.GOOD,
      nowIso: reviewAt,
    });
    memory = next.memory;
    last = reviewAt;
    intervals.push(next.intervalDays);
  }
  for (let i = 1; i < intervals.length; i += 1) {
    assert.ok(intervals[i] >= intervals[i - 1], `${intervals} 应单调不减`);
  }
  assert.ok(intervals[9] > intervals[0], `${intervals} 应明显增长`);
});

function addDays(iso, days) {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString();
}

test("四档预览按 再记<困难<良好<简单 排列间隔", () => {
  const memory = memoryForNewLapse(null, NOW);
  const preview = previewSchedule({ memory, lastReviewAt: NOW, nowIso: NOW });
  assert.deepEqual(
    preview.map((item) => item.grade),
    [1, 2, 3, 4],
  );
  const days = preview.map((item) => item.intervalDays);
  assert.ok(days[0] <= days[1] && days[1] <= days[2] && days[2] <= days[3], `${days}`);
});

test("旧阶梯记录可迁移:保留进度并给出可用记忆状态", () => {
  const memory = memoryFromLadderRecord({
    correctStreak: 3,
    timesWrong: 2,
    nextReviewAt: "2026-10-01T00:00:00.000Z",
  });
  assert.ok(memory.stability >= 3);
  assert.equal(memory.reps, 4);
  assert.equal(memory.lapses, 1);
  const next = applyReview({
    memory,
    lastReviewAt: NOW,
    grade: GRADE.GOOD,
    nowIso: "2026-10-01T00:00:00.000Z",
  });
  assert.ok(next.intervalDays >= 1);
});

test("保持率随逾期天数下降", () => {
  const memory = { difficulty: 5, stability: 10, reps: 3, lapses: 0 };
  assert.ok(retrievability(memory, 5) > retrievability(memory, 20));
});
