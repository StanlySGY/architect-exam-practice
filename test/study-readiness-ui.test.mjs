import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const [html, app] = await Promise.all([
  readFile(resolve(root, "public/index.html"), "utf8"),
  readFile(resolve(root, "public/app.js"), "utf8"),
]);

test("现行 240 分钟连考入口默认关闭，并明确完整试卷条件", () => {
  assert.match(html, /id="start-real-continuous-exam"[^>]*disabled/);
  assert.match(html, /综合知识 75 题，至少 120 分钟、最多 150 分钟/);
  assert.match(html, /240 分钟总时限内的剩余时间/);
  assert.match(app, /selected\.questions === 75 && selected\.cases >= 3/);
  assert.match(app, /continuousMode: true/);
});

test("连考前端说明最短交卷时间、案例接续、断点恢复和两科分别 45 分判定", () => {
  assert.match(app, /至少进行 120 分钟后才能手动交卷/);
  assert.match(app, /150 分钟到时自动交卷并衔接案例分析/);
  assert.match(app, /api\("\/api\/continuous-exams\/pending"\)/);
  assert.match(app, /api\("\/api\/case-exams"/);
  assert.match(app, /mcq\?\.total === 75 && Number\(mcq\.correct\) >= 45/);
  assert.match(app, /caseScoreOn75 >= 45/);
});

test("学习进度必须先完成本单元自检，巩固没有匹配题时不会拿其他章节题替代", () => {
  assert.match(app, /请先完成本节的 \$\{incompleteChecks\.length\} 项自检/);
  assert.match(app, /当前没有知识点精准匹配且已审校的题目/);
  assert.match(app, /api\(`\/api\/learning-reinforcement\?unitId=/);
});
