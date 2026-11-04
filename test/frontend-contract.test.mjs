import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  calculateExecutionPathEstimate,
  calculateInputDomainEstimate,
} from "../public/learning-visualizers.mjs";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
const roadmapUi = await readFile(new URL("../public/roadmap-ui.mjs", import.meta.url), "utf8");
const reviewPage = await readFile(new URL("../public/exam-review-2026.html", import.meta.url), "utf8");
const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const reviewNotes = await readFile(new URL("../src/question-review-notes.mjs", import.meta.url), "utf8");

test("前端共享 API 提供默认超时并合并调用方取消信号", () => {
  assert.match(app, /const DEFAULT_API_TIMEOUT_MS = 30_000/);
  assert.match(app, /timeoutMs = DEFAULT_API_TIMEOUT_MS/);
  assert.match(app, /callerSignal\.addEventListener\("abort", abortFromCaller/);
  assert.match(app, /timeoutError\.code = "REQUEST_TIMEOUT"/);
  assert.match(app, /removeAbortListener\(\)/);
});

test("主要列表容器声明 aria-busy 并使用页面级重试", () => {
  for (const id of [
    "wrong-list",
    "history-list",
    "case-list",
    "paper-list",
    "wiki-directory",
    "wiki-reader",
    "bank-list",
    "stats-summary",
    "data-summary",
    "materials-groups",
    "materials-document",
    "mock-history-list",
    "case-exam-stage",
    "real-exam-catalog-status",
    "question-issues-list",
    "study-queue-body",
    "content-health-body",
  ]) {
    assert.match(html, new RegExp(`id="${id}"[^>]*aria-busy="false"`));
  }
  assert.match(app, /function renderLoadError\(target, error, retry\)/);
  assert.match(app, /text: "重新加载"/);
  assert.match(app, /beginLoad\("wrong", "#wrong-list"/);
  assert.match(app, /beginLoad\("question-bank", "#bank-list"/);
  assert.match(app, /beginLoad\(\s*"real-exam-catalog",\s*"#real-exam-catalog-status"/);
  assert.match(app, /load\.fail\(error, loadRealExamCatalog\)/);
  assert.match(app, /beginLoad\(\s*"wiki",/);
});

test("长耗时生成和评分请求使用显式长超时", () => {
  assert.match(app, /const LONG_API_TIMEOUT_MS = 10 \* 60_000/);
  assert.ok((app.match(/timeoutMs: LONG_API_TIMEOUT_MS/g) || []).length >= 8);
});

test("加载态和错误态具有稳定的可视样式", () => {
  assert.match(css, /\.loading-state/);
  assert.match(css, /\.load-error/);
  assert.match(css, /\.retry-button/);
});

test("论文模拟计时器随列表生命周期清理", () => {
  assert.match(app, /function clearPaperMockTimers\(\)/);
  assert.match(app, /state\.paperMockTimers\.add\(mockTimer\)/);
  assert.match(app, /function renderPapers\(papers, total = papers\.length\) \{\s*clearPaperMockTimers\(\);/);
  assert.match(app, /if \(mockTimer !== null && !mockBar\.isConnected\)/);
  assert.match(app, /if \(view !== "paper"\) clearPaperMockTimers\(\);/);
  assert.match(app, /if \(!mockBar\.isConnected\) return;/);
});

test("Wiki 提问抽屉管理遮罩、焦点和关闭竞态", () => {
  assert.match(html, /id="wiki-ask-drawer"[^>]*aria-modal="true"/);
  assert.match(app, /let wikiAskCloseTimer = null/);
  assert.match(app, /\$\("#wiki-ask-backdrop"\)\.hidden = false/);
  assert.match(app, /clearTimeout\(wikiAskCloseTimer\)/);
  assert.match(app, /if \(returnFocus\?\.isConnected\) returnFocus\.focus\(\)/);
});

test("启动和章节筛选失败时仍保留可恢复流程", () => {
  assert.match(app, /beginLoad\("chapters", "#coverage", "正在加载章节…"\)/);
  assert.match(app, /load\.fail\(error, loadChapters\)/);
  assert.match(app, /async function initializeApp\(\)/);
  assert.match(app, /await Promise\.allSettled\(\[/);
  assert.match(app, /await loadBankSections\(\);[\s\S]*?\$\("#bank-section"\)\.value = "all"/);
});

test("知识图谱、模型工作区和案例模拟保持当前交互状态", () => {
  assert.match(app, /function renderFilteredWikiGraph\(\)/);
  assert.match(app, /renderWikiGraph\(wikiFilteredEntries\(\), \{/);
  assert.match(app, /focusDepth: depth/);
  assert.match(app, /state\.modelWorkspace = workspaceDraft\(collectWorkspaceDraft\(\)\)/);
  assert.match(app, /textarea\.agent-prompt/);
  assert.match(app, /state\.caseExam\)/);
  assert.match(app, /已有进行中的案例模拟，请继续作答/);
  assert.match(app, /memory\.upcomingDistinct \?\? memory\.upcoming/);
});

test("学习自检、案例作答、论文草稿和知识库筛选具有可访问名称", () => {
  assert.match(app, /type: "checkbox", "aria-label": check\.prompt/);
  assert.match(app, /"aria-label": "案例作答：问题 " \+ \(index \+ 1\)/);
  assert.match(app, /"aria-label": "论文草稿：" \+ \(paper\.title \|\| paper\.id\)/);
  assert.match(app, /"aria-label": "编辑概念解释"/);
  assert.match(html, /id="wiki-search"[^>]*aria-label="搜索知识点标题或内容"/);
  assert.match(html, /id="wiki-status-filter"[^>]*aria-label="按校对状态筛选"/);
});

test("命令面板支持 Escape 关闭，避免模态层阻断页面导航", () => {
  assert.match(app, /document\.getElementById\("command-palette"\)\.close\(\);/);
  assert.match(html, /id="command-palette"[^>]*aria-label="命令面板"/);
});

test("首页学习队列和内容质量概览使用只读 API，并禁用零到期复习入口", () => {
  assert.match(app, /api\("\/api\/study-queue\?limit=5"\)/);
  assert.match(app, /api\("\/api\/content-health"\)/);
  assert.match(app, /function setReviewActionState\(due\)/);
  assert.match(app, /button\.disabled = disabled/);
  assert.match(app, /textContent = disabled[\s\S]*?"暂无到期题"/);
  assert.match(html, /id="start-review"[^>]*disabled/);
  assert.match(html, /id="review-all"[^>]*disabled/);
});

test("题库编辑器提供带来源定位和核验范围的人工审校入口", () => {
  assert.match(html, /id="bank-review-submit"/);
  assert.match(app, /来源路径标记（需在源资料库定位）：" \+ item\.sourceFile/);
  assert.match(app, /题目级出处：" \+ preciseReferences\.join/);
  assert.match(app, /item\.sourceUrl/);
  assert.match(app, /item\.sourcePage/);
  assert.match(app, /来源路径标记：未记录/);
  assert.match(app, /evidenceReference: draft\.reference\.value/);
  assert.match(app, /reviewedFields/);
  assert.match(app, /\/api\/questions\/\$\{encodeURIComponent\(question\.id\)\}\/review/);
  assert.match(app, /来源权威性仍需人工判断/);
});


test("零基础路线在首页提供独立的配置、进度和教材/题型入口", () => {
  assert.match(html, /id="beginner-roadmap"/);
  assert.match(app, /import \{ mountBeginnerRoadmap \} from "\/roadmap-ui\.mjs"/);
  assert.match(app, /async function openRoadmapWeek\(week\)/);
  assert.match(app, /mountBeginnerRoadmap\(\{ onOpenWeek: openRoadmapWeek \}\)/);
  assert.match(css, /#home-view \.beginner-roadmap/);
  assert.match(css, /@media\(max-width:620px\).*roadmap-setup/s);
});


test("2026 考后复盘入口在首次配置和已有路线状态下都可见", () => {
  assert.match(roadmapUi, /link\.href = "\/exam-review-2026\.html"/);
  assert.equal((roadmapUi.match(/reviewShortcut\(\)/g) || []).length, 2);
  assert.match(reviewPage, /2026 年实际考试节奏/);
  assert.match(reviewPage, /240 分钟/);
  assert.match(reviewPage, /14:30—16:30/);
});

test("学习路线的存储失败会明确告警且阻止进度误推进或丢失", () => {
  assert.match(roadmapUi, /function showRoadmapError\(panel, message\)[\s\S]*?setAttribute\("role", "alert"\)/);
  assert.match(roadmapUi, /if \(!savePlan\(next\)\) \{[\s\S]*?本周尚未推进[\s\S]*?return;[\s\S]*?render\(\);/);
  assert.match(roadmapUi, /localStorage\.removeItem\(ROADMAP_STORAGE_KEY\);[\s\S]*?catch \{[\s\S]*?原路线和进度均已保留/);
  assert.match(css, /\.roadmap-error\{[^}]*var\(--danger-ink\)/);
});

test("学习路线进度条向辅助技术公开当前完成比例", () => {
  assert.match(roadmapUi, /progressTrack\.setAttribute\("role", "progressbar"\)/);
  assert.match(roadmapUi, /aria-valuemin/);
  assert.match(roadmapUi, /aria-valuemax/);
  assert.match(roadmapUi, /aria-valuenow/);
  assert.match(roadmapUi, /aria-valuetext/);
});

test("命题复习提示使用显式只读模块白名单，且练习只在提交答案后显示", () => {
  assert.ok(app.includes('import { questionReviewNoteFor } from "/lib/question-review-notes.mjs";'));
  assert.ok(server.includes('["/lib/question-review-notes.mjs", resolve(root, "src/question-review-notes.mjs")]'));
  assert.ok(app.includes("function questionReviewNoteNode(question)"));
  const questionNode = app.slice(app.indexOf("function questionNode("), app.indexOf("function renderAnswerSheet("));
  assert.ok(questionNode.indexOf("questionReviewNoteNode(question)") > questionNode.indexOf("if (checked)"));
  const resultDetail = app.slice(app.indexOf("function resultDetailNode("), app.indexOf("function renderResult("));
  assert.ok(resultDetail.includes("questionReviewNoteNode(detail)"));
  assert.ok(reviewNotes.includes('answerVerification: "not-established"'));
  assert.ok(reviewNotes.includes("humanSignOff: false"));
  assert.ok(css.includes(".question-review-note-references"));
  assert.ok(css.includes(".question-review-note-boundary"));
});

test("输入域与执行路径可视化的加权计算保持权重归一且区分简单平均", () => {
  const input = calculateInputDomainEstimate(5);
  assert.deepEqual(input.rows.map((row) => row.weight), [80, 15, 5]);
  assert.equal(input.weighted, 97.45);
  assert.ok(input.equal > 91.33 && input.equal < 91.34);
  const path = calculateExecutionPathEstimate(10);
  assert.deepEqual(path.rows.map((row) => row.weight), [70, 20, 10]);
  assert.equal(path.weighted, 3.5);
  assert.ok(path.equal > 8.33 && path.equal < 8.34);
  assert.equal(calculateInputDomainEstimate(30).rows.reduce((sum, row) => sum + row.weight, 0), 100);
  assert.throws(() => calculateInputDomainEstimate("bad"), /有限数字/);
});

test("交互式课程实验只挂载到明确对应单元，并声明示例边界与辅助技术说明", async () => {
  const visualizers = await readFile(new URL("../public/learning-visualizers.mjs", import.meta.url), "utf8");
  assert.ok(app.includes('import { learningVisualizerNode } from "/learning-visualizers.mjs";'));
  assert.ok(app.includes("learningVisualizerNode(unit, element)"));
  for (const id of ["9.2.3.6", "9.2.3.7", "19.3.3"]) assert.ok(visualizers.includes(`case "${id}"`));
  assert.match(visualizers, /自拟示例|非教材公式/);
  assert.match(visualizers, /aria-live/);
  assert.match(css, /\.learning-visualizer/);
  assert.match(css, /prefers-reduced-motion/);
});
