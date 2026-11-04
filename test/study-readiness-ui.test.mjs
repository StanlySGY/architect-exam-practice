import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const [html, app, caseExamService, css] = await Promise.all([
  readFile(resolve(root, "public/index.html"), "utf8"),
  readFile(resolve(root, "public/app.js"), "utf8"),
  readFile(resolve(root, "src/service/case-exam.mjs"), "utf8"),
  readFile(resolve(root, "public/styles.css"), "utf8"),
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
  assert.match(app, /earliestSubmitAt/);
  assert.match(app, /本场开始满 180 分钟后开放交卷/);
  assert.match(caseExamService, /240 分钟连考的案例分析只能在考试结束前 60 分钟进入交卷窗口/);
});

test("学习进度必须先完成本单元自检，巩固没有匹配题时不会拿其他章节题替代", () => {
  assert.match(app, /请先完成本节的 \$\{incompleteChecks\.length\} 项自检/);
  assert.match(app, /当前没有知识点精准匹配且已审校的题目/);
  assert.match(app, /api\(`\/api\/learning-reinforcement\?unitId=/);
});

test("课程核验状态和资料依据必须在核心讲解前展示，并区分不同核验级别", () => {
  const start = app.indexOf("function renderLearningPath(");
  const end = app.indexOf("async function loadLearningPath(", start);
  const renderer = app.slice(start, end);
  const primaryLesson = renderer.indexOf('className: "learning-topic learning-topic-primary"');
  assert.ok(primaryLesson > 0, "核心课程内容节点应存在");
  assert.ok(renderer.indexOf("contentStatusNode,") < primaryLesson, "核验状态必须先于核心讲解");
  assert.ok(renderer.indexOf("learningEvidenceNode,") < primaryLesson, "资料依据入口必须先于核心讲解");
  assert.match(renderer, /部分核验 · 仍需教材复核/);
  assert.match(renderer, /资料链接可访问，不等于正文足以支持全部讲解/);
  assert.match(renderer, /暂无登记依据/);
  assert.match(renderer, /ai-source-cross-check-complete/);
  assert.match(renderer, /verificationReviewNode,/);
  assert.match(renderer, /这不是人工审批，也不代表整节课程已核验/);
  assert.match(renderer, /verificationPendingClaims/);
  assert.match(css, /\.learning-content-status\.is-verified/);
  assert.match(css, /\.learning-content-status\.is-partial/);
  assert.match(css, /\.learning-content-status\.is-missing/);
  assert.match(css, /\.learning-content-status\{flex-wrap:wrap;gap:9px\}/);
  assert.match(css, /\.learning-content-status-copy\{flex:1 1 calc\(100% - 18px\)\}/);
});
