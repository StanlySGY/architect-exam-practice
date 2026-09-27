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
