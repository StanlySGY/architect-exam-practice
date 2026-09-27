import { renderQuestionFigure } from "/lib/figures.mjs";
import { renderMarkdown } from "/lib/markdown.mjs";
import { validateEssaySample } from "/lib/essay.mjs";
import { $, element, emptyMessage } from "/ui.js";
import {
  currentWikiGraph,
  destroyWikiGraph,
  fitWikiGraph,
  focusWikiGraphNode,
  initWikiGraphDeps,
  renderWikiGraph,
  updateWikiGraphSearch,
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
  wikiEntries: [],
  wikiSelectedId: "",
  generationControllers: new Map(),
  loadVersions: new Map(),
  modelWorkspace: { providers: [], agents: [], defaultAgentId: "" },
  caseOffset: 0,
  caseLimit: 4,
  caseTotal: 0,
  caseLoadId: 0,
  paperOffset: 0,
  paperLimit: 4,
  paperTotal: 0,
  paperLoadId: 0,
  caseExam: null,
  caseExamTimer: null,
  examDeadline: null,
  examTimer: null,
  examSaveQueues: new Map(),
  examAnswerRevisions: new Map(),
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
    ["生成章节题目", "home", ".agent-panel"],
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
    element("strong", { text: "还没有生成题目" }),
    element("p", {
      text: "先在数据管理配置模型，再按章节生成题目；也可以导入真题库开始练习。",
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
  if (view === "home") loadActiveSession();
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
    loadQuestionIssues();
    loadAuditLog();
    loadModelConfig();
  }
}

function renderChapters() {
  const options = state.chapters.map((chapter) =>
    element("option", {
      text: `第 ${chapter.id} 章　${chapter.title}`,
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
            ? `${chapter.title} · ${chapter.counts.all} 道可用`
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
          text: `${section.title} · ${section.counts.all} 道可用`,
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
  else if (count) availability = `${count} 道可用（新增题目自动防重）`;
  else availability = "导图已就绪，尚未生成此难度";
  $("#availability").textContent = availability;
  let actionText;
  if (state.generationRetry) actionText = "重试生成";
  else if (count) actionText = "补充 Agent 题目";
  else actionText = "根据当前章节导图生成题目";
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
      figureNode(question),
      element("div", {}, options),
      element("div", { className: "question-actions" }, [
        reportButtonNode(question.id),
      ]),
    ],
  );
  const checked = state.checks[question.id];
  if (checked) {
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
        element("p", { text: checked.analysis }),
        aiAnalysisNode(checked.aiAnalysis),
        sourceNodeNode(question.sourceNode),
      ],
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
        ? state.session.term
          ? `${state.session.term} · 按题号组卷 · 交卷统一判分`
          : "模拟考试 · 跨章抽题 · 交卷统一判分"
        : `系统架构设计师 · ${difficultyNames[state.session.difficulty]}难度`;
  $("#submit-hint").textContent =
    state.session.mode === "exam-mcq"
      ? `共 ${questions.length} 道题，可随时修改答案，交卷后统一判分`
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
    if (data.session.mode === "exam-mcq") scope = examSessionTitle(data.session);
    $("#resume-title").textContent = scope;
    $("#resume-meta").textContent =
      `${answered}/${data.session.total} 道已作答 · 创建于 ${new Date(data.session.createdAt).toLocaleString("zh-CN")}`;
  } catch (error) {
    showToast(error.message, true);
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
      }),
      timeoutMs: LONG_API_TIMEOUT_MS,
    });
    state.activeSession = null;
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

function resultDetailNode(detail, index) {
  const analysisChildren = [
    element("h4", { text: `解析 · ${detail.knowledgePoint}` }),
    element("p", { text: detail.analysis }),
  ];
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
  return element(
    "article",
    { className: `result-card ${detail.isCorrect ? "" : "incorrect"}` },
    [
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
      figureNode(detail),
      element("div", {
        className: "answer-line",
        text: `你的答案：${detail.userAnswer || "未作答"}　正确答案：${detail.correctAnswer}`,
      }),
      element("div", { className: "analysis" }, analysisChildren),
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
    text: record.mastered ? "重新加入回顾" : "标记已掌握",
    attrs: {
      "data-mastered": String(!record.mastered),
      "data-question-id": record.questionId,
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
  $("#wrong-summary").replaceChildren(
    wrongSummaryNode(data.summary.total, "累计错题"),
    wrongSummaryNode(data.summary.active, "未掌握"),
    wrongSummaryNode(data.summary.due, "今日待回顾"),
    wrongSummaryNode(data.summary.mastered, "已掌握"),
  );
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
  const total = data.total ?? data.records.length;
  const pageCount = Math.max(1, Math.ceil(total / state.wrongLimit));
  const currentPage = Math.floor(state.wrongOffset / state.wrongLimit) + 1;
  $("#wrong-page").textContent = total
    ? `第 ${currentPage} / ${pageCount} 页 · 共 ${total} 道`
    : "暂无错题";
  $("#wrong-previous").disabled = state.wrongOffset === 0;
  $("#wrong-next").disabled = state.wrongOffset + state.wrongLimit >= total;
  $("#wrong-pagination").hidden = total <= state.wrongLimit;
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

async function startReview() {
  try {
    state.session = await api("/api/review-sessions", {
      method: "POST",
      body: JSON.stringify({ limit: $("#count").value }),
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
      ]),
      element("span", { className: "muted", text: question.knowledgePoint }),
    ]),
    element("div", { className: "question-text", text: question.question }),
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
    sourceNodeNode(question.sourceNode),
    element(
      "div",
      { className: "bank-actions" },
      isImportedItem(question) ? [star, toggle] : [star, toggle, remove],
    ),
  ]);
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
}

async function loadStatistics() {
  const load = beginLoad(
    "statistics",
    ["#stats-summary", "#chapter-stats", "#practice-trend", "#weak-points", "#knowledge-mastery", "#review-stats"],
    "正在加载学习统计…",
  );
  try {
    const data = await api("/api/statistics");
    if (!load.isCurrent()) return;
    renderStatistics(data);
    load.finish();
  } catch (error) {
    load.fail(error, loadStatistics);
  }
}

function issueNode(issue) {
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
  return element("article", { className: "question-issue-row" }, [
    element("div", { className: "question-text", text: issue.question }),
    element("div", {
      className: "wrong-meta",
      text: `第 ${issue.chapter} 章 · ${issue.note} · ${new Date(issue.createdAt).toLocaleString("zh-CN")}`,
    }),
    restore,
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
    const summary = await api("/api/data/status");
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
    load.finish();
  } catch (error) {
    load.fail(error, loadDataStatus);
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

function providerNode(provider) {
  const card = element("article", { className: "provider-card", attrs: { "data-provider-id": provider.id } });
  const nameInput = element("input", { attrs: { type: "text", "aria-label": "供应商名称" } });
  nameInput.value = provider.name;
  const deleteButton = element("button", {
    className: "workspace-delete",
    text: "删除供应商",
    attrs: { type: "button" },
  });
  deleteButton.addEventListener("click", () => {
    if (state.modelWorkspace.providers.length <= 1) {
      showToast("至少保留一个供应商", true);
      return;
    }
    state.modelWorkspace.providers = state.modelWorkspace.providers.filter((item) => item.id !== provider.id);
    state.modelWorkspace.agents = state.modelWorkspace.agents.filter((agent) => agent.providerId !== provider.id);
    if (!state.modelWorkspace.agents.length) state.modelWorkspace.defaultAgentId = "";
    renderModelWorkspace();
  });
  const baseUrl = element("input", { className: "provider-base-url", attrs: { type: "url", placeholder: "https://api.example.com/v1" } });
  baseUrl.value = provider.baseUrl;
  const apiKey = element("input", { className: "provider-api-key", attrs: { type: "password", placeholder: "留空表示无需鉴权" } });
  apiKey.value = provider.apiKey;
  const type = providerTypeSelect(provider);
  const model = modelSelectNode(provider.models, provider.defaultModel, "provider-default-model");
  const fetchButton = element("button", { className: "secondary mc-provider-fetch", text: "获取模型列表", attrs: { type: "button" } });
  const fetchState = element("span", { className: "provider-fetch-state", text: provider.models.length ? `${provider.models.length} 个模型可选` : "尚未获取模型" });
  fetchButton.addEventListener("click", () => fetchProviderModels(provider.id));
  card.append(
    element("div", { className: "provider-card-header" }, [nameInput, deleteButton]),
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

function agentNode(agent) {
  const card = element("article", { className: "agent-config-card", attrs: { "data-agent-id": agent.id } });
  const nameInput = element("input", { attrs: { type: "text", "aria-label": "Agent 名称" } });
  nameInput.value = agent.name;
  const deleteButton = element("button", { className: "workspace-delete", text: "删除 Agent", attrs: { type: "button" } });
  deleteButton.addEventListener("click", () => {
    if (state.modelWorkspace.agents.length <= 1) {
      showToast("至少保留一个 Agent", true);
      return;
    }
    state.modelWorkspace.agents = state.modelWorkspace.agents.filter((item) => item.id !== agent.id);
    if (state.modelWorkspace.defaultAgentId === agent.id) state.modelWorkspace.defaultAgentId = state.modelWorkspace.agents[0]?.id || "";
    renderModelWorkspace();
  });
  const providerSelect = element("select", { className: "agent-provider" });
  providerSelect.append(...state.modelWorkspace.providers.map((provider) => element("option", { text: provider.name, attrs: { value: provider.id } })));
  providerSelect.value = agent.providerId;
  const provider = state.modelWorkspace.providers.find((item) => item.id === agent.providerId) || state.modelWorkspace.providers[0];
  let modelSelect = modelSelectNode(provider?.models, agent.model, "agent-model");
  providerSelect.addEventListener("change", () => {
    const nextProvider = state.modelWorkspace.providers.find((item) => item.id === providerSelect.value);
    modelSelect = modelSelectNode(nextProvider?.models, "", "agent-model");
    card.querySelector(".agent-model")?.replaceWith(modelSelect);
  });
  const description = element("input", { className: "agent-description", attrs: { type: "text", placeholder: "简短说明这个 Agent 的职责" } });
  description.value = agent.description;
  const prompt = element("textarea", { className: "agent-prompt", attrs: { rows: "4", placeholder: "例如：优先指出概念边界，引用知识库条目，避免编造资料外事实。" } });
  prompt.value = agent.systemPrompt;
  const enabled = element("input", { attrs: { type: "checkbox" } });
  enabled.checked = agent.enabled;
  card.append(
    element("div", { className: "agent-config-card-header" }, [nameInput, deleteButton]),
    element("div", { className: "agent-config-grid" }, [
      element("label", { text: "绑定供应商" }, [providerSelect]),
      element("label", { text: "使用模型" }, [modelSelect]),
      element("label", { text: "职责说明" }, [description]),
      element("label", { className: "agent-prompt", text: "角色提示词" }, [prompt]),
      element("label", { className: "agent-task-member" }, [enabled, element("span", { text: "允许参与任务" })]),
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
      systemPrompt: card.querySelector(".agent-prompt")?.value.trim() || "",
      enabled: card.querySelector('input[type="checkbox"]')?.checked !== false,
    };
  });
  return {
    providers,
    agents,
    defaultAgentId: $("#agent-default")?.value || agents[0]?.id || "",
  };
}

function renderModelWorkspace() {
  ensureWorkspaceDraft();
  const providerList = $("#provider-list");
  const agentList = $("#agent-list");
  if (!providerList || !agentList) return;
  providerList.replaceChildren(...state.modelWorkspace.providers.map(providerNode));
  agentList.replaceChildren(...state.modelWorkspace.agents.map(agentNode));
  const defaultSelect = $("#agent-default");
  defaultSelect.replaceChildren(...state.modelWorkspace.agents.map((agent) => element("option", { text: agent.name, attrs: { value: agent.id } })));
  defaultSelect.value = state.modelWorkspace.defaultAgentId || state.modelWorkspace.agents[0]?.id || "";
  const judgeSelect = $("#agent-task-judge");
  judgeSelect.replaceChildren(...state.modelWorkspace.agents.filter((agent) => agent.enabled).map((agent) => element("option", { text: agent.name, attrs: { value: agent.id } })));
  judgeSelect.value = state.modelWorkspace.defaultAgentId || state.modelWorkspace.agents.find((agent) => agent.enabled)?.id || "";
  const members = $("#agent-task-members");
  members.replaceChildren(...state.modelWorkspace.agents.filter((agent) => agent.enabled).map((agent) => {
    const checkbox = element("input", { attrs: { type: "checkbox", value: agent.id } });
    checkbox.checked = agent.id === state.modelWorkspace.defaultAgentId;
    return element("label", { className: "agent-task-member" }, [checkbox, element("span", { text: agent.name })]);
  }));
}

async function loadModelConfig() {
  try {
    const config = await api("/api/model-config");
    state.modelWorkspace = workspaceDraft(config);
    renderModelWorkspace();
  } catch (error) {
    showToast(error.message, true);
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
    renderModelWorkspace();
    showToast("模型工作区已保存并生效");
    await loadModelStatus();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "保存工作区";
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
}

function addAgent() {
  const provider = state.modelWorkspace.providers[0];
  if (!provider) {
    showToast("请先添加供应商", true);
    return;
  }
  const agentId = `agent-${Date.now()}`;
  state.modelWorkspace.agents.push({
    id: agentId,
    name: `Agent ${state.modelWorkspace.agents.length + 1}`,
    description: "",
    providerId: provider.id,
    model: provider.defaultModel || provider.models[0] || "",
    systemPrompt: "",
    enabled: true,
  });
  renderModelWorkspace();
}

function renderAgentTaskResult(result) {
  const box = $("#agent-task-result");
  const answers = (result.results || []).map((item) => element("div", { className: "agent-task-answer" }, [
    element("div", { className: "agent-task-meta" }, [
      element("strong", { text: item.agentName }),
      element("span", { text: item.error ? "调用失败" : `${item.model || "默认模型"} · 置信度 ${Math.round((item.confidence || 0) * 100)}%` }),
    ]),
    element("p", { text: item.error || item.answer }),
    item.keyPoints?.length ? element("ul", {}, item.keyPoints.map((point) => element("li", { text: point }))) : null,
  ]));
  const synthesis = result.synthesis
    ? element("div", { className: "agent-task-answer agent-task-synthesis" }, [
        element("h4", { text: `综合结果 · ${result.synthesis.judgedBy || "评审 Agent"}` }),
        element("p", { text: result.synthesis.answer }),
      ])
    : null;
  box.replaceChildren(
    element("h4", { text: result.strategy === "battle" ? "对战与评审结果" : result.strategy === "parallel" ? "并行回答结果" : "Agent 回答" }),
    ...answers,
    synthesis,
  );
  box.hidden = false;
}

async function runAgentTask() {
  const button = $("#agent-task-run");
  const prompt = $("#agent-task-prompt").value.trim();
  const strategy = $("#agent-task-strategy").value;
  const agentIds = [...document.querySelectorAll('#agent-task-members input:checked')].map((input) => input.value);
  const task = beginGenerationTask({
    key: "agent-task",
    button,
    progress: $("#agent-task-progress"),
    progressText: $("#agent-task-progress-text"),
    cancel: $("#agent-task-cancel"),
    label: "运行 Agent 任务",
  });
  try {
    const result = await api("/api/agents/run", {
      method: "POST",
      body: JSON.stringify({ prompt, strategy, agentIds, judgeAgentId: $("#agent-task-judge").value }),
      signal: task.signal,
      timeoutMs: LONG_API_TIMEOUT_MS,
    });
    renderAgentTaskResult(result);
  } catch (error) {
    if (isGenerationCancelled(error, task.signal)) {
      showToast("已停止 Agent 任务");
      return;
    }
    showToast(error.message, true);
  } finally {
    task.finish();
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
    loadDataStatus(),
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
    $("#materials-content").scrollTo({ top: 0, behavior: "auto" });
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
  if (!knownType || failed) {
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

async function loadPapers() {
  populatePaperChapters();
  const loadId = ++state.paperLoadId;
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
      "data-paper-id": paper.id,
    },
  });
  textarea.value = paper.draft || "";
  // 论文模拟计时：120 分钟倒计时基于服务端开始时间，刷新安全。
  let mockTimer = null;
  const mockBar = element("div", { className: "paper-mock-bar" }, []);
  const renderMockBar = () => {
    clearInterval(mockTimer);
    mockTimer = null;
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
      const remaining = Math.max(
        0,
        Math.round((deadline - Date.now()) / 1000),
      );
      const minutes = Math.floor(remaining / 60);
      const seconds = remaining % 60;
      countdown.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
      countdown.classList.toggle("urgent", remaining <= 300);
      if (remaining === 0) {
        clearInterval(mockTimer);
        mockTimer = null;
        showToast("论文模拟时间到，请提交论文");
      }
    };
    tick();
    mockTimer = setInterval(tick, 1000);
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
    element("p", { className: "paper-description", text: paper.description }),
    sourceNodeNode(paper.sourceNode),
    writingPoints.length
      ? element("details", { className: "paper-points" }, [
          element("summary", { text: "写作要点（" + writingPoints.length + "）" }),
          element("ul", {}, writingPoints),
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
      renderWikiGraph(wikiFilteredEntries(), { focusId: state.wikiSelectedId });
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
      element("div", { className: "wiki-ask-answer" }, [
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
    attrs: { rows: "4" },
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
  if (graphActive) renderWikiGraph(wikiFilteredEntries(), { focusId: state.wikiSelectedId });
  else destroyWikiGraph();
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
  const data = await api("/api/chapters");
  state.chapters = data.chapters;
  state.chapterMap = new Map(state.chapters.map((item) => [item.id, item]));
  renderChapters();
}

// ===== 模拟考试 =====

async function loadMock() {
  await Promise.all([loadMockHistory(), loadRealExamCatalog(), loadActiveCaseExam()]);
}

async function loadRealExamCatalog() {
  const select = $("#real-exam-term");
  const start = $("#start-real-exam");
  const load = beginLoad(
    "real-exam-catalog",
    "#real-exam-catalog-status",
    "正在加载真题目录…",
  );
  try {
    const { papers } = await api("/api/real-exams");
    if (!load.isCurrent()) return;
    const choicePapers = (papers ?? []).filter((paper) => paper.questions > 0);
    if (!choicePapers.length) {
      select.replaceChildren(
        element("option", { text: "请先导入真题库", attrs: { value: "" } }),
      );
      select.disabled = true;
      start.disabled = true;
      setRealExamCatalogStatus("未导入真题");
      load.finish();
      return;
    }
    const previous = select.value;
    select.replaceChildren(
      ...choicePapers.map((paper) =>
        element("option", {
          text: `${paper.term} · ${paper.questions} 题${paper.cases ? ` · ${paper.cases} 案例` : ""}${paper.papers ? ` · ${paper.papers} 论文` : ""}`,
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

async function loadMockHistory() {
  const load = beginLoad("mock-history", "#mock-history-list", "正在加载模拟记录…");
  const available = state.chapters.reduce(
    (sum, chapter) => sum + (chapter.counts?.all ?? 0),
    0,
  );
  $("#mock-availability").textContent = `生成题 ${available} 道可用`;
  $("#start-mock-exam").disabled = available === 0;
  $("#start-case-exam").disabled = !(await caseBankCount());
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
    const { exam } = await api("/api/case-exams/active");
    if (!load.isCurrent()) return;
    state.caseExam = exam;
    renderCaseExam();
    load.finish();
  } catch (error) {
    load.fail(error, loadActiveCaseExam);
  }
}

function renderCaseExam() {
  const stage = $("#case-exam-stage");
  const resume = $("#mock-exam-resume");
  clearInterval(state.caseExamTimer);
  state.caseExamTimer = null;
  const exam = state.caseExam;
  if (!exam) {
    stage.replaceChildren();
    resume.hidden = true;
    return;
  }
  resume.hidden = true;
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
    text: `剩余时间 · 共 ${exam.cases.length} 道案例`,
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
    renderCaseExamGrade(grade);
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
function renderCaseExamGrade(grade) {
  const stage = $("#case-exam-stage");
  const passed = grade.max_score
    ? Math.round((grade.total_score / grade.max_score) * 100) >= 60
    : false;
  const cards = (grade.cases ?? []).map((caseGrade) =>
    element("article", { className: "panel case-card" }, [
      element("h3", { className: "case-title", text: caseGrade.title }),
      caseGradeNode(caseGrade),
    ]),
  );
  stage.replaceChildren(
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
$("#mc-add-provider").addEventListener("click", addProvider);
$("#agent-add").addEventListener("click", addAgent);
$("#agent-task-run").addEventListener("click", runAgentTask);
$("#app-dialog").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) {
    finishAppDialog($("#app-dialog-input").hidden ? false : null);
  }
});
$("#wiki-generate").addEventListener("click", generateWiki);
$("#wiki-search").addEventListener("input", () => {
  renderWiki();
  // 图谱激活时同步关键词高亮，目录与图谱共用同一套搜索。
  const graph = currentWikiGraph();
  if (graph && !$("#wiki-graph").hidden) {
    updateWikiGraphSearch(graph, $("#wiki-search").value);
  }
});
$("#wiki-chapter-filter").addEventListener("change", () => {
  renderWiki();
  if (!$("#wiki-graph").hidden) {
    renderWikiGraph(wikiFilteredEntries(), { focusId: state.wikiSelectedId });
  }
});
$("#wiki-status-filter").addEventListener("change", () => {
  renderWiki();
  if (!$("#wiki-graph").hidden) {
    renderWikiGraph(wikiFilteredEntries(), { focusId: state.wikiSelectedId });
  }
});
// 知识图谱模块需要的应用层回调在首次进入图谱前注入。
initWikiGraphDeps({ openEntry: jumpToWikiEntry });
$("#wiki-reader-tab").addEventListener("click", () => setWikiWorkspaceTab("reader"));
$("#wiki-graph-toggle").addEventListener("click", () => setWikiWorkspaceTab("graph"));
$("#wiki-graph-fit").addEventListener("click", () => {
  const graph = currentWikiGraph();
  if (graph) fitWikiGraph(graph);
});
$("#wiki-graph-reset").addEventListener("click", () => {
  if (!$("#wiki-graph").hidden) renderWikiGraph(state.wikiEntries);
});
let wikiGraphResizeTimer = 0;
window.addEventListener("resize", () => {
  if (!currentWikiGraph() || $("#wiki-graph").hidden) return;
  clearTimeout(wikiGraphResizeTimer);
  wikiGraphResizeTimer = setTimeout(() => {
    if (currentWikiGraph() && !$("#wiki-graph").hidden) {
      renderWikiGraph(state.wikiEntries, { focusId: state.wikiSelectedId });
    }
  }, 120);
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
  await loadBankSections();
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
  }
});

await loadChapters();
await loadSections();
await loadModelStatus();
await loadActiveSession();
await refreshReviewBadge();
await loadStudyPlan();

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
