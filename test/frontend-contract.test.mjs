import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");

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
  assert.match(app, /evidenceReference: draft\.reference\.value/);
  assert.match(app, /reviewedFields/);
  assert.match(app, /\/api\/questions\/\$\{encodeURIComponent\(question\.id\)\}\/review/);
  assert.match(app, /来源权威性仍需人工判断/);
});
