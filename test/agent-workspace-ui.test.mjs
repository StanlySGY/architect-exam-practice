import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");

test("Agent 工作区拥有独立导航和独立页面，不再埋在数据管理中", () => {
  assert.ok(html.includes('data-view="agents"'));
  assert.ok(html.includes('<section id="agents-view" class="view page-view agent-workspace-view">'));
  const dataStart = html.indexOf('<section id="data-view"');
  const dataEnd = html.indexOf('</section>', dataStart);
  assert.ok(dataStart >= 0 && dataEnd > dataStart);
  assert.equal(html.slice(dataStart, html.indexOf('<section class="panel data-panel">', dataStart)).includes('id="provider-list"'), false);
  assert.ok(app.includes('if (view === "agents")'));
  assert.ok(app.includes('if (view === "data")'));
});

test("工作区按 Agent 团队、供应商和任务拆分为独立标签面板", () => {
  for (const tab of ["team", "providers", "tasks"]) {
    assert.ok(html.includes('data-agent-tab="' + tab + '"'));
    assert.ok(html.includes('data-agent-panel="' + tab + '"'));
  }
  assert.ok(html.includes('role="tablist" aria-label="Agent 工作区导航"'));
  assert.ok(html.includes('id="agent-workspace-save-state"'));
  assert.ok(app.includes("function setAgentWorkspaceTab(tab)"));
  assert.ok(app.includes("aria-selected"));
});

test("Agent 团队提供角色模板和可折叠的高级提示词", () => {
  for (const template of ["exam-tutor", "architecture-reviewer", "source-checker"]) {
    assert.ok(html.includes('data-agent-role-template="' + template + '"'));
    assert.ok(app.includes('"' + template + '"'));
  }
  assert.ok(html.includes("系统提示词"));
  assert.ok(app.includes("function addAgentFromTemplate(templateId)"));
  assert.ok(app.includes("agent-prompt-details"));
});

test("工作区展示供应商、Agent、默认角色和未保存状态", () => {
  for (const id of [
    "provider-list", "agent-list", "agent-default", "mc-save",
    "agent-workspace-save-state", "agent-metric-enabled",
    "agent-metric-providers", "agent-metric-default",
  ]) assert.ok(html.includes('id="' + id + '"'), id);
  assert.ok(app.includes("function updateWorkspaceDirtyState()"));
  assert.ok(app.includes("current !== state.modelWorkspaceSavedSignature"));
  assert.ok(app.includes("工作区存在未保存的修改"));
  assert.ok(app.includes("const boundAgents = state.modelWorkspace.agents.filter"));
  assert.ok(app.includes("请先为这些角色更换供应商"));
  assert.ok(app.includes("const effectiveDefault = enabledDefault || state.modelWorkspace.agents.find((agent) => agent.enabled)"));
  assert.ok(app.includes("state.modelWorkspaceSavedSignature = workspaceSignature(state.modelWorkspace)"));
});

test("协作方式使用策略卡片，并约束角色数量和评审角色", () => {
  for (const strategy of ["single", "parallel", "battle"]) {
    assert.ok(html.includes('data-agent-strategy="' + strategy + '"'));
    assert.ok(app.includes("button.dataset.agentStrategy === strategy"));
  }
  assert.ok(html.includes('id="agent-task-members"'));
  assert.ok(html.includes('id="agent-task-judge-wrap"'));
  assert.ok(html.includes('id="agent-strategy-preview"'));
  assert.ok(html.includes('id="agent-task-call-estimate"'));
  assert.ok(app.includes("一次最多选择 4 个 Agent"));
  assert.ok(app.includes("当前策略需要至少选择 2 个已启用的 Agent"));
  assert.ok(app.includes('strategy === "single" && selectedInputs.length > 1'));
});

test("任务输入提供模板、长度计数、未保存防护和执行反馈", () => {
  assert.ok(html.includes('id="agent-task-prompt"'));
  assert.ok(html.includes('maxlength="16000"'));
  assert.ok(html.includes('aria-label="Agent 任务内容"'));
  for (const template of ["概念讲解", "方案对比", "架构评审"]) assert.ok(html.includes(template));
  assert.ok(html.includes('id="agent-task-char-count"'));
  assert.ok(app.includes("agent-task-char-count"));
  assert.ok(app.includes("工作区存在未保存的修改"));
  assert.ok(app.includes("正在执行角色任务"));
});

test("执行结果区分成功/失败，展示要点、关注点并支持复制", () => {
  assert.ok(html.includes('id="agent-task-result"'));
  assert.ok(app.includes("function agentTaskPlainText(result)"));
  assert.ok(app.includes("复制全部结果"));
  assert.ok(app.includes("模型自评置信度"));
  assert.ok(app.includes("关键要点"));
  assert.ok(app.includes("需要留意"));
  assert.ok(app.includes("综合评审"));
  assert.ok(app.includes("综合评审未执行"));
  assert.ok(app.includes("agent-result-run-meta"));
  assert.ok(app.includes("复制此回答"));
  assert.ok(app.includes("performance.now()"));
  assert.ok(app.includes("state.modelWorkspace.defaultAgentId === agent.id"));
  assert.ok(app.includes("disabled: !agent.enabled"));
});

test("Agent 工作区具备响应式、键盘焦点和窄屏布局", () => {
  assert.ok(css.includes(".agent-workspace-view{width:100%;max-width:none;min-width:0}"));
  assert.ok(css.includes("@media(max-width:1100px){.agent-config-columns"));
  assert.ok(css.includes("@media(max-width:800px){.agent-page-heading"));
  assert.ok(css.includes("@media(max-width:560px){.agent-workspace-metrics"));
  assert.ok(css.includes(".agent-strategy-card:focus-visible"));
  assert.ok(css.includes(".agent-task-result[hidden]{display:none}"));
});

test("Agent 任务结果提供明确保存的本机历史、回看和删除入口", () => {

  for (const id of [
    "agent-task-history-details",
    "agent-task-history-count",
    "agent-task-history-list",
    "agent-task-history-clear",
  ]) {
    assert.ok(html.includes('id="' + id + '"'), id);
  }
  assert.ok(html.includes("不会上传到服务端"));
  assert.ok(html.includes("不做应用层加密"));
  assert.ok(app.includes("function renderAgentTaskHistory("));
  assert.ok(app.includes("function openAgentTaskHistory(id)"));
  assert.ok(app.includes("saveAgentTaskHistory("));
  assert.ok(app.includes("removeAgentTaskHistory("));
  assert.ok(css.includes(".agent-task-history-row"));
});

test("服务端任务列表结构正确，显示任务摘要并为操作提供可访问名称", () => {
  assert.equal((html.match(/class="agent-task-layout"/g) || []).length, 1);
  assert.match(html, /<\/details>\s*<section class="agent-server-tasks">[\s\S]*?<\/section>\s*<div class="agent-task-layout">/);
  assert.ok(html.includes("/styles.css?v=20261103-agent-fullwidth1"));
  assert.ok(html.includes("/app.js?v=20261103-agent-persistent4"));
  assert.ok(app.includes("task.promptPreview"));
  assert.ok(app.includes("function agentServerTaskStatusLabel(status)"));
  assert.ok(app.includes("agentServerTaskStatusLabel(task.status)"));
  assert.equal(app.includes("agentTaskStatusLabel(task.status)"), false);
  assert.ok(app.includes("box.replaceChildren(...["));
  assert.ok(app.includes("].filter(Boolean));"));
  assert.ok(app.includes("agent-server-task-prompt"));
  assert.ok(app.includes('"aria-label": (isActive ? "继续跟踪：" : "查看结果：") + promptPreview'));
  assert.ok(app.includes('"aria-label": "取消任务：" + promptPreview'));
  assert.ok(css.includes(".agent-server-task-prompt"));
});

test("持久任务状态查询遇到瞬时故障时保留任务并进行有上限的退避重试", () => {
  const watcher = app.slice(app.indexOf("async function watchDurableAgentTask"), app.indexOf("async function createDurableAgentTask"));
  assert.ok(watcher.includes("let statusFailures = 0;"));
  assert.ok(watcher.includes("const retryDelay = Math.min(2_000, 250 * (2 ** Math.min(statusFailures - 1, 3)))"));
  assert.match(watcher, /if \(signal\?\.aborted\) \{\s+await requestCancellation\(\);/);
});

test("Agent 任务通过真实 SSE 事件展示逐角色状态，并提供定点重试", () => {
  assert.ok(html.includes('id="agent-task-progress-roles"'));
  assert.ok(html.includes('id="agent-task-progress-text"'));
  assert.ok(html.includes('id="agent-task-plan"'));
  assert.ok(app.includes("function renderAgentTaskPlan(plan)"));
  assert.ok(app.includes("function agentTaskQualityText(quality)"));
  assert.ok(app.includes("function agentTaskPlanText(plan)"));
  assert.ok(app.includes("function refreshAgentTaskQuality(result, reviewOverride)"));
  assert.ok(app.includes('refreshAgentTaskQuality(taskRecord.result, "passed")'));
  assert.ok(app.includes('refreshAgentTaskQuality(taskRecord.result, successfulCount >= 2 ? "pending" : "skipped")'));
  assert.ok(html.includes('id="agent-server-task-list"'));
  assert.ok(html.includes('id="agent-server-task-refresh"'));
  assert.ok(app.includes("async function createDurableAgentTask(payload"));
  assert.ok(app.includes("async function watchDurableAgentTask(taskId"));
  assert.ok(app.includes("async function readDurableAgentTaskEvents(taskId"));
  assert.ok(app.includes("async function loadAgentServerTasks("));
  assert.ok(app.includes("async function openAgentServerTask(taskId)"));
  assert.ok(app.includes("async function cancelAgentServerTask(taskId)"));
  assert.ok(app.includes('createDurableAgentTask({'));
  assert.ok(app.includes('"last-event-id": String(afterSeq)'));
  assert.ok(app.includes("function updateAgentTaskProgress(event)"));
  assert.ok(app.includes("async function retryAgentResult(agentId)"));
  assert.ok(app.includes("async function retryAgentReview()"));
  assert.ok(app.includes('mode: "review"'));
  assert.ok(app.includes('strategy: "single"'));
  assert.ok(app.includes("persistUpdatedAgentTaskHistory(taskRecord)"));
  assert.ok(app.includes("historySyncFailed"));
  assert.ok(app.includes("重新同步历史"));
  assert.ok(app.includes("候选答案已更新，之前的综合评审已过期"));
  assert.ok(css.includes(".agent-task-progress-row.is-running"));
  assert.ok(css.includes(".agent-task-progress-row.is-failed"));
  assert.ok(css.includes(".agent-task-plan-step"));
  assert.ok(css.includes(".agent-quality-summary"));
  assert.ok(css.includes(".agent-plan-summary"));
  assert.ok(css.includes(".agent-result-card-actions"));
  assert.ok(css.includes(".agent-server-task-row"));
  assert.ok(css.includes(".agent-server-task-actions"));
});
