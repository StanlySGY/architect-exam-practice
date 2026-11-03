import assert from "node:assert/strict";
import test from "node:test";
import { createStudyRoadmap, getActiveRoadmapWeek, advanceStudyRoadmap } from "../public/study-roadmap.mjs";

test("零基础和有经验路线按每周投入时间伸缩", () => {
  const beginner = createStudyRoadmap({ experience: "beginner", hoursPerWeek: 8, startDate: "2026-10-30" });
  const experienced = createStudyRoadmap({ experience: "experienced", hoursPerWeek: 8, startDate: "2026-10-30" });
  const partTime = createStudyRoadmap({ experience: "beginner", hoursPerWeek: 4, startDate: "2026-10-30" });
  assert.equal(beginner.totalHours, 144);
  assert.equal(beginner.totalWeeks, 18);
  assert.equal(experienced.totalHours, 112);
  assert.equal(experienced.totalWeeks, 14);
  assert.equal(partTime.totalWeeks, 36);
  assert.ok(beginner.weeks.every((week, index) => week.number === index + 1));
});

test("课程路线覆盖教程 1—20 章且每周有具体任务和产出", () => {
  for (const hours of [4, 6, 8, 10, 12]) {
    const plan = createStudyRoadmap({ experience: "beginner", hoursPerWeek: hours });
    const covered = new Set(plan.weeks.flatMap((week) => week.chapters));
    for (let chapter = 1; chapter <= 20; chapter += 1) {
      assert.ok(covered.has(chapter), "chapter " + chapter + " missing at " + hours + " hours/week");
    }
    assert.ok(plan.weeks.every((week) => week.tasks.length >= 1 && week.deliverable.length > 0));
  }
});

test("重复学习周轮换每个单元的任务，覆盖该单元完整任务集合", () => {
  const plan = createStudyRoadmap({ experience: "beginner", hoursPerWeek: 4, startDate: "2026-10-30" });
  const firstModuleWeeks = plan.weeks.filter((week) => week.title.includes("先理解系统架构是什么"));
  assert.equal(firstModuleWeeks.length, 3);
  const seenTasks = new Set(firstModuleWeeks.flatMap((week) => week.tasks));
  for (const task of [
    "阅读第1章并画系统边界图",
    "解释架构与详细设计的区别",
    "做10道基础辨析题并写错因"
  ]) {
    assert.ok(seenTasks.has(task), "repeated weeks never expose task: " + task);
  }
});

test("压缩周期不会重复或遗漏学习单元，并保留合并主题的全部任务", () => {
  for (const hours of [8, 10, 12]) {
    const plan = createStudyRoadmap({ experience: "experienced", hoursPerWeek: hours, startDate: "2026-10-30" });
    const topics = plan.weeks.flatMap((week) => week.title.split(" / "));
    assert.equal(topics.length, 16, "every core module must appear exactly once at " + hours + " hours/week");
    assert.equal(new Set(topics).size, 16, "compressed roadmap must not repeat a module at " + hours + " hours/week");
    const tasks = new Set(plan.weeks.flatMap((week) => week.tasks));
    for (const task of [
      "阅读第1章并画系统边界图",
      "解释架构与详细设计的区别",
      "做10道基础辨析题并写错因",
      "梳理CPU、内存、存储、I/O瓶颈",
      "复习性能指标与计算题",
      "用吞吐量、响应时间解释系统问题"
    ]) {
      assert.ok(tasks.has(task), "compressed roadmap omitted task: " + task);
    }
  }
});

test("路线进度只推进一周，不会超过计划周数", () => {
  let plan = createStudyRoadmap({ experience: "beginner", hoursPerWeek: 8, startDate: "2026-10-30" });
  assert.equal(getActiveRoadmapWeek(plan).number, 1);
  plan = advanceStudyRoadmap(plan);
  assert.equal(plan.completedThrough, 1);
  assert.equal(getActiveRoadmapWeek(plan).number, 2);
  for (let i = 1; i < plan.totalWeeks + 4; i += 1) plan = advanceStudyRoadmap(plan);
  const active = getActiveRoadmapWeek(plan);
  assert.equal(plan.completedThrough, plan.totalWeeks);
  assert.equal(active.completed, true);
  assert.equal(active.percent, 100);
});

test("非法基础、投入时间和进度不会破坏路线", () => {
  const plan = createStudyRoadmap({ experience: "unknown", hoursPerWeek: 99, completedThrough: 999, startDate: "not-a-date" });
  assert.equal(plan.experience, "beginner");
  assert.equal(plan.hoursPerWeek, 8);
  assert.equal(plan.completedThrough, plan.totalWeeks);
  assert.match(plan.startDate, /^\d{4}-\d{2}-\d{2}$/);
});
