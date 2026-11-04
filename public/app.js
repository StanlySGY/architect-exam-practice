import { renderQuestionFigure } from "/lib/figures.mjs";
import { questionReviewNoteFor } from "/lib/question-review-notes.mjs";
import { renderMarkdown } from "/lib/markdown.mjs";
import { validateEssaySample } from "/lib/essay.mjs";
import { mountBeginnerRoadmap } from "/roadmap-ui.mjs";
import { learningVisualizerNode } from "/learning-visualizers.mjs";
import { $, element, emptyMessage } from "/ui.js";
import {
  AGENT_TASK_HISTORY_LIMIT,
  clearAgentTaskHistory,
  loadAgentTaskHistory,
  removeAgentTaskHistory,
  saveAgentTaskHistory,
} from "/agent-task-history.mjs";
import {
  currentWikiGraph,
  destroyWikiGraph,
  fitWikiGraph,
  focusWikiGraphNode,
  initWikiGraphDeps,
  renderWikiGraph,
  updateWikiGraphFocus,
} from "/graph.js";

const state = {
  chapters: [],
  chapterMap: new Map(),
  session: null,
  answers: {},
  checks: {},
  pendingChecks: new Set(),
  currentIndex: 0,
  sectionMap: new Map(),
  result: null,
  generationRetry: false,
  activeSession: null,
  bankOffset: 0,
  bankLimit: 50,
  bankTotal: 0,
  wrongRecords: [],
  wrongOffset: 0,
  wrongLimit: 50,
  wrongTotal: 0,
  dueCount: 0,
  wikiEntries: [],
  wikiSelectedId: "",
  generationControllers: new Map(),
  loadVersions: new Map(),
  modelWorkspace: { providers: [], agents: [], defaultAgentId: "" },
  modelWorkspaceSavedSignature: "",
  modelWorkspaceLoaded: false,
  agentSelectedIds: null,
  agentWorkspaceTab: "team",
  lastAgentTask: null,
  agentTaskHistory: [],
  agentTaskBusy: false,
  agentTaskProgressRows: new Map(),
  activeAgentTaskId: "",
  agentServerTasks: [],
  caseOffset: 0,
  caseLimit: 4,
  caseTotal: 0,
  caseLoadId: 0,
  paperOffset: 0,
  paperLimit: 4,
  paperTotal: 0,
  paperLoadId: 0,
  paperMockTimers: new Set(),
  caseExam: null,
  pendingContinuousExam: null,
  realExamCatalog: [],
  wikiGraphColorBy: "chapter",
  wikiGraphDepth: 1,
  caseExamTimer: null,
  examDeadline: null,
  examTimer: null,
  examSaveQueues: new Map(),
  examAnswerRevisions: new Map(),
  // 复习自评(1-4)与作答置信度(1-3):复习模式判题后可选档位,影响 FSRS 间隔。
  ratings: {},
  confidenceByQuestion: {},
};
const difficultyNames = {
  easy: "简单",
  medium: "中等",
  hard: "困难",
  mixed: "混合",
};

function bankOnboardingNode() {
  const actions = [
    ["配置模型", "data", ".model-config-panel"],
    ["生成待审校章节题", "home", ".agent-panel"],
    ["进入真题套卷", "mock", "#real-exam-form"],
    ["导入真题库", "data", "#import-bank"],
  ].map(([label, view, target]) => {
    const button = element("button", {
      className: "secondary",
      text: label,
      attrs: { type: "button" },
    });
    button.addEventListener("click", () => {
      switchView(view);
      document.querySelector(target)?.scrollIntoView({ behavior: "smooth" });
    });
    return button;
  });
  return [
    element("strong", { text: "当前没有可用于正式章节练习的已审校题目" }),
    element("p", {
      text: "思维导图生成题必须完成答案、解析和来源核验后才能进入正式章节练习。待审校题不会混入正式成绩；你可以先做历年真题套卷，或在题库管理中审查生成题。",
    }),
    element("div", { className: "bank-onboarding-actions" }, actions),
  ];
}

// 展示题目来源导图节点，便于回溯核对导图内容。
function sourceNodeNode(sourceNode) {
  if (!sourceNode) return null;
  return element("div", {
    className: "tip",
    text: `来源节点：${sourceNode}`,
  });
}

const sourceTypeNames = {
  generated: "生成题",
  real: "历年真题",
  mock: "模拟题",
};

function itemSourceType(item) {
  return item?.sourceType || "generated";
}

function sourceTypeLabel(item) {
  return sourceTypeNames[itemSourceType(item)] || "生成题";
}

function answerTrustFor(item) {
  if (item?.answerTrustLabel || item?.answerTrustNote) {
    return {
      code: item.answerTrust || "unverified",
      label: item.answerTrustLabel || "答案来源未标注",
      note: item.answerTrustNote || "当前题目的答案来源没有独立核验记录。",
    };
  }
  if (itemSourceType(item) === "real") {
    return {
      code: "third-party",
      label: "第三方整理答案",
      note: "题库清单明确说明真题答案是非官方整理，请以原卷和权威资料核对。",
    };
  }
  if (itemSourceType(item) === "mock") {
    return {
      code: "mock-unverified",
      label: "模拟题答案未独立核验",
      note: "模拟题没有官方原卷背书，答案和解析遇到争议时请提交问题。",
    };
  }
  return {
    code: "generated",
    label: "生成题答案未独立核验",
    note: "题目和解析由 Agent 生成，尚未经过独立事实核验；请结合教材判断。",
  };
}

function answerTrustNode(item) {
  const trust = answerTrustFor(item);
  const children = [
    element("strong", { text: `答案来源：${trust.label}` }),
    element("span", { text: trust.note }),
  ];
  if (isImportedItem(item)) {
    const preciseReferences = [
      item.sourceUrl ? "URL：" + item.sourceUrl : null,
      item.sourcePage ? "页码：" + item.sourcePage : null,
      item.sourceReference ? "条款/题号：" + item.sourceReference : null,
      item.sourceCitation ? "引文定位：" + item.sourceCitation : null,
      item.sourceLocation ? "具体位置：" + item.sourceLocation : null,
    ].filter(Boolean);
    if (preciseReferences.length) {
      children.push(element("span", {
        className: "source-file-reference",
        text: "题目级出处：" + preciseReferences.join("；"),
      }));
    }
    children.push(element("span", {
      className: "source-file-reference",
      text: item.sourceFile ? "来源路径标记（需在源资料库定位）：" + item.sourceFile : "来源路径标记：未记录",
    }));
  }
  return element("div", { className: `source-trust source-trust-${trust.code}` }, children);
}

function questionReviewNoteNode(question) {
  const note = questionReviewNoteFor(question?.id);
  if (!note) return null;
  return element("section", { className: "question-review-note", attrs: { "aria-label": "命题审校提示" } }, [
    element("div", { className: "question-review-note-heading" }, [
      element("strong", { text: "审校提示：" + note.title }),
      element("span", { text: note.label }),
    ]),
    element("p", { text: note.summary }),
    element("ul", {}, note.points.map((point) => element("li", { text: point }))),
    element("p", { className: "question-review-note-takeaway", text: note.takeaway }),
    element("div", { className: "question-review-note-references" }, [
      element("strong", { text: "可定位的原始资料" }),
      ...note.references.map((reference) => element("a", {
        text: reference.label,
        attrs: { href: reference.url, target: "_blank", rel: "noopener noreferrer" },
      })),
    ]),
    element("p", { className: "question-review-note-boundary", text: note.boundary }),
  ]);
}

function isImportedItem(item) {
  return itemSourceType(item) === "real" || itemSourceType(item) === "mock";
}

function examSessionTitle(session) {
  if (!session) return "综合知识模拟卷";
  if (session.term) {
    const kind = session.sourceType === "mock" ? "模拟卷" : "真题套卷";
    return `${session.term}${kind}`;
  }
  return "综合知识模拟卷";
}

function setRealExamCatalogStatus(message) {
  const status = $("#real-exam-catalog-status");
  if (!status) return;
  status.replaceChildren(
    element("span", {
      attrs: { id: "real-exam-availability" },
      text: message,
    }),
  );
}

// 关联 Wiki 条目链接，点击跳转到知识库对应条目。
function wikiLinkNode(wikiEntry) {
  const link = element("button", {
    className: "wiki-backlink",
    text: wikiEntry.title,
    attrs: { type: "button" },
  });
  link.addEventListener("click", () => jumpToWikiEntry(wikiEntry.id));
  return link;
}

const ACCESS_TOKEN_KEY = "architect-access-token";
const DEFAULT_API_TIMEOUT_MS = 30_000;
const LONG_API_TIMEOUT_MS = 10 * 60_000;

async function api(path, options = {}, authRetried = false) {
  const {
    headers: customHeaders = {},
    signal: callerSignal,
    timeoutMs = DEFAULT_API_TIMEOUT_MS,
    ...requestOptions
  } = options;
  const headers = { "content-type": "application/json", ...customHeaders };
  const controller = new AbortController();
  let timedOut = false;
  let timer = null;
  let removeAbortListener = () => {};
  const timeout = Number(timeoutMs);

  if (!Number.isFinite(timeout) || timeout < 0) {
    throw new TypeError("timeoutMs 必须是非负数");
  }
  const abortFromCaller = () => controller.abort(callerSignal.reason);
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort(callerSignal.reason);
    else {
      callerSignal.addEventListener("abort", abortFromCaller, { once: true });
      removeAbortListener = () => callerSignal.removeEventListener("abort", abortFromCaller);
    }
  }
  if (timeout > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException("请求超时", "TimeoutError"));
    }, timeout);
  }
  const cleanup = () => {
    if (timer) clearTimeout(timer);
    removeAbortListener();
  };
  try {
    try {
      const token = sessionStorage.getItem(ACCESS_TOKEN_KEY);
      if (token) headers.authorization = `Bearer ${token}`;
    } catch {
      // 隐私模式禁用 sessionStorage 时仍允许本机无认证模式工作。
    }
    const response = await fetch(path, {
      ...requestOptions,
      headers,
      signal: controller.signal,
    });
    const body = await response.json().catch((error) => {
      if (timedOut || callerSignal?.aborted) throw error;
      return {};
    });
    if (timedOut) {
      const timeoutError = new Error("请求超时，请稍后重试");
      timeoutError.code = "REQUEST_TIMEOUT";
      timeoutError.name = "TimeoutError";
      timeoutError.status = 408;
      throw timeoutError;
    }
    cleanup();
    if (
      !response.ok &&
      response.status === 401 &&
      body.code === "AUTH_REQUIRED" &&
      !authRetried
    ) {
      const token = await promptDialog({
        title: "需要访问令牌",
        message: "服务端已开启访问控制，请输入访问令牌。",
        placeholder: "访问令牌",
        type: "password",
      });
      if (token?.trim()) {
        try {
          sessionStorage.setItem(ACCESS_TOKEN_KEY, token.trim());
        } catch {
          // 下一次请求仍可由当前页面重新输入。
        }
        return api(path, options, true);
      }
    }
    if (!response.ok) {
      const error = new Error(body.error || `请求失败（${response.status}）`);
      error.code = body.code;
      error.status = response.status;
      throw error;
    }
    return body;
  } catch (error) {
    cleanup();
    // 用户主动取消优先于超时，生成任务等调用方才能正确收尾。
    if (callerSignal?.aborted) throw error;
    if (timedOut) {
      const timeoutError = new Error("请求超时，请稍后重试");
      timeoutError.code = "REQUEST_TIMEOUT";
      timeoutError.name = "TimeoutError";
      timeoutError.status = 408;
      throw timeoutError;
    }
    throw error;
  }
}

async function streamAgentRequest(path, body, {
  signal: callerSignal,
  timeoutMs = LONG_API_TIMEOUT_MS,
  onProgress = () => {},
} = {}, authRetried = false) {
  const controller = new AbortController();
  let timedOut = false;
  let timer = null;
  let removeAbortListener = () => {};
  const timeout = Number(timeoutMs);
  if (!Number.isFinite(timeout) || timeout < 0) {
    throw new TypeError("timeoutMs 必须是非负数");
  }
  const abortFromCaller = () => controller.abort(callerSignal.reason);
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort(callerSignal.reason);
    else {
      callerSignal.addEventListener("abort", abortFromCaller, { once: true });
      removeAbortListener = () => callerSignal.removeEventListener("abort", abortFromCaller);
    }
  }
  if (timeout > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException("请求超时", "TimeoutError"));
    }, timeout);
  }
  const cleanup = () => {
    if (timer) clearTimeout(timer);
    removeAbortListener();
  };
  try {
    const headers = { "content-type": "application/json", accept: "text/event-stream" };
    try {
      const token = sessionStorage.getItem(ACCESS_TOKEN_KEY);
      if (token) headers.authorization = `Bearer ${token}`;
    } catch {
      // 本机无认证模式不依赖 sessionStorage。
    }
    const response = await fetch(path, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      cleanup();
      if (
        response.status === 401 &&
        payload.code === "AUTH_REQUIRED" &&
        !authRetried
      ) {
        const token = await promptDialog({
          title: "需要访问令牌",
          message: "服务端已开启访问控制，请输入访问令牌。",
          placeholder: "访问令牌",
          type: "password",
        });
        if (token?.trim()) {
          try {
            sessionStorage.setItem(ACCESS_TOKEN_KEY, token.trim());
          } catch {
            // 下一次请求仍可由当前页面重新输入。
          }
          return streamAgentRequest(path, body, { callerSignal, timeoutMs, onProgress }, true);
        }
      }
      const error = new Error(payload.error || `请求失败（${response.status}）`);
      error.code = payload.code || "REQUEST_FAILED";
      error.status = response.status;
      throw error;
    }
    if (!response.body?.getReader) {
      throw new Error("浏览器不支持读取 Agent 进度流，请升级浏览器后重试");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let completed = false;
    let result = null;
    const dispatch = (block) => {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) return;
      let message;
      try {
        message = JSON.parse(data);
      } catch {
        throw new Error("Agent 进度事件格式无效");
      }
      if (message.type === "progress" && message.event) {
        try {
          onProgress(message.event);
        } catch {
          // UI 更新失败不应中断模型任务。
        }
      } else if (message.type === "complete") {
        result = message.result;
        completed = true;
      } else if (message.type === "error") {
        const error = new Error(message.error || "Agent 任务执行失败");
        error.code = message.code || "REQUEST_FAILED";
        error.status = message.status || 500;
        throw error;
      }
    };

    while (!completed) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let boundary;
      while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const block = buffer.slice(0, boundary);
        const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)[0];
        buffer = buffer.slice(boundary + separator.length);
        dispatch(block);
        if (completed) break;
      }
    }
    if (timedOut) {
      const error = new Error("Agent 任务超时，请稍后重试");
      error.code = "REQUEST_TIMEOUT";
      error.name = "TimeoutError";
      error.status = 408;
      throw error;
    }
    if (!completed) {
      throw new Error("Agent 进度连接提前结束，任务结果未完整返回");
    }
    return result;
  } catch (error) {
    if (callerSignal?.aborted) throw error;
    if (timedOut) {
      const timeoutError = new Error("Agent 任务超时，请稍后重试");
      timeoutError.code = "REQUEST_TIMEOUT";
      timeoutError.name = "TimeoutError";
      timeoutError.status = 408;
      throw timeoutError;
    }
    throw error;
  } finally {
    cleanup();
  }
}

const AGENT_ACTIVE_TASK_STORAGE_KEY = "architect-agent-active-task";
const AGENT_DURABLE_TASK_TIMEOUT_MS = 30 * 60_000;

function readActiveAgentTaskReference() {
  try {
    const value = JSON.parse(localStorage.getItem(AGENT_ACTIVE_TASK_STORAGE_KEY) || "null");
    return value && typeof value.taskId === "string" ? value : null;
  } catch {
    return null;
  }
}

function writeActiveAgentTaskReference(taskId) {
  state.activeAgentTaskId = taskId || "";
  try {
    if (taskId) localStorage.setItem(AGENT_ACTIVE_TASK_STORAGE_KEY, JSON.stringify({ taskId, updatedAt: Date.now() }));
    else localStorage.removeItem(AGENT_ACTIVE_TASK_STORAGE_KEY);
  } catch {
    // 服务端任务仍然持久化；本机快捷引用仅用于刷新后的便捷恢复。
  }
}

async function cancelDurableAgentTask(taskId) {
  if (!taskId) return null;
  return api(`/api/agents/tasks/${encodeURIComponent(taskId)}/cancel`, {
    method: "POST",
    body: "{}",
    timeoutMs: 10_000,
  });
}

async function readDurableAgentTaskEvents(taskId, afterSeq, { signal, onProgress }, authRetried = false) {
  const headers = {
    accept: "text/event-stream",
    "last-event-id": String(afterSeq),
  };
  try {
    const token = sessionStorage.getItem(ACCESS_TOKEN_KEY);
    if (token) headers.authorization = `Bearer ${token}`;
  } catch {
    // 本机无认证模式不依赖 sessionStorage。
  }

  const response = await fetch(`/api/agents/tasks/${encodeURIComponent(taskId)}/events`, {
    method: "GET",
    headers,
    signal,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401 && payload.code === "AUTH_REQUIRED" && !authRetried) {
      const token = await promptDialog({
        title: "需要访问令牌",
        message: "服务端已开启访问控制，请输入访问令牌。",
        placeholder: "访问令牌",
        type: "password",
      });
      if (token?.trim()) {
        try { sessionStorage.setItem(ACCESS_TOKEN_KEY, token.trim()); } catch { /* 下次请求可重新输入 */ }
        return readDurableAgentTaskEvents(taskId, afterSeq, { signal, onProgress }, true);
      }
    }
    const error = new Error(payload.error || `无法连接任务事件流（${response.status}）`);
    error.code = payload.code || "AGENT_TASK_STREAM_FAILED";
    error.status = response.status;
    throw error;
  }
  if (!response.body?.getReader) throw new Error("浏览器不支持读取 Agent 事件流");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let cursor = afterSeq;
  let terminal = null;
  const dispatch = (block) => {
    const lines = block.split(/\r?\n/);
    const idLine = lines.find((line) => line.startsWith("id:"));
    if (idLine) {
      const nextCursor = Number(idLine.slice(3).trim());
      if (Number.isSafeInteger(nextCursor) && nextCursor > cursor) cursor = nextCursor;
    }
    const data = lines.filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart()).join("\n");
    if (!data) return;
    const message = JSON.parse(data);
    if (message.eventSeq && Number.isSafeInteger(Number(message.eventSeq))) {
      cursor = Math.max(cursor, Number(message.eventSeq));
    }
    if (message.type === "progress" && message.event) {
      try { onProgress(message.event); } catch { /* UI 更新失败不应中断任务 */ }
    } else if (message.type === "task_started" || message.type === "task_resumed" || message.type === "task_requeued") {
      try {
        onProgress({
          type: "task_started",
          totalAgents: 1,
          resumed: message.type !== "task_started",
          attempt: message.event?.attempt,
        });
      } catch { /* UI 更新失败不应中断任务 */ }
    } else if (message.type === "task_cancel_requested") {
      try { onProgress({ type: "task_cancel_requested" }); } catch { /* UI 更新失败不应中断任务 */ }
    } else if (message.type === "complete" || message.type === "error" || message.type === "task_cancelled") {
      terminal = message;
    }
  };

  try {
    while (!terminal) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let boundary;
      while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)[0];
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + separator.length);
        dispatch(block);
        if (terminal) break;
      }
    }
  } finally {
    try { await reader.cancel(); } catch { /* 服务器可能已结束流 */ }
  }
  return { cursor, terminal };
}

async function watchDurableAgentTask(taskId, { signal, onProgress = () => {}, timeoutMs = AGENT_DURABLE_TASK_TIMEOUT_MS } = {}) {
  const deadline = Date.now() + timeoutMs;
  let cursor = 0;
  let statusFailures = 0;
  let cancelPromise = null;
  const requestCancellation = () => {
    if (!cancelPromise) {
      cancelPromise = cancelDurableAgentTask(taskId).catch((error) => {
        showToast(error.message || "取消任务请求未能发送；服务端任务状态仍可查询", true);
      });
    }
  };
  const onAbort = () => { void requestCancellation(); };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    while (Date.now() < deadline) {
      if (signal?.aborted) {
        await requestCancellation();
        throw new DOMException("任务已取消", "AbortError");
      }
      let status;
      try {
        status = await api(`/api/agents/tasks/${encodeURIComponent(taskId)}`, {
          method: "GET",
          signal,
          timeoutMs: 15_000,
        });
        statusFailures = 0;
      } catch (error) {
        if (signal?.aborted) {
          await requestCancellation();
          throw new DOMException("任务已取消", "AbortError");
        }
        if (error.status && error.status < 500 && ![408, 425, 429].includes(error.status)) throw error;
        statusFailures += 1;
        // 状态查询也可能遇到短暂网络抖动；保留 taskId，并用有上限的退避继续跟踪。
        const retryDelay = Math.min(2_000, 250 * (2 ** Math.min(statusFailures - 1, 3)));
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        continue;
      }
      const task = status.task;
      if (task.status === "completed") {
        writeActiveAgentTaskReference("");
        void loadAgentServerTasks();
        return task.result;
      }
      if (task.status === "failed") {
        writeActiveAgentTaskReference("");
        void loadAgentServerTasks();
        const error = new Error(task.error?.message || "Agent 任务执行失败");
        error.code = task.error?.code || "AGENT_TASK_FAILED";
        error.status = 500;
        throw error;
      }
      if (task.status === "cancelled") {
        writeActiveAgentTaskReference("");
        void loadAgentServerTasks();
        const error = new Error(task.error?.message || "Agent 任务已取消");
        error.code = "LLM_GENERATION_CANCELLED";
        error.status = 499;
        throw error;
      }
      if (signal?.aborted) continue;

      try {
        const streamed = await readDurableAgentTaskEvents(taskId, cursor, { signal, onProgress });
        cursor = streamed.cursor;
        if (streamed.terminal?.type === "complete") {
          writeActiveAgentTaskReference("");
          void loadAgentServerTasks();
          return streamed.terminal.result;
        }
        if (streamed.terminal?.type === "error") {
          const error = new Error(streamed.terminal.error || "Agent 任务执行失败");
          error.code = streamed.terminal.code || "AGENT_TASK_FAILED";
          error.status = streamed.terminal.status || 500;
          throw error;
        }
        if (streamed.terminal?.type === "task_cancelled") {
          writeActiveAgentTaskReference("");
          const error = new Error("Agent 任务已取消");
          error.code = "LLM_GENERATION_CANCELLED";
          error.status = 499;
          throw error;
        }
      } catch (error) {
        if (signal?.aborted) {
          await requestCancellation();
          throw new DOMException("任务已取消", "AbortError");
        }
        if (error.status && error.status < 500 && error.status !== 429) throw error;
        // 连接断开/临时服务故障时保留 taskId 和游标，重新查询后继续订阅。
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    const error = new Error("任务仍在服务端运行，当前页面停止等待；可从服务端任务列表继续跟踪。");
    error.code = "AGENT_TASK_WATCH_TIMEOUT";
    error.status = 408;
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

async function createDurableAgentTask(payload, { signal, onProgress = () => {} } = {}) {
  const idempotencyKey = globalThis.crypto?.randomUUID?.()
    || `agent-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  // 创建请求本身不绑定 UI AbortSignal：若用户在服务器接受后立即停止，仍需取得 taskId 再发出持久取消请求。
  const created = await api("/api/agents/tasks", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(payload),
    timeoutMs: 30_000,
  });
  const taskId = created.task?.id;
  if (!taskId) throw new Error("服务端没有返回持久任务 ID");
  state.activeAgentTaskId = taskId;
  writeActiveAgentTaskReference(taskId);
  void loadAgentServerTasks();
  if (signal?.aborted) {
    await cancelDurableAgentTask(taskId).catch(() => {});
    throw new DOMException("任务已取消", "AbortError");
  }
  return watchDurableAgentTask(taskId, { signal, onProgress });
}

function resolveElements(target) {
  const targets = Array.isArray(target) ? target : [target];
  return targets
    .map((item) => (typeof item === "string" ? $(item) : item))
    .filter(Boolean);
}

function resolveElement(target) {
  return resolveElements(target)[0];
}

function setBusy(target, busy) {
  for (const node of resolveElements(target)) {
    node.setAttribute("aria-busy", String(Boolean(busy)));
  }
}

function loadingNode(message = "正在加载…") {
  return element("div", {
    className: "loading-state",
    attrs: { role: "status", "aria-live": "polite" },
  }, [
    element("span", { className: "spinner", attrs: { "aria-hidden": "true" } }),
    element("span", { text: message }),
  ]);
}

function renderLoading(target, message = "正在加载…") {
  setBusy(target, true);
  for (const node of resolveElements(target)) node.replaceChildren(loadingNode(message));
}

function renderLoadError(target, error, retry) {
  setBusy(target, false);
  for (const node of resolveElements(target)) {
    const retryButton = element("button", {
      className: "secondary retry-button",
      text: "重新加载",
      attrs: { type: "button" },
    });
    retryButton.addEventListener("click", () => {
      retryButton.disabled = true;
      retryButton.textContent = "加载中…";
      retry();
    });
    node.replaceChildren(
      element("div", { className: "load-error", attrs: { role: "alert" } }, [
        element("strong", { text: "加载失败" }),
        element("p", { text: error?.message || "暂时无法读取数据，请重试。" }),
        retryButton,
      ]),
    );
  }
}

function beginLoad(key, target, message = "正在加载…") {
  const version = (state.loadVersions.get(key) || 0) + 1;
  state.loadVersions.set(key, version);
  renderLoading(target, message);
  return {
    isCurrent: () => state.loadVersions.get(key) === version,
    finish() {
      if (this.isCurrent()) setBusy(target, false);
    },
    fail(error, retry) {
      if (this.isCurrent()) renderLoadError(target, error, retry);
    },
  };
}

function resetExamSaveState(session = null) {
  state.examSaveQueues.clear();
  state.examAnswerRevisions.clear();
  for (const [questionId, revision] of Object.entries(session?.answerRevisions ?? {})) {
    if (Number.isInteger(revision) && revision > 0) {
      state.examAnswerRevisions.set(`${session.id}:${questionId}`, revision);
    }
  }
}

function showToast(message, isError = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.className = `show${isError ? " error" : ""}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.className = "";
  }, 4200);
}

// 自定义确认/输入弹窗：替代原生 window.confirm / window.prompt，风格与站内一致。
let appDialogResolve = null;

function finishAppDialog(result) {
  const dialog = $("#app-dialog");
  if (appDialogResolve) {
    const resolve = appDialogResolve;
    appDialogResolve = null;
    resolve(result);
  }
  if (dialog.open) dialog.close();
}

function appDialog({
  title,
  message = "",
  confirmText = "确认",
  cancelText = "取消",
  danger = false,
  input = null,
} = {}) {
  const dialog = $("#app-dialog");
  if (dialog.open) return Promise.resolve(input === null ? false : null);
  $("#app-dialog-title").textContent = title;
  const messageBox = $("#app-dialog-message");
  messageBox.replaceChildren();
  if (message) messageBox.append(element("p", { text: message }));
  messageBox.hidden = !message;
  const inputNode = $("#app-dialog-input");
  inputNode.hidden = input === null;
  inputNode.value = input?.value ?? "";
  inputNode.type = input?.type || "text";
  inputNode.placeholder = input?.placeholder || "";
  const confirmButton = $("#app-dialog-confirm");
  confirmButton.textContent = confirmText;
  confirmButton.className = danger ? "danger-button" : "primary";
  $("#app-dialog-cancel").textContent = cancelText;
  return new Promise((resolve) => {
    appDialogResolve = resolve;
    dialog.addEventListener(
      "close",
      () => finishAppDialog(input === null ? false : null),
      { once: true },
    );
    $("#app-dialog-cancel").onclick = () =>
      finishAppDialog(input === null ? false : null);
    confirmButton.onclick = () => {
      if (input !== null && input.required !== false && !inputNode.value.trim()) {
        inputNode.classList.add("is-invalid");
        inputNode.focus();
        return;
      }
      finishAppDialog(input === null ? true : inputNode.value);
    };
    inputNode.onkeydown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        confirmButton.click();
      }
    };
    inputNode.oninput = () => inputNode.classList.remove("is-invalid");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    if (input !== null) inputNode.focus();
    else confirmButton.focus();
  });
}

const confirmDialog = (options) => appDialog({ ...options, input: null });

function promptDialog({
  title,
  message = "",
  placeholder = "",
  type = "text",
  confirmText = "确认",
  required = true,
} = {}) {
  return appDialog({
    title,
    message,
    confirmText,
    input: { value: "", type, placeholder, required },
  });
}

function beginGenerationTask({ key, button, progress, progressText, cancel, label }) {
  const controller = new AbortController();
  const startedAt = Date.now();
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = `${label}中…`;
  progress.hidden = false;
  cancel.hidden = false;
  cancel.disabled = false;
  const timer = setInterval(() => {
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    progressText.textContent = `正在${label}，已等待 ${seconds} 秒…`;
  }, 1000);
  cancel.onclick = () => {
    if (controller.signal.aborted) return;
    cancel.disabled = true;
    progressText.textContent = `正在停止${label}…`;
    controller.abort();
  };
  state.generationControllers.set(key, controller);
  return {
    signal: controller.signal,
    finish() {
      clearInterval(timer);
      if (state.generationControllers.get(key) === controller) {
        state.generationControllers.delete(key);
      }
      progress.hidden = true;
      cancel.hidden = true;
      cancel.disabled = false;
      cancel.onclick = null;
      button.disabled = false;
      button.textContent = originalText;
    },
  };
}

function isGenerationCancelled(error, signal) {
  return Boolean(signal?.aborted) || error?.name === "AbortError";
}

function switchView(view) {
  if (view !== "paper") clearPaperMockTimers();
  if (view !== "materials" && materialState.focus) {
    materialState.focus = false;
    applyMaterialReaderState();
  }
  document
    .querySelectorAll(".view")
    .forEach((item) =>
      item.classList.toggle("active", item.id === `${view}-view`),
    );
  document
    .querySelectorAll(".nav-button")
    .forEach((item) =>
      item.classList.toggle("active", item.dataset.view === view),
    );
  // 视图同步到 URL：#wiki 这类链接可直达、刷新后停留在原视图。
  if (window.location.hash !== `#${view}`) {
    history.replaceState(null, "", `#${view}`);
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (view === "home") {
    loadActiveSession();
    loadStudyQueue();
    loadLearningPath();
  }
  if (view === "mock") loadMock();
  if (view === "wrong") loadWrong();
  if (view === "history") loadHistory();
  if (view === "case") loadCases();
  if (view === "paper") loadPapers();
  if (view === "wiki") loadWiki();
  if (view === "materials") loadMaterials();
  if (view === "bank") prepareQuestionBank();
  if (view === "stats") loadStatistics();
  if (view === "data") {
    loadDataStatus();
    loadContentHealth();
    loadQuestionIssues();
    loadAuditLog();
  }
  if (view === "agents") {
    if (state.modelWorkspaceLoaded) renderModelWorkspace();
    else loadModelConfig();
  }
}

function renderChapters() {
  const options = state.chapters.map((chapter) =>
    element("option", {
      text: `第 ${chapter.id} 章　${chapter.title} · ${chapter.counts.all} 道已审校`,
      attrs: { value: chapter.id },
    }),
  );
  $("#chapter").replaceChildren(...options);
  const cards = state.chapters.map((chapter) => {
    const available = chapter.source === "mindmap";
    return element(
      "div",
      {
        className: `chapter-card ${available ? "available" : "empty"}`,
      },
      [
        element("strong", { text: `第 ${chapter.id} 章` }),
        element("span", {
          text: available
            ? `${chapter.title} · ${chapter.counts.all} 道已审校可练${chapter.reviewCounts?.pendingReview ? ` · ${chapter.reviewCounts.pendingReview} 道待审校` : ""}${chapter.reviewCounts?.quarantined ? ` · ${chapter.reviewCounts.quarantined} 道隔离` : ""}`
            : `${chapter.title} · 尚未整理`,
        }),
      ],
    );
  });
  $("#coverage").replaceChildren(...cards);
  const onboarding = $("#bank-onboarding");
  onboarding.hidden = state.chapters.some((chapter) => (chapter.counts?.all ?? 0) > 0);
  if (!onboarding.hidden) onboarding.replaceChildren(...bankOnboardingNode());
  updateAvailability();
}

function selectedChapter() {
  return state.chapterMap.get(Number($("#chapter").value));
}

function selectedScope() {
  const chapter = selectedChapter();
  const sectionId = $("#section").value;
  return sectionId === "all" ? chapter : state.sectionMap.get(sectionId);
}

async function loadSections() {
  const chapter = selectedChapter();
  if (!chapter) return;
  try {
    const data = await api(`/api/sections?chapter=${chapter.id}`);
    state.sectionMap = new Map(
      data.sections.map((section) => [section.id, section]),
    );
    const options = [
      element("option", { text: "整章练习", attrs: { value: "all" } }),
      ...data.sections.map((section) =>
        element("option", {
          text: `${section.title} · ${section.counts.all} 道已审校${section.reviewCounts?.pendingReview ? ` · ${section.reviewCounts.pendingReview} 待审校` : ""}`,
          attrs: { value: section.id },
        }),
      ),
    ];
    $("#section").replaceChildren(...options);
    updateAvailability();
  } catch (error) {
    showToast(error.message, true);
  }
}

function updateAvailability() {
  const chapter = selectedChapter();
  if (!chapter) return;
  const scope = selectedScope();
  const mapped = chapter.source === "mindmap";
  const difficulty = $("#difficulty").value;
  const count =
    difficulty === "mixed"
      ? (scope?.counts.all ?? 0)
      : (scope?.counts[difficulty] ?? 0);
  let availability;
  if (!mapped) availability = "尚未整理思维导图";
  else if (count) availability = `${count} 道已审校可用（新增题目自动防重）${scope?.reviewCounts?.pendingReview ? ` · 另有 ${scope.reviewCounts.pendingReview} 道待审校` : ""}`;
  else if (scope?.reviewCounts?.pendingReview) availability = `0 道已审校可用 · ${scope.reviewCounts.pendingReview} 道待审校（暂不可用于正式练习）`;
  else if (scope?.reviewCounts?.quarantined) availability = `当前难度没有已审校题 · ${scope.reviewCounts.quarantined} 道已隔离`;
  else availability = "导图已就绪，当前难度尚无题目";
  $("#availability").textContent = availability;
  let actionText;
  if (state.generationRetry) actionText = "重试生成";
  else if (count) actionText = "补充 Agent 题目";
  else actionText = scope?.reviewCounts?.pendingReview
    ? "补充生成候选题（生成后需审校）"
    : "根据当前章节导图生成候选题（需审校后使用）";
  $("#generate-button").textContent = actionText;
  $("#generate-button").disabled = !mapped;
  $("#start-practice-button").disabled = !mapped || !count;
}

function reportButtonNode(questionId) {
  const button = element("button", {
    className: "small-button report-button",
    text: "标记题目有误",
    attrs: { type: "button" },
  });
  button.addEventListener("click", () => reportQuestion(questionId, button));
  return button;
}

async function reportQuestion(questionId, button) {
  const note = await promptDialog({
    title: "标记题目有误",
    message: "请简要说明问题（例如：答案错误、解析不一致、题目重复）。",
    placeholder: "问题描述",
    required: false,
    confirmText: "标记有误",
  });
  if (note === null) return;
  try {
    await api(`/api/questions/${encodeURIComponent(questionId)}/report`, {
      method: "POST",
      body: JSON.stringify({ note }),
    });
    button.disabled = true;
    button.textContent = "已标记，不再出题";
    showToast("已标记问题题目，后续普通练习不会再选入");
    await loadDataStatus();
  } catch (error) {
    showToast(error.message, true);
  }
}

function optionNode(question, key, value) {
  const input = element("input", {
    attrs: { type: "radio", name: question.id, value: key },
  });
  if (state.answers[question.id] === key) input.checked = true;
  // 练习模式下已判题或判题中的选项锁定；模拟考试可随时改答案。
  const locked =
    state.session?.mode !== "exam-mcq" &&
    (state.checks[question.id] || state.pendingChecks.has(question.id));
  if (locked) input.disabled = true;
  return element("label", { className: "option" }, [
    input,
    element("span", { className: "option-key", text: key }),
    element("span", { text: value }),
  ]);
}

function figureNode(item) {
  const html = renderQuestionFigure(item?.figure, item?.figureMissing);
  if (!html) return null;
  const holder = document.createElement("div");
  holder.className = "question-figure";
  holder.innerHTML = html;
  return holder;
}

function aiAnalysisNode(text) {
  if (!text) return null;
  return element("div", { className: "analysis ai-analysis" }, [
    element("h4", { text: "补充解析" }),
    element("p", { text }),
  ]);
}

function currentQuestion() {
  return state.session?.questions[state.currentIndex];
}

const CONFIDENCE_LEVELS = [
  { value: 1, name: "猜测" },
  { value: 2, name: "大概" },
  { value: 3, name: "确定" },
];

// 置信度选择(答题前):"自信地错=误解,心虚地错=没掌握",是单人场景最好的错因分类信号。
function confidenceNode(question) {
  if (state.session?.mode === "exam-mcq") return null;
  if (state.answers[question.id]) return null;
  const current = state.confidenceByQuestion[question.id];
  const row = element("div", { className: "confidence-row" }, [
    element("span", { className: "confidence-label", text: "把握程度" }),
    ...CONFIDENCE_LEVELS.map((level) => {
      const chip = element("button", {
        className: `confidence-chip${current === level.value ? " active" : ""}`,
        attrs: { type: "button", "aria-pressed": String(current === level.value) },
      }, [
        element("kbd", { text: String(level.value) }),
        element("span", { text: level.name }),
      ]);
      chip.addEventListener("click", () => {
        state.confidenceByQuestion[question.id] =
          state.confidenceByQuestion[question.id] === level.value ? null : level.value;
        renderCurrentQuestion();
      });
      return chip;
    }),
  ]);
  return row;
}

// 复习模式的四档调度预览:选择自评档位,FSRS 据此计算下一次间隔。
function scheduleNode(schedule) {
  if (!schedule?.grades?.length) return null;
  const row = element("div", { className: "schedule-row" });
  for (const grade of schedule.grades) {
    const active = (state.ratings[currentQuestion()?.id] ?? null) === grade.grade;
    const button = element("button", {
      className: "schedule-btn",
      attrs: { type: "button", "aria-pressed": String(active) },
    }, [
      element("span", { className: "schedule-days", text: grade.intervalDays >= 1 ? `${grade.intervalDays} 天` : "今天" }),
      element("span", { className: "schedule-name", text: grade.name }),
    ]);
    button.addEventListener("click", () => {
      const question = currentQuestion();
      if (!question) return;
      state.ratings[question.id] =
        state.ratings[question.id] === grade.grade ? undefined : grade.grade;
      renderCurrentQuestion();
    });
    row.append(button);
  }
  const meta = element("p", {
    className: "muted",
    text: `自评档位决定下次复习间隔；连续答对 ${schedule.graduation} 次毕业（当前 ${schedule.currentStreak ?? 0}）`,
  });
  const wrap = element("div", {}, [element("strong", { text: "这次复习感觉如何？" }), row, meta]);
  return wrap;
}

function questionNode(question, index, total) {
  const options = Object.entries(question.options).map(([key, value]) =>
    optionNode(question, key, value),
  );
  const card = element(
    "article",
    { className: "question-card", attrs: { id: `question-${question.id}` } },
    [
      element("div", { className: "question-top" }, [
        element("span", {
          className: "question-number",
          text: `${String(index + 1).padStart(2, "0")} / ${total}`,
        }),
        element("span", {
          className: "difficulty",
          text: difficultyNames[question.difficulty] || question.difficulty,
        }),
      ]),
      element("div", { className: "question-text", text: question.question }),
      answerTrustNode(question),
      figureNode(question),
      element("div", {}, options),
      confidenceNode(question),
      element("div", { className: "question-actions" }, [
        reportButtonNode(question.id),
      ]),
    ],
  );
  const checked = state.checks[question.id];
  if (checked) {
    const wrongOptionRationale =
      !checked.isCorrect && checked.optionRationale?.[checked.userAnswer]
        ? checked.optionRationale[checked.userAnswer]
        : null;
    const correctRationale = checked.optionRationale?.[checked.correctAnswer];
    const feedback = element(
      "div",
      {
        className: `current-feedback ${checked.isCorrect ? "correct" : "incorrect"}`,
      },
      [
        element("strong", {
          text: checked.isCorrect ? "✓ 回答正确" : "× 回答错误",
        }),
        element("span", {
          text: checked.isCorrect
            ? "继续保持，可以进入下一题。"
            : `正确答案：${checked.correctAnswer}`,
        }),
        wrongOptionRationale
          ? element("p", { text: `你选的 ${checked.userAnswer}：${wrongOptionRationale}` })
          : null,
        !checked.isCorrect && correctRationale
          ? element("p", { text: `正确项 ${checked.correctAnswer}：${correctRationale}` })
          : null,
        element("p", { text: checked.analysis }),
        aiAnalysisNode(checked.aiAnalysis),
        questionReviewNoteNode(question),
        sourceNodeNode(question.sourceNode),
        state.session?.mode === "review" && checked.isCorrect
          ? scheduleNode(checked.schedule)
          : null,
      ].filter(Boolean),
    );
    card.append(feedback);
  }
  return card;
}
function renderAnswerSheet() {
  const questions = state.session.questions;
  const examMode = state.session?.mode === "exam-mcq";
  const items = questions.map((question, index) => {
    const checked = state.checks[question.id];
    let className = "sheet-item";
    if (index === state.currentIndex) className += " current";
    if (state.answers[question.id]) className += " answered";
    // 模拟考试交卷前答题卡只标已答，不透露对错。
    if (checked && !examMode)
      className += checked.isCorrect ? " correct" : " incorrect";
    const item = element("button", {
      className,
      text: index + 1,
      attrs: { type: "button", "aria-label": `第 ${index + 1} 题` },
    });
    item.addEventListener("click", () => {
      state.currentIndex = index;
      renderCurrentQuestion();
    });
    return item;
  });
  $("#answer-sheet-items").replaceChildren(...items);
  const answered = Object.keys(state.answers).length;
  $("#sheet-summary").textContent = `${answered}/${questions.length}`;
  $("#answer-progress").textContent = `${answered}/${questions.length}`;
}

function renderCurrentQuestion() {
  const question = currentQuestion();
  if (!question) return;
  $("#current-question").replaceChildren(
    questionNode(question, state.currentIndex, state.session.questions.length),
  );
  $("#question-position").textContent =
    `${state.currentIndex + 1} / ${state.session.questions.length}`;
  $("#previous-question").disabled = state.currentIndex === 0;
  $("#next-question").disabled =
    state.currentIndex === state.session.questions.length - 1;
  $("#current-question")
    .querySelectorAll("input")
    .forEach((input) =>
      input.addEventListener("change", () => {
        if (state.session?.mode === "exam-mcq") saveExamAnswer(input.value);
        else checkCurrentAnswer(input.value);
      }),
    );
  renderAnswerSheet();
}

// 模拟考试作答：只保存答案，不返回任何反馈。
async function saveExamAnswer(answer) {
  const question = currentQuestion();
  if (!question) return;
  const previous = state.answers[question.id];
  const queueKey = `${state.session.id}:${question.id}`;
  const revision = (state.examAnswerRevisions.get(queueKey) || 0) + 1;
  state.examAnswerRevisions.set(queueKey, revision);
  state.answers[question.id] = answer;
  $("#submit-hint").textContent = "答案已保存；模拟考试可随时修改答案";
  renderCurrentQuestion();
  const previousRequest = state.examSaveQueues.get(queueKey) || Promise.resolve();
  const request = previousRequest.catch(() => {}).then(() => api("/api/exam-answers", {
      method: "POST",
      body: JSON.stringify({
        sessionId: state.session.id,
        questionId: question.id,
        answer,
        revision,
      }),
    }));
  state.examSaveQueues.set(queueKey, request);
  try {
    const result = await request;
    if (result.revision > revision) {
      state.examAnswerRevisions.set(queueKey, result.revision);
    }
  } catch (error) {
    // 保存失败时回滚本地选择，避免界面与判卷用的服务端答案不一致。
    if (state.examAnswerRevisions.get(queueKey) === revision) {
      if (previous === undefined) delete state.answers[question.id];
      else state.answers[question.id] = previous;
      showToast(error.message, true);
      renderCurrentQuestion();
    }
  } finally {
    if (state.examSaveQueues.get(queueKey) === request) {
      state.examSaveQueues.delete(queueKey);
    }
  }
}

async function checkCurrentAnswer(answer) {
  const question = currentQuestion();
  if (state.checks[question.id] || state.pendingChecks.has(question.id)) return;
  state.answers[question.id] = answer;
  state.pendingChecks.add(question.id);
  renderCurrentQuestion();
  try {
    state.checks[question.id] = await api("/api/check-answer", {
      method: "POST",
      body: JSON.stringify({
        sessionId: state.session.id,
        questionId: question.id,
        answer,
        confidence: state.confidenceByQuestion[question.id] ?? null,
      }),
    });
    $("#submit-hint").textContent = "答案已锁定；请继续作答或提交整套练习";
    $("#current-question")
      .querySelector(".current-feedback")
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  } catch (error) {
    delete state.answers[question.id];
    showToast(error.message, true);
  } finally {
    state.pendingChecks.delete(question.id);
    renderCurrentQuestion();
  }
}

function renderQuestions({ restore = false } = {}) {
  const questions = state.session.questions;
  if (restore) {
    const firstUnanswered = questions.findIndex(
      (question) => !state.answers[question.id],
    );
    state.currentIndex = firstUnanswered === -1 ? 0 : firstUnanswered;
  } else {
    state.currentIndex = 0;
    state.answers = {};
    state.checks = {};
    state.ratings = {};
    state.confidenceByQuestion = {};
    state.pendingChecks.clear();
  }
  let title = `第 ${state.session.chapter} 章练习`;
  if (state.session.section)
    title = `第 ${state.session.chapter} 章 · ${state.session.section} 练习`;
  if (state.session.mode === "review") title = "错题回顾";
  if (state.session.mode === "exam-mcq") title = examSessionTitle(state.session);
  $("#practice-title").textContent = title;
  $("#practice-meta").textContent =
    state.session.mode === "review"
      ? "间隔回顾 · 错题本"
      : state.session.mode === "exam-mcq"
        ? state.session.continuousMode
          ? `${state.session.term || "当前考期"} · 240 分钟连考 · 综合知识阶段`
          : state.session.term
            ? `${state.session.term} · 按题号组卷 · 交卷统一判分`
            : "模拟考试 · 跨章抽题 · 交卷统一判分"
        : `系统架构设计师 · ${difficultyNames[state.session.difficulty]}难度`;
  $("#submit-hint").textContent =
    state.session.mode === "exam-mcq"
      ? state.session.continuousMode
        ? "连考第一阶段：综合知识 75 题，至少进行 120 分钟后才能手动交卷，150 分钟到时自动交卷并衔接案例分析。"
        : `共 ${questions.length} 道题，可随时修改答案，交卷后统一判分`
      : `已加载 ${questions.length} 道题，选择答案后立即判题`;
  setupExamCountdown();
  renderCurrentQuestion();
}

// 模拟考试倒计时：基于服务端 startedAt 计算，刷新安全；归零自动交卷。
function setupExamCountdown() {
  clearInterval(state.examTimer);
  state.examTimer = null;
  const countdown = $("#exam-countdown");
  const label = $("#exam-countdown-label");
  const session = state.session;
  if (session?.mode !== "exam-mcq" || !session.durationSeconds) {
    countdown.hidden = true;
    label.hidden = true;
    state.examDeadline = null;
    return;
  }
  state.examDeadline =
    new Date(session.startedAt).getTime() + session.durationSeconds * 1000;
  countdown.hidden = false;
  label.hidden = false;
  label.textContent = session.continuousMode
    ? "连考第一阶段 · 至少 120 分钟 / 最多 150 分钟"
    : "剩余时间";
  const tick = () => {
    const remaining = Math.max(
      0,
      Math.round((state.examDeadline - Date.now()) / 1000),
    );
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    countdown.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    countdown.classList.toggle("urgent", remaining <= 300);
    if (remaining === 0) {
      clearInterval(state.examTimer);
      state.examTimer = null;
      showToast("考试时间到，自动交卷");
      submitPractice(null, { auto: true });
    }
  };
  tick();
  state.examTimer = setInterval(tick, 1000);
}

async function loadActiveSession() {
  try {
    const data = await api("/api/sessions/active");
    state.activeSession = data.session;
    const panel = $("#resume-panel");
    panel.hidden = !data.session;
    if (!data.session) return;
    const answered = Object.keys(data.session.answers ?? {}).length;
    let scope = `第 ${data.session.chapter} 章`;
    if (data.session.section) scope += ` · ${data.session.section}`;
    if (data.session.mode === "review") scope = "错题回顾";
    if (data.session.mode === "learning-reinforcement") scope = "知识点巩固";
    if (data.session.mode === "exam-mcq") scope = examSessionTitle(data.session);
    $("#resume-title").textContent = scope;
    if ($("#home-view")?.classList.contains("active")) loadStudyQueue();
    $("#resume-meta").textContent =
      `${answered}/${data.session.total} 道已作答 · 创建于 ${new Date(data.session.createdAt).toLocaleString("zh-CN")}`;
  } catch (error) {
    showToast(error.message, true);
  }
}

function setReviewActionState(due) {
  state.dueCount = Math.max(0, Number(due) || 0);
  const disabled = state.dueCount === 0;
  for (const selector of ["#start-review", "#review-all"]) {
    const button = $(selector);
    if (!button) continue;
    button.disabled = disabled;
    button.textContent = disabled
      ? "暂无到期题"
      : selector === "#review-all"
        ? "回顾未掌握错题"
        : "开始回顾";
  }
}

function renderLearningPath(data) {
  const panel = $("#learning-path");
  const body = $("#learning-body");
  if (!panel || !body) return;
  panel.hidden = !data.current;
  $("#learning-position").textContent = data.current ? data.position : "体系已学完";
  const bar = $("#learning-progress span");
  if (bar) bar.style.width = Math.max(0, Math.min(100, Number(data.percent) || 0)) + "%";
  if (!data.current) {
    body.replaceChildren(element("p", { className: "muted", text: "第一轮系统学习已完成。接下来以巩固、案例、论文和模考为主。" }));
    return;
  }
  const unit = data.current;
  const startButton = element("button", { className: "primary", text: unit.status === "learning" ? "继续学习" : "开始学习", attrs: { type: "button" } });
  startButton.addEventListener("click", async () => {
    startButton.disabled = true;
    try { renderLearningPath(await api("/api/learning/start", { method: "POST", body: JSON.stringify({ unitId: unit.id }) })); loadStudyQueue(); }
    catch (error) { showToast(error.message, true); } finally { startButton.disabled = false; }
  });
  const completeButton = element("button", { className: "secondary", text: "完成自检并进入精准巩固", attrs: { type: "button" } });
  completeButton.addEventListener("click", async () => {
    const incompleteChecks = (unit.selfChecks ?? []).filter((check) => !check.completed);
    if (incompleteChecks.length) {
      showToast(`请先完成本节的 ${incompleteChecks.length} 项自检。能够独立解释后再推进学习进度。`, true);
      body.querySelector(".learning-check-list input:not(:checked)")?.focus();
      return;
    }
    completeButton.disabled = true;
    try {
      const reinforcement = await api(`/api/learning-reinforcement?unitId=${encodeURIComponent(unit.id)}&limit=5`);
      const next = await api("/api/learning/complete", { method: "POST", body: JSON.stringify({ unitId: unit.id, confidence: 2 }) });
      renderLearningPath(next);
      loadStudyQueue();
      if (!reinforcement.count) {
        showToast("已记录本节阅读完成；当前没有知识点精准匹配且已审校的题目，不会用其他章节题目代替。请结合教材自检，题目补齐后再进行巩固。");
        return;
      }
      state.session = await api("/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          chapter: unit.chapter,
          section: unit.sectionId,
          difficulty: "mixed",
          count: reinforcement.count,
          questionIds: reinforcement.questions.map((question) => question.id),
          mode: "learning-reinforcement",
        }),
      });
      resetExamSaveState(state.session);
      state.activeSession = null;
      $("#resume-panel").hidden = true;
      renderQuestions();
      switchView("practice");
      showToast(`已进入“${reinforcement.unitTitle}”知识点巩固：${reinforcement.count} 题。`);
    } catch (error) { showToast(error.message, true); } finally { completeButton.disabled = false; }
  });
  const topic = (heading, content, className = "") => content
    ? element("section", { className: `learning-topic ${className}`.trim() }, [
        element("h3", { text: heading }),
        element("p", { text: content }),
      ])
    : null;
  const evidenceNodes = (unit.evidence ?? []).map((item) => {
    const href = safeHttpUrl(item.url);
    return element("li", { className: "learning-evidence-item" }, [
      href
        ? element("a", { text: item.sourceTitle || item.url, attrs: { href, target: "_blank", rel: "noopener noreferrer" } })
        : element("strong", { text: item.sourceTitle || "未提供可打开的来源链接" }),
      item.sourceAuthority ? element("p", { text: "来源：" + item.sourceAuthority }) : null,
      item.supportedClaim ? element("p", { text: "支持范围：" + item.supportedClaim }) : null,
      item.scope ? element("p", { text: "边界说明：" + item.scope }) : null,
      item.reviewStatus || item.reviewedOn
        ? element("small", { text: [item.reviewStatus, item.reviewedOn].filter(Boolean).join(" · ") })
        : null,
    ]);
  });
  const lessonContext = [];
  if (unit.prerequisites?.length) lessonContext.push(element("div", {}, [
    element("strong", { text: "前置知识" }),
    element("p", { text: unit.prerequisites.join("；") }),
  ]));
  if (unit.keyRelations?.length) lessonContext.push(element("div", {}, [
    element("strong", { text: "关联主题" }),
    element("p", { text: unit.keyRelations.join("；") }),
  ]));
  if (unit.practiceFocus?.length) lessonContext.push(element("div", {}, [
    element("strong", { text: "训练关注" }),
    element("p", { text: unit.practiceFocus.join("；") }),
  ]));
  body.replaceChildren(
    element("div", { className: "learning-meta" }, [
      element("span", { className: "learning-chapter-chip", text: "第 " + unit.chapter + " 章 · " + unit.chapterTitle }),
      element("span", { className: "learning-section-title", text: unit.sourceTitle }),
    ]),
    element("div", { className: "learning-content" }, [
      element("section", { className: "learning-topic learning-topic-primary" }, [
        element("span", { className: "learning-topic-index", text: "01" }),
        element("div", {}, [element("h3", { text: "这节先学什么" }), element("p", { text: unit.coreKnowledge })]),
      ]),
      topic("为什么要学习", unit.teaching?.why),
      topic("核心机制与方法", unit.teaching?.how),
      learningVisualizerNode(unit, element),
      topic("应用场景", unit.teaching?.scenarios),
      topic("例子与演练", unit.teaching?.examples),
      topic("考试关注点", unit.examFocus, "learning-topic-exam"),
      topic("容易混淆的概念", unit.teaching?.confusions || unit.commonConfusions),
      topic("常见陷阱", unit.teaching?.pitfalls),
      lessonContext.length ? element("section", { className: "learning-topic learning-lesson-context" }, [
        element("h3", { text: "学习导航" }),
        ...lessonContext,
      ]) : null,
      evidenceNodes.length ? element("details", { className: "learning-topic learning-evidence" }, [
        element("summary", { text: `资料依据与核验边界（${evidenceNodes.length}）` }),
        element("ul", { className: "learning-evidence-list" }, evidenceNodes),
      ]) : element("section", { className: "learning-topic learning-evidence-missing" }, [
        element("h3", { text: "资料依据" }),
        element("p", { text: "当前单元没有登记可追溯的资料依据。请以指定版本教材和官方资料复核，不要仅凭本页面记忆。" }),
      ]),
      element("section", { className: "learning-checks" }, [
        element("div", { className: "learning-checks-heading" }, [element("div", {}, [element("h3", { text: "学完自检" }), element("p", { text: "勾选你已经能独立解释的知识点" })]), element("span", { className: "learning-checks-count", text: (unit.selfChecks ?? []).filter((check) => check.completed).length + " / " + (unit.selfChecks ?? []).length })]),
        element("ul", { className: "learning-check-list" }, (unit.selfChecks ?? []).map((check) => {
          const checkbox = element("input", { attrs: { type: "checkbox", "aria-label": check.prompt } });
          checkbox.checked = Boolean(check.completed);
          checkbox.addEventListener("change", async () => {
            checkbox.disabled = true;
            try { renderLearningPath(await api("/api/learning/check", { method: "POST", body: JSON.stringify({ unitId: unit.id, checkId: check.id, completed: checkbox.checked }) })); }
            catch (error) { checkbox.checked = !checkbox.checked; showToast(error.message, true); }
            finally { checkbox.disabled = false; }
          });
          return element("li", { className: check.completed ? "is-complete" : "" }, [checkbox, element("span", { text: check.prompt })]);
        })),
      ]),
      element("div", { className: "learning-content-status" }, [element("span", { className: "status-dot", attrs: { "aria-hidden": "true" } }), element("span", { text: "课程内容状态：" + (unit.contentStatus === "verified" ? "已核验" : unit.contentStatus === "partial" ? "部分核验，仍需教材复核" : "待补充与核验") })]),
    ]),
    element("div", { className: "learning-actions" }, [startButton, completeButton]),
    element("p", { className: "muted learning-disclaimer", text: data.disclaimer }),
  );
}

async function loadLearningPath() {
  try { renderLearningPath(await api("/api/learning-plan")); } catch (error) { showToast(error.message, true); }
}

function studyQueueActionButton(item, label = "开始") {
  const button = element("button", {
    className: "primary",
    text: label,
    attrs: { type: "button" },
  });
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await runStudyQueueAction(item.action);
    } catch (error) {
      showToast(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  return button;
}

async function runStudyQueueAction(action) {
  if (!action) return;
  if (action.type === "resume-session") {
    if (state.activeSession?.id !== action.sessionId) await loadActiveSession();
    if (state.activeSession?.id !== action.sessionId) {
      throw new Error("未找到可恢复的练习会话");
    }
    resumeActiveSession();
    return;
  }
  if (action.type === "start-review") {
    await startReview(action.limit);
    return;
  }
  if (action.type === "start-learning") {
    switchView("home");
    await loadLearningPath();
    document.querySelector("#learning-path")?.scrollIntoView({ behavior: "smooth" });
    return;
  }
  if (action.type === "start-practice") {
    switchView("home");
    $("#chapter").value = String(action.chapter);
    await loadSections();
    $("#section").value = action.section || "all";
    $("#difficulty").value = action.difficulty || "mixed";
    $("#count").value = String(action.count || 10);
    updateAvailability();
    await startPractice();
    return;
  }
  if (action.type === "open-materials") {
    switchView("materials");
    await loadMaterials();
    const targetId = action.materialId;
    if (targetId && materialState.materials.some((item) => item.id === targetId)) {
      await openMaterial(targetId);
    }
    return;
  }
  if (action.type === "open-mock") {
    switchView("mock");
    $("#mock-exam-form")?.scrollIntoView({ behavior: "smooth" });
    return;
  }
  if (action.type === "open-bank") {
    switchView("bank");
    document.querySelector("#bank-view .page-heading")?.scrollIntoView({ behavior: "smooth" });
    return;
  }
  if (action.type === "resume-case-exam") {
    switchView("mock");
    await loadActiveCaseExam();
    $("#mock-exam-resume-button")?.click();
    return;
  }
  if (action.type === "configure-model") {
    switchView("data");
    document
      .querySelector(".model-config-panel")
      ?.scrollIntoView({ behavior: "smooth" });
    return;
  }
  if (action.type === "generate") {
    switchView("home");
    document
      .querySelector(".agent-panel")
      ?.scrollIntoView({ behavior: "smooth" });
    return;
  }
  if (action.type === "import-bank") {
    switchView("data");
    document
      .querySelector("#import-bank")
      ?.scrollIntoView({ behavior: "smooth" });
  }
}

function studyQueueItemNode(item) {
  const isSetup = item.kind === "setup";
  const actions = isSetup
    ? (item.action?.options ?? []).map((option) =>
        studyQueueActionButton({ action: option }, option.label),
      )
    : [
        studyQueueActionButton(
          item,
          item.kind === "resume-case-exam" || item.kind === "resume-session"
            ? "继续学习"
            : item.kind === "review"
              ? "开始回顾"
              : item.kind === "learning"
                ? "开始学习"
                : "开始练习",
        ),
      ];
  return element("article", { className: "study-queue-item" }, [
    element("div", { className: "study-queue-item-copy" }, [
      element("strong", { text: item.title }),
      element("span", { text: item.description }),
    ]),
    element("div", { className: "study-queue-item-actions" }, actions),
  ]);
}

function renderStudyQueue(data) {
  const panel = $("#study-queue");
  const body = $("#study-queue-body");
  if (!panel || !body) return;
  panel.hidden = false;
  $("#study-queue-status").textContent = data.next
    ? "按优先级排列"
    : "暂无安排";
  body.replaceChildren(
    ...(data.items?.length
      ? data.items.map(studyQueueItemNode)
      : [
          emptyMessage(
            "当前没有可执行安排",
            "完成一次练习后，这里会给出下一步。",
          ),
        ]),
  );
}

async function loadStudyQueue() {
  const load = beginLoad("study-queue", "#study-queue-body", "正在整理下一步…");
  try {
    const data = await api("/api/study-queue?limit=5");
    if (!load.isCurrent()) return;
    setReviewActionState(data.counts?.dueReviews ?? 0);
    renderStudyQueue(data);
    load.finish();
  } catch (error) {
    load.fail(error, loadStudyQueue);
  }
}

function resumeActiveSession() {
  if (!state.activeSession) return;
  state.session = state.activeSession;
  resetExamSaveState(state.session);
  state.answers = { ...(state.activeSession.answers ?? {}) };
  state.checks = { ...(state.activeSession.checks ?? {}) };
  state.pendingChecks.clear();
  renderQuestions({ restore: true });
  switchView("practice");
}

async function abandonActiveSession() {
  if (!state.activeSession) return;
  if (
    !(await confirmDialog({
      title: "放弃未完成练习",
      message: "确认放弃这次未完成练习？已作答进度不会计入成绩。",
      confirmText: "放弃",
      danger: true,
    }))
  )
    return;
  try {
    await api(`/api/sessions/${encodeURIComponent(state.activeSession.id)}`, {
      method: "DELETE",
    });
    resetExamSaveState(state.session);
    state.activeSession = null;
    $("#resume-panel").hidden = true;
    showToast("已放弃未完成练习");
  } catch (error) {
    showToast(error.message, true);
  }
}

async function startPractice(event) {
  event?.preventDefault();
  try {
    state.session = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({
        chapter: $("#chapter").value,
        section: $("#section").value,
        difficulty: $("#difficulty").value,
        count: $("#count").value,
      }),
    });
    resetExamSaveState(state.session);
    state.activeSession = null;
    $("#resume-panel").hidden = true;
    renderQuestions();
    switchView("practice");
  } catch (error) {
    showToast(error.message, true);
  }
}

async function generateQuestions() {
  const button = $("#generate-button");
  const progress = $("#generate-progress");
  const progressText = $("#generate-progress-text");
  const task = beginGenerationTask({
    key: "questions",
    button,
    progress,
    progressText,
    cancel: $("#generate-cancel"),
    label: "生成题目",
  });
  state.generationRetry = false;
  try {
    const chapterId = $("#chapter").value;
    const sectionId = $("#section").value;
    const difficulty =
      $("#difficulty").value === "mixed" ? "medium" : $("#difficulty").value;
    const result = await api("/api/generate", {
      method: "POST",
      body: JSON.stringify({
        chapter: chapterId,
        section: sectionId,
        difficulty,
        count: $("#count").value,
        model: $("#model-select").value || undefined,
      }),
      signal: task.signal,
      timeoutMs: LONG_API_TIMEOUT_MS,
    });
    const duplicateSummary = result.duplicatesSkipped
      ? `，已过滤 ${result.duplicatesSkipped} 道重复题`
      : "";
    const completionSummary =
      result.complete === false
        ? `；本次实际补充 ${result.added}/${result.requested} 道`
        : "";
    showToast(
      `已根据思维导图生成 ${result.added} 道题${duplicateSummary}${completionSummary}，正在刷新题库`,
    );
    await loadChapters();
    $("#chapter").value = chapterId;
    await loadSections();
    $("#section").value = sectionId;
    $("#difficulty").value = difficulty;
    updateAvailability();
  } catch (error) {
    if (isGenerationCancelled(error, task.signal)) {
      state.generationRetry = false;
      showToast("已停止生成题目");
      return;
    }
    state.generationRetry = true;
    showToast(error.message, true);
  } finally {
    task.finish();
    updateAvailability();
  }
}

function goToQuestion(index) {
  if (!state.session) return;
  state.currentIndex = Math.max(
    0,
    Math.min(index, state.session.questions.length - 1),
  );
  renderCurrentQuestion();
}

async function submitPractice(event, { auto = false } = {}) {
  event?.preventDefault();
  if (!state.session || state.submittingPractice) return;
  const examMode = state.session.mode === "exam-mcq";
  const examSession = state.session;
  if (examMode && examSession.continuousMode && !auto) {
    const elapsedSeconds = Math.max(0, (Date.now() - new Date(examSession.startedAt).getTime()) / 1000);
    const minimumSeconds = 120 * 60;
    if (elapsedSeconds < minimumSeconds) {
      const remaining = Math.ceil((minimumSeconds - elapsedSeconds) / 60);
      showToast(`连考模式的综合知识阶段至少进行 120 分钟，还需 ${remaining} 分钟后才能交卷并进入案例阶段。`, true);
      return;
    }
  }
  const unanswered = state.session.questions.length - Object.keys(state.answers).length;
  const message = examMode
    ? unanswered
      ? `还有 ${unanswered} 题未作答，交卷后统一判分且不能重考。确认交卷？`
      : "交卷后统一判分，且本次模拟不能再次提交。确认交卷？"
    : "提交后将显示答案与解析，且本次练习不能再次提交。确认提交？";
  if (
    !auto &&
    !(await confirmDialog({
      title: examMode ? "交卷确认" : "提交确认",
      message,
      confirmText: examMode ? "交卷" : "提交并判卷",
    }))
  )
    return;
  state.submittingPractice = true;
  const submitButton = $("#questions-form button[type=submit]");
  const originalSubmitText = submitButton?.textContent || "提交并判卷";
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = auto ? "时间到，判卷中…" : "判卷中…";
  }
  if (examMode) {
    clearInterval(state.examTimer);
    state.examTimer = null;
  }
  try {
    if (examMode && state.examSaveQueues.size) {
      await Promise.allSettled([...state.examSaveQueues.values()]);
    }
    state.result = await api("/api/grade", {
      method: "POST",
      body: JSON.stringify({
        sessionId: state.session.id,
        answers: state.answers,
        ratings: Object.fromEntries(
          Object.entries(state.ratings).filter(([, grade]) => grade != null),
        ),
      }),
      timeoutMs: LONG_API_TIMEOUT_MS,
    });
    state.activeSession = null;
    if (examMode && examSession.continuousMode) {
      state.session = null;
      state.pendingContinuousExam = {
        sessionId: examSession.id,
        term: examSession.term,
        sourceType: examSession.sourceType,
        choiceResult: {
          correct: state.result.correct,
          total: state.result.total,
          percentage: state.result.percentage,
        },
      };
      switchView("mock");
      await continueContinuousExam(state.pendingContinuousExam);
      refreshReviewBadge();
      return;
    }
    renderResult();
    switchView("result");
    refreshReviewBadge();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    state.submittingPractice = false;
    if (submitButton?.isConnected) {
      submitButton.disabled = false;
      submitButton.textContent = originalSubmitText;
    }
  }
}

function resultStatus(detail) {
  if (detail.isCorrect) return "✓ 正确";
  if (detail.userAnswer) return "× 错误";
  return "— 未作答";
}

// 复盘的逐选项分解:正确项与错选项高亮,并展示生成时的选项级归因。
function optionReviewList(detail) {
  if (!detail.options) return null;
  const rows = Object.entries(detail.options).map(([key, value]) => {
    const isCorrect = key === detail.correctAnswer;
    const isChosen = key === detail.userAnswer;
    let className = "option-review";
    if (isCorrect) className += " is-correct";
    else if (isChosen) className += " is-wrong";
    const marks = [key];
    if (isChosen && !isCorrect) marks.push("你的选择");
    if (isCorrect) marks.push("正确答案");
    const rationale = detail.optionRationale?.[key];
    return element("div", { className }, [
      element("span", {
        className: "option-mark",
        text: `${isCorrect ? "✓" : isChosen ? "✗" : "·"} ${marks.join(" · ")}`,
      }),
      element("span", { text: value }),
      rationale
        ? element("span", { className: "option-rationale", text: rationale })
        : null,
    ].filter(Boolean));
  });
  return element("div", { className: "option-review-list" }, rows);
}

function resultDetailNode(detail, index) {
  const analysisChildren = [
    element("h4", { text: `解析 · ${detail.knowledgePoint}` }),
    element("p", { text: detail.analysis }),
  ];
  if (detail.knowledgeDetail) {
    analysisChildren.push(
      element("div", { className: "knowledge-detail" }, [
        element("h5", { text: "考点详解" }),
        element("p", { text: detail.knowledgeDetail }),
      ]),
    );
  }
  if (detail.sourceNode)
    analysisChildren.push(sourceNodeNode(detail.sourceNode));
  if (detail.commonMistake)
    analysisChildren.push(
      element("div", {
        className: "tip",
        text: `常见错误：${detail.commonMistake}`,
      }),
    );
  if (detail.memoryTip)
    analysisChildren.push(
      element("div", {
        className: "tip",
        text: `记忆提示：${detail.memoryTip}`,
      }),
    );
  analysisChildren.push(aiAnalysisNode(detail.aiAnalysis));
  const mainChildren = [
    element("div", {}, [
      element("span", {
        className: "result-status",
        text: resultStatus(detail),
      }),
      element("span", {
        className: "question-number",
        text: `　${String(index + 1).padStart(2, "0")}`,
      }),
    ]),
    element("div", { className: "question-text", text: detail.question }),
    answerTrustNode(detail),
    figureNode(detail),
    optionReviewList(detail) ??
      element("div", {
        className: "answer-line",
        text: `你的答案：${detail.userAnswer || "未作答"}　正确答案：${detail.correctAnswer}`,
      }),
  ];
  return element(
    "article",
    { className: `result-card ${detail.isCorrect ? "" : "incorrect"}` },
    [
      element("div", { className: "result-main" }, mainChildren),
      element("div", { className: "analysis" }, analysisChildren),
      questionReviewNoteNode(detail),
      element("div", { className: "result-actions" }, [
        reportButtonNode(detail.id),
      ]),
    ],
  );
}

function renderResult() {
  const result = state.result;
  const examMode = result.mode === "exam-mcq";
  const passed = result.percentage >= 60;
  const circle = element("div", { className: "score-circle" }, [
    element("div", {}, [
      element("strong", { text: `${result.correct}/${result.total}` }),
      element("span", { text: `${result.percentage}% 正确` }),
    ]),
  ]);
  const children = [circle];
  if (examMode) {
    children.push(
      element("span", {
        className: `pass-badge ${passed ? "pass" : "fail"}`,
        text: passed ? "通过（≥ 60%）" : "未通过（< 60%）",
      }),
    );
  }
  children.push(
    element("h1", {
      text: examMode
        ? "模拟考试完成"
        : result.mode === "review"
          ? "回顾完成"
          : "练习完成",
    }),
    element("p", {
      className: "result-summary",
      text:
        result.mode === "exam-mcq"
          ? `${result.incorrect} 道错误 · ${result.unanswered} 道未作答 · 错题已记入错题本`
          : `${result.incorrect} 道错误 · ${result.unanswered} 道未作答 · 错题已记录`,
    }),
  );
  $("#score-hero").replaceChildren(...children);
  $("#result-details").replaceChildren(...result.details.map(resultDetailNode));
}

function wrongSummaryNode(value, label) {
  return element("div", { className: "summary-item" }, [
    element("strong", { text: value }),
    element("span", { text: label }),
  ]);
}

function wrongRecordNode(record) {
  const meta = [
    `第 ${record.chapter || "—"} 章`,
    "·",
    record.knowledgePoint,
    "·",
    `错 ${record.timesWrong} 次`,
  ];
  if (record.disabledByIssue) meta.push("· 题目已停用");
  const button = element("button", {
    className: "small-button",
    text: record.disabledByIssue
      ? "题目已停用"
      : record.mastered
        ? "重新加入回顾"
        : "标记已掌握",
    attrs: {
      type: "button",
      "data-mastered": String(!record.mastered),
      "data-question-id": record.questionId,
      ...(record.disabledByIssue ? { disabled: "" } : {}),
    },
  });
  const wikiLinks = (record.wikiEntries ?? []).map(wikiLinkNode);
  return element("article", { className: "wrong-card" }, [
    element(
      "div",
      { className: "wrong-meta" },
      meta.map((text) => element("span", { text })),
    ),
    element("div", { className: "question-text", text: record.question }),
    element("div", {
      className: "answer-line",
      text: `正确答案：${record.correctAnswer}　下次回顾：${record.mastered ? "已掌握" : new Date(record.nextReviewAt).toLocaleString("zh-CN")}`,
    }),
    wikiLinks.length
      ? element("div", { className: "wiki-section" }, [
          element("h4", { text: "关联知识点" }),
          element("div", { className: "wiki-backlinks" }, wikiLinks),
        ])
      : null,
    element("div", { className: "wrong-actions" }, [
      element("span", { className: "muted", text: record.analysis }),
      sourceNodeNode(record.sourceNode),
      button,
    ]),
  ]);
}

function renderWrong(data) {
  $("#due-count").textContent = data.summary.due;
  $("#due-badge").textContent = data.summary.due;
  setReviewActionState(data.summary.due);
  $("#wrong-summary").replaceChildren(
    wrongSummaryNode(data.summary.total, "累计错题"),
    wrongSummaryNode(data.summary.active, "未掌握"),
    wrongSummaryNode(data.summary.due, "今日待回顾"),
    wrongSummaryNode(data.summary.mastered, "已掌握"),
  );
  const total = data.total ?? data.records.length;
  const pageCount = Math.max(1, Math.ceil(total / state.wrongLimit));
  const currentPage = Math.floor(state.wrongOffset / state.wrongLimit) + 1;
  $("#wrong-page").textContent = total
    ? `第 ${currentPage} / ${pageCount} 页 · 共 ${total} 道`
    : "暂无错题";
  $("#wrong-previous").disabled = state.wrongOffset === 0;
  $("#wrong-next").disabled = state.wrongOffset + state.wrongLimit >= total;
  $("#wrong-pagination").hidden = total <= state.wrongLimit;
  if (!data.records.length) {
    const empty = emptyMessage(
      "错题本还是空的",
      "完成一次章节练习，答错的题会自动出现在这里。",
    );
    empty.classList.add("panel");
    $("#wrong-list").replaceChildren(empty);
    return;
  }
  $("#wrong-list").replaceChildren(...data.records.map(wrongRecordNode));
  $("#wrong-list")
    .querySelectorAll("[data-question-id]")
    .forEach((button) =>
      button.addEventListener("click", async () => {
        try {
          await api(
            `/api/wrong-questions/${encodeURIComponent(button.dataset.questionId)}/mastered`,
            {
              method: "PATCH",
              body: JSON.stringify({
                mastered: button.dataset.mastered === "true",
              }),
            },
          );
          await loadWrong();
        } catch (error) {
          showToast(error.message, true);
        }
      }),
    );
}

async function loadWrong() {
  const load = beginLoad("wrong", "#wrong-list", "正在加载错题…");
  try {
    const data = await api(
      `/api/wrong-questions?limit=${state.wrongLimit}&offset=${state.wrongOffset}`,
    );
    if (!load.isCurrent()) return;
    if (state.wrongOffset > 0 && !data.records.length && data.total > 0) {
      state.wrongOffset = Math.max(0, state.wrongOffset - state.wrongLimit);
      return loadWrong();
    }
    state.wrongTotal = data.total;
    state.wrongRecords = data.records;
    renderWrong(data);
    load.finish();
  } catch (error) {
    load.fail(error, loadWrong);
  }
}

async function exportWrong() {
  // 导出始终取全量错题，与当前翻页位置无关。
  let records;
  try {
    records = (await api("/api/wrong-questions")).records;
  } catch (error) {
    showToast(error.message, true);
    return;
  }
  if (!records.length) {
    showToast("错题本是空的，没有可导出的内容");
    return;
  }
  const lines = records.map((record, index) => {
    const status = record.mastered ? "已掌握" : "待复习";
    const options = ["A", "B", "C", "D"]
      .map((key) => `${key}. ${record.options?.[key] ?? ""}`)
      .join("\n");
    return [
      `${index + 1}. ${record.question}`,
      options,
      `正确答案：${record.correctAnswer}`,
      `知识点：${record.knowledgePoint}`,
      `状态：${status} · 错 ${record.timesWrong} 次`,
      record.sourceNode ? `来源：${record.sourceNode}` : "",
      `解析：${record.analysis}`,
      "",
    ]
      .filter(Boolean)
      .join("\n");
  });
  const text = `软考错题本导出（${new Date().toLocaleDateString("zh-CN")}）\n共 ${records.length} 道\n\n${lines.join("\n")}`;
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `architect-wrong-${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("错题已导出");
}

async function startReview(limit = null) {
  if (!state.dueCount) {
    showToast("暂无到期错题");
    return;
  }
  try {
    state.session = await api("/api/review-sessions", {
      method: "POST",
      body: JSON.stringify({ limit: limit || $("#count").value }),
    });
    resetExamSaveState(state.session);
    state.activeSession = null;
    $("#resume-panel").hidden = true;
    renderQuestions();
    switchView("practice");
  } catch (error) {
    showToast(error.message, true);
  }
}

function historyNode(attempt) {
  let title;
  if (attempt.mode === "review") title = "错题回顾";
  else if (attempt.mode === "exam-mcq") title = examSessionTitle(attempt);
  else title = `第 ${attempt.chapter} 章 · ${difficultyNames[attempt.difficulty]}`;
  return element("div", { className: "history-row" }, [
    element("span", { text: title }),
    element("span", {
      text: new Date(attempt.gradedAt).toLocaleString("zh-CN"),
    }),
    element("span", { text: `${attempt.correct}/${attempt.total} 正确` }),
    element("strong", { text: `${attempt.percentage}%` }),
  ]);
}

async function loadHistory() {
  const load = beginLoad("history", "#history-list", "正在加载练习记录…");
  try {
    const { attempts } = await api("/api/attempts");
    if (!load.isCurrent()) return;
    $("#history-list").replaceChildren(
      ...(attempts.length
        ? attempts.map(historyNode)
        : [emptyMessage("还没有练习记录", "从首页选择一章开始第一次练习。")]),
    );
    load.finish();
  } catch (error) {
    load.fail(error, loadHistory);
  }
}

function populateBankChapters() {
  const selected = $("#bank-chapter").value;
  const options = [
    element("option", { text: "全部章节", attrs: { value: "all" } }),
    ...state.chapters.map((chapter) =>
      element("option", {
        text: `第 ${chapter.id} 章 · ${chapter.title}`,
        attrs: { value: chapter.id },
      }),
    ),
  ];
  $("#bank-chapter").replaceChildren(...options);
  if (options.some((option) => option.value === selected)) {
    $("#bank-chapter").value = selected;
  }
}

async function loadBankSections() {
  const chapter = $("#bank-chapter").value;
  const selected = $("#bank-section").value;
  const options = [
    element("option", { text: "全部小节", attrs: { value: "all" } }),
  ];
  if (chapter !== "all") {
    const data = await api(
      `/api/sections?chapter=${encodeURIComponent(chapter)}`,
    );
    options.push(
      ...data.sections.map((section) =>
        element("option", {
          text: section.title,
          attrs: { value: section.id },
        }),
      ),
    );
  }
  $("#bank-section").replaceChildren(...options);
  if (options.some((option) => option.value === selected)) {
    $("#bank-section").value = selected;
  }
}

function bankQuestionNode(question) {
  const options = Object.entries(question.options).map(([key, value]) =>
    element("li", {}, [
      element("strong", { text: `${key}. ` }),
      element("span", { text: value }),
    ]),
  );
  const statusText = question.status === "disabled" ? "问题题" : "正常";
  const statusClass = question.status === "disabled" ? " disabled" : "";
  const toggle = element("button", {
    className: "small-button",
    text: question.status === "disabled" ? "恢复到题库" : "标记有误",
    attrs: { type: "button" },
  });
  toggle.addEventListener("click", async () => {
    if (question.status === "disabled") {
      try {
        await api(`/api/questions/${encodeURIComponent(question.id)}/active`, {
          method: "PATCH",
        });
        showToast("题目已恢复到题库");
        await refreshQuestionBank();
      } catch (error) {
        showToast(error.message, true);
      }
      return;
    }
    await reportQuestion(question.id, toggle);
    await refreshQuestionBank();
  });
  const remove = element("button", {
    className: "danger-button",
    text: "永久删除",
    attrs: { type: "button" },
  });
  remove.addEventListener("click", () => deleteBankQuestion(question));
  const star = element("button", {
    className: "small-button",
    text: question.starred ? "★ 已收藏" : "☆ 收藏",
    attrs: { type: "button" },
  });
  star.addEventListener("click", async () => {
    try {
      await api(`/api/questions/${encodeURIComponent(question.id)}/star`, {
        method: "PATCH",
        body: JSON.stringify({ starred: !question.starred }),
      });
      await refreshQuestionBank();
    } catch (error) {
      showToast(error.message, true);
    }
  });
  return element("article", { className: `panel bank-card${statusClass}` }, [
    element("div", { className: "bank-card-header" }, [
      element("div", { className: "bank-tags" }, [
        element("span", { text: sourceTypeLabel(question) }),
        question.term ? element("span", { text: question.term }) : null,
        element("span", { text: `第 ${question.chapter} 章` }),
        element("span", { text: question.section || "整章" }),
        element("span", {
          text: difficultyNames[question.difficulty] || question.difficulty,
        }),
        element("span", {
          className: `bank-status${statusClass}`,
          text: statusText,
        }),
        question.difficultyFlag === "too_easy"
          ? element("span", { className: "flag-easy", text: "疑似过易" })
          : null,
        question.difficultyFlag === "too_hard"
          ? element("span", { className: "flag-hard", text: "疑似过难" })
          : null,
        question.revision > 1
          ? element("span", { text: `v${question.revision}` })
          : null,
      ].filter(Boolean)),
      element("span", {
        className: "muted",
        text: question.stats
          ? `${question.knowledgePoint} · 作答 ${question.stats.seen} 次 · 正确率 ${Math.round((question.stats.correct / question.stats.seen) * 100)}%`
          : question.knowledgePoint,
      }),
    ]),
    element("div", { className: "question-text", text: question.question }),
    answerTrustNode(question),
    figureNode(question),
    element("ol", { className: "bank-options" }, options),
    element("div", {
      className: "bank-answer",
      text: `正确答案：${question.correctAnswer}`,
    }),
    element("div", { className: "analysis" }, [
      element("h4", { text: "解析" }),
      element("p", { text: question.analysis }),
      aiAnalysisNode(question.aiAnalysis),
    ]),
    questionReviewNoteNode(question),
    sourceNodeNode(question.sourceNode),
    element(
      "div",
      { className: "bank-actions" },
      isImportedItem(question)
        ? [star, toggle]
        : [star, editBankQuestionButton(question), toggle, remove],
    ),
  ]);
}

function editBankQuestionButton(question) {
  const button = element("button", {
    className: "small-button",
    text: "编辑",
    attrs: { type: "button" },
  });
  button.addEventListener("click", () => openBankQuestionEditor(question));
  return button;
}

// 题目编辑器:保存后旧版本进入 revisions(服务端保留最近 5 版),可在历史统计中追溯。
function openBankQuestionEditor(question) {
  const dialog = $("#bank-edit-dialog");
  const form = $("#bank-edit-form");
  const stem = element("textarea", { attrs: { rows: "3" } });
  stem.value = question.question;
  const optionInputs = Object.fromEntries(
    ["A", "B", "C", "D"].map((key) => {
      const input = element("input", { attrs: { type: "text" } });
      input.value = question.options?.[key] ?? "";
      return [key, input];
    }),
  );
  const correct = element("select");
  for (const key of ["A", "B", "C", "D"]) {
    const option = element("option", { text: key, attrs: { value: key } });
    if (key === question.correctAnswer) option.selected = true;
    correct.append(option);
  }
  const analysis = element("textarea", { attrs: { rows: "4" } });
  analysis.value = question.analysis ?? "";
  const knowledge = element("input", { attrs: { type: "text" } });
  knowledge.value = question.knowledgePoint ?? "";
  form.replaceChildren(
    element("label", {}, ["题干", stem]),
    element("div", { className: "edit-grid" }, [
      element("label", {}, ["正确答案", correct]),
      element("label", {}, ["知识点", knowledge]),
    ]),
    ...["A", "B", "C", "D"].map((key) =>
      element("label", {}, [`选项 ${key}`, optionInputs[key]]),
    ),
    element("label", {}, ["解析", analysis]),
    element("h3", { text: "人工审校记录" }),
    element("p", { className: "muted", text: "批准前必须填写可定位的来源，并明确核验题干、选项、正确答案和解析。此记录表示审校人声明，不代表系统已独立证实来源权威性。" }),
    ...(() => {
      const reviewer = element("input", { attrs: { type: "text", maxlength: "256", placeholder: "审校人" } });
      const evidenceType = element("select");
      evidenceType.append(element("option", { text: "请选择证据类型", attrs: { value: "" } }));
      for (const [value, label] of [["official_exam", "官方原卷/官方答案"], ["official_standard", "官方标准/规范"], ["textbook", "教材/参考书"], ["secondary_source", "可靠二手来源"], ["manual_note", "仅人工备注（不能批准）"]]) { const option = element("option", { text: label, attrs: { value } }); evidenceType.append(option); }
      const reference = element("input", { attrs: { type: "text", maxlength: "2000", placeholder: "来源 URL，或书名/版本/页码/条款" } });
      const note = element("textarea", { attrs: { rows: "3", maxlength: "4000", placeholder: "核验结论、答案依据及争议说明" } });
      const scope = Object.fromEntries([["question", "题干"], ["options", "选项"], ["correctAnswer", "正确答案"], ["analysis", "解析"], ["knowledgeDetail", "知识详解"]].map(([value, label]) => { const input = element("input", { attrs: { type: "checkbox", value } }); return [value, { input, label }]; }));
      form.reviewDraft = { reviewer, evidenceType, reference, note, scope };
      return [element("label", {}, ["审校人", reviewer]), element("label", {}, ["证据类型", evidenceType]), element("label", {}, ["来源定位", reference]), element("label", {}, ["核验摘要", note]), element("fieldset", { className: "review-scope" }, [element("legend", { text: "核验范围" }), ...Object.values(scope).map(({ input, label }) => element("label", {}, [input, label]))])];
    })(),
  );
  const reviewButton = $("#bank-review-submit");
  reviewButton.hidden = isImportedItem(question);
  reviewButton.disabled = isImportedItem(question);
  reviewButton.title = "记录来源与核验范围；不会自动验证来源本身";
  reviewButton.onclick = async () => {
    const draft = form.reviewDraft;
    const editedOptions = Object.fromEntries(Object.entries(optionInputs).map(([key, input]) => [key, input.value.trim()]));
    const hasUnsavedEdits = stem.value.trim() !== question.question || Object.keys(editedOptions).some((key) => editedOptions[key] !== String(question.options?.[key] ?? "").trim()) || correct.value !== question.correctAnswer || analysis.value.trim() !== String(question.analysis ?? "").trim() || knowledge.value.trim() !== String(question.knowledgePoint ?? "").trim();
    if (hasUnsavedEdits) { showToast("题目内容有未保存修改，请先保存，再重新打开题目记录审校", true); return; }
    try {
      await api(`/api/questions/${encodeURIComponent(question.id)}/review`, { method: "POST", body: JSON.stringify({ reviewer: draft.reviewer.value, evidenceType: draft.evidenceType.value, evidenceReference: draft.reference.value, evidenceNote: draft.note.value, reviewedFields: Object.entries(draft.scope).filter(([, item]) => item.input.checked).map(([value]) => value) }) });
      dialog.close(); showToast("审校记录已保存；来源权威性仍需人工判断"); await refreshQuestionBank();
    } catch (error) { showToast(error.message, true); }
  };
  dialog.showModal();
  $("#bank-edit-cancel").onclick = () => dialog.close();
  $("#bank-edit-save").onclick = async () => {
    try {
      await api(`/api/questions/${encodeURIComponent(question.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          question: stem.value,
          options: Object.fromEntries(
            Object.entries(optionInputs).map(([key, input]) => [key, input.value]),
          ),
          correctAnswer: correct.value,
          analysis: analysis.value,
          knowledgePoint: knowledge.value,
        }),
      });
      dialog.close();
      showToast("题目已更新（保留历史版本）");
      await refreshQuestionBank();
    } catch (error) {
      showToast(error.message, true);
    }
  };
}

async function deleteBankQuestion(question) {
  if (
    !(await confirmDialog({
      title: "永久删除题目",
      message: `确认永久删除这道题？\n\n${question.question}`,
      confirmText: "永久删除",
      danger: true,
    }))
  )
    return;
  try {
    await api(`/api/questions/${encodeURIComponent(question.id)}`, {
      method: "DELETE",
      body: JSON.stringify({ confirm: "DELETE" }),
    });
    showToast("题目已永久删除");
    await refreshQuestionBank();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function loadQuestionBank() {
  const load = beginLoad("question-bank", "#bank-list", "正在加载题库…");
  try {
    const params = new URLSearchParams({
      query: $("#bank-query").value.trim(),
      chapter: $("#bank-chapter").value,
      section: $("#bank-section").value,
      difficulty: $("#bank-difficulty").value,
      status: $("#bank-status").value,
      starred: $("#bank-starred").value,
      sourceType: $("#bank-source").value,
      limit: state.bankLimit,
      offset: state.bankOffset,
    });
    const data = await api(`/api/questions?${params}`);
    if (!load.isCurrent()) return;
    state.bankTotal = data.total;
    if (state.bankOffset > 0 && !data.records.length) {
      state.bankOffset = Math.max(0, state.bankOffset - state.bankLimit);
      return loadQuestionBank();
    }
    $("#bank-total").textContent = `${data.total} 道题`;
    $("#bank-page").textContent =
      `第 ${Math.floor(state.bankOffset / state.bankLimit) + 1} 页`;
    $("#bank-previous").disabled = state.bankOffset === 0;
    $("#bank-next").disabled = state.bankOffset + state.bankLimit >= data.total;
    $("#bank-list").replaceChildren(
      ...(data.records.length
        ? data.records.map(bankQuestionNode)
        : [data.total === 0 && state.chapters.every((chapter) => !(chapter.counts?.all)) &&
            !$("#bank-query").value.trim() && $("#bank-chapter").value === "all" &&
            $("#bank-source").value === "all"
            ? element("div", { className: "empty" }, bankOnboardingNode())
            : emptyMessage("没有匹配的题目", "请调整关键词或筛选条件。")]),
    );
    load.finish();
  } catch (error) {
    load.fail(error, loadQuestionBank);
  }
}

async function refreshQuestionBank() {
  await Promise.all([loadChapters(), loadActiveSession()]);
  populateBankChapters();
  await loadBankSections();
  await loadQuestionBank();
}

async function prepareQuestionBank() {
  populateBankChapters();
  await loadBankSections().catch((error) => showToast(error.message, true));
  await loadQuestionBank();
}

function percentBar(value, className = "") {
  return element("div", { className: `stat-track ${className}`.trim() }, [
    element("span", {
      attrs: { style: `width:${Math.max(0, Math.min(100, value))}%` },
    }),
  ]);
}

function chapterStatNode(chapter) {
  return element("div", { className: "chapter-stat-row" }, [
    element("div", { className: "stat-row-heading" }, [
      element("strong", {
        text: `第 ${chapter.chapter} 章 · ${chapter.title}`,
      }),
      element("span", {
        text: `${chapter.accuracy}% · ${chapter.correct}/${chapter.total}`,
      }),
    ]),
    percentBar(chapter.accuracy),
  ]);
}

function trendNode(point) {
  const label =
    point.mode === "review"
      ? "回顾"
      : point.mode === "exam-mcq"
        ? "模拟"
        : `第${point.chapter}章`;
  return element("div", { className: "trend-item" }, [
    element("div", { className: "trend-value", text: `${point.percentage}%` }),
    element("div", { className: "trend-column" }, [
      element("span", {
        attrs: { style: `height:${Math.max(3, point.percentage)}%` },
      }),
    ]),
    element("div", { className: "trend-label", text: label }),
    element("time", {
      text: new Date(point.gradedAt).toLocaleDateString("zh-CN", {
        month: "numeric",
        day: "numeric",
      }),
    }),
  ]);
}

function weakPointNode(point, maximum) {
  const width = maximum ? Math.round((point.timesWrong / maximum) * 100) : 0;
  return element("div", { className: "weak-point-row" }, [
    element("div", { className: "stat-row-heading" }, [
      element("strong", { text: point.knowledgePoint }),
      element("span", {
        text: `${point.questionCount} 道题 · 累计错 ${point.timesWrong} 次`,
      }),
    ]),
    percentBar(width, "weak"),
  ]);
}

function knowledgeMasteryNode(point) {
  const total = point.total || 1;
  const masteredPercent = Math.round((point.mastered / total) * 100);
  return element("div", { className: "weak-point-row" }, [
    element("div", { className: "stat-row-heading" }, [
      element("strong", { text: point.knowledgePoint }),
      element("span", {
        text: `${point.mastered}/${point.total} 已掌握 · ${point.active} 待复习`,
      }),
    ]),
    percentBar(masteredPercent),
  ]);
}

function renderStatistics(data) {
  $("#stats-summary").replaceChildren(
    wrongSummaryNode(data.summary.attempts, "已完成练习"),
    wrongSummaryNode(data.summary.totalQuestions, "累计作答"),
    wrongSummaryNode(`${data.summary.accuracy}%`, "总体正确率"),
    wrongSummaryNode(data.summary.studyDays, "学习天数"),
  );
  $("#chapter-stats").replaceChildren(
    ...(data.chapters.length
      ? data.chapters.map(chapterStatNode)
      : [emptyMessage("暂无章节统计", "完成并提交章节练习后显示。")]),
  );
  $("#practice-trend").replaceChildren(
    ...(data.trend.length
      ? data.trend.map(trendNode)
      : [emptyMessage("暂无趋势数据", "最近 12 次练习会显示在这里。")]),
  );
  const maximum = data.weakKnowledgePoints[0]?.timesWrong ?? 0;
  $("#weak-points").replaceChildren(
    ...(data.weakKnowledgePoints.length
      ? data.weakKnowledgePoints.map((point) => weakPointNode(point, maximum))
      : [emptyMessage("还没有薄弱知识点", "错题会按知识点聚合到这里。")]),
  );
  $("#knowledge-mastery").replaceChildren(
    ...(data.knowledgeMastery?.length
      ? data.knowledgeMastery.map(knowledgeMasteryNode)
      : [emptyMessage("暂无掌握度数据", "错题会按知识点统计掌握情况。")]),
  );
  const reviewTotal = data.review.active + data.review.mastered;
  const mastery = reviewTotal
    ? Math.round((data.review.mastered / reviewTotal) * 100)
    : 0;
  $("#review-stats").replaceChildren(
    element("div", { className: "review-stat-number" }, [
      element("strong", { text: `${mastery}%` }),
      element("span", { text: "错题掌握率" }),
    ]),
    percentBar(mastery),
    element("div", {
      className: "review-stat-meta",
      text: `${data.review.mastered} 道已掌握 · ${data.review.active} 道未掌握 · ${data.review.due} 道待回顾`,
    }),
  );
  renderLearningInsights(data);
}

// 打卡热力图:GitHub 贡献图风格,四级色阶按当日作答量分档。
function heatmapNode(days) {
  if (!days?.length) return emptyMessage("暂无打卡数据", "答题后按天累计到这里。");
  const max = Math.max(...days.map((day) => day.count), 1);
  const level = (count) =>
    count === 0 ? 0 : count / max > 0.66 ? 4 : count / max > 0.33 ? 3 : count / max > 0.1 ? 2 : 1;
  return days.map((day) =>
    element("span", {
      className: "heatmap-cell",
      attrs: {
        "data-level": String(level(day.count)),
        title: `${day.date} · ${day.count} 题`,
      },
    }),
  );
}

// 章节掌握度阶梯:0 未入门 → 3 已掌握,直观显示每章走到哪一级。
function masteryRow(chapter) {
  const titles = ["未入门", "起步", "熟练", "已掌握"];
  const row = element("div", { className: "mastery-row" }, [
    element("div", { className: "stat-row-heading" }, [
      element("strong", { text: chapter.title }),
      element("span", {
        text: `${chapter.accuracy}% · ${titles[chapter.level]}${chapter.active ? ` · ${chapter.active} 题待巩固` : ""}`,
      }),
    ]),
  ]);
  const ladder = element("div", { className: "mastery-ladder" });
  for (let step = 0; step < 4; step += 1) {
    ladder.append(
      element("span", { className: `mastery-step${step <= chapter.level ? " on" : ""}` }),
    );
  }
  row.append(ladder);
  return row;
}

function renderLearningInsights(data) {
  $("#stats-heatmap")?.replaceChildren(...heatmapNode(data.heatmap));
  const memory = data.memory;
  $("#stats-memory")?.replaceChildren(
    ...(memory
      ? [
          element("div", { className: "memory-item" }, [
            element("strong", { text: memory.retention != null ? `${memory.retention}%` : "—" }),
            element("span", { text: `当前记忆保持率（${memory.tracked} 题在复习中）` }),
          ]),
          element("div", { className: "memory-item" }, [
            element("strong", {
              text: memory.upcoming?.[0] ? String(memory.upcoming[0].due) : "0",
            }),
            element("span", { text: "今天到期复习" }),
          ]),
          element("div", { className: "memory-item" }, [
            element("strong", {
              text: String(
                (memory.upcomingDistinct ?? memory.upcoming ?? [])
                  .slice(1)
                  .reduce((sum, day) => sum + day.due, 0),
              ),
            }),
            element("span", { text: "未来 6 天到期合计" }),
          ]),
        ]
      : []),
  );
  const taxonomy = data.errorTaxonomy;
  $("#stats-taxonomy")?.replaceChildren(
    ...(taxonomy && (taxonomy.confidentWrong || taxonomy.unsureWrong)
      ? [
          element("span", {
            className: "taxonomy-chip",
            text: `自信地错 ${taxonomy.confidentWrong} 次 · 多为概念误解`,
          }),
          element("span", {
            className: "taxonomy-chip gap",
            text: `心虚答错 ${taxonomy.unsureWrong} 次 · 多为没记牢`,
          }),
        ]
      : [element("span", { className: "muted", text: "作答时选择把握程度后,这里会给出错因分类。" })]),
  );
  $("#stats-mastery")?.replaceChildren(
    ...(data.chapterMastery?.length
      ? data.chapterMastery.map(masteryRow)
      : [emptyMessage("暂无掌握度数据", "完成章节练习后显示每章掌握阶梯。")]),
  );
}

async function loadStatistics() {
  const load = beginLoad(
    "statistics",
    ["#stats-summary", "#chapter-stats", "#practice-trend", "#weak-points", "#knowledge-mastery", "#review-stats", "#stats-heatmap", "#stats-memory", "#stats-taxonomy", "#stats-mastery", "#readiness-body"],
    "正在加载学习统计…",
  );
  try {
    const [data, readiness, learning] = await Promise.all([
      api("/api/statistics"),
      api("/api/exam-readiness"),
      api("/api/learning-plan"),
    ]);
    if (!load.isCurrent()) return;
    renderStatistics(data);
    renderExamReadiness(readiness);
    renderLearningPath(learning);
    load.finish();
  } catch (error) {
    load.fail(error, loadStatistics);
  }
}

function renderExamReadiness(data) {
  const level = document.querySelector("#readiness-level");
  const body = document.querySelector("#readiness-body");
  if (!level || !body) return;
  level.textContent = String(data.score) + "/100 · " + data.level;
  const dimensions = [
    ["综合正确率", data.dimensions?.overallAccuracy],
    ["章节平均", data.dimensions?.chapterAccuracy],
    ["模拟考试", data.dimensions?.mockAccuracy],
    ["到期复习", data.dimensions?.reviewDue == null ? null : String(data.dimensions.reviewDue) + " 题"],
  ];
  const next = (data.nextActions ?? []).map((item) =>
    element("div", { className: "study-queue-item" }, [
      element("div", { className: "study-queue-item-copy" }, [
        element("strong", { text: item.title }),
        element("span", { text: item.description || "" }),
      ]),
      item.action ? studyQueueActionButton(item, "去做") : null,
    ].filter(Boolean)),
  );
  const weak = (data.weakPoints ?? []).slice(0, 4).map((item) =>
    element("span", { className: "taxonomy-chip gap", text: item.knowledgePoint + " · 风险 " + item.risk }),
  );
  body.replaceChildren(
    element("div", { className: "summary-grid" }, dimensions.map(([label, value]) =>
      wrongSummaryNode(value == null ? "—" : String(value) + (typeof value === "number" ? "%" : ""), label),
    )),
    element("p", {
      className: "muted",
      text: "题库覆盖 " + (data.coverage?.percent ?? 0) + "% · 已练 " +
        (data.coverage?.attempted ?? 0) + "/" + (data.coverage?.total ?? 0) +
        " · " + (data.disclaimer || ""),
    }),
    weak.length
      ? element("div", { className: "taxonomy-strip" }, weak)
      : element("p", { className: "muted", text: "暂时没有足够错题数据生成高风险知识点。" }),
    element("div", { className: "study-queue-list" }, next.length
      ? next
      : [emptyMessage("今天没有额外安排", "保持当前 FSRS 复习节奏即可。")]),
  );
}

function issueNode(issue) {
  const issueStatus = issue.status ?? "open";
  const statusChip = element("span", {
    className: `issue-status ${issueStatus}`,
    text: issueStatus === "acknowledged" ? "已确认" : "待处理",
  });
  const acknowledge =
    issueStatus === "open"
      ? element("button", {
          className: "small-button",
          text: "确认（保留下架）",
          attrs: { type: "button" },
        })
      : null;
  if (acknowledge) {
    acknowledge.addEventListener("click", async () => {
      try {
        await api(
          `/api/questions/${encodeURIComponent(issue.questionId)}/issue-status`,
          { method: "PATCH", body: JSON.stringify({ status: "acknowledged" }) },
        );
        await loadQuestionIssues();
        showToast("已确认问题题，题目保持下架");
      } catch (error) {
        showToast(error.message, true);
      }
    });
  }
  const restore = element("button", {
    className: "small-button",
    text: "恢复到题库",
    attrs: { type: "button" },
  });
  restore.addEventListener("click", async () => {
    try {
      await api(
        `/api/questions/${encodeURIComponent(issue.questionId)}/active`,
        {
          method: "PATCH",
        },
      );
      await loadQuestionIssues();
      await loadChapters();
      await loadSections();
      showToast("题目已恢复到题库");
    } catch (error) {
      showToast(error.message, true);
    }
  });
  const meta = element("div", { className: "wrong-meta" }, [
    element("span", { text: `第 ${issue.chapter} 章 · ${issue.note} · ${new Date(issue.createdAt).toLocaleString("zh-CN")}` }),
    statusChip,
  ]);
  const actions = [restore];
  if (acknowledge) actions.unshift(acknowledge);
  return element("article", { className: "question-issue-row" }, [
    element("div", { className: "question-text", text: issue.question }),
    meta,
    ...actions,
  ]);
}

async function loadQuestionIssues() {
  const load = beginLoad("question-issues", "#question-issues-list", "正在加载问题题目…");
  try {
    const data = await api("/api/question-issues");
    if (!load.isCurrent()) return;
    if (!data.records.length) {
      $("#question-issues-list").replaceChildren(
        emptyMessage(
          "还没有标记的问题题目",
          "练习中发现题目有误时，可以在题目下方标记。",
        ),
      );
      load.finish();
      return;
    }
    $("#question-issues-list").replaceChildren(...data.records.map(issueNode));
    load.finish();
  } catch (error) {
    load.fail(error, loadQuestionIssues);
  }
}

const auditActionNames = {
  "data.export": "导出备份",
  "data.import": "导入备份",
  "data.clear": "清空数据",
};
const auditScopeNames = {
  questions: "题库",
  wrongBook: "错题本",
  attempts: "练习记录",
  all: "全部数据",
};

function auditRow(entry) {
  const scope = entry.scope
    ? `范围：${auditScopeNames[entry.scope] || entry.scope}`
    : "";
  return element("div", { className: "audit-row" }, [
    element("strong", { text: auditActionNames[entry.action] || entry.action }),
    scope ? element("span", { className: "muted", text: scope }) : null,
    element("time", {
      text: new Date(entry.at).toLocaleString("zh-CN"),
      attrs: { datetime: entry.at },
    }),
  ]);
}

async function loadAuditLog() {
  const load = beginLoad("audit-log", "#audit-log-list", "正在加载操作审计…");
  try {
    const { records } = await api("/api/audit-log");
    if (!load.isCurrent()) return;
    $("#audit-log-list").replaceChildren(
      ...(records.length
        ? records.map(auditRow)
        : [
            emptyMessage(
              "暂无操作记录",
              "导出备份、导入备份和清空数据会记录在这里。",
            ),
          ]),
    );
    load.finish();
  } catch (error) {
    load.fail(error, loadAuditLog);
  }
}

async function loadDataStatus() {
  const load = beginLoad("data-status", "#data-summary", "正在加载数据概况…");
  try {
    const [summary, usage] = await Promise.all([
      api("/api/data/status"),
      api("/api/llm-usage").catch(() => null),
    ]);
    if (!load.isCurrent()) return;
    $("#data-summary").replaceChildren(
      wrongSummaryNode(summary.questions, "题库题目"),
      wrongSummaryNode(summary.generatedQuestions ?? 0, "生成题"),
      wrongSummaryNode(summary.realQuestions ?? 0, "历年真题"),
      wrongSummaryNode(summary.mockQuestions ?? 0, "模拟题"),
      wrongSummaryNode(summary.cases ?? 0, "案例"),
      wrongSummaryNode(summary.papers ?? 0, "论文"),
      wrongSummaryNode(summary.wrongQuestions, "错题记录"),
      wrongSummaryNode(summary.attempts, "练习记录"),
    );
    if (usage) renderLlmUsage(usage);
    load.finish();
  } catch (error) {
    load.fail(error, loadDataStatus);
  }
}

function healthSummaryNode(value, label, tone = "") {
  return element("div", { className: "health-summary-item " + tone }, [
    element("strong", { text: value }),
    element("span", { text: label }),
  ]);
}

function renderContentHealth(data) {
  const body = $("#content-health-body");
  if (!body) return;
  const questions = data.sources?.questions ?? {};
  const quality = data.generatedQuality ?? {};
  const coverage = data.examCoverage ?? {};
  const wiki = data.wiki ?? {};
  const issues = data.questionIssues ?? {};
  const review = data.review ?? {};
  const trustRows = (data.answerTrust ?? []).map((item) =>
    element("div", { className: "health-line" }, [
      element("span", { text: item.label }),
      element("strong", { text: item.count }),
    ]),
  );
  const reviewRows = Object.entries(review.reasons ?? {}).map(([reason, count]) =>
    element("div", { className: "health-line" }, [
      element("span", { text: review.reasonLabels?.[reason] || reason }),
      element("strong", { text: count }),
    ]),
  );  const incompleteRows = (coverage.incomplete ?? []).map((item) =>
    element("div", { className: "health-line health-line-wrap" }, [
      element("span", {
        text:
          item.term +
          " · 缺第 " +
          item.missingQuestionNos.join("、") +
          " 题",
      }),
      element("strong", {
        text: String(item.questions) + "/" + String(item.expectedQuestions),
      }),
    ]),
  );
  body.replaceChildren(
    element("div", { className: "health-summary-grid" }, [
      healthSummaryNode(questions.total ?? 0, "选择题总量"),
      healthSummaryNode(
        quality.traceabilityRate == null
          ? "—"
          : String(quality.traceabilityRate) + "%",
        "生成题有导图来源",
      ),
      healthSummaryNode(
        quality.missingAnalysis ?? 0,
        "生成题缺解析",
        quality.missingAnalysis ? "warning" : "",
      ),
      healthSummaryNode(
        coverage.missingQuestionCount ?? 0,
        "真题套卷缺题",
        coverage.missingQuestionCount ? "warning" : "",
      ),
      healthSummaryNode(
        wiki.draft ?? 0,
        "Wiki 待校对",
        wiki.draft ? "warning" : "",
      ),
      healthSummaryNode(
        issues.unresolved ?? 0,
        "问题题待处理",
        issues.unresolved ? "warning" : "",
      ),
      healthSummaryNode(review.pending_review ?? 0, "AI 题待审校", review.pending_review ? "warning" : ""),
      healthSummaryNode(review.approved ?? 0, "AI 题已批准"),
      healthSummaryNode(review.quarantined ?? 0, "AI 题已隔离", review.quarantined ? "warning" : ""),
    ]),
    element("div", { className: "health-columns" }, [
      element("section", { className: "health-block" }, [
        element("h3", { text: "答案来源" }),
        ...(trustRows.length
          ? trustRows
          : [element("p", { className: "muted", text: "暂无来源数据" })]),
      ]),
      element("section", { className: "health-block" }, [
        element("h3", { text: "生成题质量" }),
        element("p", {
          text:
            String(quality.withSourceNode ?? 0) +
            "/" +
            String(quality.active ?? 0) +
            " 有导图来源 · " +
            String(quality.withAnalysis ?? 0) +
            "/" +
            String(quality.active ?? 0) +
            " 有解析",
        }),
        element("p", {
          className: "muted",
          text:
            "Wiki " +
            String(wiki.reviewed ?? 0) +
            " 已校对 · " +
            String(wiki.lintProblems ?? 0) +
            " 个自检问题",
        }),
      ]),
      element("section", { className: "health-block" }, [
        element("h3", { text: "AI 题审校原因" }),
        ...(reviewRows.length ? reviewRows : [element("p", { className: "muted", text: "暂无审校原因" })]),
      ]),
      element("section", { className: "health-block" }, [
        element("h3", { text: "真题套卷覆盖" }),
        ...(incompleteRows.length
          ? incompleteRows
          : [
              element("p", {
                className: "muted",
                text: coverage.totalPapers
                  ? "已导入套卷题号完整"
                  : "尚未导入真题套卷",
              }),
            ]),
      ]),
    ]),
  );
  $("#content-health-status").textContent = "已更新";
}

async function loadContentHealth() {
  const load = beginLoad(
    "content-health",
    "#content-health-body",
    "正在检查内容质量…",
  );
  try {
    const data = await api("/api/content-health");
    if (!load.isCurrent()) return;
    renderContentHealth(data);
    load.finish();
  } catch (error) {
    load.fail(error, loadContentHealth);
  }
}

function workspaceDraft(config = {}) {
  const providers = (Array.isArray(config.providers) ? config.providers : []).map((provider, index) => ({
    id: String(provider.id || `provider-${index + 1}`),
    name: String(provider.name || `供应商 ${index + 1}`),
    type: provider.type === "claude-cli" ? "claude-cli" : "openai-compatible",
    baseUrl: String(provider.baseUrl || ""),
    apiKey: String(provider.apiKey || ""),
    models: [...new Set((Array.isArray(provider.models) ? provider.models : []).map(String).filter(Boolean))],
    defaultModel: String(provider.defaultModel || ""),
  }));
  const agents = (Array.isArray(config.agents) ? config.agents : []).map((agent, index) => ({
    id: String(agent.id || `agent-${index + 1}`),
    name: String(agent.name || `Agent ${index + 1}`),
    description: String(agent.description || ""),
    providerId: String(agent.providerId || providers[0]?.id || ""),
    model: String(agent.model || ""),
    systemPrompt: String(agent.systemPrompt || ""),
    enabled: agent.enabled !== false,
  }));
  return {
    providers,
    agents,
    defaultAgentId: String(config.defaultAgentId || agents[0]?.id || ""),
  };
}

function ensureWorkspaceDraft() {
  if (state.modelWorkspace.providers.length) return;
  const providerId = `provider-${Date.now()}`;
  const agentId = `agent-${Date.now()}`;
  state.modelWorkspace = {
    providers: [{
      id: providerId,
      name: "OpenAI 兼容供应商",
      type: "openai-compatible",
      baseUrl: "",
      apiKey: "",
      models: [],
      defaultModel: "",
    }],
    agents: [{
      id: agentId,
      name: "默认答题 Agent",
      description: "日常题目、资料和知识库任务",
      providerId,
      model: "",
      systemPrompt: "你是一个严谨的系统架构设计师备考助教。先给出结论，再列出依据和不确定性。",
      enabled: true,
    }],
    defaultAgentId: agentId,
  };
}

function modelSelectNode(models, selected, className) {
  const values = [...new Set([...(models || []), selected].filter(Boolean))];
  const select = element("select", { className });
  select.append(element("option", { text: values.length ? "选择默认模型" : "先获取模型列表", attrs: { value: "" } }));
  select.append(...values.map((model) => element("option", { text: model, attrs: { value: model } })));
  select.value = selected || "";
  return select;
}

function providerTypeSelect(provider) {
  const select = element("select", { className: "provider-type" });
  select.append(
    element("option", { text: "OpenAI 兼容接口", attrs: { value: "openai-compatible" } }),
    element("option", { text: "Claude CLI", attrs: { value: "claude-cli" } }),
  );
  select.value = provider.type;
  return select;
}

function providerNode(provider, index = 0) {
  const card = element("article", { className: "provider-card", attrs: { "data-provider-id": provider.id } });
  const nameInput = element("input", { attrs: { type: "text", "aria-label": "供应商名称", placeholder: "为供应商命名" } });
  nameInput.value = provider.name;
  const deleteButton = element("button", {
    className: "workspace-delete",
    text: "删除",
    attrs: { type: "button", title: "删除此供应商", disabled: state.modelWorkspace.providers.length <= 1 },
  });
  deleteButton.addEventListener("click", () => {
    state.modelWorkspace = workspaceDraft(collectWorkspaceDraft());
    if (state.modelWorkspace.providers.length <= 1) {
      showToast("至少保留一个供应商", true);
      return;
    }
    const boundAgents = state.modelWorkspace.agents.filter((agent) => agent.providerId === provider.id);
    if (boundAgents.length) {
      setAgentWorkspaceTab("team");
      showToast("该供应商仍被 " + boundAgents.length + " 个 Agent 使用，请先为这些角色更换供应商", true);
      return;
    }
    state.modelWorkspace.providers = state.modelWorkspace.providers.filter((item) => item.id !== provider.id);
    renderModelWorkspace();
    updateWorkspaceDirtyState();
  });
  const baseUrl = element("input", { className: "provider-base-url", attrs: { type: "url", placeholder: "https://api.example.com/v1", autocomplete: "url" } });
  baseUrl.value = provider.baseUrl;
  const apiKey = element("input", { className: "provider-api-key", attrs: { type: "password", placeholder: "留空表示无需鉴权", autocomplete: "new-password" } });
  apiKey.value = provider.apiKey;
  const type = providerTypeSelect(provider);
  const model = modelSelectNode(provider.models, provider.defaultModel, "provider-default-model");
  const fetchButton = element("button", { className: "secondary mc-provider-fetch", text: "获取模型列表", attrs: { type: "button", disabled: provider.type === "claude-cli" } });
  const fetchState = element("span", { className: "provider-fetch-state", text: provider.models.length ? provider.models.length + " 个模型" : "尚未获取模型" });
  fetchButton.addEventListener("click", () => fetchProviderModels(provider.id));
  type.addEventListener("change", () => {
    fetchButton.disabled = type.value === "claude-cli";
    const badge = card.querySelector(".provider-type-badge");
    if (badge) badge.textContent = type.value === "claude-cli" ? "CLI" : "API";
    updateWorkspaceDirtyState();
  });
  card.append(
    element("div", { className: "provider-card-header" }, [
      element("span", { className: "provider-card-index", text: String(index + 1).padStart(2, "0") }),
      nameInput,
      element("span", { className: "provider-type-badge", text: provider.type === "claude-cli" ? "CLI" : "API" }),
      deleteButton,
    ]),
    element("div", { className: "provider-card-grid" }, [
      element("label", { text: "接口类型" }, [type]),
      element("label", { text: "默认模型" }, [model]),
      element("label", { className: "provider-base-url", text: "Base URL" }, [baseUrl]),
      element("label", { className: "provider-api-key", text: "API Key" }, [apiKey]),
    ]),
    element("div", { className: "provider-card-actions" }, [fetchButton, fetchState]),
  );
  return card;
}

function agentNode(agent, index = 0) {
  const cardClass = "agent-config-card" + (agent.enabled ? "" : " is-disabled")
    + (state.modelWorkspace.defaultAgentId === agent.id ? " is-default" : "");
  const card = element("article", {
    className: cardClass,
    attrs: { "data-agent-id": agent.id },
  });
  const nameInput = element("input", { attrs: { type: "text", "aria-label": "Agent 名称", placeholder: "为角色命名" } });
  nameInput.value = agent.name;
  const deleteButton = element("button", {
    className: "workspace-delete",
    text: "删除",
    attrs: { type: "button", title: "删除此 Agent", disabled: state.modelWorkspace.agents.length <= 1 },
  });
  deleteButton.addEventListener("click", () => {
    state.modelWorkspace = workspaceDraft(collectWorkspaceDraft());
    if (state.modelWorkspace.agents.length <= 1) {
      showToast("至少保留一个 Agent", true);
      return;
    }
    state.modelWorkspace.agents = state.modelWorkspace.agents.filter((item) => item.id !== agent.id);
    if (state.modelWorkspace.defaultAgentId === agent.id) {
      state.modelWorkspace.defaultAgentId = state.modelWorkspace.agents.find((item) => item.enabled)?.id || "";
    }
    state.agentSelectedIds = (state.agentSelectedIds || []).filter((id) => id !== agent.id);
    renderModelWorkspace();
    updateWorkspaceDirtyState();
  });
  const providerSelect = element("select", { className: "agent-provider" });
  providerSelect.append(...state.modelWorkspace.providers.map((provider) => element("option", { text: provider.name, attrs: { value: provider.id } })));
  providerSelect.value = agent.providerId;
  const provider = state.modelWorkspace.providers.find((item) => item.id === agent.providerId) || state.modelWorkspace.providers[0];
  const modelSelect = modelSelectNode(provider?.models, agent.model, "agent-model");
  providerSelect.addEventListener("change", () => {
    const nextProvider = state.modelWorkspace.providers.find((item) => item.id === providerSelect.value);
    const nextModel = modelSelectNode(nextProvider?.models, "", "agent-model");
    card.querySelector(".agent-model")?.replaceWith(nextModel);
    updateWorkspaceDirtyState();
  });
  const description = element("input", { className: "agent-description", attrs: { type: "text", placeholder: "例如：负责拆解复杂问题、列出关键假设" } });
  description.value = agent.description;
  const prompt = element("textarea", { className: "agent-prompt", attrs: { rows: "5", placeholder: "定义角色的专业领域、工作步骤、输出结构和约束。提示词越具体，角色分工越稳定。" } });
  prompt.value = agent.systemPrompt;
  const promptDetails = element("details", { className: "agent-prompt-details" }, [
    element("summary", { text: "高级设置 · 系统提示词" }),
    element("p", { className: "agent-prompt-help", text: "这里定义 Agent 的长期职责和输出规则；任务输入框只填写本次具体问题。" }),
    element("label", { className: "agent-prompt", text: "系统提示词" }, [prompt]),
  ]);
  const enabled = element("input", { attrs: { type: "checkbox", "aria-label": "允许参与任务" } });
  enabled.checked = agent.enabled;
  enabled.addEventListener("change", () => {
    state.modelWorkspace = workspaceDraft(collectWorkspaceDraft());
    if (!enabled.checked) {
      if (Array.isArray(state.agentSelectedIds)) {
        state.agentSelectedIds = state.agentSelectedIds.filter((id) => id !== agent.id);
      }
      if (state.modelWorkspace.defaultAgentId === agent.id) {
        state.modelWorkspace.defaultAgentId = state.modelWorkspace.agents.find((item) => item.enabled)?.id || "";
      }
    } else if (!state.modelWorkspace.defaultAgentId) {
      state.modelWorkspace.defaultAgentId = agent.id;
    }
    renderModelWorkspace();
    updateWorkspaceDirtyState();
  });
  card.append(
    element("div", { className: "agent-config-card-header" }, [
      element("span", { className: "agent-card-index", text: String(index + 1).padStart(2, "0") }),
      nameInput,
      state.modelWorkspace.defaultAgentId === agent.id ? element("span", { className: "agent-default-badge", text: "默认角色" }) : null,
      element("span", { className: "agent-enabled-badge" + (agent.enabled ? "" : " is-off"), text: agent.enabled ? "已启用" : "已停用" }),
      deleteButton,
    ]),
    element("div", { className: "agent-config-grid" }, [
      element("label", { text: "绑定供应商" }, [providerSelect]),
      element("label", { text: "使用模型" }, [modelSelect]),
      element("label", { className: "agent-description-field", text: "角色职责" }, [description]),
      promptDetails,
      element("label", { className: "agent-enabled-control" }, [
        enabled,
        element("span", { className: "agent-enabled-copy" }, [
          element("strong", { text: "允许参与任务" }),
          element("small", { text: "停用后不会出现在协作选择中" }),
        ]),
      ]),
    ]),
  );
  return card;
}

function collectWorkspaceDraft() {
  const providers = [...document.querySelectorAll(".provider-card")].map((card) => {
    const existing = state.modelWorkspace.providers.find((item) => item.id === card.dataset.providerId);
    const model = card.querySelector(".provider-default-model")?.value || "";
    return {
      ...existing,
      id: card.dataset.providerId,
      name: card.querySelector(".provider-card-header input")?.value.trim() || existing?.name || "未命名供应商",
      type: card.querySelector(".provider-type")?.value || "openai-compatible",
      baseUrl: card.querySelector("input.provider-base-url")?.value.trim() || "",
      apiKey: card.querySelector("input.provider-api-key")?.value.trim() || "",
      defaultModel: model,
      models: [...new Set([...(existing?.models || []), model].filter(Boolean))],
    };
  });
  const agents = [...document.querySelectorAll(".agent-config-card")].map((card) => {
    const existing = state.modelWorkspace.agents.find((item) => item.id === card.dataset.agentId);
    return {
      ...existing,
      id: card.dataset.agentId,
      name: card.querySelector(".agent-config-card-header input")?.value.trim() || existing?.name || "未命名 Agent",
      description: card.querySelector(".agent-description")?.value.trim() || "",
      providerId: card.querySelector(".agent-provider")?.value || providers[0]?.id || "",
      model: card.querySelector(".agent-model")?.value || "",
      systemPrompt: card.querySelector("textarea.agent-prompt")?.value.trim() || "",
      enabled: card.querySelector('input[type="checkbox"]')?.checked !== false,
    };
  });
  return {
    providers,
    agents,
    defaultAgentId: $("#agent-default")?.value || agents.find((agent) => agent.enabled)?.id || "",
  };
}

function workspaceSignature(workspace) {
  return JSON.stringify(workspaceDraft(workspace || {}));
}

function setAgentWorkspaceTab(tab) {
  const allowed = new Set(["team", "providers", "tasks"]);
  const activeTab = allowed.has(tab) ? tab : "team";
  state.agentWorkspaceTab = activeTab;
  document.querySelectorAll("[data-agent-tab]").forEach((button) => {
    const active = button.dataset.agentTab === activeTab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll("[data-agent-panel]").forEach((panel) => {
    const active = panel.dataset.agentPanel === activeTab;
    panel.classList.toggle("is-active", active);
    panel.hidden = !active;
  });
}

function updateAgentWorkspaceMetrics() {
  const workspace = state.modelWorkspace;
  const enabledAgents = workspace.agents.filter((agent) => agent.enabled);
  const enabledNode = $("#agent-metric-enabled");
  const providerNodeValue = $("#agent-metric-providers");
  const defaultNode = $("#agent-metric-default");
  const modelNode = $("#agent-metric-default-model");
  if (enabledNode) enabledNode.textContent = String(enabledAgents.length);
  if (providerNodeValue) providerNodeValue.textContent = String(workspace.providers.length);
  const defaultAgent = workspace.agents.find((agent) => agent.id === workspace.defaultAgentId);
  const provider = workspace.providers.find((item) => item.id === defaultAgent?.providerId);
  if (defaultNode) defaultNode.textContent = defaultAgent?.name || "尚未配置";
  if (modelNode) modelNode.textContent = defaultAgent
    ? (provider?.name || "未绑定供应商") + " · " + (defaultAgent.model || provider?.defaultModel || "未选择模型")
    : "先添加供应商和 Agent";
  const teamMeta = $("#agent-tab-team-meta");
  const providerMeta = $("#agent-tab-provider-meta");
  const taskMeta = $("#agent-tab-task-meta");
  const teamHealth = $("#agent-team-health");
  if (teamMeta) teamMeta.textContent = workspace.agents.length + " 个角色";
  if (providerMeta) providerMeta.textContent = workspace.providers.length + " 个连接";
  if (taskMeta) taskMeta.textContent = enabledAgents.length >= 2 ? "支持多角色协作" : "单角色运行";
  if (teamHealth) {
    teamHealth.textContent = enabledAgents.length
      ? enabledAgents.length + " 个角色可参与任务"
      : "尚无已启用的角色";
    teamHealth.classList.toggle("is-empty", enabledAgents.length === 0);
  }
}

function syncWorkspaceDraftFromForm() {
  state.modelWorkspace = workspaceDraft(collectWorkspaceDraft());
  updateAgentWorkspaceMetrics();
  updateWorkspaceDirtyState();
}

function updateWorkspaceDirtyState() {
  const saveButton = $("#mc-save");
  const status = $("#agent-workspace-save-state");
  if (!saveButton || !status) return;
  const current = workspaceSignature(collectWorkspaceDraft());
  const dirty = !state.modelWorkspaceSavedSignature || current !== state.modelWorkspaceSavedSignature;
  status.textContent = dirty ? "有未保存的修改" : "配置已保存";
  status.classList.toggle("is-dirty", dirty);
  status.classList.toggle("is-saved", !dirty);
  saveButton.disabled = !dirty;
  saveButton.textContent = dirty ? "保存更改" : "已保存";
}

function renderAgentMembers() {
  const members = $("#agent-task-members");
  if (!members) return;
  const enabledAgents = state.modelWorkspace.agents.filter((agent) => agent.enabled);
  const previous = Array.isArray(state.agentSelectedIds) ? state.agentSelectedIds : null;
  const fallbackAgentId = enabledAgents.find((agent) => agent.id === state.modelWorkspace.defaultAgentId)?.id || enabledAgents[0]?.id;
  const selectedIds = new Set((previous || [fallbackAgentId])
    .filter((id) => enabledAgents.some((agent) => agent.id === id)));
  if (enabledAgents.length && !selectedIds.size) {
    selectedIds.add(fallbackAgentId);
  }
  if (!enabledAgents.length) {
    members.replaceChildren(element("div", { className: "agent-members-empty", text: "还没有可用的 Agent。请先添加角色并启用。" }));
  } else {
    members.replaceChildren(...enabledAgents.map((agent) => {
      const checkbox = element("input", { attrs: { type: "checkbox", value: agent.id, "aria-label": "选择 " + agent.name } });
      checkbox.checked = selectedIds.has(agent.id);
      checkbox.addEventListener("change", () => {
        let checked = [...members.querySelectorAll("input:checked")];
        if (checked.length > 4) {
          checkbox.checked = false;
          showToast("一次最多选择 4 个 Agent", true);
          checked = [...members.querySelectorAll("input:checked")];
        }
        state.agentSelectedIds = checked.map((input) => input.value);
        syncAgentStrategyUi();
      });
      const provider = state.modelWorkspace.providers.find((item) => item.id === agent.providerId);
      const subtitle = agent.description || ((provider?.name || "未绑定供应商") + " · " + (agent.model || provider?.defaultModel || "未选模型"));
      return element("label", { className: "agent-task-member-card" }, [
        checkbox,
        element("span", { className: "agent-member-avatar", text: (agent.name || "A").slice(0, 1).toUpperCase(), attrs: { "aria-hidden": "true" } }),
        element("span", { className: "agent-member-copy" }, [
          element("strong", { text: agent.name }),
          element("small", { text: subtitle }),
        ]),
        element("span", { className: "agent-member-check", text: "✓", attrs: { "aria-hidden": "true" } }),
      ]);
    }));
  }
  syncAgentStrategyUi();
}

function syncAgentStrategyUi() {
  const strategySelect = $("#agent-task-strategy");
  if (!strategySelect) return;
  let strategy = strategySelect.value;
  const members = $("#agent-task-members");
  let selectedInputs = [...(members?.querySelectorAll("input:checked") || [])];
  if (strategy === "single" && selectedInputs.length > 1) {
    selectedInputs.slice(1).forEach((input) => { input.checked = false; });
    selectedInputs = selectedInputs.slice(0, 1);
    state.agentSelectedIds = selectedInputs.map((input) => input.value);
  }
  const selectedCount = selectedInputs.length;
  const enabledCount = state.modelWorkspace.agents.filter((agent) => agent.enabled).length;
  if (strategy !== "single" && enabledCount < 2) {
    strategy = "single";
    strategySelect.value = "single";
  }
  document.querySelectorAll("[data-agent-strategy]").forEach((button) => {
    const active = button.dataset.agentStrategy === strategy;
    button.classList.toggle("is-selected", active);
    button.setAttribute("aria-pressed", String(active));
    button.disabled = button.dataset.agentStrategy !== "single" && enabledCount < 2;
  });
  const judgeWrap = $("#agent-task-judge-wrap");
  if (judgeWrap) judgeWrap.hidden = strategy !== "battle";
  const preview = {
    single: {
      mark: "01",
      title: "单 Agent · 独立完成",
      copy: "由一个角色处理任务，适合日常答疑和内容起草。",
    },
    parallel: {
      mark: "02",
      title: "并行回答 · 多视角比较",
      copy: "所选角色分别回答同一问题，便于比较差异和关注点。",
    },
    battle: {
      mark: "03",
      title: "对战评审 · 生成综合结论",
      copy: "先并行收集候选答案，再由评审角色综合；评审会额外调用一次模型。",
    },
  }[strategy];
  const previewMark = $("#agent-strategy-preview .agent-strategy-preview-mark");
  const previewTitle = $("#agent-strategy-preview-title");
  const previewCopy = $("#agent-strategy-preview-copy");
  const callEstimate = $("#agent-task-call-estimate");
  if (previewMark) previewMark.textContent = preview.mark;
  if (previewTitle) previewTitle.textContent = preview.title;
  if (previewCopy) previewCopy.textContent = preview.copy;
  if (callEstimate) {
    const plannedCalls = strategy === "single" ? (selectedCount ? 1 : 0)
      : strategy === "battle" ? selectedCount + (selectedCount >= 2 ? 1 : 0)
        : selectedCount;
    callEstimate.textContent = plannedCalls
      ? "预计 " + plannedCalls + " 次模型调用"
      : "请先选择 Agent";
  }
  const count = $("#agent-selected-count");
  if (count) {
    count.textContent = "已选 " + selectedCount + " 个";
    count.classList.toggle("is-invalid", strategy !== "single" && selectedCount < 2);
  }
  const hint = $("#agent-task-validation");
  if (hint && !hint.hidden) {
    hint.textContent = strategy === "single"
      ? (selectedCount < 1 ? "请至少选择一个已启用的 Agent。" : "")
      : (selectedCount < 2 ? "并行与对战模式至少需要选择 2 个 Agent。" : "");
    hint.hidden = !hint.textContent;
  }
}

function renderModelWorkspace() {
  ensureWorkspaceDraft();
  const providerList = $("#provider-list");
  const agentList = $("#agent-list");
  if (!providerList || !agentList) return;
  providerList.replaceChildren(...state.modelWorkspace.providers.map(providerNode));
  agentList.replaceChildren(...state.modelWorkspace.agents.map(agentNode));
  const defaultSelect = $("#agent-default");
  defaultSelect.replaceChildren(...state.modelWorkspace.agents.map((agent) => element("option", {
    text: agent.name + (agent.enabled ? "" : "（已停用）"),
    attrs: { value: agent.id, disabled: !agent.enabled },
  })));
  const enabledDefault = state.modelWorkspace.agents.find((agent) => agent.id === state.modelWorkspace.defaultAgentId && agent.enabled);
  const effectiveDefault = enabledDefault || state.modelWorkspace.agents.find((agent) => agent.enabled);
  if (effectiveDefault && state.modelWorkspace.defaultAgentId !== effectiveDefault.id) {
    state.modelWorkspace.defaultAgentId = effectiveDefault.id;
  }
  defaultSelect.value = effectiveDefault?.id || "";
  const judgeSelect = $("#agent-task-judge");
  const enabledAgents = state.modelWorkspace.agents.filter((agent) => agent.enabled);
  judgeSelect.replaceChildren(...(enabledAgents.length
    ? enabledAgents.map((agent) => element("option", { text: agent.name, attrs: { value: agent.id } }))
    : [element("option", { text: "请先启用 Agent", attrs: { value: "" } })]));
  judgeSelect.value = effectiveDefault?.id || enabledAgents[0]?.id || "";
  renderAgentMembers();
  updateAgentWorkspaceMetrics();
  setAgentWorkspaceTab(state.agentWorkspaceTab);
  updateWorkspaceDirtyState();
}

async function loadModelConfig() {
  try {
    const config = await api("/api/model-config");
    state.modelWorkspace = workspaceDraft(config);
    state.modelWorkspaceSavedSignature = workspaceSignature(state.modelWorkspace);
    state.modelWorkspaceLoaded = true;
    state.agentSelectedIds = null;
    renderModelWorkspace();
  } catch (error) {
    showToast(error.message, true);
    const status = $("#agent-workspace-save-state");
    if (status) {
      status.textContent = "配置加载失败";
      status.classList.add("is-error");
    }
  }
}

async function saveModelConfig() {
  const button = $("#mc-save");
  const draft = collectWorkspaceDraft();
  button.disabled = true;
  button.textContent = "保存中…";
  try {
    const config = await api("/api/model-config/workspace", {
      method: "POST",
      body: JSON.stringify(draft),
    });
    state.modelWorkspace = workspaceDraft(config);
    state.modelWorkspaceSavedSignature = workspaceSignature(state.modelWorkspace);
    state.modelWorkspaceLoaded = true;
    renderModelWorkspace();
    showToast("模型工作区已保存并生效");
    await loadModelStatus();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    updateWorkspaceDirtyState();
  }
}

async function fetchProviderModels(providerId) {
  const draft = collectWorkspaceDraft();
  state.modelWorkspace = workspaceDraft(draft);
  const provider = state.modelWorkspace.providers.find((item) => item.id === providerId);
  if (!provider) return;
  const result = $("#mc-fetch-result");
  result.hidden = true;
  const button = document.querySelector(`[data-provider-id="${CSS.escape(providerId)}"] .mc-provider-fetch`);
  if (button) {
    button.disabled = true;
    button.textContent = "获取中…";
  }
  try {
    const data = await api("/api/model-config/fetch-models", {
      method: "POST",
      body: JSON.stringify({ providerId, baseUrl: provider.baseUrl, apiKey: provider.apiKey, type: provider.type }),
    });
    provider.models = [...new Set((data.models || []).map(String).filter(Boolean))];
    provider.defaultModel = provider.defaultModel && provider.models.includes(provider.defaultModel)
      ? provider.defaultModel
      : provider.models[0] || provider.defaultModel;
    state.modelWorkspace.providers = state.modelWorkspace.providers.map((item) => item.id === providerId ? provider : item);
    renderModelWorkspace();
    result.textContent = provider.models.length ? `已获取 ${provider.models.length} 个模型，请在供应商卡片的下拉框中选择默认模型。` : "接口未返回可用模型，请检查地址或接口类型。";
    result.className = provider.models.length ? "mc-fetch-result" : "mc-fetch-result error";
    result.hidden = false;
  } catch (error) {
    result.textContent = error.message;
    result.className = "mc-fetch-result error";
    result.hidden = false;
  } finally {
    const currentButton = document.querySelector(`[data-provider-id="${CSS.escape(providerId)}"] .mc-provider-fetch`);
    if (currentButton) {
      currentButton.disabled = false;
      currentButton.textContent = "获取模型列表";
    }
  }
}

function addProvider() {
  state.modelWorkspace = workspaceDraft(collectWorkspaceDraft());
  const providerId = `provider-${Date.now()}`;
  state.modelWorkspace.providers.push({
    id: providerId,
    name: `供应商 ${state.modelWorkspace.providers.length + 1}`,
    type: "openai-compatible",
    baseUrl: "",
    apiKey: "",
    models: [],
    defaultModel: "",
  });
  renderModelWorkspace();
  setAgentWorkspaceTab("providers");
  requestAnimationFrame(() => {
    const card = document.querySelector('[data-provider-id="' + CSS.escape(providerId) + '"]');
    card?.scrollIntoView({ behavior: "smooth", block: "center" });
    card?.querySelector(".provider-card-header input")?.focus();
  });
}

const AGENT_ROLE_TEMPLATES = {
  "exam-tutor": {
    name: "备考导师",
    description: "负责知识点讲解、考点拆解和循序渐进的学习指导",
    systemPrompt: "你是一名严谨的系统架构设计师备考导师。先判断学习者的问题属于哪个知识领域，再用准确、易懂的语言解释概念。优先采用“定义—原理—适用场景—优缺点—易混淆点—考试提示”的结构。对于不在官方考试大纲或教程明确覆盖范围内的前沿内容，标注为拓展知识，不把它说成必考点。不要编造真题、教材原文或官方结论；不确定时明确说明。",
  },
  "architecture-reviewer": {
    name: "架构评审",
    description: "从质量属性、约束、风险和成本角度评审技术方案",
    systemPrompt: "你是一名资深系统架构评审专家。评审时先复述目标与约束，再从性能、可用性、可靠性、安全性、可维护性、可扩展性和成本等维度分析。区分事实、假设与建议；指出关键权衡、单点故障、容量瓶颈和迁移风险。给出优先级明确、可以落地的改进建议。不要为了显得全面而臆造数据或系统现状。",
  },
  "source-checker": {
    name: "资料核查员",
    description: "检查事实、证据出处、版本信息和不确定性",
    systemPrompt: "你是一名严谨的技术资料核查员。逐项检查结论是否有可追溯证据，区分原始来源、二手解读、推断和个人建议。优先要求文档标题、发布机构、版本、日期、章节或页码等定位信息。证据不足时标注“待核实”，禁止伪造链接、页码、标准条款或官方口径。发现来源之间冲突时并列展示，不要擅自消解冲突。",
  },
};

function addAgentFromTemplate(templateId) {
  const template = AGENT_ROLE_TEMPLATES[templateId];
  if (!template) return;
  state.modelWorkspace = workspaceDraft(collectWorkspaceDraft());
  const provider = state.modelWorkspace.providers[0];
  if (!provider) {
    setAgentWorkspaceTab("providers");
    showToast("请先配置模型供应商", true);
    return;
  }
  const agentId = "agent-" + Date.now();
  state.modelWorkspace.agents.push({
    id: agentId,
    name: template.name,
    description: template.description,
    providerId: provider.id,
    model: provider.defaultModel || provider.models[0] || "",
    systemPrompt: template.systemPrompt,
    enabled: true,
  });
  if (!state.modelWorkspace.defaultAgentId) state.modelWorkspace.defaultAgentId = agentId;
  renderModelWorkspace();
  setAgentWorkspaceTab("team");
  showToast("已添加“" + template.name + "”，保存后即可使用");
  requestAnimationFrame(() => {
    const card = document.querySelector('[data-agent-id="' + CSS.escape(agentId) + '"]');
    card?.scrollIntoView({ behavior: "smooth", block: "center" });
    card?.querySelector(".agent-config-card-header input")?.focus();
  });
}

function addAgent() {
  state.modelWorkspace = workspaceDraft(collectWorkspaceDraft());
  const provider = state.modelWorkspace.providers[0];
  if (!provider) {
    setAgentWorkspaceTab("providers");
    showToast("请先添加供应商", true);
    return;
  }
  const agentId = `agent-${Date.now()}`;
  state.modelWorkspace.agents.push({
    id: agentId,
    name: "Agent " + (state.modelWorkspace.agents.length + 1),
    description: "",
    providerId: provider.id,
    model: provider.defaultModel || provider.models[0] || "",
    systemPrompt: "",
    enabled: true,
  });
  if (!state.modelWorkspace.defaultAgentId) state.modelWorkspace.defaultAgentId = agentId;
  renderModelWorkspace();
  setAgentWorkspaceTab("team");
  requestAnimationFrame(() => {
    const card = document.querySelector('[data-agent-id="' + CSS.escape(agentId) + '"]');
    card?.scrollIntoView({ behavior: "smooth", block: "center" });
    card?.querySelector(".agent-config-card-header input")?.focus();
  });
}

function agentTaskPlainText(result) {
  const lines = [
    "Agent 协作结果 · " + (result.strategy === "battle" ? "对战评审" : result.strategy === "parallel" ? "并行回答" : "单 Agent"),
    "",
  ];
  for (const item of result.results || []) {
    lines.push("【" + (item.agentName || "Agent") + "】" + (item.error ? "（调用失败）" : " · " + (item.model || "默认模型") + " · 置信度 " + Math.round((item.confidence || 0) * 100) + "%"));
    lines.push(item.error || item.answer || "未返回内容");
    if (item.keyPoints?.length) lines.push("关键要点：" + item.keyPoints.join("；"));
    if (item.concerns?.length) lines.push("需要留意：" + item.concerns.join("；"));
    lines.push("");
  }
  if (result.synthesis) {
    lines.push("【综合评审 · " + (result.synthesis.judgedBy || "评审 Agent") + "】");
    lines.push(result.synthesis.answer || "");
  }
  return lines.join("\n").trim();
}


function renderAgentTaskHistory(records = loadAgentTaskHistory()) {
  state.agentTaskHistory = records;
  const list = $("#agent-task-history-list");
  const count = $("#agent-task-history-count");
  const clearButton = $("#agent-task-history-clear");
  if (!list || !count || !clearButton) return;
  count.textContent = records.length + " / " + AGENT_TASK_HISTORY_LIMIT + " 条";
  clearButton.disabled = records.length === 0;
  if (!records.length) {
    list.replaceChildren(element("p", {
      className: "agent-task-history-empty",
      text: "还没有保存的任务。运行完成后，点击结果区的“保存到本机历史”即可留存。",
    }));
    return;
  }
  list.replaceChildren(...records.map((record) => {
    const successCount = record.result.results.filter((item) => !item.error).length;
    const failureCount = record.result.results.length - successCount;
    const dateLabel = new Date(record.createdAt).toLocaleString("zh-CN", {
      month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
    const strategyLabel = record.strategy === "battle" ? "对战评审" : record.strategy === "parallel" ? "并行回答" : "单 Agent";
    const row = element("article", { className: "agent-task-history-row", attrs: { role: "listitem" } }, [
      element("div", { className: "agent-task-history-copy" }, [
        element("div", { className: "agent-task-history-meta" }, [
          element("strong", { text: dateLabel }),
          element("span", { text: strategyLabel }),
          element("span", { text: successCount + " 成功" + (failureCount ? " · " + failureCount + " 失败" : "") }),
          element("span", { text: record.callCount + " 次调用" }),
        ]),
        element("p", { text: record.prompt }),
      ]),
      element("div", { className: "agent-task-history-actions" }, [
        element("button", { className: "secondary", text: "查看结果", attrs: { type: "button" } }),
        element("button", { className: "ghost agent-history-delete", text: "删除", attrs: { type: "button", "aria-label": "删除这条历史记录" } }),
      ]),
    ]);
    row.querySelector(".agent-task-history-actions .secondary").addEventListener("click", () => openAgentTaskHistory(record.id));
    row.querySelector(".agent-history-delete").addEventListener("click", () => {
      const deleted = removeAgentTaskHistory(record.id);
      if (!deleted.ok) {
        showToast("无法访问本机浏览器存储，未能删除历史记录", true);
        return;
      }
      if (state.lastAgentTask?.historyId === record.id) {
        state.lastAgentTask.historyId = "";
        const saveButton = $("#agent-task-result .agent-save-history");
        if (saveButton) {
          saveButton.disabled = false;
          saveButton.textContent = "保存到本机历史";
        }
      }
      renderAgentTaskHistory(deleted.items);
      showToast("已删除这条历史记录");
    });
    return row;
  }));
}

function agentServerTaskStatusLabel(status) {
  return ({
    queued: "排队中",
    running: "运行中",
    cancelling: "正在取消",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  })[status] || status || "未知";
}

function serverTaskViewResult(task) {
  if (task.request?.mode !== "review") return task.result || null;
  const candidates = Array.isArray(task.request.results) ? task.request.results : [];
  return {
    strategy: "battle",
    results: candidates.map((item) => ({
      agentId: item.agentId || "",
      agentName: item.agentName || "Agent",
      answer: item.answer || "",
      concerns: item.concerns || [],
      keyPoints: [],
      confidence: 0,
    })),
    synthesis: task.result?.synthesis || null,
    synthesisError: task.result?.synthesis ? "" : task.error?.message || "",
    quality: task.result?.quality || null,
    callCount: task.result?.callCount || 1,
  };
}

function showAgentServerTaskResult(task, result = serverTaskViewResult(task)) {
  const request = task.request || {};
  if (!result) {
    showToast(task.error?.message || "任务尚未产生可展示的结果", task.status === "failed");
    return;
  }
  const strategy = request.mode === "review" ? "battle" : request.strategy || result.strategy || "single";
  const agentIds = request.mode === "review"
    ? (request.results || []).map((item) => item.agentId).filter(Boolean)
    : request.agentIds || [];
  const durationMs = task.startedAt && task.finishedAt
    ? Math.max(0, Date.parse(task.finishedAt) - Date.parse(task.startedAt))
    : 0;
  const callCount = Number(result.callCount) || (result.results || []).length + (result.synthesis ? 1 : 0);
  state.lastAgentTask = {
    prompt: request.prompt || "",
    strategy,
    agentIds,
    judgeAgentId: request.judgeAgentId || "",
    result,
    durationMs,
    callCount,
    completedAt: task.finishedAt || task.updatedAt,
    serverTaskId: task.id,
  };
  const prompt = $("#agent-task-prompt");
  if (prompt && request.prompt) {
    prompt.value = request.prompt;
    prompt.dispatchEvent(new Event("input", { bubbles: true }));
  }
  const strategySelect = $("#agent-task-strategy");
  if (strategySelect && request.mode !== "review") strategySelect.value = strategy;
  if (request.mode !== "review") {
    state.agentSelectedIds = agentIds;
    renderAgentMembers();
    syncAgentStrategyUi();
    const judge = $("#agent-task-judge");
    if (judge && request.judgeAgentId) judge.value = request.judgeAgentId;
  }
  renderAgentTaskResult(result, { durationMs, callCount });
  setAgentWorkspaceTab("tasks");
}

function renderAgentServerTasks(tasks = []) {
  state.agentServerTasks = tasks;
  const list = $("#agent-server-task-list");
  const count = $("#agent-server-task-count");
  if (!list || !count) return;
  count.textContent = String(tasks.length);
  if (!tasks.length) {
    list.replaceChildren(element("p", {
      className: "agent-server-task-empty",
      text: "还没有服务端任务。运行后的任务会在本机 SQLite 保留，页面关闭后仍可恢复。",
    }));
    return;
  }
  const rows = tasks.map((task) => {
    const isActive = ["queued", "running", "cancelling"].includes(task.status);
    const promptPreview = String(task.promptPreview || "").trim() || "未记录任务摘要";
    const dateLabel = new Date(task.updatedAt || task.createdAt).toLocaleString("zh-CN", {
      month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
    const row = element("article", {
      className: "agent-server-task-row status-" + String(task.status || "unknown"),
      attrs: { role: "listitem" },
    }, [
      element("div", { className: "agent-server-task-copy" }, [
        element("div", { className: "agent-server-task-meta" }, [
          element("strong", { text: agentServerTaskStatusLabel(task.status) }),
          element("span", { text: dateLabel }),
          element("span", { text: "尝试 " + (task.attemptCount || 0) + " 次" }),
          element("span", { text: "事件 #" + (task.eventSeq || 0) }),
        ]),
        element("p", { className: "agent-server-task-prompt", text: promptPreview }),
        element("small", { text: "任务 ID · " + task.id }),
      ]),
      element("div", { className: "agent-server-task-actions" }, [
        element("button", {
          className: "secondary agent-server-task-open",
          text: isActive ? "继续跟踪" : "查看结果",
          attrs: { type: "button", "aria-label": (isActive ? "继续跟踪：" : "查看结果：") + promptPreview },
        }),
        isActive ? element("button", {
          className: "ghost agent-server-task-cancel",
          text: "取消",
          attrs: { type: "button", "aria-label": "取消任务：" + promptPreview },
        }) : null,
      ]),
    ]);
    row.querySelector(".agent-server-task-open").addEventListener("click", () => {
      void openAgentServerTask(task.id);
    });
    row.querySelector(".agent-server-task-cancel")?.addEventListener("click", () => {
      void cancelAgentServerTask(task.id);
    });
    return row;
  });
  list.replaceChildren(...rows);
}

async function loadAgentServerTasks({ quiet = true } = {}) {
  const list = $("#agent-server-task-list");
  if (!list) return;
  try {
    const data = await api("/api/agents/tasks?limit=12", { method: "GET", timeoutMs: 15_000 });
    renderAgentServerTasks(data.tasks || []);
  } catch (error) {
    if (!quiet) showToast(error.message || "服务端任务列表加载失败", true);
    if (!state.agentServerTasks.length) {
      list.replaceChildren(element("p", {
        className: "agent-server-task-empty",
        text: error.code === "AGENT_DISABLED" ? "服务端 Agent 任务功能尚未开启。" : "暂时无法读取服务端任务列表。",
      }));
    }
  }
}

async function cancelAgentServerTask(taskId) {
  try {
    await cancelDurableAgentTask(taskId);
    await loadAgentServerTasks();
    showToast("已提交任务取消请求");
  } catch (error) {
    showToast(error.message || "取消任务失败", true);
  }
}

async function openAgentServerTask(taskId) {
  if (state.agentTaskBusy) return;
  try {
    let { task } = await api(`/api/agents/tasks/${encodeURIComponent(taskId)}`, {
      method: "GET",
      timeoutMs: 15_000,
    });
    if (["queued", "running", "cancelling"].includes(task.status)) {
      const operation = beginAgentTaskUiOperation("恢复任务跟踪");
      try {
        const result = await watchDurableAgentTask(taskId, {
          signal: operation.signal,
          onProgress: updateAgentTaskProgress,
        });
        const refreshed = await api(`/api/agents/tasks/${encodeURIComponent(taskId)}`, { method: "GET" });
        task = refreshed.task;
        showAgentServerTaskResult(task, result);
        showToast("已从服务端恢复任务结果");
      } finally {
        state.agentTaskBusy = false;
        operation.finish();
      }
    } else {
      showAgentServerTaskResult(task);
      if (task.status === "failed") showToast(task.error?.message || "任务执行失败", true);
      else if (task.status === "cancelled") showToast("该任务已取消");
    }
  } catch (error) {
    if (error.code === "LLM_GENERATION_CANCELLED" || error.name === "AbortError") {
      showToast("已停止当前任务跟踪；服务端正在处理取消请求");
    } else {
      showToast(error.message || "恢复服务端任务失败", true);
    }
  } finally {
    state.agentTaskBusy = false;
    await loadAgentServerTasks();
  }
}

function openAgentTaskHistory(id) {
  const record = state.agentTaskHistory.find((item) => item.id === id);
  if (!record) return;
  const prompt = $("#agent-task-prompt");
  prompt.value = record.prompt;
  prompt.dispatchEvent(new Event("input", { bubbles: true }));
  $("#agent-task-strategy").value = record.strategy;
  state.agentSelectedIds = record.agentIds.filter((agentId) =>
    state.modelWorkspace.agents.some((agent) => agent.id === agentId && agent.enabled));
  renderAgentMembers();
  syncAgentStrategyUi();
  const judge = $("#agent-task-judge");
  if (record.judgeAgentId && [...judge.options].some((option) => option.value === record.judgeAgentId)) {
    judge.value = record.judgeAgentId;
  }
  state.lastAgentTask = { ...record, completedAt: record.createdAt, historyId: record.id, restored: true };
  setAgentWorkspaceTab("tasks");
  $("#agent-task-history-details").open = true;
  renderAgentTaskResult(record.result, {
    durationMs: record.durationMs,
    callCount: record.callCount,
    historyId: record.id,
  });
  showToast("已载入历史结果；再次运行前请检查当前角色配置");
}

async function clearAgentTaskHistoryWithConfirmation() {
  if (!state.agentTaskHistory.length) return;
  const confirmed = await confirmDialog({
    title: "清空 Agent 历史",
    message: "将删除当前浏览器保存的全部 Agent 任务记录，不能撤销。此操作不会影响模型配置、题库或学习记录。",
    confirmText: "清空历史",
    danger: true,
  });
  if (!confirmed) return;
  const cleared = clearAgentTaskHistory();
  if (!cleared.ok) {
    showToast("无法访问本机浏览器存储，未能清空历史", true);
    return;
  }
  if (state.lastAgentTask) {
    state.lastAgentTask.historyId = "";
    const saveButton = $("#agent-task-result .agent-save-history");
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent = "保存到本机历史";
    }
  }
  renderAgentTaskHistory(cleared.items);
  showToast("Agent 历史已清空");
}

function renderAgentTaskPlan(plan) {
  const box = $("#agent-task-plan");
  if (!box) return;
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];
  const rows = steps.map((step) => {
    const isReview = step.type === "review";
    const dependencyText = isReview
      ? `依赖 ${(step.dependsOn || []).length} 个 Worker；至少 2 个成功后执行`
      : step.execution === "parallel" ? "独立上下文 · 并行执行" : "独立上下文 · 单步执行";
    return element("li", { className: "agent-task-plan-step" + (isReview ? " is-review" : "") }, [
      element("span", { className: "agent-task-plan-role", text: isReview ? "Evaluator" : "Worker" }),
      element("strong", { text: step.agentName || "Agent" }),
      element("small", { text: dependencyText }),
    ]);
  });
  box.hidden = false;
  box.replaceChildren(
    element("div", { className: "agent-task-plan-heading" }, [
      element("strong", { text: "Router 任务计划" }),
      element("span", { text: plan?.router?.mode === "deterministic" ? "本地规则路由 · 不额外调用模型" : "任务计划" }),
    ]),
    element("ol", { className: "agent-task-plan-steps" }, rows),
    element("p", { className: "agent-task-plan-note", text: "输出门禁只检查结构完整性，不代表答案事实正确。" }),
  );
}

function agentTaskPlanText(plan) {
  if (!plan || !Array.isArray(plan.steps)) return "";
  const workers = plan.steps.filter((step) => step.type === "worker").length;
  const reviewer = plan.steps.find((step) => step.type === "review");
  return `Router 计划：${workers} 个独立 Worker${plan.execution?.mode === "parallel_then_review" ? " 并行执行" : " 执行"}${reviewer ? `，随后由 ${reviewer.agentName || "Evaluator"} 在至少 2 个 Worker 成功后评审` : ""}。`;
}

function agentTaskQualityText(quality) {
  if (!quality) return "输出质量门禁：未返回检查结果。";
  const workers = quality.workers || {};
  const review = {
    passed: "通过",
    failed: "未通过",
    pending: "等待重新评审",
    skipped: "因成功 Worker 不足而跳过",
    not_required: "不适用",
  }[quality.review] || "未执行";
  return `结构完整性门禁：Worker ${workers.passed || 0} 通过、${workers.failed || 0} 未通过、${workers.notEvaluated || 0} 未检查；综合评审：${review}。该门禁不判断事实正确性。`;
}
function refreshAgentTaskQuality(result, reviewOverride) {
  if (!result) return;
  const items = Array.isArray(result.results) ? result.results : [];
  const workers = {
    passed: items.filter((item) => item?.quality?.passed === true).length,
    failed: items.filter((item) => item?.quality?.passed === false).length,
    notEvaluated: items.filter((item) => item?.quality?.passed == null).length,
  };
  const review = reviewOverride || (result.strategy !== "battle"
    ? "not_required"
    : result.synthesis
      ? "passed"
      : result.synthesisError
        ? "failed"
        : "skipped");
  const allWorkersPassed = items.length > 0 && workers.passed === items.length;
  const status = allWorkersPassed && ["passed", "not_required"].includes(review)
    ? "passed"
    : workers.passed > 0 || review === "passed"
      ? "partial"
      : "failed";
  result.quality = {
    ...(result.quality || {}),
    gate: result.quality?.gate || "agent-output-contract-v1",
    status,
    workers,
    review,
    note: result.quality?.note || "该门禁只检查输出结构与完整性，不判断事实、推理或引用是否正确。",
  };
}

function updateAgentTaskProgress(event) {
  const list = $("#agent-task-progress-roles");
  const summary = $("#agent-task-progress-text");
  if (!list || !summary) return;
  if (event.type === "plan_created") {
    renderAgentTaskPlan(event.plan);
    summary.textContent = `Router 已规划 ${event.plan?.steps?.length || 0} 个执行步骤，准备派发 Worker…`;
    return;
  }
  if (event.type === "quality_gate_passed" || event.type === "quality_gate_failed") {
    const gateStatus = event.type === "quality_gate_passed" ? "通过" : "未通过";
    summary.textContent = `${event.agentName || "Agent"} 的结构完整性门禁${gateStatus}${event.issues?.length ? "：" + event.issues.join("、") : ""}。`;
    return;
  }
  if (event.type === "quality_gate_skipped") return;
  if (event.type === "task_started") {
    summary.textContent = `已启动 ${event.totalAgents || 0} 个 Worker，等待执行结果…`;
    return;
  }
  if (event.type === "agent_started" || event.type === "review_started") {
    const stage = event.stage === "review" || event.type === "review_started" ? "review" : "answer";
    const id = String(event.agentId || event.agentName || "agent");
    const key = stage + ":" + id;
    let row = state.agentTaskProgressRows.get(key);
    if (!row) {
      row = element("div", { className: "agent-task-progress-row is-running" }, [
        element("span", { className: "agent-task-progress-stage", text: stage === "review" ? "评审" : "回答" }),
        element("strong", { text: event.agentName || "Agent" }),
        element("span", { className: "agent-task-progress-status", text: "执行中" }),
      ]);
      state.agentTaskProgressRows.set(key, row);
      list.append(row);
    } else {
      row.className = "agent-task-progress-row is-running";
      row.querySelector(".agent-task-progress-status").textContent = "执行中";
    }
    summary.textContent = stage === "review"
      ? "角色回答已返回，正在进行综合评审…"
      : "正在执行角色任务，完成结果会逐项显示…";
    return;
  }
  if (event.type === "agent_completed" || event.type === "agent_failed") {
    const stage = event.stage === "review" ? "review" : "answer";
    const key = stage + ":" + String(event.agentId || event.agentName || "agent");
    const row = state.agentTaskProgressRows.get(key);
    if (row) {
      const failed = event.type === "agent_failed";
      row.className = "agent-task-progress-row " + (failed ? "is-failed" : "is-complete");
      row.querySelector(".agent-task-progress-status").textContent = failed ? "失败" : "已完成";
      if (failed) row.title = event.error || "调用失败";
    }
    const completed = [...state.agentTaskProgressRows.values()].filter((item) =>
      item.classList.contains("is-complete") || item.classList.contains("is-failed")).length;
    summary.textContent = `已返回 ${completed} 项执行结果${event.type === "agent_failed" ? "，有角色失败，可单独重试" : ""}。`;
    return;
  }
  if (event.type === "review_skipped") {
    summary.textContent = "成功回答不足 2 个，已跳过综合评审；可以先重试失败角色。";
    return;
  }
  if (event.type === "task_completed") {
    summary.textContent = `任务结束：${event.successfulAgents} 个角色成功，${event.failedAgents} 个失败，共 ${event.callCount} 次模型调用。`;
  }
}

function beginAgentTaskUiOperation(label) {
  state.agentTaskBusy = true;
  state.agentTaskProgressRows.clear();
  $("#agent-task-progress-roles").replaceChildren();
  const planBox = $("#agent-task-plan");
  if (planBox) {
    planBox.hidden = true;
    planBox.replaceChildren();
  }
  return beginGenerationTask({
    key: "agent-task",
    button: $("#agent-task-run"),
    progress: $("#agent-task-progress"),
    progressText: $("#agent-task-progress-text"),
    cancel: $("#agent-task-cancel"),
    label,
  });
}

function persistUpdatedAgentTaskHistory(task) {
  if (!task?.historyId) return true;
  const saved = saveAgentTaskHistory({
    id: task.historyId,
    createdAt: task.completedAt || new Date().toISOString(),
    prompt: task.prompt || "",
    strategy: task.strategy || task.result?.strategy || "single",
    agentIds: task.agentIds || [],
    judgeAgentId: task.judgeAgentId || "",
    durationMs: task.durationMs,
    callCount: task.callCount,
    result: task.result,
  });
  if (!saved.ok) {
    task.historySyncFailed = true;
    showToast("本次重试结果已更新，但同步历史失败；可以点击“重新同步历史”再次尝试", true);
    return false;
  }
  task.historySyncFailed = false;
  renderAgentTaskHistory(saved.items);
  return true;
}

function renderAgentTaskResult(result, meta = {}) {
  const box = $("#agent-task-result");
  const items = result.results || [];
  const succeeded = items.filter((item) => !item.error).length;
  const failed = items.length - succeeded;
  const canRetryReview = result.strategy === "battle" && items.filter((item) => !item.error && item.answer).length >= 2;
  const actions = element("div", { className: "agent-result-actions" }, [
    element("button", {
      className: "secondary agent-save-history",
      text: meta.historyNeedsSync ? "重新同步历史" : meta.historyId ? "已保存到历史" : "保存到本机历史",
      attrs: { type: "button", disabled: Boolean(meta.historyId && !meta.historyNeedsSync) },
    }),
    element("button", { className: "secondary agent-copy-result", text: "复制全部结果", attrs: { type: "button" } }),
  ]);
  const heading = element("div", { className: "agent-result-heading" }, [
    element("div", {}, [
      element("span", { className: "agent-section-index", text: "TASK OUTPUT" }),
      element("h3", { text: result.synthesis ? "综合结果与角色回答" : "角色回答" }),
      element("p", { text: succeeded + " 个 Agent 成功" + (failed ? " · " + failed + " 个失败" : "") + "。请比较观点和依据，不要只看置信度。" }),
      element("p", { className: "agent-quality-summary", text: agentTaskQualityText(result.quality) }),
      result.plan ? element("p", { className: "agent-plan-summary", text: agentTaskPlanText(result.plan) }) : null,
      element("span", { className: "agent-result-run-meta", text: (meta.durationMs != null ? "耗时 " + (meta.durationMs / 1000).toFixed(1) + " 秒" : "") + (meta.callCount != null ? " · " + meta.callCount + " 次模型调用" : "") }),
    ]),
    actions,
  ]);
  actions.querySelector(".agent-save-history").addEventListener("click", () => {
    const task = state.lastAgentTask;
    if (!task?.result) {
      showToast("当前没有可保存的任务结果", true);
      return;
    }
    const id = task.historyId || "agent-task-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    const saved = saveAgentTaskHistory({
      id,
      createdAt: task.completedAt || new Date().toISOString(),
      prompt: task.prompt || "",
      strategy: task.strategy || result.strategy || "single",
      agentIds: task.agentIds || [],
      judgeAgentId: task.judgeAgentId || "",
      durationMs: task.durationMs ?? meta.durationMs,
      callCount: task.callCount ?? meta.callCount,
      result: task.result,
    });
    if (!saved.ok) {
      showToast(saved.reason === "invalid" ? "结果内容过大或格式异常，未能保存" : "本机浏览器存储不可用，未能保存历史", true);
      return;
    }
    task.historyId = id;
    task.historySyncFailed = false;
    renderAgentTaskHistory(saved.items);
    $("#agent-task-history-details").open = true;
    const saveHistoryButton = actions.querySelector(".agent-save-history");
    saveHistoryButton.disabled = true;
    saveHistoryButton.textContent = "已保存到历史";
    showToast("已保存到本机浏览器历史");
  });
  heading.querySelector(".agent-copy-result").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(agentTaskPlainText(result));
      showToast("结果已复制");
    } catch {
      showToast("复制失败，请检查浏览器剪贴板权限", true);
    }
  });
  const answers = items.map((item, index) => {
    const isError = Boolean(item.error);
    const percent = Math.round((item.confidence || 0) * 100);
    const card = element("article", { className: "agent-result-card" + (isError ? " is-error" : "") }, [
      element("div", { className: "agent-result-card-head" }, [
        element("span", { className: "agent-result-number", text: String(index + 1).padStart(2, "0") }),
        element("div", { className: "agent-result-identity" }, [
          element("strong", { text: item.agentName || "Agent" }),
          element("small", { text: isError ? "本次调用未成功" : (item.model || "默认模型") }),
        ]),
        element("span", { className: "agent-result-status" + (isError ? " is-error" : " is-success"), text: isError ? "失败" : "已完成" }),
      ]),
      isError
        ? element("p", { className: "agent-result-error", text: item.error })
        : element("div", { className: "agent-result-body" }, [
            element("div", { className: "agent-confidence" }, [
              element("span", { text: "模型自评置信度" }),
              element("strong", { text: percent + "%" }),
            ]),
            element("div", { className: "agent-confidence-track", attrs: { role: "meter", "aria-label": (item.agentName || "Agent") + " 置信度", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(percent) } }, [
              element("span", { attrs: { style: "width:" + percent + "%" } }),
            ]),
            element("p", { className: "agent-result-answer", text: item.answer || "未返回内容" }),
            item.keyPoints?.length ? element("div", { className: "agent-result-detail" }, [
              element("strong", { text: "关键要点" }),
              element("ul", {}, item.keyPoints.map((point) => element("li", { text: point }))),
            ]) : null,
            item.concerns?.length ? element("div", { className: "agent-result-detail agent-result-concerns" }, [
              element("strong", { text: "需要留意" }),
              element("ul", {}, item.concerns.map((point) => element("li", { text: point }))),
            ]) : null,
          ]),
      element("div", { className: "agent-result-card-actions" }, [
        element("button", { className: "ghost agent-copy-one", text: "复制此回答", attrs: { type: "button" } }),
        isError
          ? element("button", {
              className: "secondary agent-retry-one",
              text: "重试此角色",
              attrs: { type: "button", disabled: state.agentTaskBusy },
            })
          : null,
      ]),
    ]);
    card.querySelector(".agent-copy-one").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(agentTaskPlainText({ strategy: result.strategy, results: [item] }));
        showToast("已复制 " + (item.agentName || "Agent") + " 的回答");
      } catch {
        showToast("复制失败，请检查浏览器剪贴板权限", true);
      }
    });
    card.querySelector(".agent-retry-one")?.addEventListener("click", () => retryAgentResult(item.agentId));
    return card;
  });
  const synthesis = result.synthesis
    ? element("article", { className: "agent-synthesis-card" }, [
        element("div", { className: "agent-synthesis-kicker" }, [
          element("span", { text: "FINAL REVIEW" }),
          element("strong", { text: "综合评审 · " + (result.synthesis.judgedBy || "评审 Agent") }),
        ]),
        element("p", { className: "agent-result-answer", text: result.synthesis.answer || "评审角色未返回综合结果。" }),
        result.synthesis.keyPoints?.length ? element("div", { className: "agent-result-detail" }, [
          element("strong", { text: "综合要点" }),
          element("ul", {}, result.synthesis.keyPoints.map((point) => element("li", { text: point }))),
        ]) : null,
        result.synthesis.concerns?.length ? element("div", { className: "agent-result-detail agent-result-concerns" }, [
          element("strong", { text: "仍需核实" }),
          element("ul", {}, result.synthesis.concerns.map((point) => element("li", { text: point }))),
        ]) : null,
      ])
    : result.strategy === "battle"
      ? element("article", { className: "agent-synthesis-card agent-synthesis-pending" }, [
          element("strong", { text: result.synthesisError ? "综合评审失败" : "综合评审未执行" }),
          element("p", { text: result.synthesisError || "至少需要两个 Agent 成功返回答案才能执行综合评审。" }),
          result.synthesisError && canRetryReview
            ? element("button", {
                className: "secondary agent-retry-review",
                text: "仅重试综合评审",
                attrs: { type: "button", disabled: state.agentTaskBusy },
              })
            : null,
        ])
      : null;
  synthesis?.querySelector(".agent-retry-review")?.addEventListener("click", retryAgentReview);
  box.replaceChildren(...[
    heading,
    synthesis,
    element("div", { className: "agent-result-grid" }, answers),
  ].filter(Boolean));
  box.hidden = false;
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function retryAgentResult(agentId) {
  if (state.agentTaskBusy) return;
  const taskRecord = state.lastAgentTask;
  const agent = state.modelWorkspace.agents.find((item) => item.id === agentId && item.enabled);
  if (!taskRecord?.result || !agent) {
    showToast("该角色已不可用，请检查 Agent 配置", true);
    return;
  }
  const failedIndex = taskRecord.result.results.findIndex((item) => item.agentId === agentId && item.error);
  if (failedIndex < 0) {
    showToast("没有找到该角色的失败记录", true);
    return;
  }
  if (workspaceSignature(collectWorkspaceDraft()) !== state.modelWorkspaceSavedSignature) {
    showToast("Agent 配置有未保存的修改，请先保存再重试", true);
    return;
  }

  const operation = beginAgentTaskUiOperation("重试失败角色");
  const startedAt = performance.now();
  try {
    const retried = await createDurableAgentTask({
      mode: "run",
      prompt: taskRecord.prompt,
      strategy: "single",
      agentIds: [agentId],
    }, {
      signal: operation.signal,
      onProgress: updateAgentTaskProgress,
    });
    const replacement = retried.results?.find((item) => item.agentId === agentId) || retried.results?.[0];
    if (!replacement) throw new Error("重试请求没有返回角色结果");
    const nextResults = [...taskRecord.result.results];
    nextResults[failedIndex] = replacement;
    taskRecord.result = { ...taskRecord.result, results: nextResults };
    if (taskRecord.strategy === "battle" && !replacement.error) {
      const successfulCount = nextResults.filter((item) => !item.error && item.answer).length;
      taskRecord.result = {
        ...taskRecord.result,
        synthesis: null,
        synthesisError: successfulCount >= 2
          ? "候选答案已更新，之前的综合评审已过期，请重新评审。"
          : "当前成功回答不足 2 个，暂时无法进行综合评审。",
      };
      refreshAgentTaskQuality(taskRecord.result, successfulCount >= 2 ? "pending" : "skipped");
    } else {
      refreshAgentTaskQuality(taskRecord.result);
    }
    taskRecord.callCount = (Number(taskRecord.callCount) || 0) + (Number(retried.callCount) || 1);
    taskRecord.durationMs = (Number(taskRecord.durationMs) || 0) + Math.round(performance.now() - startedAt);
    taskRecord.completedAt = new Date().toISOString();
    state.agentTaskBusy = false;
    persistUpdatedAgentTaskHistory(taskRecord);
    renderAgentTaskResult(taskRecord.result, {
      durationMs: taskRecord.durationMs,
      callCount: taskRecord.callCount,
      historyId: taskRecord.historyId,
      historyNeedsSync: Boolean(taskRecord.historySyncFailed),
    });
    showToast(replacement.error ? "该角色仍未成功，可检查模型配置后再次重试" : "已更新该角色的回答");
  } catch (error) {
    if (isGenerationCancelled(error, operation.signal)) {
      $("#agent-task-progress-text").textContent = "重试已停止";
      showToast("已停止角色重试");
    } else {
      showToast(error.message || "角色重试失败", true);
    }
  } finally {
    state.agentTaskBusy = false;
    operation.finish();
  }
}

async function retryAgentReview() {
  if (state.agentTaskBusy) return;
  const taskRecord = state.lastAgentTask;
  const successful = taskRecord?.result?.results?.filter((item) => !item.error && item.answer) || [];
  if (!taskRecord || taskRecord.strategy !== "battle" || successful.length < 2) {
    showToast("至少需要两个成功的角色回答才能重新评审", true);
    return;
  }
  if (workspaceSignature(collectWorkspaceDraft()) !== state.modelWorkspaceSavedSignature) {
    showToast("Agent 配置有未保存的修改，请先保存再重试", true);
    return;
  }

  const operation = beginAgentTaskUiOperation("重试综合评审");
  const startedAt = performance.now();
  let reviewStarted = false;
  try {
    const retried = await createDurableAgentTask({
      mode: "review",
      prompt: taskRecord.prompt,
      results: taskRecord.result.results,
      judgeAgentId: taskRecord.judgeAgentId || $("#agent-task-judge").value,
    }, {
      signal: operation.signal,
      onProgress: (event) => {
        if (event.type === "review_started" || (event.type === "agent_started" && event.stage === "review")) {
          reviewStarted = true;
        }
        updateAgentTaskProgress(event);
      },
    });
    if (!retried.synthesis) throw new Error("评审接口未返回综合结果");
    taskRecord.result = { ...taskRecord.result, synthesis: retried.synthesis, synthesisError: "" };
    refreshAgentTaskQuality(taskRecord.result, "passed");
    taskRecord.callCount = (Number(taskRecord.callCount) || 0) + (Number(retried.callCount) || 1);
    taskRecord.durationMs = (Number(taskRecord.durationMs) || 0) + Math.round(performance.now() - startedAt);
    taskRecord.completedAt = new Date().toISOString();
    state.agentTaskBusy = false;
    persistUpdatedAgentTaskHistory(taskRecord);
    renderAgentTaskResult(taskRecord.result, {
      durationMs: taskRecord.durationMs,
      callCount: taskRecord.callCount,
      historyId: taskRecord.historyId,
      historyNeedsSync: Boolean(taskRecord.historySyncFailed),
    });
    showToast("综合评审已更新，原有角色回答没有重新调用");
  } catch (error) {
    if (isGenerationCancelled(error, operation.signal)) {
      $("#agent-task-progress-text").textContent = "评审重试已停止";
      showToast("已停止综合评审重试");
      return;
    }
    taskRecord.result = { ...taskRecord.result, synthesis: null, synthesisError: error.message || "综合评审重试失败" };
    if (reviewStarted) taskRecord.callCount = (Number(taskRecord.callCount) || 0) + 1;
    taskRecord.durationMs = (Number(taskRecord.durationMs) || 0) + Math.round(performance.now() - startedAt);
    taskRecord.completedAt = new Date().toISOString();
    state.agentTaskBusy = false;
    persistUpdatedAgentTaskHistory(taskRecord);
    renderAgentTaskResult(taskRecord.result, {
      durationMs: taskRecord.durationMs,
      callCount: taskRecord.callCount,
      historyId: taskRecord.historyId,
      historyNeedsSync: Boolean(taskRecord.historySyncFailed),
    });
    showToast(error.message || "综合评审重试失败", true);
  } finally {
    state.agentTaskBusy = false;
    operation.finish();
  }
}

async function runAgentTask() {
  if (state.agentTaskBusy) return;
  const prompt = $("#agent-task-prompt").value.trim();
  const strategy = $("#agent-task-strategy").value;
  const agentIds = [...document.querySelectorAll('#agent-task-members input:checked')].map((input) => input.value);
  const validation = $("#agent-task-validation");
  const enabledCount = state.modelWorkspace.agents.filter((agent) => agent.enabled).length;
  const required = strategy === "single" ? 1 : 2;
  if (!prompt) {
    validation.textContent = "请先描述本次任务的目标和背景。";
    validation.hidden = false;
    $("#agent-task-prompt").focus();
    return;
  }
  if (agentIds.length < required || enabledCount < required) {
    validation.textContent = strategy === "single"
      ? "请至少选择一个已启用的 Agent。"
      : "当前策略需要至少选择 2 个已启用的 Agent，请调整参与角色或切换为单 Agent。";
    validation.hidden = false;
    $("#agent-task-members").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  validation.hidden = true;
  const currentSignature = workspaceSignature(collectWorkspaceDraft());
  if (currentSignature !== state.modelWorkspaceSavedSignature) {
    validation.textContent = "工作区存在未保存的修改。请先保存配置，再运行任务，避免调用旧的角色设置。";
    validation.hidden = false;
    $("#mc-save").focus();
    return;
  }

  $("#agent-task-result").hidden = true;
  const operation = beginAgentTaskUiOperation("运行 Agent 任务");
  const startedAt = performance.now();
  const judgeAgentId = $("#agent-task-judge").value;
  try {
    const result = await createDurableAgentTask({
      mode: "run",
      prompt,
      strategy,
      agentIds,
      judgeAgentId,
    }, {
      signal: operation.signal,
      onProgress: updateAgentTaskProgress,
    });
    const durationMs = Math.round(performance.now() - startedAt);
    const callCount = Number(result.callCount) || (result.results || []).length + (result.synthesis ? 1 : 0);
    state.lastAgentTask = {
      prompt,
      strategy,
      agentIds,
      judgeAgentId,
      result,
      durationMs,
      callCount,
      completedAt: new Date().toISOString(),
    };
    state.agentTaskBusy = false;
    renderAgentTaskResult(result, { durationMs, callCount });
    const failed = (result.results || []).filter((item) => item.error).length;
    if (failed || result.synthesisError) {
      showToast("任务已返回部分结果；失败项可单独重试", true);
    } else {
      showToast("Agent 任务已完成");
    }
  } catch (error) {
    if (isGenerationCancelled(error, operation.signal)) {
      $("#agent-task-progress-text").textContent = "任务已停止";
      showToast("已停止 Agent 任务");
      return;
    }
    validation.textContent = error.message;
    validation.hidden = false;
    validation.scrollIntoView({ behavior: "smooth", block: "center" });
    showToast(error.message, true);
  } finally {
    state.agentTaskBusy = false;
    operation.finish();
  }
}
async function refreshAfterDataChange() {
  state.session = null;
  resetExamSaveState();
  state.result = null;
  await loadChapters();
  await loadSections();
  await Promise.all([
    loadActiveSession(),
    refreshReviewBadge(),
    loadStudyQueue(),
    loadDataStatus(),
    loadContentHealth(),
    loadQuestionIssues(),
    loadAuditLog(),
  ]);
}

async function exportData() {
  try {
    const backup = await api("/api/data/export");
    const blob = new Blob([`${JSON.stringify(backup, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `architect-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("备份已导出");
    loadAuditLog();
  } catch (error) {
    showToast(error.message, true);
  }
}

const materialFormatNames = {
  markdown: "Markdown",
  mermaid: "Mermaid",
  html: "HTML",
  svg: "SVG",
  text: "纯文本",
};

const materialState = {
  note: "",
  materials: [],
  selectedId: null,
  fontScale: 1,
  narrow: false,
  focus: false,
  preferencesLoaded: false,
  loadId: 0,
};

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

async function loadMaterials() {
  const load = beginLoad(
    "materials",
    "#materials-groups",
    "正在加载资料…",
  );
  loadMaterialPreferences();
  try {
    const data = await api("/api/study-materials");
    if (!load.isCurrent()) return;
    materialState.note = data.note || "";
    materialState.materials = data.materials || [];
    $("#materials-note").textContent =
      materialState.note || "只读浏览本机资料，不会改动原文。";
    if (
      materialState.selectedId &&
      !materialState.materials.some((item) => item.id === materialState.selectedId)
    ) {
      materialState.selectedId = null;
    }
    renderMaterialGroups();
    if (materialState.selectedId) await openMaterial(materialState.selectedId);
    else renderMaterialEmpty();
    if (load.isCurrent()) load.finish();
  } catch (error) {
    load.fail(error, loadMaterials);
  }
}

function renderMaterialGroups() {
  const query = $("#materials-search").value.trim().toLowerCase();
  const visible = materialState.materials.filter((item) =>
    `${item.title} ${item.groupLabel}`.toLowerCase().includes(query),
  );
  const groups = new Map();
  for (const item of visible) {
    const label = item.groupLabel || "资料";
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(item);
  }
  const blocks = [...groups.entries()].map(([label, items]) =>
    element("section", { className: "materials-group" }, [
      element("h2", { text: label }),
      ...items.map((item) => {
        const button = element("button", {
          className:
            item.id === materialState.selectedId
              ? "materials-item active"
              : "materials-item",
          text: item.title,
          attrs: { type: "button" },
        });
        button.addEventListener("click", () => openMaterial(item.id));
        return button;
      }),
    ]),
  );
  $("#materials-groups").replaceChildren(
    ...(blocks.length
      ? blocks
      : [emptyMessage("没有匹配的资料", "换一个标题关键词试试。")]),
  );
}

async function openMaterial(id) {
  materialState.selectedId = id;
  renderMaterialGroups();
  const requestId = ++materialState.loadId;
  const load = beginLoad("material-document", "#materials-document", "正在读取资料…");
  const body = $("#materials-document");
  $("#materials-toc").replaceChildren();
  $("#materials-toc").hidden = true;
  updateMaterialToolbar();
  try {
    const doc = await api(`/api/study-materials/${encodeURIComponent(id)}`);
    if (requestId !== materialState.loadId || !load.isCurrent()) return;
    renderMaterialDocument(doc);
    // 恢复上次阅读位置；没有记录时回到顶部。
    restoreReaderPosition(id);
    load.finish();
  } catch (error) {
    if (requestId !== materialState.loadId || !load.isCurrent()) return;
    load.fail(error, () => openMaterial(id));
    updateMaterialToolbar();
  }
}

function loadMaterialPreferences() {
  if (materialState.preferencesLoaded) return;
  materialState.preferencesLoaded = true;
  try {
    const scale = Number(localStorage.getItem("architect-material-font-scale"));
    if (Number.isFinite(scale)) materialState.fontScale = clampMaterialScale(scale);
    materialState.narrow = localStorage.getItem("architect-material-narrow") === "true";
  } catch {
    materialState.fontScale = 1;
    materialState.narrow = false;
  }
  applyMaterialReaderState();
}

function persistMaterialPreference(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
  }
}

function clampMaterialScale(value) {
  return Math.min(1.25, Math.max(0.9, Math.round(Number(value) * 20) / 20));
}

function materialById(id) {
  return materialState.materials.find((item) => item.id === id) || null;
}

function materialCountText(doc) {
  const count = doc?.charCount ?? String(doc?.content ?? doc?.markdown ?? "").length;
  return count ? `${Number(count).toLocaleString("zh-CN")} 字` : "";
}

function updateMaterialToolbar(doc = materialById(materialState.selectedId)) {
  const format = $("#materials-format");
  const count = $("#materials-count");
  const previous = $("#materials-prev");
  const next = $("#materials-next");
  if (!format || !count || !previous || !next) return;
  format.textContent = doc ? materialFormatNames[doc.format] || doc.format || "资料" : "未选择";
  format.dataset.format = doc?.format || "";
  count.textContent = materialCountText(doc);
  const index = materialState.materials.findIndex((item) => item.id === materialState.selectedId);
  previous.disabled = index <= 0;
  next.disabled = index < 0 || index >= materialState.materials.length - 1;
  previous.title = index > 0 ? `上一篇：${materialState.materials[index - 1].title}` : "已经是第一篇";
  next.title = index >= 0 && index < materialState.materials.length - 1
    ? `下一篇：${materialState.materials[index + 1].title}`
    : "已经是最后一篇";
}

function renderMaterialEmpty() {
  const body = $("#materials-document");
  const toc = $("#materials-toc");
  body.replaceChildren(
    emptyMessage("选择一篇资料", "左侧按大纲和教材分组，正文会在这里按原格式阅读。"),
  );
  toc.replaceChildren();
  toc.hidden = true;
  updateMaterialToolbar(null);
  applyMaterialReaderState();
}

function renderMaterialDocument(doc) {
  const body = $("#materials-document");
  const content = String(doc.content ?? doc.markdown ?? "");
  const title = element("h2", { className: "materials-title", text: doc.title });
  const sourceUrl = safeHttpUrl(doc.sourceUrl);
  const meta = element("div", { className: "materials-document-meta" }, [
    sourceUrl
      ? element("a", {
          text: "查看来源",
          attrs: { href: sourceUrl, target: "_blank", rel: "noreferrer" },
        })
      : element("span", { className: "muted", text: "本地资料" }),
  ]);
  const rendered = renderMaterialContent(doc.format || "markdown", content, doc.title);
  body.replaceChildren(title, meta, ...rendered);
  updateMaterialToolbar(doc);
  applyMaterialReaderState();
}

function renderMaterialContent(format, content, title) {
  if (format === "markdown") return [renderMaterialMarkdown(content)];
  if (format === "mermaid") return renderMaterialMermaid(content);
  if (format === "html" || format === "svg") {
    const frame = document.createElement("iframe");
    frame.className = "material-frame";
    frame.title = `${title}预览`;
    frame.setAttribute("sandbox", "");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.srcdoc = content;
    return [element("div", { className: "material-frame-wrap" }, [frame])];
  }
  return [element("pre", { className: "material-plain-text", text: content })];
}

function renderMaterialMarkdown(content) {
  const article = element("div", { className: "markdown-body" });
  article.innerHTML = renderMarkdown(content, window.location.origin);
  const firstHeading = article.querySelector(":scope > h1");
  const selected = materialById(materialState.selectedId);
  if (firstHeading && selected && firstHeading.textContent.trim() === selected.title.trim()) {
    firstHeading.remove();
  }
  article.querySelectorAll("pre code[data-language]").forEach((code) => {
    const language = String(code.dataset.language || "").toLowerCase().replace(/^language-/, "");
    if (language !== "mermaid") return;
    const nodes = renderMaterialMermaid(code.textContent || "");
    code.closest("pre")?.replaceWith(...nodes);
  });
  buildMaterialToc(article);
  return article;
}

function renderMaterialMermaid(code) {
  const source = String(code || "").trim();
  const rendered = renderQuestionFigure({ kind: "mermaid", code: source }, false);
  const knownType = /^(?:flowchart|graph|classDiagram|sequenceDiagram|stateDiagram(?:-v2)?)\b/im.test(source);
  const failed = /无法解析|尚未支持渲染/.test(rendered);
  const diagram = element("div", { className: "material-diagram" });
  diagram.innerHTML = rendered;
  if ((!knownType || failed) && !rendered.includes("figure-render-warning")) {
    diagram.prepend(
      element("p", {
        className: "material-render-warning",
        text: "该 Mermaid 语法暂不完全支持，已保留源码供核对。",
      }),
    );
  }
  const sourceBlock = element("details", { className: "material-source" }, [
    element("summary", { text: "查看 Mermaid 源码" }),
    element("pre", { className: "material-source-code" }, [
      element("code", { text: source }),
    ]),
  ]);
  return [diagram, sourceBlock];
}

function buildMaterialToc(article) {
  const toc = $("#materials-toc");
  if (!toc) return;
  const headings = [...article.querySelectorAll("h1, h2, h3")];
  if (!headings.length) {
    toc.replaceChildren();
    toc.hidden = true;
    return;
  }
  const used = new Set();
  const buttons = headings.map((heading, index) => {
    const base = String(heading.textContent || "section")
      .trim()
      .replace(/[^\w\u4e00-\u9fff-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section";
    let id = `material-${base}-${index + 1}`;
    while (used.has(id)) id = `${id}-copy`;
    used.add(id);
    heading.id = id;
    const button = element("button", {
      className: `materials-toc-item level-${heading.tagName.slice(1)}`,
      text: heading.textContent.trim(),
      attrs: { type: "button", "data-target": id },
    });
    button.addEventListener("click", () => {
      heading.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return button;
  });
  toc.replaceChildren(
    element("strong", { className: "materials-toc-title", text: "本页目录" }),
    ...buttons,
  );
  toc.hidden = false;
  updateMaterialTocState();
}

function updateMaterialTocState() {
  const toc = $("#materials-toc");
  const body = $("#materials-content");
  if (!toc || toc.hidden || !body) return;
  const headings = [...$("#materials-document").querySelectorAll("h1, h2, h3")];
  if (!headings.length) return;
  const boundary = body.getBoundingClientRect().top + 36;
  let active = headings[0];
  for (const heading of headings) {
    if (heading.getBoundingClientRect().top <= boundary) active = heading;
  }
  toc.querySelectorAll("button[data-target]").forEach((button) => {
    button.classList.toggle("active", button.dataset.target === active.id);
  });
}

function applyMaterialReaderState() {
  const content = $("#materials-content");
  const documentNode = $("#materials-document");
  const shell = document.querySelector(".app-shell");
  if (content) {
    content.classList.toggle("is-narrow", materialState.narrow);
    content.classList.toggle("is-focus", materialState.focus);
  }
  if (documentNode) {
    documentNode.style.setProperty("--material-font-scale", String(materialState.fontScale));
  }
  shell?.classList.toggle("materials-focus", materialState.focus);
  const width = $("#materials-width");
  const focus = $("#materials-focus");
  const down = $("#materials-font-down");
  const up = $("#materials-font-up");
  if (width) {
    width.textContent = materialState.narrow ? "使用宽版" : "窄版";
    width.setAttribute("aria-pressed", String(materialState.narrow));
  }
  if (focus) {
    focus.textContent = materialState.focus ? "退出专注" : "专注阅读";
    focus.setAttribute("aria-pressed", String(materialState.focus));
  }
  if (down) down.disabled = materialState.fontScale <= 0.9;
  if (up) up.disabled = materialState.fontScale >= 1.25;
}

function openAdjacentMaterial(offset) {
  const index = materialState.materials.findIndex((item) => item.id === materialState.selectedId);
  const target = materialState.materials[index + offset];
  if (target) openMaterial(target.id);
}

async function exportDiagnosis() {
  try {
    const diagnosis = await api("/api/data/diagnosis");
    const blob = new Blob([`${JSON.stringify(diagnosis, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ai-diagnosis-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("学习诊断已导出");
  } catch (error) {
    showToast(error.message, true);
  }
}

async function importDataFile(file) {
  if (!file) return;
  try {
    if (file.size > 50_000_000) throw new Error("备份文件不能超过 50 MB");
    let backup;
    try {
      backup = JSON.parse(await file.text());
    } catch {
      throw new Error("备份文件不是有效的 JSON");
    }
    if (
      !(await confirmDialog({
        title: "导入备份",
        message: "导入会替换当前题库、错题本和练习记录。确认继续？",
        confirmText: "导入",
        danger: true,
      }))
    )
      return;
    await api("/api/data/import", {
      method: "POST",
      body: JSON.stringify({ confirm: "IMPORT", backup }),
    });
    await refreshAfterDataChange();
    showToast("备份已导入并恢复");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    $("#import-file").value = "";
  }
}

async function clearData(scope) {
  const labels = {
    wrongBook: "错题本",
    attempts: "练习记录",
    questions: "题库、未完成练习和错题本",
    all: "全部学习数据",
  };
  if (
    !(await confirmDialog({
      title: "清空数据",
      message: `确认清空${labels[scope]}？此操作不能撤销。`,
      confirmText: "清空",
      danger: true,
    }))
  )
    return;
  try {
    await api("/api/data/clear", {
      method: "POST",
      body: JSON.stringify({ scope, confirm: "CLEAR" }),
    });
    await refreshAfterDataChange();
    showToast(`已清空${labels[scope]}`);
  } catch (error) {
    showToast(error.message, true);
  }
}

async function refreshReviewBadge() {
  try {
    const data = await api("/api/wrong-questions");
    $("#due-count").textContent = data.summary.due;
    $("#due-badge").textContent = data.summary.due;
    setReviewActionState(data.summary.due);
  } catch {
    // 首页仍可使用；错题数据会在下次导航时重试。
  }
}

async function loadModelStatus() {
  try {
    const status = await api("/api/model-status");
    let label = "模型未配置，请在数据管理中配置模型";
    if (status.configured) {
      label =
        status.provider === "openai-compatible"
          ? `${status.model} 已配置`
          : "Claude CLI 已配置";
    }
    $("#model-status").textContent = label;
    $("#model-status").classList.toggle("error-status", !status.configured);
    const sidebarStatus = $(".sidebar-status");
    if (sidebarStatus) {
      sidebarStatus.classList.toggle("ready", Boolean(status.configured));
      sidebarStatus.classList.toggle("error", !status.configured);
    }
    $("#sidebar-model-status").textContent = status.configured
      ? `${status.model || status.provider || "已配置"}`
      : "未配置";
    const select = $("#model-select");
    const models = status.models ?? [];
    select.replaceChildren(
      element("option", { text: "默认模型", attrs: { value: "" } }),
      ...models.map((model) =>
        element("option", { text: model, attrs: { value: model } }),
      ),
    );
    select.hidden = models.length <= 1;
  } catch {
    $("#model-status").textContent = "模型状态未知";
    $("#sidebar-model-status").textContent = "状态未知";
  }
}

async function openRoadmapWeek(week) {
  if (week.action === "paper") {
    switchView("paper");
    await loadPapers();
    return;
  }
  if (week.action === "case") {
    switchView("case");
    await loadCases();
    return;
  }
  if (week.action === "mock") {
    switchView("mock");
    await loadMock();
    return;
  }
  const chapter = Number(week.chapters?.[0]);
  const chapterInfo = state.chapters.find((item) => item.id === chapter);
  if (!chapterInfo) {
    showToast("本周没有可定位的教材章节。", true);
    return;
  }
  switchView("materials");
  await loadMaterials();
  const padded = String(chapter).padStart(2, "0");
  const materialId = `textbook-第${padded}章-${chapterInfo.title}`;
  const material = materialState.materials.find((item) => item.id === materialId)
    ?? materialState.materials.find((item) => item.group === "textbook" && item.title.includes(`第${padded}章`));
  if (material) await openMaterial(material.id);
  else showToast(`未找到第 ${chapter} 章教材资料，请从“资料”页选择对应章节。`);
}

async function loadStudyPlan() {
  try {
    const plan = await api("/api/study-plan");
    const panel = $("#study-plan");
    panel.hidden = false;
    $("#plan-today").textContent = plan.todayAnswered;
    $("#plan-goal").textContent = plan.dailyGoal;
    $("#plan-streak").textContent = plan.streak;
    $("#plan-goal-select").value = String(plan.dailyGoal);
    const percent = plan.dailyGoal
      ? Math.min(100, Math.round((plan.todayAnswered / plan.dailyGoal) * 100))
      : 0;
    $("#plan-bar span").style.width = `${percent}%`;
    $("#plan-meta").textContent = plan.dailyGoal
      ? plan.todayDone
        ? "今日目标已完成，继续保持！"
        : `还差 ${Math.max(0, plan.dailyGoal - plan.todayAnswered)} 题完成今日目标`
      : "设置每日目标，开始坚持打卡。";
    $("#sidebar-plan-progress").textContent = plan.dailyGoal
      ? `${plan.todayAnswered} / ${plan.dailyGoal}`
      : `${plan.todayAnswered} 题`;
    $("#sidebar-plan-bar").style.width = `${percent}%`;
  } catch {
    // 学习计划加载失败不影响其他功能。
  }
}

async function setDailyGoal(goal) {
  try {
    await api("/api/study-plan/goal", {
      method: "POST",
      body: JSON.stringify({ goal: Number(goal) }),
    });
    await loadStudyPlan();
  } catch (error) {
    showToast(error.message, true);
  }
}

function populateCaseChapters() {
  const select = $("#case-chapter");
  select.replaceChildren(
    ...state.chapters.map((chapter) =>
      element("option", {
        text: `第 ${chapter.id} 章　${chapter.title}`,
        attrs: { value: chapter.id },
      }),
    ),
  );
}

async function loadCases() {
  populateCaseChapters();
  const loadId = ++state.caseLoadId;
  const load = beginLoad("cases", "#case-list", "正在加载案例…");
  try {
    const params = new URLSearchParams({
      sourceType: $("#case-source")?.value || "all",
      limit: state.caseLimit,
      offset: state.caseOffset,
    });
    const data = await api(`/api/cases?${params}`);
    if (loadId !== state.caseLoadId || !load.isCurrent()) return;
    if (state.caseOffset > 0 && !data.cases.length && data.total > 0) {
      state.caseOffset = Math.max(0, state.caseOffset - state.caseLimit);
      return loadCases();
    }
    state.caseTotal = data.total;
    state.caseOffset = data.offset;
    renderCases(data.cases, data.total);
    load.finish();
  } catch (error) {
    load.fail(error, loadCases);
  }
}

function caseNode(caseItem) {
  const questions = caseItem.questions.map((question, index) =>
    element("div", { className: "case-question" }, [
      element("div", { className: "case-question-head" }, [
        element("strong", { text: `问题 ${index + 1}（${question.points} 分）` }),
      ]),
      element("p", { className: "question-text", text: question.text }),
      element("textarea", {
        className: "case-answer",
        attrs: {
          rows: "4",
          placeholder: "在此输入你的作答…",
          "aria-label": "案例作答：问题 " + (index + 1) + "，" + question.text,
          "data-case-id": caseItem.id,
          "data-question-id": question.id,
        },
      }),
      element("div", { className: "case-question-actions" }, [
        element("button", {
          className: "small-button case-draft-button",
          text: "保存草稿",
          attrs: { type: "button" },
        }),
      ]),
      element("details", { className: "case-reference" }, [
        element("summary", { text: "查看参考答案" }),
        element("p", { text: question.referenceAnswer }),
      ]),
    ]),
  );
  const showReferenceButton = element("button", {
    className: "ghost",
    text: "展开全部参考答案",
    attrs: { type: "button" },
  });
  showReferenceButton.addEventListener("click", () => {
    const container = showReferenceButton.closest(".case-card");
    container.querySelectorAll(".case-reference").forEach((node) => {
      node.open = true;
    });
    showReferenceButton.disabled = true;
    showReferenceButton.textContent = "已展开全部参考答案";
  });
  const aiGradeButton = element("button", {
    className: "primary case-ai-grade",
    text: "AI 评分",
    attrs: { type: "button" },
  });
  aiGradeButton.addEventListener("click", () =>
    gradeCaseWithAI(caseItem, aiGradeButton),
  );
  // 回填已保存的草稿
  const drafts = caseItem.drafts ?? {};
  // 回显已持久化的 AI 评分（含相关知识点链接）。
  const gradeBox = element("div", {
    className: "case-grade-result",
    hidden: !caseItem.grade,
  });
  if (caseItem.grade) gradeBox.replaceChildren(caseGradeNode(caseItem.grade));
  return element("article", { className: "panel case-card" }, [
    element("div", { className: "case-card-header" }, [
      element("div", { className: "bank-tags" }, [
        element("span", { text: sourceTypeLabel(caseItem) }),
        caseItem.term ? element("span", { text: caseItem.term }) : null,
        element("span", { text: `第 ${caseItem.chapter} 章` }),
        element("span", { text: caseItem.section || "整章" }),
        element("span", { text: caseItem.knowledgePoint }),
      ]),
    ]),
    element("h3", { className: "case-title", text: caseItem.title }),
    answerTrustNode(caseItem),
    element("p", { className: "case-scenario", text: caseItem.scenario }),
    sourceNodeNode(caseItem.sourceNode),
    ...questions,
    element("div", { className: "case-actions" }, [
      showReferenceButton,
      aiGradeButton,
    ]),
    gradeBox,
  ]);
}

async function gradeCaseWithAI(caseItem, button) {
  const card = button.closest(".case-card");
  const textareas = card.querySelectorAll(".case-answer");
  const answers = {};
  for (const textarea of textareas) {
    answers[textarea.dataset.questionId] = textarea.value;
  }
  const answered = Object.values(answers).filter((text) => text.trim()).length;
  if (!answered) {
    showToast("请至少作答一道小问再评分", true);
    return;
  }
  button.disabled = true;
  button.textContent = "AI 评分中…";
  const gradeBox = card.querySelector(".case-grade-result");
  gradeBox.hidden = true;
  try {
    const grade = await api("/api/cases/grade", {
      method: "POST",
      body: JSON.stringify({
        caseId: caseItem.id,
        answers,
        model: $("#model-select").value || undefined,
      }),
      timeoutMs: LONG_API_TIMEOUT_MS,
    });
    gradeBox.replaceChildren(caseGradeNode(grade));
    gradeBox.hidden = false;
    showToast(`AI 评分完成：${grade.total_score}/${grade.max_score} 分`);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "AI 评分";
  }
}

// 案例逐问得分展示，样式与论文评分卡一致。
function caseGradeNode(grade) {
  const results = (grade.results ?? []).map((item) =>
    element("div", { className: "grade-dimension" }, [
      element("div", { className: "stat-row-heading" }, [
        element("strong", { text: item.text }),
        element("span", {
          className: item.score >= item.max ? "result-status" : "",
          text: `${item.score}/${item.max} 分${item.answered ? "" : "（未作答）"}`,
        }),
      ]),
      percentBar(item.max ? Math.round((item.score / item.max) * 100) : 0),
      item.comment
        ? element("p", { className: "muted", text: item.comment })
        : null,
    ]),
  );
  return element("details", { className: "paper-grade grade-disclosure" }, [
    element("summary", { text: "AI 评分：" + grade.total_score + "/" + grade.max_score + " 分" }),
    element("div", { className: "grade-disclosure-content" }, [
    ...results,
    grade.overall_comment
      ? element("p", { className: "grade-comment", text: grade.overall_comment })
      : null,
    (grade.wikiEntries ?? []).length
      ? element("div", { className: "wiki-section" }, [
          element("h4", { text: "相关知识点" }),
          element(
            "div",
            { className: "wiki-backlinks" },
            grade.wikiEntries.map(wikiLinkNode),
          ),
        ])
      : null,
    ]),
  ]);
}

function updateCasePagination(total) {
  const pagination = $("#case-pagination");
  const pageCount = Math.max(1, Math.ceil(total / state.caseLimit));
  const currentPage = Math.floor(state.caseOffset / state.caseLimit) + 1;
  $("#case-page").textContent = total
    ? `第 ${currentPage} / ${pageCount} 页 · 共 ${total} 道`
    : "暂无案例";
  $("#case-previous").disabled = state.caseOffset === 0;
  $("#case-next").disabled = state.caseOffset + state.caseLimit >= total;
  pagination.hidden = total <= state.caseLimit;
}

function renderCases(cases, total = cases.length) {
  $("#case-list").replaceChildren(
    ...(cases.length
      ? cases.map(caseNode)
      : [
          emptyMessage(
            "还没有案例分析题",
            "选择章节生成案例，或先到数据管理导入真题库。",
          ),
        ]),
  );
  // 回填草稿并绑定草稿保存按钮
  $("#case-list")
    .querySelectorAll(".case-card")
    .forEach((card, index) => {
      const caseItem = cases[index];
      if (!caseItem) return;
      const drafts = caseItem.drafts ?? {};
      card.querySelectorAll(".case-answer").forEach((textarea) => {
        const draft = drafts[textarea.dataset.questionId];
        if (draft) textarea.value = draft;
      });
      card.querySelectorAll(".case-draft-button").forEach((button) => {
        button.addEventListener("click", async () => {
          const textarea = button.closest(".case-question").querySelector(".case-answer");
          if (button.disabled) return;
          button.disabled = true;
          button.textContent = "保存中…";
          try {
            await api("/api/cases/draft", {
              method: "POST",
              body: JSON.stringify({
                caseId: caseItem.id,
                questionId: textarea.dataset.questionId,
                text: textarea.value,
              }),
            });
            button.textContent = "已保存";
            showToast("案例草稿已保存");
            setTimeout(() => {
              if (button.isConnected) {
                button.disabled = false;
                button.textContent = "保存草稿";
              }
            }, 2000);
          } catch (error) {
            showToast(error.message, true);
            button.disabled = false;
            button.textContent = "保存草稿";
          }
        });
      });
    });
  updateCasePagination(total);
}

async function generateCases() {
  const button = $("#case-generate");
  const progress = $("#case-progress");
  const progressText = $("#case-progress-text");
  const task = beginGenerationTask({
    key: "cases",
    button,
    progress,
    progressText,
    cancel: $("#case-cancel"),
    label: "生成案例",
  });
  try {
    const result = await api("/api/cases/generate", {
      method: "POST",
      body: JSON.stringify({
        chapter: $("#case-chapter").value,
        count: $("#case-count").value,
        model: $("#model-select").value || undefined,
      }),
      signal: task.signal,
      timeoutMs: LONG_API_TIMEOUT_MS,
    });
    showToast(
      `已生成 ${result.added} 道案例分析题${result.duplicatesSkipped ? `，过滤 ${result.duplicatesSkipped} 条重复` : ""}`,
    );
    state.caseOffset = 0;
    await loadCases();
  } catch (error) {
    if (isGenerationCancelled(error, task.signal)) {
      showToast("已停止生成案例");
      return;
    }
    showToast(error.message, true);
  } finally {
    task.finish();
  }
}

function populatePaperChapters() {
  const select = $("#paper-chapter");
  select.replaceChildren(
    ...state.chapters.map((chapter) =>
      element("option", {
        text: `第 ${chapter.id} 章　${chapter.title}`,
        attrs: { value: chapter.id },
      }),
    ),
  );
}

function clearPaperMockTimers() {
  for (const timer of state.paperMockTimers) clearInterval(timer);
  state.paperMockTimers.clear();
}

async function loadPapers() {
  populatePaperChapters();
  const loadId = ++state.paperLoadId;
  clearPaperMockTimers();
  const load = beginLoad("papers", "#paper-list", "正在加载论文题目…");
  try {
    const params = new URLSearchParams({
      sourceType: $("#paper-source")?.value || "all",
      limit: state.paperLimit,
      offset: state.paperOffset,
    });
    const data = await api(`/api/papers?${params}`);
    if (loadId !== state.paperLoadId || !load.isCurrent()) return;
    if (state.paperOffset > 0 && !data.papers.length && data.total > 0) {
      state.paperOffset = Math.max(0, state.paperOffset - state.paperLimit);
      return loadPapers();
    }
    state.paperTotal = data.total;
    state.paperOffset = data.offset;
    renderPapers(data.papers, data.total);
    load.finish();
  } catch (error) {
    load.fail(error, loadPapers);
  }
}

function paperNode(paper) {
  const writingPoints = (paper.writingPoints ?? []).map((point) =>
    element("li", { text: point }),
  );
  const textarea = element("textarea", {
    className: "paper-draft",
    attrs: {
      rows: "12",
      placeholder:
        "第一行只写“摘要”，其后另起“正文”或一级标题。摘要 300–400 字，正文 2000–3000 字，并用第一人称写清项目职责。",
      "aria-label": "论文草稿：" + (paper.title || paper.id),
      "data-paper-id": paper.id,
    },
  });
  textarea.value = paper.draft || "";
  // 论文模拟计时：120 分钟倒计时基于服务端开始时间，刷新安全。
  let mockTimer = null;
  const mockBar = element("div", { className: "paper-mock-bar" }, []);
  const stopMockTimer = () => {
    if (mockTimer === null) return;
    clearInterval(mockTimer);
    state.paperMockTimers.delete(mockTimer);
    mockTimer = null;
  };
  const renderMockBar = () => {
    stopMockTimer();
    const mock = paper.mock;
    if (!mock) {
      const startButton = element("button", {
        className: "small-button paper-mock-start",
        text: "开始 120 分钟模拟",
        attrs: { type: "button" },
      });
      startButton.addEventListener("click", async () => {
        try {
          const result = await api("/api/papers/mock-start", {
            method: "POST",
            body: JSON.stringify({ paperId: paper.id }),
          });
          if (!mockBar.isConnected) return;
          paper.mock = result.mock;
          showToast("论文模拟已开始，倒计时 120 分钟");
          renderMockBar();
        } catch (error) {
          showToast(error.message, true);
        }
      });
      mockBar.replaceChildren(startButton);
      return;
    }
    const countdown = element("strong", { className: "countdown" });
    const label = element("span", { text: "剩余时间 · 到时请提交论文" });
    mockBar.replaceChildren(countdown, label);
    const deadline =
      new Date(mock.startedAt).getTime() + mock.durationSeconds * 1000;
    const tick = () => {
      // 列表刷新会移除旧卡片；避免旧卡片继续计时并弹出过期提示。
      if (mockTimer !== null && !mockBar.isConnected) {
        stopMockTimer();
        return;
      }
      const remaining = Math.max(
        0,
        Math.round((deadline - Date.now()) / 1000),
      );
      const minutes = Math.floor(remaining / 60);
      const seconds = remaining % 60;
      countdown.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
      countdown.classList.toggle("urgent", remaining <= 300);
      if (remaining === 0) {
        stopMockTimer();
        if (mockBar.isConnected) showToast("论文模拟时间到，请提交论文");
      }
    };
    tick();
    mockTimer = setInterval(tick, 1000);
    state.paperMockTimers.add(mockTimer);
  };
  renderMockBar();
  const saveButton = element("button", {
    className: "secondary",
    text: "保存草稿",
    attrs: { type: "button" },
  });
  saveButton.addEventListener("click", async () => {
    if (saveButton.disabled) return;
    saveButton.disabled = true;
    saveButton.textContent = "保存中…";
    try {
      await api("/api/papers/draft", {
        method: "POST",
        body: JSON.stringify({ paperId: paper.id, draft: textarea.value }),
      });
      showToast("草稿已保存");
    } catch (error) {
      showToast(error.message, true);
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = "保存草稿";
    }
  });
  const gradeButton = element("button", {
    className: "primary",
    text: "提交评分",
    attrs: { type: "button" },
  });
  gradeButton.addEventListener("click", async () => {
    if (!textarea.value.trim()) {
      showToast("请先撰写论文内容", true);
      return;
    }
    const structure = validateEssaySample(paper, textarea.value);
    if (!structure.valid) {
      showToast(structure.errors.join("；"), true);
      return;
    }
    gradeButton.disabled = true;
    gradeButton.textContent = "评分中…";
    try {
      const grade = await api("/api/papers/grade", {
        method: "POST",
        body: JSON.stringify({
          paperId: paper.id,
          draft: textarea.value,
          model: $("#model-select").value || undefined,
        }),
        timeoutMs: LONG_API_TIMEOUT_MS,
      });
      await loadPapers();
      showToast(`评分完成：${grade.total_score} 分`);
    } catch (error) {
      showToast(error.message, true);
      gradeButton.disabled = false;
      gradeButton.textContent = "提交评分";
    }
  });
  const gradeNode = paper.grade ? paperGradeNode(paper.grade) : null;
  const aiSample = paper.aiSample;
  return element("article", { className: "panel paper-card" }, [
    element("div", { className: "paper-card-header" }, [
      element("div", { className: "bank-tags" }, [
        element("span", { text: sourceTypeLabel(paper) }),
        paper.term ? element("span", { text: paper.term }) : null,
        element("span", { text: `第 ${paper.chapter} 章` }),
        element("span", { text: paper.section || "整章" }),
        element("span", { text: paper.knowledgePoint }),
      ]),
    ]),
    element("h3", { className: "paper-title", text: paper.title }),
    answerTrustNode(paper),
    element("p", { className: "paper-description", text: paper.description }),
    sourceNodeNode(paper.sourceNode),
    writingPoints.length
      ? element("details", { className: "paper-points" }, [
          element("summary", { text: "写作要点（" + writingPoints.length + "）" }),
          element("ul", {}, writingPoints),
        ])
      : null,
    aiSample
      ? element("details", { className: "paper-points paper-ai-sample" }, [
          element("summary", { text: "AI 参考范文（非官方，学习结构用）" }),
          element("p", { className: "muted", text: aiSample.note }),
          element("div", {
            className: "paper-ai-sample-content",
            text: aiSample.content,
          }),
        ])
      : null,
    textarea,
    mockBar,
    element("div", { className: "paper-actions" }, [saveButton, gradeButton]),
    gradeNode,
  ]);
}

function paperGradeNode(grade) {
  const dimensions = Object.entries(grade.dimensions ?? {}).map(
    ([name, dim]) =>
      element("div", { className: "grade-dimension" }, [
        element("div", { className: "stat-row-heading" }, [
          element("strong", { text: name }),
          element("span", { text: `${dim.score}/${dim.max}` }),
        ]),
        percentBar(dim.max ? Math.round((dim.score / dim.max) * 100) : 0),
        dim.comment
          ? element("p", { className: "muted", text: dim.comment })
          : null,
      ]),
  );
  return element("details", { className: "paper-grade grade-disclosure" }, [
    element("summary", { text: "评分结果：" + grade.total_score + "/" + grade.max_score + " 分" }),
    element("div", { className: "grade-disclosure-content" }, [
    ...dimensions,
    grade.overall_comment
      ? element("p", { className: "grade-comment", text: grade.overall_comment })
      : null,
    grade.structureWarnings?.length
      ? element("div", { className: "grade-list structure-warnings" }, [
          element("h4", { text: "书写提醒" }),
          element(
            "ul",
            {},
            grade.structureWarnings.map((item) => element("li", { text: item })),
          ),
        ])
      : null,
    grade.strengths?.length
      ? element("div", { className: "grade-list" }, [
          element("h4", { text: "优势" }),
          element("ul", {}, grade.strengths.map((s) => element("li", { text: s }))),
        ])
      : null,
    grade.weaknesses?.length
      ? element("div", { className: "grade-list" }, [
          element("h4", { text: "不足" }),
          element("ul", {}, grade.weaknesses.map((s) => element("li", { text: s }))),
        ])
      : null,
    grade.recommendations?.length
      ? element("div", { className: "grade-list" }, [
          element("h4", { text: "改进建议" }),
          element("ul", {}, grade.recommendations.map((s) => element("li", { text: s }))),
        ])
      : null,
    (grade.wikiEntries ?? []).length
      ? element("div", { className: "wiki-section" }, [
          element("h4", { text: "相关知识点" }),
          element(
            "div",
            { className: "wiki-backlinks" },
            grade.wikiEntries.map(wikiLinkNode),
          ),
        ])
      : null,
    ]),
  ]);
}

function updatePaperPagination(total) {
  const pagination = $("#paper-pagination");
  const pageCount = Math.max(1, Math.ceil(total / state.paperLimit));
  const currentPage = Math.floor(state.paperOffset / state.paperLimit) + 1;
  $("#paper-page").textContent = total
    ? `第 ${currentPage} / ${pageCount} 页 · 共 ${total} 道`
    : "暂无论文题目";
  $("#paper-previous").disabled = state.paperOffset === 0;
  $("#paper-next").disabled = state.paperOffset + state.paperLimit >= total;
  pagination.hidden = total <= state.paperLimit;
}

function renderPapers(papers, total = papers.length) {
  clearPaperMockTimers();
  $("#paper-empty").hidden = papers.length > 0;
  $("#paper-list").replaceChildren(...papers.map(paperNode));
  updatePaperPagination(total);
}

async function generatePapers() {
  const button = $("#paper-generate");
  const progress = $("#paper-progress");
  const progressText = $("#paper-progress-text");
  const task = beginGenerationTask({
    key: "papers",
    button,
    progress,
    progressText,
    cancel: $("#paper-cancel"),
    label: "生成论文题目",
  });
  try {
    const result = await api("/api/papers/generate", {
      method: "POST",
      body: JSON.stringify({
        chapter: $("#paper-chapter").value,
        count: $("#paper-count").value,
        model: $("#model-select").value || undefined,
      }),
      signal: task.signal,
      timeoutMs: LONG_API_TIMEOUT_MS,
    });
    showToast(
      `已生成 ${result.added} 道论文题目${result.duplicatesSkipped ? `，过滤 ${result.duplicatesSkipped} 条重复` : ""}`,
    );
    state.paperOffset = 0;
    await loadPapers();
  } catch (error) {
    if (isGenerationCancelled(error, task.signal)) {
      showToast("已停止生成论文题目");
      return;
    }
    showToast(error.message, true);
  } finally {
    task.finish();
  }
}

function populateWikiChapters() {
  const select = $("#wiki-chapter");
  select.replaceChildren(
    ...state.chapters.map((chapter) =>
      element("option", {
        text: `第 ${chapter.id} 章　${chapter.title}`,
        attrs: { value: chapter.id },
      }),
    ),
  );
}

async function loadWiki() {
  populateWikiChapters();
  const load = beginLoad(
    "wiki",
    ["#wiki-directory", "#wiki-reader"],
    "正在加载知识库…",
  );
  try {
    const data = await api("/api/wiki");
    if (!load.isCurrent()) return;
    state.wikiEntries = data.entries;
    renderWiki();
    if (!$("#wiki-graph").hidden) {
      renderWikiGraph(wikiFilteredEntries(), {
        focusId: state.wikiSelectedId,
        colorBy: state.wikiGraphColorBy,
      });
    }
    load.finish();
  } catch (error) {
    load.fail(error, loadWiki);
  }
}

// Wiki 自检（Lint）：同名条目 / 引用断链 / 孤立条目 / 缺少溯源。
const wikiLintNames = {
  duplicate_title: "同名条目",
  broken_related: "引用断链",
  orphan: "孤立条目",
  missing_source: "缺少溯源",
};

// 问知识库：两阶段（先选题后作答），答案附可点击的引用条目。
async function askWiki() {
  const input = $("#wiki-question");
  const question = input.value.trim();
  if (!question) {
    showToast("请先输入问题", true);
    return;
  }
  const button = $("#wiki-ask");
  const resultBox = $("#wiki-ask-result");
  button.disabled = true;
  resultBox.hidden = true;
  button.textContent = "思考中…";
  try {
    const result = await api("/api/wiki/ask", {
      method: "POST",
      body: JSON.stringify({
        question,
        model: $("#model-select")?.value || undefined,
      }),
      timeoutMs: LONG_API_TIMEOUT_MS,
    });
    const references = (result.references ?? []).map(wikiLinkNode);
    resultBox.replaceChildren(
      element("div", {
        className: `wiki-ask-answer${result.abstained ? " wiki-ask-abstain" : ""}`,
      }, [
        element("p", { className: "wiki-ask-text", text: result.answer }),
        references.length
          ? element("div", { className: "wiki-section" }, [
              element("h4", { text: "引用条目" }),
              element("div", { className: "wiki-backlinks" }, references),
            ])
          : null,
      ]),
    );
    resultBox.hidden = false;
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "提问";
  }
}

async function runWikiLint() {
  const panel = $("#wiki-lint-result");
  const button = $("#wiki-lint");
  button.disabled = true;
  try {
    const result = await api("/api/wiki/lint");
    panel.hidden = false;
    $("#wiki-lint-summary").textContent = `共 ${result.total} 个条目，${result.problems} 个需要处理`;
    const items = result.issues.map((item) => {
      const node = element("div", { className: "wiki-lint-item" }, [
        element("button", {
          className: "wiki-lint-title",
          text: item.title,
          attrs: { type: "button" },
        }),
        ...item.issues.map((issue) =>
          element("span", {
            className: "wiki-lint-tag",
            text: wikiLintNames[issue] || issue,
          }),
        ),
      ]);
      // 断链修复：把解析不到的引用一键改为建议的现有条目标题。
      for (const suggestion of item.suggestions ?? []) {
        const fixButton = element("button", {
          className: "small-button",
          text: `「${suggestion.name}」→「${suggestion.candidate}」`,
          attrs: { type: "button" },
        });
        fixButton.addEventListener("click", async () => {
          try {
            await api("/api/wiki/lint/fix", {
              method: "POST",
              body: JSON.stringify({
                entryId: item.id,
                name: suggestion.name,
                candidate: suggestion.candidate,
              }),
            });
            showToast("已修复引用");
            await runWikiLint();
          } catch (error) {
            showToast(error.message, true);
          }
        });
        node.append(fixButton);
      }
      // 同名条目：一键合并到最早的条目。
      if (item.issues.includes("duplicate_title") && item.mergeInto) {
        const mergeButton = element("button", {
          className: "small-button",
          text: "合并到最早条目",
          attrs: { type: "button" },
        });
        mergeButton.addEventListener("click", async () => {
          try {
            await api("/api/wiki/merge", {
              method: "POST",
              body: JSON.stringify({ entryId: item.id, intoId: item.mergeInto }),
            });
            showToast("已合并条目");
            await runWikiLint();
          } catch (error) {
            showToast(error.message, true);
          }
        });
        node.append(mergeButton);
      }
      node
        .querySelector(".wiki-lint-title")
        .addEventListener("click", () => jumpToWikiEntry(item.id));
      return node;
    });
    $("#wiki-lint-issues").replaceChildren(
      ...(items.length
        ? items
        : [
            emptyMessage(
              "自检通过",
              "没有发现同名、断链、孤立或缺少溯源的条目。",
            ),
          ]),
    );
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
}


const wikiStatusNames = {
  draft: "待校对",
  reviewed: "已校对",
  flagged: "有疑问",
};

function wikiNode(entry) {
  const relatedSuggestions = element("div", {
    className: "wiki-related-suggestions",
    attrs: { "aria-busy": "true" },
  });
  loadWikiRelatedSuggestions(entry.id, relatedSuggestions);
  entry._relatedSuggestionsNode = relatedSuggestions;
  const statusClass = `wiki-status ${entry.status}`;
  const keyPoints = (entry.keyPoints ?? []).map((point) =>
    element("li", { text: point }),
  );
  const mistakes = (entry.commonMistakes ?? []).map((point) =>
    element("li", { text: point }),
  );
  // 双向链接：related 中能匹配到现有条目的显示为可点击链接。
  const related = (entry.related ?? []).map((point, index) => {
    const targetId = entry.links?.[index];
    const tag = element("span", {
      className: `wiki-related-tag${targetId ? " linked" : ""}`,
      text: point,
    });
    if (targetId) {
      tag.addEventListener("click", () => jumpToWikiEntry(targetId));
    }
    return tag;
  });
  // 反链：引用当前条目的其他条目。
  const backlinks = (entry.backlinks ?? []).map((link) =>
    element("button", {
      className: "wiki-backlink",
      text: link.title,
      attrs: { type: "button" },
    }),
  );
  backlinks.forEach((button, index) => {
    button.addEventListener("click", () =>
      jumpToWikiEntry(entry.backlinks[index].id),
    );
  });
  const statusButton = element("button", {
    className: "small-button",
    text: entry.status === "reviewed" ? "标记有疑问" : "标记已校对",
    attrs: { type: "button" },
  });
  statusButton.addEventListener("click", async () => {
    const next = entry.status === "reviewed" ? "flagged" : "reviewed";
    try {
      await api("/api/wiki/status", {
        method: "POST",
        body: JSON.stringify({ entryId: entry.id, status: next }),
      });
      await loadWiki();
    } catch (error) {
      showToast(error.message, true);
    }
  });
  const editButton = element("button", {
    className: "small-button",
    text: "编辑",
    attrs: { type: "button" },
  });
  editButton.addEventListener("click", () => {
    const card = editButton.closest(".wiki-entry");
    const editor = card.querySelector(".wiki-editor");
    editor.hidden = !editor.hidden;
  });
  const summaryInput = element("textarea", {
    className: "wiki-edit-summary",
    attrs: { rows: "4", "aria-label": "编辑概念解释" },
  });
  summaryInput.value = entry.summary || "";
  const saveEdit = element("button", {
    className: "primary",
    text: "保存修改",
    attrs: { type: "button" },
  });
  saveEdit.addEventListener("click", async () => {
    try {
      await api("/api/wiki/entry", {
        method: "PATCH",
        body: JSON.stringify({
          entryId: entry.id,
          updates: { summary: summaryInput.value },
        }),
      });
      showToast("已保存修改");
      await loadWiki();
    } catch (error) {
      showToast(error.message, true);
    }
  });
  return element("article", { className: "wiki-entry", attrs: { "data-id": entry.id } }, [
    element("div", { className: "wiki-card-header" }, [
      element("div", { className: "bank-tags" }, [
        element("span", { text: `第 ${entry.chapter} 章` }),
        element("span", { text: entry.section || "整章" }),
        element("span", { className: statusClass, text: wikiStatusNames[entry.status] || entry.status }),
      ]),
    ]),
    element("h3", { className: "wiki-title", text: entry.title }),
    element("p", { className: "wiki-summary", text: entry.summary }),
    entry.aiCheckNote
      ? element("p", { className: "wiki-ai-note muted", text: entry.aiCheckNote })
      : null,
    sourceNodeNode(entry.sourceNode),
    keyPoints.length
      ? element("div", { className: "wiki-section" }, [
          element("h4", { text: "关键要点" }),
          element("ul", {}, keyPoints),
        ])
      : null,
    mistakes.length
      ? element("div", { className: "wiki-section" }, [
          element("h4", { text: "常见误区" }),
          element("ul", {}, mistakes),
        ])
      : null,
    related.length
      ? element("div", { className: "wiki-section" }, [
          element("h4", { text: "关联知识点" }),
          element("div", { className: "wiki-related" }, related),
        ])
      : null,
    backlinks.length
      ? element("div", { className: "wiki-section" }, [
          element("h4", { text: "反向链接" }),
          element("div", { className: "wiki-backlinks" }, backlinks),
        ])
      : null,
    element("div", { className: "wiki-section" }, [
      element("h4", { text: "猜你想看（语义相关）" }),
      relatedSuggestions,
    ]),
    element("div", { className: "wiki-actions" }, [editButton, statusButton]),
    element("div", { className: "wiki-editor", hidden: true }, [
      element("h4", { text: "编辑概念解释" }),
      summaryInput,
      element("div", { className: "wiki-editor-actions" }, [saveEdit]),
    ]),
  ]);
}

function wikiDirectoryNode(entry, active) {
  const button = element("button", {
    className: `wiki-directory-item${active ? " active" : ""}`,
    attrs: {
      type: "button",
      "aria-current": active ? "page" : "false",
    },
  }, [
    element("span", { className: "wiki-directory-meta", text: `第 ${entry.chapter} 章 · ${entry.section || "整章"}` }),
    element("strong", { text: entry.title }),
    element("span", { className: "wiki-directory-summary", text: entry.summary || "暂无摘要" }),
    element("span", { className: `wiki-status ${entry.status}`, text: wikiStatusNames[entry.status] || entry.status }),
  ]);
  button.addEventListener("click", () => {
    state.wikiSelectedId = entry.id;
    renderWiki();
    // 图谱模式下点目录 = 在图谱中定位该知识点。
    if (!$("#wiki-graph").hidden) focusWikiGraphNode(entry.id);
  });
  return button;
}

function populateWikiChapterFilter() {
  const select = $("#wiki-chapter-filter");
  if (!select) return;
  const current = select.value || "all";
  const chapters = [
    ...new Set(state.wikiEntries.map((entry) => Number(entry.chapter) || 0)),
  ].sort((a, b) => a - b);
  select.replaceChildren(
    element("option", { text: "全部章节", attrs: { value: "all" } }),
    ...chapters.map((chapter) =>
      element("option", { text: `第 ${chapter} 章`, attrs: { value: String(chapter) } }),
    ),
  );
  select.value = chapters.includes(Number(current)) ? current : "all";
}

// 目录与图谱共用的同一套筛选：搜索关键词 + 章节 + 校对状态。
function wikiFilteredEntries() {
  const search = $("#wiki-search").value.trim().toLowerCase();
  const statusFilter = $("#wiki-status-filter").value;
  const chapterFilter = $("#wiki-chapter-filter").value;
  return state.wikiEntries.filter((entry) => {
    if (statusFilter !== "all" && entry.status !== statusFilter) return false;
    if (
      chapterFilter !== "all" &&
      String(Number(entry.chapter) || 0) !== chapterFilter
    ) {
      return false;
    }
    if (search) {
      const text = `${entry.title} ${entry.summary} ${(entry.keyPoints ?? []).join(" ")}`.toLowerCase();
      if (!text.includes(search)) return false;
    }
    return true;
  });
}

function renderFilteredWikiGraph() {
  if (!currentWikiGraph() || $("#wiki-graph").hidden) return;
  const depth = Number($("#wiki-graph-depth")?.value) || state.wikiGraphDepth || 1;
  state.wikiGraphDepth = depth;
  renderWikiGraph(wikiFilteredEntries(), {
    focusId: state.wikiSelectedId,
    colorBy: state.wikiGraphColorBy,
    focusDepth: depth,
  });
}

function renderWiki() {
  populateWikiChapterFilter();
  const filtered = wikiFilteredEntries();
  if (!filtered.some((entry) => entry.id === state.wikiSelectedId)) {
    state.wikiSelectedId = filtered[0]?.id || "";
  }
  const selected = state.wikiEntries.find((entry) => entry.id === state.wikiSelectedId);
  $("#wiki-directory-count").textContent = filtered.length ? `${filtered.length} 个条目` : "0 个条目";
  $("#wiki-directory").replaceChildren(
    ...(filtered.length
      ? filtered.map((entry) => wikiDirectoryNode(entry, entry.id === state.wikiSelectedId))
      : [emptyMessage("暂无匹配条目", "尝试清除搜索或状态筛选。")]),
  );
  $("#wiki-reader").replaceChildren(
    ...(selected
      ? [wikiNode(selected)]
      : [emptyMessage("还没有知识点条目", "选择章节后，点击上方按钮生成知识点条目。")]),
  );
}

function setWikiWorkspaceTab(tab) {
  const graphActive = tab === "graph";
  const readerTab = $("#wiki-reader-tab");
  const graphTab = $("#wiki-graph-toggle");
  const readerPane = $("#wiki-reader");
  const graphPane = $("#wiki-graph");
  readerTab.classList.toggle("active", !graphActive);
  graphTab.classList.toggle("active", graphActive);
  readerTab.setAttribute("aria-selected", String(!graphActive));
  graphTab.setAttribute("aria-selected", String(graphActive));
  readerPane.hidden = graphActive;
  graphPane.hidden = !graphActive;
  if (graphActive) {
    renderWikiGraph(wikiFilteredEntries(), {
      focusId: state.wikiSelectedId,
      colorBy: state.wikiGraphColorBy,
      focusDepth: Number($("#wiki-graph-depth")?.value) || state.wikiGraphDepth || 1,
    });
  } else destroyWikiGraph();
}

// 跳转到指定 Wiki 条目：切换右侧阅读器，不移动整页滚动位置。
async function jumpToWikiEntry(entryId) {
  switchView("wiki");
  if (!state.wikiEntries.length) {
    try {
      const data = await api("/api/wiki");
      state.wikiEntries = data.entries;
    } catch (error) {
      showToast(error.message, true);
      return;
    }
  }
  $("#wiki-search").value = "";
  $("#wiki-status-filter").value = "all";
  $("#wiki-chapter-filter").value = "all";
  state.wikiSelectedId = entryId;
  setWikiWorkspaceTab("reader");
  renderWiki();
  const entry = state.wikiEntries.find((item) => item.id === entryId);
  if (!entry || state.wikiSelectedId !== entryId) {
    showToast("该条目不存在或已被过滤");
    return;
  }
  $("#wiki-reader").scrollTo({ top: 0, behavior: "smooth" });
  $("#wiki-reader").focus({ preventScroll: true });
}

async function generateWiki() {
  const button = $("#wiki-generate");
  const progress = $("#wiki-progress");
  const progressText = $("#wiki-progress-text");
  const task = beginGenerationTask({
    key: "wiki",
    button,
    progress,
    progressText,
    cancel: $("#wiki-cancel"),
    label: "生成知识点",
  });
  try {
    const result = await api("/api/wiki/generate", {
      method: "POST",
      body: JSON.stringify({
        chapter: $("#wiki-chapter").value,
        count: $("#wiki-count").value,
        model: $("#model-select").value || undefined,
      }),
      signal: task.signal,
      timeoutMs: LONG_API_TIMEOUT_MS,
    });
    showToast(
      `已生成 ${result.added} 个知识点条目${result.duplicatesSkipped ? `，过滤 ${result.duplicatesSkipped} 条重复` : ""}`,
    );
    await loadWiki();
    $("#wiki-generate-dialog")?.close();
  } catch (error) {
    if (isGenerationCancelled(error, task.signal)) {
      showToast("已停止生成知识点");
      return;
    }
    showToast(error.message, true);
  } finally {
    task.finish();
  }
}

async function loadChapters() {
  const load = beginLoad("chapters", "#coverage", "正在加载章节…");
  try {
    const data = await api("/api/chapters");
    if (!load.isCurrent()) return false;
    state.chapters = data.chapters;
    state.chapterMap = new Map(state.chapters.map((item) => [item.id, item]));
    renderChapters();
    load.finish();
    return true;
  } catch (error) {
    load.fail(error, loadChapters);
    return false;
  }
}

// ===== 模拟考试 =====

async function loadMock() {
  await Promise.all([loadMockHistory(), loadRealExamCatalog(), loadActiveCaseExam()]);
}

async function loadRealExamCatalog() {
  const select = $("#real-exam-term");
  const start = $("#start-real-exam");
  const continuousStart = $("#start-real-continuous-exam");
  const load = beginLoad(
    "real-exam-catalog",
    "#real-exam-catalog-status",
    "正在加载真题目录…",
  );
  try {
    const { papers } = await api("/api/real-exams");
    if (!load.isCurrent()) return;
    const choicePapers = (papers ?? []).filter((paper) => paper.questions > 0);
    state.realExamCatalog = choicePapers;
    if (!choicePapers.length) {
      select.replaceChildren(
        element("option", { text: "请先导入真题库", attrs: { value: "" } }),
      );
      select.disabled = true;
      start.disabled = true;
      if (continuousStart) continuousStart.disabled = true;
      setRealExamCatalogStatus("未导入真题");
      load.finish();
      return;
    }
    const previous = select.value;
    select.replaceChildren(
      ...choicePapers.map((paper) =>
        element("option", {
          text: `${paper.term} · ${paper.questions} 题${paper.cases ? ` · ${paper.cases} 案例` : ""}${paper.papers ? ` · ${paper.papers} 论文` : ""}${paper.missingQuestionNos?.length ? ` · 缺题号 ${paper.missingQuestionNos.join(",")}` : ""}`,
          attrs: {
            value: paper.term,
            "data-source-type": paper.sourceType,
          },
        }),
      ),
    );
    select.disabled = false;
    start.disabled = false;
    if ([...select.options].some((option) => option.value === previous)) {
      select.value = previous;
    }
    updateRealContinuousButton();
    const latest = choicePapers.find((paper) => paper.sourceType === "real") || choicePapers[0];
    setRealExamCatalogStatus(`${choicePapers.length} 套可开 · 最新 ${latest.term}`);
    load.finish();
  } catch (error) {
    if (!load.isCurrent()) return;
    select.replaceChildren(
      element("option", { text: "真题目录加载失败", attrs: { value: "" } }),
    );
    select.disabled = true;
    start.disabled = true;
    load.fail(error, loadRealExamCatalog);
  }
}

function updateRealContinuousButton() {
  const button = $("#start-real-continuous-exam");
  if (!button) return;
  const select = $("#real-exam-term");
  const selected = state.realExamCatalog.find((paper) =>
    paper.term === select?.value && paper.sourceType === (select.selectedOptions[0]?.dataset.sourceType || "real"),
  );
  const ready = Boolean(selected && selected.questions === 75 && selected.cases >= 3);
  button.disabled = !ready;
  button.title = ready
    ? "综合知识 75 题 + 同考期至少 3 道案例，按 240 分钟总时限连续作答"
    : "该考期必须同时具备完整 75 道综合知识题和至少 3 道同来源案例题，才能开始连考";
}

async function loadMockHistory() {
  const load = beginLoad("mock-history", "#mock-history-list", "正在加载模拟记录…");
  const generatedAvailable = state.chapters.reduce(
    (sum, chapter) => sum + (chapter.counts?.all ?? 0),
    0,
  );
  // 综合模拟的服务端在没有生成题时会回退到导入题；查询同一份活动题库，
  // 避免导入真题后前端仍把入口置灰。
  const [activeBank, caseBankAvailable] = await Promise.all([
    api("/api/questions?status=active&limit=1&offset=0").catch(() => ({ total: 0 })),
    caseBankCount(),
  ]);
  const importedFallbackAvailable = Math.max(0, Number(activeBank.total) || 0);
  const canStartMock = generatedAvailable > 0 || importedFallbackAvailable > 0;
  $("#mock-availability").textContent = generatedAvailable > 0
    ? `生成题 ${generatedAvailable} 道可用`
    : importedFallbackAvailable > 0
      ? `题库 ${importedFallbackAvailable} 道可用（将使用导入题）`
      : "暂无可用题目";
  $("#start-mock-exam").disabled = !canStartMock;
  $("#start-case-exam").disabled = !caseBankAvailable || Boolean(state.caseExam);
  try {
    const { exams } = await api("/api/case-exams");
    const { attempts } = await api("/api/attempts");
    if (!load.isCurrent()) return;
    const examRows = exams
      .filter((exam) => exam.gradedAt || exam.abandonedAt)
      .slice(0, 20)
      .map((exam) => {
        const title = `案例模拟卷 · ${exam.titles.join("、")}`;
        return element("div", { className: "history-row" }, [
          element("span", { text: title }),
          element("span", {
            text: new Date(exam.startedAt).toLocaleString("zh-CN"),
          }),
          element("span", {
            text: exam.abandonedAt
              ? "已放弃"
              : `${exam.totalScore ?? 0}/${exam.maxScore ?? 75} 分`,
          }),
          element("strong", {
            text: exam.abandonedAt ? "—" : `${examScorePercent(exam)}%`,
          }),
        ]);
      });
    const attemptRows = attempts
      .filter((attempt) => attempt.mode === "exam-mcq")
      .slice(0, 20)
      .map((attempt) =>
        historyNode({ ...attempt, chapter: attempt.chapter }),
      );
    $("#mock-history-list").replaceChildren(
      ...(examRows.length + attemptRows.length
        ? [...attemptRows, ...examRows]
        : [
            emptyMessage(
              "还没有模拟记录",
              "开始一次综合知识或案例模拟后，结果会显示在这里。",
            ),
          ]),
    );
    load.finish();
  } catch (error) {
    load.fail(error, loadMockHistory);
  }
}

function examScorePercent(exam) {
  const max = exam.maxScore ?? 75;
  if (!max) return 0;
  return Math.round(((exam.totalScore ?? 0) / max) * 100);
}

async function caseBankCount() {
  try {
    const data = await api("/api/cases?limit=1&offset=0");
    return data.total;
  } catch {
    return 0;
  }
}

async function startMockExam(event) {
  event?.preventDefault();
  try {
    state.session = await api("/api/exam-sessions", {
      method: "POST",
      body: JSON.stringify({
        count: $("#mock-count").value,
        durationMinutes: $("#mock-duration").value,
      }),
    });
    resetExamSaveState(state.session);
    state.activeSession = null;
    $("#resume-panel").hidden = true;
    renderQuestions();
    switchView("practice");
  } catch (error) {
    showToast(error.message, true);
  }
}

async function startRealExam(event) {
  event?.preventDefault();
  const select = $("#real-exam-term");
  const term = select.value;
  if (!term) {
    showToast("请先导入真题库并选择考期", true);
    return;
  }
  const sourceType =
    select.selectedOptions[0]?.dataset.sourceType || "real";
  try {
    state.session = await api("/api/exam-sessions", {
      method: "POST",
      body: JSON.stringify({
        term,
        sourceType,
        durationMinutes: 150,
      }),
    });
    resetExamSaveState(state.session);
    state.activeSession = null;
    $("#resume-panel").hidden = true;
    renderQuestions();
    switchView("practice");
  } catch (error) {
    showToast(error.message, true);
  }
}

async function startRealContinuousExam() {
  const select = $("#real-exam-term");
  const term = select.value;
  if (!term) {
    showToast("请先选择一个完整考期，再开始连考。", true);
    return;
  }
  const button = $("#start-real-continuous-exam");
  if (button) {
    button.disabled = true;
    button.textContent = "正在准备连考试卷…";
  }
  try {
    state.session = await api("/api/exam-sessions", {
      method: "POST",
      body: JSON.stringify({
        term,
        sourceType: select.selectedOptions[0]?.dataset.sourceType || "real",
        durationMinutes: 150,
        count: 75,
        continuousMode: true,
      }),
    });
    resetExamSaveState(state.session);
    state.activeSession = null;
    $("#resume-panel").hidden = true;
    renderQuestions();
    switchView("practice");
    showToast("连考开始：综合知识至少 120 分钟、最多 150 分钟，之后自动衔接案例剩余时间。");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "按此考期开始 240 分钟连考";
    }
  }
}

async function importArchitectBank() {
  const button = $("#import-bank");
  if (
    !(await confirmDialog({
      title: "导入真题库",
      message:
        "将从相邻仓库导入历年真题和模拟卷。导入按题号更新，不会覆盖生成题或练习进度。确认继续？",
      confirmText: "导入",
    }))
  ) {
    return;
  }
  button.disabled = true;
  button.textContent = "导入中…";
  try {
    const result = await api("/api/real-exams/import", { method: "POST" });
    await refreshAfterDataChange();
    showToast(
      `已导入选择题 ${result.questions.total}、案例 ${result.cases.total}、论文 ${result.papers.total}`,
    );
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "导入真题库";
  }
}

// ===== 案例模拟卷 =====

async function loadActiveCaseExam() {
  const load = beginLoad("active-case-exam", "#case-exam-stage", "正在加载案例模拟…");
  try {
    const [{ exam }, pending] = await Promise.all([
      api("/api/case-exams/active"),
      api("/api/continuous-exams/pending").catch(() => ({ exam: null })),
    ]);
    if (!load.isCurrent()) return;
    state.caseExam = exam;
    state.pendingContinuousExam = exam ? null : pending.exam;
    if (exam) $("#start-case-exam").disabled = true;
    renderCaseExam();
    load.finish();
  } catch (error) {
    load.fail(error, loadActiveCaseExam);
  }
}

async function continueContinuousExam(pending = state.pendingContinuousExam) {
  if (!pending?.sessionId) return false;
  try {
    const exam = await api("/api/case-exams", {
      method: "POST",
      body: JSON.stringify({ continuousSessionId: pending.sessionId }),
      timeoutMs: LONG_API_TIMEOUT_MS,
    });
    state.caseExam = exam;
    state.pendingContinuousExam = null;
    switchView("mock");
    renderCaseExam();
    showToast(`综合知识阶段已完成，案例阶段开始。剩余 ${Math.floor(exam.durationSeconds / 60)} 分钟。`);
    await loadMockHistory();
    return true;
  } catch (error) {
    const latest = await api("/api/continuous-exams/pending").catch(() => ({ exam: null }));
    state.pendingContinuousExam = latest.exam || pending;
    switchView("mock");
    renderCaseExam();
    showToast(error.message + "；你可以在案例模块中重新继续，不会丢失综合知识成绩。", true);
    return false;
  }
}

function renderCaseExam() {
  const stage = $("#case-exam-stage");
  const resume = $("#mock-exam-resume");
  clearInterval(state.caseExamTimer);
  state.caseExamTimer = null;
  const exam = state.caseExam;
  if (!exam) {
    const pending = state.pendingContinuousExam;
    if (pending) {
      const elapsed = Math.max(0, (Date.now() - new Date(pending.startedAt).getTime()) / 1000);
      const remaining = Math.max(0, 240 * 60 - elapsed);
      stage.replaceChildren(element("section", { className: "panel continuous-exam-handoff" }, [
        element("span", { className: "eyebrow", text: "CONTINUOUS EXAM · STAGE 2" }),
        element("h2", { text: "综合知识已交卷，等待进入案例分析" }),
        element("p", { text: `${pending.term || "当前考期"} · 综合知识 ${pending.choiceResult?.correct ?? "—"}/${pending.choiceResult?.total ?? 75} 题正确 · 本场总时限 240 分钟 · 当前剩余约 ${Math.floor(remaining / 60)} 分钟` }),
        element("p", { className: "muted", text: "案例阶段将使用同一考期、同一来源的案例题，并继承 240 分钟总时限。刷新页面后仍可继续。" }),
        element("button", { className: "primary", text: "继续案例分析阶段", attrs: { type: "button" } }),
      ]));
      stage.querySelector("button")?.addEventListener("click", () => continueContinuousExam(pending));
    } else {
      stage.replaceChildren();
    }
    resume.hidden = true;
    return;
  }
  $("#mock-exam-resume-title").textContent = exam.continuousSessionId ? "继续 240 分钟连考 · 案例阶段" : "继续案例模拟卷";
  $("#mock-exam-resume-meta").textContent = exam.continuousSessionId
    ? `综合知识 ${exam.continuousMcqResult?.correct ?? "—"}/${exam.continuousMcqResult?.total ?? 75} 题正确 · 案例阶段剩余 ${Math.floor((exam.remainingSeconds ?? exam.durationSeconds) / 60)} 分钟 · 草稿会持续保存。`
    : `已开始于 ${new Date(exam.startedAt).toLocaleString("zh-CN")}，草稿会持续保存。`;
  resume.hidden = false;
  stage.replaceChildren(caseExamNode(exam));
  // 回填草稿
  stage.querySelectorAll(".case-card").forEach((card, index) => {
    const caseItem = exam.cases[index];
    const texts = caseItem?.drafts?.texts ?? {};
    card.querySelectorAll(".case-answer").forEach((textarea) => {
      const draft = texts[textarea.dataset.questionId];
      if (draft) textarea.value = draft;
      textarea.dataset.savedText = textarea.value;
      textarea.addEventListener("input", () => {
        clearTimeout(textarea.caseDraftTimer);
        textarea.caseDraftTimer = setTimeout(() => {
          saveCaseExamTextarea(exam, textarea).catch((error) => {
            if (error.code !== "EXAM_TIME_OVER") showToast(error.message, true);
          });
        }, 800);
      });
      textarea.addEventListener("blur", () => {
        saveCaseExamTextarea(exam, textarea).catch((error) => {
          if (error.code !== "EXAM_TIME_OVER") showToast(error.message, true);
        });
      });
    });
  });
  fillCaseExamCountdown(exam);
}

function caseExamExpired(exam) {
  return Date.now() >= new Date(exam.startedAt).getTime() + exam.durationSeconds * 1000;
}

function saveCaseExamTextarea(exam, textarea) {
  clearTimeout(textarea.caseDraftTimer);
  const text = textarea.value;
  const previous = textarea.caseDraftPending ?? Promise.resolve();
  if (caseExamExpired(exam)) return previous;
  const pending = previous.catch(() => {}).then(async () => {
    if (state.caseExam?.id !== exam.id || caseExamExpired(exam) || text === textarea.dataset.savedText) return;
    await api("/api/case-exams/draft", {
      method: "POST",
      body: JSON.stringify({
        examId: exam.id,
        caseId: textarea.dataset.caseId,
        questionId: textarea.dataset.questionId,
        text,
      }),
    });
    textarea.dataset.savedText = text;
  });
  textarea.caseDraftPending = pending;
  return pending;
}

// 在 timerBox 中渲染案例模拟倒计时并启动定时器。
function fillCaseExamCountdown(exam) {
  const timerBox = document.querySelector("#case-exam-stage .case-exam-timer");
  if (!timerBox) return;
  const countdown = caseExamTimerElement();
  const label = element("span", {
    text: exam.continuousSessionId
      ? `240 分钟连考总剩余时间 · 案例阶段共 ${exam.cases.length} 道 · 满 180 分钟后开放交卷`
      : `剩余时间 · 共 ${exam.cases.length} 道案例`,
  });
  timerBox.replaceChildren(countdown, label);
  const deadline =
    new Date(exam.startedAt).getTime() + exam.durationSeconds * 1000;
  const tick = () => {
    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    countdown.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    countdown.classList.toggle("urgent", remaining <= 300);
    const submit = document.querySelector("#case-exam-stage .case-exam-submit");
    const earliestSubmitAt = exam.continuousSessionId
      ? Date.parse(exam.earliestSubmitAt || new Date(deadline - 60 * 60 * 1000).toISOString())
      : 0;
    const canSubmit = !exam.continuousSessionId || Date.now() >= earliestSubmitAt;
    if (submit && remaining > 0) {
      submit.disabled = !canSubmit;
      submit.textContent = canSubmit
        ? "交卷并由 AI 判分"
        : "本场开始满 180 分钟后开放交卷";
    }
    if (remaining <= 2 && remaining > 0) {
      document.querySelectorAll("#case-exam-stage .case-answer").forEach((textarea) => {
        saveCaseExamTextarea(exam, textarea).catch((error) => {
          if (error.code !== "EXAM_TIME_OVER") showToast(error.message, true);
        });
      });
    }
    if (remaining === 0) {
      clearInterval(state.caseExamTimer);
      state.caseExamTimer = null;
      label.textContent = "时间已到 · 仅已保存草稿可判分";
      document.querySelectorAll("#case-exam-stage .case-answer").forEach((textarea) => {
        clearTimeout(textarea.caseDraftTimer);
        textarea.disabled = true;
      });
      const submit = document.querySelector("#case-exam-stage .case-exam-submit");
      if (submit && !submit.disabled) submit.textContent = "按已保存草稿判分";
      showToast("案例模拟时间到，未保存的修改不能提交；可按已保存草稿判分");
    }
  };
  tick();
  state.caseExamTimer = setInterval(tick, 1000);
}

function caseExamTimerElement() {
  return element("strong", { className: "countdown" });
}

function caseExamNode(exam) {
  const timerBox = element("div", { className: "case-exam-timer" }, []);
  const cards = exam.cases.map((caseItem) => {
    const texts = caseItem.drafts?.texts ?? {};
    const questions = caseItem.questions.map((question, index) =>
      element("div", { className: "case-question" }, [
        element("div", { className: "case-question-head" }, [
          element("strong", {
            text: `问题 ${index + 1}（${question.points} 分）`,
          }),
        ]),
        element("p", { className: "question-text", text: question.text }),
        element("textarea", {
          className: "case-answer",
          attrs: {
            rows: "5",
            placeholder: "在此输入你的作答…",
            "data-case-id": caseItem.id,
            "data-question-id": question.id,
          },
        }),
      ]),
    );
    // 回填已保存的草稿
    return element("article", { className: "panel case-card" }, [
      element("div", { className: "case-card-header" }, [
        element("div", { className: "bank-tags" }, [
          element("span", { text: `第 ${caseItem.chapter} 章` }),
          element("span", { text: caseItem.knowledgePoint }),
        ]),
      ]),
      element("h3", { className: "case-title", text: caseItem.title }),
      element("p", { className: "case-scenario", text: caseItem.scenario }),
      ...questions,
    ]);
  });
  const submitButton = element("button", {
    className: "primary wide case-exam-submit",
    text: "交卷并由 AI 判分",
    attrs: { type: "button" },
  });
  submitButton.addEventListener("click", () => submitCaseExam(exam, submitButton));
  const abandonButton = element("button", {
    className: "ghost case-exam-abandon",
    text: "放弃本次模拟",
    attrs: { type: "button" },
  });
  abandonButton.addEventListener("click", () => abandonCaseExam(exam.id));
  return element("section", { className: "case-exam-stage" }, [
    timerBox,
    ...cards,
    element("div", { className: "case-exam-actions" }, [
      abandonButton,
      submitButton,
    ]),
  ]);
}

async function startCaseExam() {
  if (state.caseExam) {
    document.querySelector("#case-exam-stage")?.scrollIntoView({ behavior: "smooth" });
    showToast("已有进行中的案例模拟，请继续作答");
    return;
  }
  if (
    !(await confirmDialog({
      title: "开始案例模拟",
      message: "将抽 3 道案例限时 90 分钟连做，交卷后 AI 一次性判分。开始？",
      confirmText: "开始模拟",
    }))
  )
    return;
  try {
    state.caseExam = await api("/api/case-exams", {
      method: "POST",
      body: JSON.stringify({ count: 3, durationMinutes: 90 }),
    });
    renderCaseExam();
    showToast("案例模拟卷已生成，计时开始");
    await loadMockHistory();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function abandonCaseExam(examId) {
  if (
    !(await confirmDialog({
      title: "放弃案例模拟",
      message: "确认放弃本次案例模拟？进度不会保留。",
      confirmText: "放弃",
      danger: true,
    }))
  )
    return;
  try {
    await api(`/api/case-exams/${encodeURIComponent(examId)}`, {
      method: "DELETE",
    });
    state.caseExam = null;
    renderCaseExam();
    await loadMockHistory();
    showToast("已放弃案例模拟");
  } catch (error) {
    showToast(error.message, true);
  }
}

async function submitCaseExam(exam, button) {
  if (button.disabled) return;
  const earliestSubmitAt = exam.continuousSessionId
    ? Date.parse(exam.earliestSubmitAt || new Date(
        Date.parse(exam.startedAt) + Math.max(0, Number(exam.durationSeconds) - 60 * 60) * 1000,
      ).toISOString())
    : 0;
  if (exam.continuousSessionId && Date.now() < earliestSubmitAt) {
    const remainingMinutes = Math.ceil(
      (earliestSubmitAt - Date.now()) / 60_000,
    );
    showToast(`连考案例分析需在本场开始满 180 分钟后才能交卷，还需 ${remainingMinutes} 分钟。`, true);
    return;
  }
  const stage = document.querySelector("#case-exam-stage");
  const textareas = stage.querySelectorAll(".case-answer");
  const expired = caseExamExpired(exam);
  const unanswered = [...textareas].filter((textarea) =>
    !(expired ? textarea.dataset.savedText : textarea.value).trim(),
  ).length;
  if (
    !(await confirmDialog({
      title: "案例模拟交卷",
      message: expired
        ? "时间已到，不能再保存答案。仅按已保存草稿由 AI 判分，确认交卷？"
        : unanswered
          ? `还有 ${unanswered} 个小问未作答，交卷后 AI 判分且不能重考。确认交卷？`
          : "交卷后 AI 一次性判分，且不能重考。确认交卷？",
      confirmText: "交卷并由 AI 判分",
    }))
  )
    return;
  if (
    !expired &&
    caseExamExpired(exam) &&
    !(await confirmDialog({
      title: "已到截止时间",
      message: "刚刚到时，未保存的修改不能提交。仍按已保存草稿判分？",
      confirmText: "按已保存草稿判分",
      danger: true,
    }))
  )
    return;
  button.disabled = true;
  const originalButtonText = button.textContent;
  button.textContent = "AI 判分中，约需 1-2 分钟…";
  try {
    const saves = await Promise.allSettled(
      [...textareas].map((textarea) =>
        expired
          ? (textarea.caseDraftPending ?? Promise.resolve())
          : saveCaseExamTextarea(exam, textarea),
      ),
    );
    const unexpectedFailure = saves.find((result) =>
      result.status === "rejected" && result.reason.code !== "EXAM_TIME_OVER",
    );
    if (unexpectedFailure) throw unexpectedFailure.reason;
    if (saves.some((result) => result.status === "rejected") ||
        (caseExamExpired(exam) && [...textareas].some((textarea) => textarea.value !== textarea.dataset.savedText))) {
      showToast("部分修改未赶上截止时间，仅按已保存草稿判分");
    }
    const grade = await api("/api/case-exams/grade", {
      method: "POST",
      body: JSON.stringify({
        examId: exam.id,
        model: $("#model-select").value || undefined,
      }),
      timeoutMs: LONG_API_TIMEOUT_MS,
    });
    state.caseExam = null;
    clearInterval(state.caseExamTimer);
    state.caseExamTimer = null;
    renderCaseExamGrade(grade, exam);
    await loadMockHistory();
    showToast(`AI 判分完成：${grade.total_score}/${grade.max_score} 分`);
  } catch (error) {
    showToast(error.message, true);
    button.disabled = false;
    button.textContent = caseExamExpired(exam)
      ? "按已保存草稿判分"
      : originalButtonText;
  }
}

// 案例模拟卷判分结果展示（整卷逐问得分 + 总分）。
function renderCaseExamGrade(grade, exam = null) {
  const stage = $("#case-exam-stage");
  $("#mock-exam-resume").hidden = true;
  const passed = grade.max_score
    ? Math.round((grade.total_score / grade.max_score) * 100) >= 60
    : false;
  const mcq = exam?.continuousMcqResult;
  const caseScoreOn75 = grade.max_score ? (Number(grade.total_score) / Number(grade.max_score)) * 75 : 0;
  const casePassed = caseScoreOn75 >= 45;
  const mcqPassed = mcq?.total === 75 && Number(mcq.correct) >= 45;
  const continuousPassed = Boolean(exam?.continuousSessionId && mcq && mcqPassed && casePassed);
  const cards = (grade.cases ?? []).map((caseGrade) =>
    element("article", { className: "panel case-card" }, [
      element("h3", { className: "case-title", text: caseGrade.title }),
      caseGradeNode(caseGrade),
    ]),
  );
  stage.replaceChildren(
    exam?.continuousSessionId && mcq ? element("section", { className: "panel continuous-exam-result" }, [
      element("div", { className: "panel-heading" }, [
        element("h2", { text: "240 分钟连考 · 两科成绩" }),
        element("span", { className: `pass-badge ${continuousPassed ? "pass" : "fail"}`, text: continuousPassed ? "两科均达 45 分" : "至少一科未达 45 分" }),
      ]),
      element("div", { className: "continuous-exam-result-grid" }, [
        element("div", {}, [element("strong", { text: `${mcq.correct}/75` }), element("span", { text: "综合知识 · 45 分为合格线" }), element("small", { text: mcqPassed ? "达到单科合格线" : "未达到单科合格线" })]),
        element("div", {}, [element("strong", { text: `${Math.round(caseScoreOn75 * 10) / 10}/75` }), element("span", { text: `案例分析 · 原始得分 ${grade.total_score}/${grade.max_score} · 45 分为合格线` }), element("small", { text: casePassed ? "达到单科合格线" : "未达到单科合格线" })]),
      ]),
      element("p", { className: "muted", text: "连考判定按两科分别达到 45 分计算，不用两科总分相互抵消。案例评分由 AI 生成，建议结合参考答案人工复核。" }),
    ]) : null,
    element("div", { className: "score-hero" }, [
      element("div", { className: "score-circle" }, [
        element("div", {}, [
          element("strong", {
            text: `${grade.total_score}/${grade.max_score}`,
          }),
          element("span", { text: "案例模拟总分" }),
        ]),
      ]),
      element("span", {
        className: `pass-badge ${passed ? "pass" : "fail"}`,
        text: passed ? "通过（≥ 60%）" : "未通过（< 60%）",
      }),
    ]),
    ...cards,
  );
}

document.querySelectorAll("[data-view]").forEach((button) =>
  button.addEventListener("click", (event) => {
    event.preventDefault();
    switchView(button.dataset.view);
  }),
);
$("#practice-form").addEventListener("submit", startPractice);
$("#mock-exam-form").addEventListener("submit", startMockExam);
$("#real-exam-form").addEventListener("submit", startRealExam);
$("#real-exam-term").addEventListener("change", updateRealContinuousButton);
$("#start-real-continuous-exam").addEventListener("click", startRealContinuousExam);
$("#start-case-exam").addEventListener("click", startCaseExam);
$("#mock-exam-resume-button").addEventListener("click", () => {
  if (!state.caseExam) return;
  document
    .querySelector("#case-exam-stage")
    .scrollIntoView({ behavior: "smooth" });
});
$("#mock-exam-abandon").addEventListener("click", () => {
  if (state.caseExam) abandonCaseExam(state.caseExam.id);
});
$("#questions-form").addEventListener("submit", submitPractice);
$("#chapter").addEventListener("change", loadSections);
$("#section").addEventListener("change", updateAvailability);
$("#difficulty").addEventListener("change", updateAvailability);
$("#previous-question").addEventListener("click", () =>
  goToQuestion(state.currentIndex - 1),
);
$("#next-question").addEventListener("click", () =>
  goToQuestion(state.currentIndex + 1),
);
$("#resume-session").addEventListener("click", resumeActiveSession);
$("#abandon-session").addEventListener("click", abandonActiveSession);
$("#generate-button").addEventListener("click", generateQuestions);
$("#start-review").addEventListener("click", startReview);
$("#review-all").addEventListener("click", startReview);
$("#export-wrong").addEventListener("click", exportWrong);
$("#wrong-previous").addEventListener("click", () => {
  state.wrongOffset = Math.max(0, state.wrongOffset - state.wrongLimit);
  loadWrong();
});
$("#wrong-next").addEventListener("click", () => {
  if (state.wrongOffset + state.wrongLimit >= state.wrongTotal) return;
  state.wrongOffset += state.wrongLimit;
  loadWrong();
});
$("#plan-goal-select").addEventListener("change", (event) =>
  setDailyGoal(event.target.value),
);
$("#case-generate").addEventListener("click", generateCases);
$("#case-source").addEventListener("change", () => {
  state.caseOffset = 0;
  loadCases();
});
$("#case-previous").addEventListener("click", () => {
  state.caseOffset = Math.max(0, state.caseOffset - state.caseLimit);
  loadCases();
});
$("#case-next").addEventListener("click", () => {
  if (state.caseOffset + state.caseLimit >= state.caseTotal) return;
  state.caseOffset += state.caseLimit;
  loadCases();
});
$("#paper-generate").addEventListener("click", generatePapers);
$("#paper-source").addEventListener("change", () => {
  state.paperOffset = 0;
  loadPapers();
});
$("#paper-previous").addEventListener("click", () => {
  state.paperOffset = Math.max(0, state.paperOffset - state.paperLimit);
  loadPapers();
});
$("#paper-next").addEventListener("click", () => {
  if (state.paperOffset + state.paperLimit >= state.paperTotal) return;
  state.paperOffset += state.paperLimit;
  loadPapers();
});
$("#mc-save").addEventListener("click", saveModelConfig);
document.querySelectorAll("[data-agent-tab]").forEach((button, index, buttons) => {
  button.addEventListener("click", () => setAgentWorkspaceTab(button.dataset.agentTab));
  button.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const nextIndex = (index + (event.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length;
    buttons[nextIndex].focus();
    setAgentWorkspaceTab(buttons[nextIndex].dataset.agentTab);
  });
});
document.querySelectorAll("[data-agent-role-template]").forEach((button) => {
  button.addEventListener("click", () => addAgentFromTemplate(button.dataset.agentRoleTemplate));
});
$("#mc-add-provider").addEventListener("click", addProvider);
$("#agent-add").addEventListener("click", addAgent);
$("#agent-task-run").addEventListener("click", runAgentTask);
$("#provider-list").addEventListener("input", syncWorkspaceDraftFromForm);
$("#provider-list").addEventListener("change", syncWorkspaceDraftFromForm);
$("#agent-list").addEventListener("input", syncWorkspaceDraftFromForm);
$("#agent-list").addEventListener("change", syncWorkspaceDraftFromForm);
$("#agent-default").addEventListener("change", () => {
  state.modelWorkspace.defaultAgentId = $("#agent-default").value;
  renderModelWorkspace();
  updateWorkspaceDirtyState();
});
$("#agent-task-strategy").addEventListener("change", syncAgentStrategyUi);
document.querySelectorAll("[data-agent-strategy]").forEach((button) => {
  button.addEventListener("click", () => {
    $("#agent-task-strategy").value = button.dataset.agentStrategy;
    syncAgentStrategyUi();
  });
});
$("#agent-task-prompt").addEventListener("input", () => {
  const count = $("#agent-task-prompt").value.length;
  $("#agent-task-char-count").textContent = count.toLocaleString("zh-CN") + " / 16,000";
  $("#agent-task-char-count").classList.toggle("is-near-limit", count > 14_400);
  $("#agent-task-validation").hidden = true;
});
document.querySelectorAll("[data-agent-prompt-template]").forEach((button) => {
  button.addEventListener("click", () => {
    const prompt = $("#agent-task-prompt");
    const prefix = button.dataset.agentPromptTemplate;
    prompt.value = prompt.value.trim() ? prompt.value.trim() + "\n\n" + prefix : prefix;
    prompt.focus();
    prompt.dispatchEvent(new Event("input", { bubbles: true }));
    prompt.setSelectionRange(prompt.value.length, prompt.value.length);
  });
});
$("#agent-task-members").addEventListener("change", syncAgentStrategyUi);
$("#agent-task-history-clear").addEventListener("click", clearAgentTaskHistoryWithConfirmation);
$("#agent-server-task-refresh").addEventListener("click", () => { void loadAgentServerTasks({ quiet: false }); });
renderAgentTaskHistory();
void loadAgentServerTasks();
$("#app-dialog").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) {
    finishAppDialog($("#app-dialog-input").hidden ? false : null);
  }
});
$("#wiki-generate").addEventListener("click", generateWiki);
// 生成知识点以模态弹窗承载（一次性动作）；进行中不允许意外关闭。
$("#wiki-generate-open").addEventListener("click", () => {
  $("#wiki-generate-dialog").showModal();
});
$("#wiki-generate-dialog-close").addEventListener("click", () => {
  $("#wiki-generate-dialog").close();
});
$("#wiki-generate-dialog").addEventListener("cancel", (event) => {
  if (state.generationControllers.has("wiki")) event.preventDefault();
});
// 问知识库以右侧抽屉承载（多轮问答）：浏览目录/图谱不中断。
let wikiAskCloseTimer = null;
let wikiAskReturnFocus = null;

function openWikiAskDrawer() {
  const drawer = $("#wiki-ask-drawer");
  if (wikiAskCloseTimer !== null) {
    clearTimeout(wikiAskCloseTimer);
    wikiAskCloseTimer = null;
  }
  if (drawer.hidden) {
    const active = document.activeElement;
    wikiAskReturnFocus =
      active instanceof HTMLElement && !drawer.contains(active)
        ? active
        : $("#wiki-ask-open");
  }
  drawer.hidden = false;
  drawer.setAttribute("aria-hidden", "false");
  $("#wiki-ask-backdrop").hidden = false;
  requestAnimationFrame(() => drawer.classList.add("open"));
  $("#wiki-question").focus();
}
function closeWikiAskDrawer() {
  const drawer = $("#wiki-ask-drawer");
  const backdrop = $("#wiki-ask-backdrop");
  if (drawer.hidden) {
    backdrop.hidden = true;
    return;
  }
  if (wikiAskCloseTimer !== null) clearTimeout(wikiAskCloseTimer);
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  backdrop.hidden = true;
  const returnFocus = wikiAskReturnFocus;
  wikiAskCloseTimer = setTimeout(() => {
    drawer.hidden = true;
    wikiAskCloseTimer = null;
    if (returnFocus?.isConnected) returnFocus.focus();
  }, 240);
}
$("#wiki-ask-open").addEventListener("click", openWikiAskDrawer);
$("#wiki-ask-close").addEventListener("click", closeWikiAskDrawer);
$("#wiki-ask-backdrop").addEventListener("click", closeWikiAskDrawer);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("#wiki-ask-drawer").hidden) {
    event.preventDefault();
    closeWikiAskDrawer();
  }
});
$("#wiki-search").addEventListener("input", () => {
  renderWiki();
  // 搜索结果必须同步重建图谱，避免目录已过滤而图谱仍显示旧节点。
  renderFilteredWikiGraph();
});
$("#wiki-chapter-filter").addEventListener("change", () => {
  renderWiki();
  renderFilteredWikiGraph();
});
$("#wiki-status-filter").addEventListener("change", () => {
  renderWiki();
  renderFilteredWikiGraph();
});
$("#wiki-graph-colorby").addEventListener("change", (event) => {
  state.wikiGraphColorBy = event.target.value;
  renderFilteredWikiGraph();
});
// 知识图谱模块需要的应用层回调在首次进入图谱前注入。
initWikiGraphDeps({ openEntry: jumpToWikiEntry });
$("#wiki-reader-tab").addEventListener("click", () => setWikiWorkspaceTab("reader"));
$("#wiki-graph-toggle").addEventListener("click", () => setWikiWorkspaceTab("graph"));
$("#wiki-graph-fit").addEventListener("click", () => {
  const graph = currentWikiGraph();
  if (graph) fitWikiGraph(graph);
});
// 浏览器全屏：整个图谱面板铺满屏幕，画布随视口重建，点节点更从容。
$("#wiki-graph-fullscreen").addEventListener("click", async () => {
  const panel = $("#wiki-graph");
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await panel.requestFullscreen();
  } catch (error) {
    showToast(`无法进入全屏：${error.message}`, true);
  }
});
document.addEventListener("fullscreenchange", () => {
  const fullscreen = Boolean(document.fullscreenElement);
  const button = $("#wiki-graph-fullscreen");
  if (button) {
    button.title = fullscreen ? "退出全屏" : "浏览器全屏";
    button.setAttribute("aria-label", button.title);
  }
  if (!currentWikiGraph() || $("#wiki-graph").hidden) return;
  // 全屏切换会改变画布尺寸，短暂等待布局生效后按新视口重建图谱。
  setTimeout(() => {
    renderFilteredWikiGraph();
  }, 80);
});
$("#wiki-graph-reset").addEventListener("click", () => {
  renderFilteredWikiGraph();
});
let wikiGraphResizeTimer = 0;
window.addEventListener("resize", () => {
  if (!currentWikiGraph() || $("#wiki-graph").hidden) return;
  clearTimeout(wikiGraphResizeTimer);
  wikiGraphResizeTimer = setTimeout(renderFilteredWikiGraph, 120);
});
$("#wiki-lint").addEventListener("click", runWikiLint);
$("#wiki-ask").addEventListener("click", askWiki);
$("#wiki-question").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    askWiki();
  }
});
$("#bank-filters").addEventListener("submit", (event) => {
  event.preventDefault();
  state.bankOffset = 0;
  loadQuestionBank();
});
$("#bank-chapter").addEventListener("change", async () => {
  state.bankOffset = 0;
  try {
    await loadBankSections();
  } catch (error) {
    // 章节切换仍应刷新题库；失败时回退到整章，避免沿用旧小节筛选。
    $("#bank-section").value = "all";
    showToast(error.message, true);
  }
  loadQuestionBank();
});
$("#bank-section").addEventListener("change", () => {
  state.bankOffset = 0;
  loadQuestionBank();
});
$("#bank-difficulty").addEventListener("change", () => {
  state.bankOffset = 0;
  loadQuestionBank();
});
$("#bank-status").addEventListener("change", () => {
  state.bankOffset = 0;
  loadQuestionBank();
});
$("#bank-starred").addEventListener("change", () => {
  state.bankOffset = 0;
  loadQuestionBank();
});
$("#bank-source").addEventListener("change", () => {
  state.bankOffset = 0;
  loadQuestionBank();
});
$("#bank-previous").addEventListener("click", () => {
  state.bankOffset = Math.max(0, state.bankOffset - state.bankLimit);
  loadQuestionBank();
});
$("#bank-next").addEventListener("click", () => {
  if (state.bankOffset + state.bankLimit >= state.bankTotal) return;
  state.bankOffset += state.bankLimit;
  loadQuestionBank();
});
$("#import-bank").addEventListener("click", importArchitectBank);
$("#export-data").addEventListener("click", exportData);
$("#export-diagnosis").addEventListener("click", exportDiagnosis);
$("#materials-search").addEventListener("input", renderMaterialGroups);
$("#materials-prev").addEventListener("click", () => openAdjacentMaterial(-1));
$("#materials-next").addEventListener("click", () => openAdjacentMaterial(1));
$("#materials-font-down").addEventListener("click", () => {
  materialState.fontScale = clampMaterialScale(materialState.fontScale - 0.05);
  persistMaterialPreference("architect-material-font-scale", materialState.fontScale);
  applyMaterialReaderState();
});
$("#materials-font-up").addEventListener("click", () => {
  materialState.fontScale = clampMaterialScale(materialState.fontScale + 0.05);
  persistMaterialPreference("architect-material-font-scale", materialState.fontScale);
  applyMaterialReaderState();
});
$("#materials-width").addEventListener("click", () => {
  materialState.narrow = !materialState.narrow;
  persistMaterialPreference("architect-material-narrow", materialState.narrow);
  applyMaterialReaderState();
});
$("#materials-focus").addEventListener("click", () => {
  materialState.focus = !materialState.focus;
  applyMaterialReaderState();
});
$("#materials-content").addEventListener("scroll", updateMaterialTocState, { passive: true });
window.addEventListener("scroll", updateMaterialTocState, { passive: true });
$("#import-data").addEventListener("click", () => $("#import-file").click());
$("#import-file").addEventListener("change", (event) =>
  importDataFile(event.target.files[0]),
);
document
  .querySelectorAll("[data-clear]")
  .forEach((button) =>
    button.addEventListener("click", () => clearData(button.dataset.clear)),
  );

// 快捷键：练习视图下按 A/B/C/D 选择当前题选项，左右方向键翻页。
document.addEventListener("keydown", (event) => {
  if (!state.session || !$("#practice-view").classList.contains("active"))
    return;
  if (event.target.matches("input, textarea, select")) return;
  const key = event.key.toUpperCase();
  if (["A", "B", "C", "D"].includes(key)) {
    const question = currentQuestion();
    if (!question) return;
    if (state.session.mode !== "exam-mcq" && state.checks[question.id]) return;
    const input = document.querySelector(
      `#current-question input[value="${key}"]`,
    );
    if (input && !input.disabled) {
      input.checked = true;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  } else if (event.key === "ArrowLeft") {
    goToQuestion(state.currentIndex - 1);
  } else if (event.key === "ArrowRight") {
    goToQuestion(state.currentIndex + 1);
  } else if (["1", "2", "3"].includes(event.key)) {
    // 答题前选把握程度：1 猜测 / 2 大概 / 3 确定。
    const question = currentQuestion();
    if (!question || state.answers[question.id]) return;
    const value = Number(event.key);
    state.confidenceByQuestion[question.id] =
      state.confidenceByQuestion[question.id] === value ? null : value;
    renderCurrentQuestion();
  } else if (event.key === "Enter") {
    // 答完当前题后 Enter 进入下一题（最后一题交给按钮/提交栏）。
    const question = currentQuestion();
    const answered =
      state.answers[question?.id] ||
      (state.session.mode === "exam-mcq" && state.answers[question?.id]);
    if (!question || !answered) return;
    if (state.currentIndex < state.session.questions.length - 1) {
      goToQuestion(state.currentIndex + 1);
    }
  }
});

async function initializeApp() {
  // 章节是筛选器的基础，先完成它，再让其他启动任务互相隔离失败。
  await Promise.allSettled([loadChapters()]);
  mountBeginnerRoadmap({ onOpenWeek: openRoadmapWeek });
  await Promise.allSettled([
    loadSections(),
    loadModelStatus(),
    loadActiveSession(),
    refreshReviewBadge(),
    loadStudyPlan(),
    loadStudyQueue(),
  ]);
}

await initializeApp();

// 启动时按 URL hash 直达视图（如 #wiki），并响应 hash 变化。
function viewFromHash() {
  const view = window.location.hash.replace("#", "");
  return document.getElementById(`${view}-view`) ? view : null;
}
window.addEventListener("hashchange", () => {
  const view = viewFromHash();
  if (view && !document.querySelector(`#${view}-view.active`)) switchView(view);
});
if (viewFromHash() && !document.querySelector(".view.active#home-view")) {
  switchView(viewFromHash());
} else if (viewFromHash()) {
  switchView(viewFromHash());
}

// ===== 2026 UI 升级:主题切换 / 命令面板 / Wiki 相关推荐 / 数据库备份 / 阅读器增强 =====

// --- 主题:OKLCH token 双主题,跟随系统 + 手动切换,localStorage 持久化 ---
const THEME_KEY = "architect-theme";

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const label = $("#theme-toggle-label");
  if (label) label.textContent = theme === "dark" ? "深色" : "浅色";
}

function currentTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

(function initTheme() {
  let stored = null;
  try {
    stored = localStorage.getItem(THEME_KEY);
  } catch {
    stored = null;
  }
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  applyTheme(stored === "dark" || stored === "light" ? stored : prefersDark ? "dark" : "light");
})();

$("#theme-toggle")?.addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* 隐私模式忽略 */
  }
});

// --- 命令面板:Ctrl/Cmd+K,静态命令表 + 子序列模糊过滤 + 方向键导航 ---
const COMMANDS = [
  ...[...document.querySelectorAll(".nav-button")].map((button) => ({
    label: button.querySelector(".label")?.textContent?.trim() || button.textContent.trim(),
    group: "页面",
    run: () => switchView(button.dataset.view),
  })),
  { label: "开始错题回顾", group: "操作", run: () => startReview() },
  { label: "导出完整备份 (JSON)", group: "操作", run: () => exportData() },
  { label: "备份数据库 (SQLite)", group: "操作", run: () => backupDatabase() },
  { label: "切换浅色 / 深色主题", group: "操作", run: () => $("#theme-toggle").click() },
  { label: "刷新学习统计", group: "操作", run: () => { switchView("stats"); loadStatistics(); } },
];

const paletteState = { index: 0, matches: [] };

function commandMatches(query) {
  const text = query.trim().toLowerCase();
  if (!text) return COMMANDS;
  const scored = [];
  for (const command of COMMANDS) {
    const label = command.label.toLowerCase();
    let cursor = 0;
    let score = 0;
    for (const char of text) {
      const found = label.indexOf(char, cursor);
      if (found === -1) {
        score = -1;
        break;
      }
      score += found === cursor ? 2 : 1;
      cursor = found + 1;
    }
    if (score >= 0) scored.push({ command, score });
  }
  return scored
    .sort((left, right) => right.score - left.score)
    .map((item) => item.command);
}

function renderCommandList() {
  const input = $("#command-input");
  const list = $("#command-list");
  const empty = $("#command-empty");
  paletteState.matches = commandMatches(input.value);
  paletteState.index = 0;
  list.replaceChildren(
    ...paletteState.matches.map((command, index) => {
      const item = element("li", { className: "command-item", attrs: { role: "option" } }, [
        element("span", { text: command.label }),
        element("span", { className: "cmd-group", text: command.group }),
      ]);
      if (index === paletteState.index) item.classList.add("active");
      item.addEventListener("click", () => executeCommand(command));
      item.addEventListener("mousemove", () => {
        if (paletteState.index === index) return;
        paletteState.index = index;
        updateCommandActive();
      });
      return item;
    }),
  );
  empty.hidden = paletteState.matches.length > 0;
}

function updateCommandActive() {
  [...$("#command-list").children].forEach((item, index) =>
    item.classList.toggle("active", index === paletteState.index),
  );
}

function executeCommand(command) {
  $("#command-palette").close();
  try {
    command.run();
  } catch (error) {
    showToast(error.message, true);
  }
}

function openCommandPalette() {
  const dialog = $("#command-palette");
  $("#command-input").value = "";
  renderCommandList();
  dialog.showModal();
  $("#command-input").focus();
}

$("#command-input")?.addEventListener("input", renderCommandList);
$("#command-input")?.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    paletteState.index = Math.min(
      paletteState.index + 1,
      paletteState.matches.length - 1,
    );
    updateCommandActive();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    paletteState.index = Math.max(paletteState.index - 1, 0);
    updateCommandActive();
  } else if (event.key === "Enter") {
    event.preventDefault();
    const command = paletteState.matches[paletteState.index];
    if (command) executeCommand(command);
  } else if (event.key === "Escape") {
    event.preventDefault();
    document.getElementById("command-palette").close();
  }
});

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    const dialog = $("#command-palette");
    if (dialog.open) dialog.close();
    else openCommandPalette();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "j") {
    event.preventDefault();
    $("#theme-toggle").click();
  } else if (event.key === "/" && event.target === document.body) {
    event.preventDefault();
    openCommandPalette();
  }
});

// --- Wiki 语义相关推荐:嵌入向量检索,一键跳转 ---
async function loadWikiRelatedSuggestions(entryId, container) {
  if (!entryId) {
    container.replaceChildren(
      element("span", { className: "muted", text: "暂无推荐。" }),
    );
    return;
  }
  try {
    const data = await api(
      `/api/wiki/related?entryId=${encodeURIComponent(entryId)}&limit=5`,
    );
    if (!data.suggestions.length) {
      container.replaceChildren(
        element("span", { className: "muted", text: "还没有足够相似的其他条目。" }),
      );
      return;
    }
    const chips = data.suggestions.map((suggestion) => {
      const chip = element("button", {
        className: "related-chip",
        text: `${suggestion.title} · ${suggestion.score}`,
        attrs: { type: "button" },
      });
      chip.addEventListener("click", () => jumpToWikiEntry(suggestion.id));
      return chip;
    });
    container.replaceChildren(...chips);
  } catch {
    container.replaceChildren(
      element("span", { className: "muted", text: "相关推荐加载失败。" }),
    );
  } finally {
    container.removeAttribute("aria-busy");
  }
}

// --- 数据库在线备份(VACUUM INTO)+ LLM 用量展示 ---
async function backupDatabase() {
  const button = $("#backup-db");
  if (button) button.disabled = true;
  try {
    const result = await api("/api/data/backup-db", { method: "POST" });
    showToast(
      `数据库已备份：${result.file}（${Math.max(1, Math.round(result.bytes / 1024))} KB）`,
    );
    await loadDataStatus();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    if (button) button.disabled = false;
  }
}

$("#backup-db")?.addEventListener("click", backupDatabase);

function renderLlmUsage(summary) {
  const target = $("#llm-usage-summary");
  if (!target) return;
  if (!summary?.requests) {
    target.textContent = "模型用量：暂无调用记录。";
    return;
  }
  const tokens = summary.promptTokens + summary.completionTokens;
  target.textContent = `模型用量：最近 ${summary.requests} 次调用 · 输入 ${summary.promptTokens.toLocaleString()} + 输出 ${summary.completionTokens.toLocaleString()} = ${tokens.toLocaleString()} tokens`;
}

// --- 阅读器:滚动进度条 + 阅读位置记忆 + 宋体正文 ---
const READER_POSITION_PREFIX = "architect-reader-pos-";

function registerReaderProgress() {
  const body = $(".materials-body");
  const bar = $("#reader-progress");
  if (!body || !bar) return;
  let frame = 0;
  body.addEventListener("scroll", () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const max = body.scrollHeight - body.clientHeight;
      const ratio = max > 0 ? body.scrollTop / max : 0;
      bar.style.width = `${Math.min(100, Math.round(ratio * 100))}%`;
      if (materialState.selectedId) {
        try {
          localStorage.setItem(
            READER_POSITION_PREFIX + materialState.selectedId,
            String(Math.round(body.scrollTop)),
          );
        } catch {
          /* 忽略 */
        }
      }
    });
  });
}

function restoreReaderPosition(id) {
  const body = $(".materials-body");
  if (!body || !id) return;
  let position = 0;
  try {
    position = Number(localStorage.getItem(READER_POSITION_PREFIX + id)) || 0;
  } catch {
    position = 0;
  }
  if (position > 0) requestAnimationFrame(() => body.scrollTo({ top: position }));
}

(function initReaderEnhancements() {
  registerReaderProgress();
  const serifButton = $("#materials-serif");
  const body = $(".materials-body");
  if (!serifButton) return;
  let serif = false;
  try {
    serif = localStorage.getItem("architect-material-serif") === "true";
  } catch {
    serif = false;
  }
  const apply = () => {
    $(".materials-document")?.classList.toggle("is-serif", serif);
    serifButton.setAttribute("aria-pressed", String(serif));
  };
  apply();
  serifButton.addEventListener("click", () => {
    serif = !serif;
    apply();
    try {
      localStorage.setItem("architect-material-serif", String(serif));
    } catch {
      /* 忽略 */
    }
  });
  void body;
})();

// --- 图谱邻域深度:1 度/2 度/关(选中节点时按 BFS 深度高亮邻域) ---
$("#wiki-graph-depth")?.addEventListener("change", (event) => {
  state.wikiGraphDepth = Number(event.target.value);
  const graph = currentWikiGraph();
  if (graph) {
    graph.focusDepth = state.wikiGraphDepth;
    updateWikiGraphFocus(graph);
  }
});
