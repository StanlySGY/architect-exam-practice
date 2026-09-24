import { renderQuestionFigure } from "/lib/figures.mjs";
import { renderMarkdown } from "/lib/markdown.mjs";
import { validateEssaySample } from "/lib/essay.mjs";

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
  wikiEntries: [],
  caseExam: null,
  caseExamTimer: null,
  examDeadline: null,
  examTimer: null,
};
const difficultyNames = {
  easy: "简单",
  medium: "中等",
  hard: "困难",
  mixed: "混合",
};
const $ = (selector) => document.querySelector(selector);

function element(tag, { className, text, attrs = {} } = {}, children = []) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, String(value));
  node.append(...children.filter(Boolean));
  return node;
}

function emptyMessage(title, message) {
  return element("div", { className: "empty" }, [
    element("strong", { text: title }),
    element("span", { text: message }),
  ]);
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

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `请求失败（${response.status}）`);
    error.code = body.code;
    error.status = response.status;
    throw error;
  }
  return body;
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

function switchView(view) {
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
  const cards = state.chapters.map((chapter) =>
    element(
      "div",
      {
        className: `chapter-card ${chapter.source === "mindmap" ? "available" : ""}`,
      },
      [
        element("strong", { text: `第 ${chapter.id} 章` }),
        element("span", {
          text: `${chapter.title} · ${chapter.source === "mindmap" ? `${chapter.counts.all} 道可用` : "尚未整理导图"}`,
        }),
      ],
    ),
  );
  $("#coverage").replaceChildren(...cards);
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
  const note = window.prompt(
    "请简要说明问题（例如：答案错误、解析不一致、题目重复）",
  );
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
  state.answers[question.id] = answer;
  $("#submit-hint").textContent = "答案已保存；模拟考试可随时修改答案";
  renderCurrentQuestion();
  try {
    await api("/api/exam-answers", {
      method: "POST",
      body: JSON.stringify({
        sessionId: state.session.id,
        questionId: question.id,
        answer,
      }),
    });
  } catch (error) {
    showToast(error.message, true);
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
      submitPractice();
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
  state.answers = { ...(state.activeSession.answers ?? {}) };
  state.checks = { ...(state.activeSession.checks ?? {}) };
  state.pendingChecks.clear();
  renderQuestions({ restore: true });
  switchView("practice");
}

async function abandonActiveSession() {
  if (!state.activeSession) return;
  if (!window.confirm("确认放弃这次未完成练习？已作答进度不会计入成绩。"))
    return;
  try {
    await api(`/api/sessions/${encodeURIComponent(state.activeSession.id)}`, {
      method: "DELETE",
    });
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
  button.disabled = true;
  button.textContent = "生成中…";
  progress.hidden = false;
  const startedAt = Date.now();
  const timer = setInterval(() => {
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    progressText.textContent = `正在生成题目，已等待 ${seconds} 秒…`;
  }, 1000);
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
    state.generationRetry = true;
    showToast(error.message, true);
  } finally {
    clearInterval(timer);
    progress.hidden = true;
    button.disabled = false;
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

async function submitPractice(event) {
  event?.preventDefault();
  if (!state.session) return;
  const examMode = state.session.mode === "exam-mcq";
  const unanswered = state.session.questions.length - Object.keys(state.answers).length;
  const message = examMode
    ? unanswered
      ? `还有 ${unanswered} 题未作答，交卷后统一判分且不能重考。确认交卷？`
      : "交卷后统一判分，且本次模拟不能再次提交。确认交卷？"
    : "提交后将显示答案与解析，且本次练习不能再次提交。确认提交？";
  if (!window.confirm(message)) return;
  if (examMode) {
    clearInterval(state.examTimer);
    state.examTimer = null;
  }
  try {
    state.result = await api("/api/grade", {
      method: "POST",
      body: JSON.stringify({
        sessionId: state.session.id,
        answers: state.answers,
      }),
    });
    state.activeSession = null;
    renderResult();
    switchView("result");
    refreshReviewBadge();
  } catch (error) {
    showToast(error.message, true);
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
  try {
    const data = await api("/api/wrong-questions");
    state.wrongRecords = data.records;
    renderWrong(data);
  } catch (error) {
    showToast(error.message, true);
  }
}

function exportWrong() {
  const records = state.wrongRecords;
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
  try {
    const { attempts } = await api("/api/attempts");
    $("#history-list").replaceChildren(
      ...(attempts.length
        ? attempts.map(historyNode)
        : [emptyMessage("还没有练习记录", "从首页选择一章开始第一次练习。")]),
    );
  } catch (error) {
    showToast(error.message, true);
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
  if (!window.confirm(`确认永久删除这道题？\n\n${question.question}`)) return;
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
        : [emptyMessage("没有匹配的题目", "请调整关键词或筛选条件。")]),
    );
  } catch (error) {
    showToast(error.message, true);
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
  try {
    await loadBankSections();
    await loadQuestionBank();
  } catch (error) {
    showToast(error.message, true);
  }
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
  try {
    renderStatistics(await api("/api/statistics"));
  } catch (error) {
    showToast(error.message, true);
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
  try {
    const data = await api("/api/question-issues");
    if (!data.records.length) {
      $("#question-issues-list").replaceChildren(
        emptyMessage(
          "还没有标记的问题题目",
          "练习中发现题目有误时，可以在题目下方标记。",
        ),
      );
      return;
    }
    $("#question-issues-list").replaceChildren(...data.records.map(issueNode));
  } catch (error) {
    showToast(error.message, true);
  }
}

async function loadDataStatus() {
  try {
    const summary = await api("/api/data/status");
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
  } catch (error) {
    showToast(error.message, true);
  }
}

async function loadModelConfig() {
  try {
    const config = await api("/api/model-config");
    $("#mc-base-url").value = config.ARCHITECT_LLM_BASE_URL || "";
    $("#mc-api-key").value = config.ARCHITECT_LLM_API_KEY || "";
    $("#mc-model").value = config.ARCHITECT_LLM_MODEL || "";
    $("#mc-models").value = config.ARCHITECT_LLM_MODELS || "";
  } catch (error) {
    showToast(error.message, true);
  }
}

async function saveModelConfig() {
  const button = $("#mc-save");
  button.disabled = true;
  button.textContent = "保存中…";
  try {
    await api("/api/model-config", {
      method: "POST",
      body: JSON.stringify({
        ARCHITECT_LLM_BASE_URL: $("#mc-base-url").value.trim(),
        ARCHITECT_LLM_API_KEY: $("#mc-api-key").value.trim(),
        ARCHITECT_LLM_MODEL: $("#mc-model").value.trim(),
        ARCHITECT_LLM_MODELS: $("#mc-models").value.trim(),
      }),
    });
    showToast("模型配置已保存并生效");
    await loadModelStatus();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "保存配置";
  }
}

async function fetchModels() {
  const button = $("#mc-fetch");
  const result = $("#mc-fetch-result");
  button.disabled = true;
  button.textContent = "获取中…";
  result.hidden = true;
  try {
    const data = await api("/api/model-config/fetch-models", {
      method: "POST",
      body: JSON.stringify({
        baseUrl: $("#mc-base-url").value.trim(),
        apiKey: $("#mc-api-key").value.trim(),
      }),
    });
    if (!data.models.length) {
      result.textContent = "该接口未返回可用模型，请检查 Base URL 或手动填写模型名。";
      result.className = "mc-fetch-result error";
    } else {
      result.textContent = `获取到 ${data.models.length} 个模型：${data.models.join("、")}`;
      result.className = "mc-fetch-result";
      $("#mc-models").value = data.models.join(",");
    }
    result.hidden = false;
  } catch (error) {
    result.textContent = error.message;
    result.className = "mc-fetch-result error";
    result.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = "获取模型列表";
  }
}

async function refreshAfterDataChange() {
  state.session = null;
  state.result = null;
  await loadChapters();
  await loadSections();
  await Promise.all([
    loadActiveSession(),
    refreshReviewBadge(),
    loadDataStatus(),
    loadQuestionIssues(),
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
  } catch (error) {
    showToast(error.message, true);
  }
}

const materialState = { note: "", materials: [], selectedId: null };

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

async function loadMaterials() {
  try {
    const data = await api("/api/study-materials");
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
    else {
      $("#materials-content").replaceChildren(
        emptyMessage("选择一篇资料", "左侧按大纲和教材分组，点开后只读显示正文。"),
      );
    }
  } catch (error) {
    showToast(error.message, true);
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
  const body = $("#materials-content");
  body.replaceChildren(element("p", { className: "muted", text: "正在读取…" }));
  try {
    const doc = await api(`/api/study-materials/${encodeURIComponent(id)}`);
    const article = element("div", { className: "markdown-body" });
    article.innerHTML = renderMarkdown(doc.markdown, window.location.origin);
    const source = safeHttpUrl(doc.sourceUrl);
    const heading = [
      element("h2", { text: doc.title }),
      source
        ? element("p", { className: "muted" }, [
            element("a", {
              text: "查看来源",
              attrs: { href: source, target: "_blank", rel: "noreferrer" },
            }),
          ])
        : null,
    ];
    body.replaceChildren(...heading.filter(Boolean), article);
  } catch (error) {
    body.replaceChildren(emptyMessage("资料打不开", error.message));
  }
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
    if (!window.confirm("导入会替换当前题库、错题本和练习记录。确认继续？"))
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
  if (!window.confirm(`确认清空${labels[scope]}？此操作不能撤销。`)) return;
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
    let label = "模型未配置，请填写 .env";
    if (status.configured) {
      label =
        status.provider === "openai-compatible"
          ? `${status.model} 已配置`
          : "Claude CLI 已配置";
    }
    $("#model-status").textContent = label;
    $("#model-status").classList.toggle("error-status", !status.configured);
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
  try {
    const params = new URLSearchParams({
      sourceType: $("#case-source")?.value || "all",
    });
    const data = await api(`/api/cases?${params}`);
    renderCases(data.cases);
  } catch (error) {
    showToast(error.message, true);
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
      element("div", { className: "case-reference", hidden: true }, [
        element("h4", { text: "参考答案" }),
        element("p", { text: question.referenceAnswer }),
      ]),
    ]),
  );
  const showReferenceButton = element("button", {
    className: "ghost",
    text: "查看参考答案",
    attrs: { type: "button" },
  });
  showReferenceButton.addEventListener("click", () => {
    const container = showReferenceButton.closest(".case-card");
    container.querySelectorAll(".case-reference").forEach((node) => {
      node.hidden = false;
    });
    showReferenceButton.disabled = true;
    showReferenceButton.textContent = "已显示参考答案";
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
  return element("div", { className: "paper-grade" }, [
    element("div", { className: "grade-score" }, [
      element("strong", { text: `${grade.total_score}/${grade.max_score}` }),
      element("span", { text: "AI 评分" }),
    ]),
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
  ]);
}

function renderCases(cases) {
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
              button.textContent = "保存草稿";
            }, 2000);
          } catch (error) {
            showToast(error.message, true);
          }
        });
      });
    });
}

async function generateCases() {
  const button = $("#case-generate");
  const progress = $("#case-progress");
  const progressText = $("#case-progress-text");
  button.disabled = true;
  progress.hidden = false;
  const startedAt = Date.now();
  const timer = setInterval(() => {
    progressText.textContent = `正在生成案例，已等待 ${Math.round((Date.now() - startedAt) / 1000)} 秒…`;
  }, 1000);
  try {
    const result = await api("/api/cases/generate", {
      method: "POST",
      body: JSON.stringify({
        chapter: $("#case-chapter").value,
        count: $("#case-count").value,
        model: $("#model-select").value || undefined,
      }),
    });
    showToast(`已生成 ${result.added} 道案例分析题`);
    await loadCases();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    clearInterval(timer);
    progress.hidden = true;
    button.disabled = false;
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
  try {
    const params = new URLSearchParams({
      sourceType: $("#paper-source")?.value || "all",
    });
    const data = await api(`/api/papers?${params}`);
    renderPapers(data.papers);
  } catch (error) {
    showToast(error.message, true);
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
    try {
      await api("/api/papers/draft", {
        method: "POST",
        body: JSON.stringify({ paperId: paper.id, draft: textarea.value }),
      });
      showToast("草稿已保存");
    } catch (error) {
      showToast(error.message, true);
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
      });
      await loadPapers();
      showToast(`评分完成：${grade.total_score} 分`);
    } catch (error) {
      showToast(error.message, true);
      gradeButton.disabled = false;
      gradeButton.textContent = "提交评分";
    }
  });
  const gradeNode = paper.grade ? paperGradeNode(paper.grade) : null;  return element("article", { className: "panel paper-card" }, [
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
      ? element("div", { className: "paper-points" }, [
          element("h4", { text: "写作要点" }),
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
  return element("div", { className: "paper-grade" }, [
    element("div", { className: "grade-score" }, [
      element("strong", { text: `${grade.total_score}/${grade.max_score}` }),
      element("span", { text: "分" }),
    ]),
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
  ]);
}

function renderPapers(papers) {
  $("#paper-list").replaceChildren(
    ...(papers.length
      ? papers.map(paperNode)
      : [
          emptyMessage(
            "还没有论文题目",
            "选择章节生成论文，或先到数据管理导入真题库。",
          ),
        ]),
  );
}

async function generatePapers() {
  const button = $("#paper-generate");
  const progress = $("#paper-progress");
  const progressText = $("#paper-progress-text");
  button.disabled = true;
  progress.hidden = false;
  const startedAt = Date.now();
  const timer = setInterval(() => {
    progressText.textContent = `正在生成论文题目，已等待 ${Math.round((Date.now() - startedAt) / 1000)} 秒…`;
  }, 1000);
  try {
    const result = await api("/api/papers/generate", {
      method: "POST",
      body: JSON.stringify({
        chapter: $("#paper-chapter").value,
        count: $("#paper-count").value,
        model: $("#model-select").value || undefined,
      }),
    });
    showToast(`已生成 ${result.added} 道论文题目`);
    await loadPapers();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    clearInterval(timer);
    progress.hidden = true;
    button.disabled = false;
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
  try {
    const data = await api("/api/wiki");
    state.wikiEntries = data.entries;
    renderWiki(data.entries);
  } catch (error) {
    showToast(error.message, true);
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
    const card = editButton.closest(".wiki-card");
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
  return element("article", { className: "panel wiki-card", attrs: { "data-id": entry.id } }, [
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

function renderWiki(entries) {
  const search = $("#wiki-search").value.trim().toLowerCase();
  const statusFilter = $("#wiki-status-filter").value;
  const filtered = entries.filter((entry) => {
    if (statusFilter !== "all" && entry.status !== statusFilter) return false;
    if (search) {
      const text = `${entry.title} ${entry.summary} ${(entry.keyPoints ?? []).join(" ")}`.toLowerCase();
      if (!text.includes(search)) return false;
    }
    return true;
  });
  $("#wiki-list").replaceChildren(
    ...(filtered.length
      ? filtered.map(wikiNode)
      : [
          emptyMessage(
            "还没有知识点条目",
            "选择章节，点击上方按钮生成知识点条目。",
          ),
        ]),
  );
}

// 跳转到指定 Wiki 条目：清除筛选，滚动到对应卡片并高亮。
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
  renderWiki(state.wikiEntries);
  const card = document.querySelector(`.wiki-card[data-id="${entryId}"]`);
  if (!card) {
    showToast("该条目不存在或已被过滤");
    return;
  }
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.classList.add("wiki-highlight");
  setTimeout(() => card.classList.remove("wiki-highlight"), 2000);
}

// 知识图谱：基于条目 related 关系，用简单力导向布局渲染 SVG。
function renderWikiGraph(entries) {
  const canvas = $("#wiki-graph-canvas");
  if (entries.length < 2) {
    canvas.replaceChildren(
      emptyMessage("条目太少", "至少需要 2 个知识点才能展示图谱。"),
    );
    return;
  }
  const width = 900;
  const height = 520;
  const nodes = entries.map((entry, index) => ({
    id: entry.id,
    title: entry.title,
    x: 100 + Math.random() * (width - 200),
    y: 100 + Math.random() * (height - 200),
    vx: 0,
    vy: 0,
  }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  // 边：基于 links（related 匹配到的条目）。
  const edges = [];
  for (const entry of entries) {
    for (const targetId of entry.links ?? []) {
      if (nodeById.has(targetId)) {
        edges.push({ source: entry.id, target: targetId });
      }
    }
  }
  // 力导向迭代。
  const iterations = 200;
  const repulsion = 1800;
  const attraction = 0.02;
  const centerForce = 0.01;
  for (let iter = 0; iter < iterations; iter += 1) {
    for (const node of nodes) {
      node.vx += (width / 2 - node.x) * centerForce;
      node.vy += (height / 2 - node.y) * centerForce;
      for (const other of nodes) {
        if (other === node) continue;
        const dx = node.x - other.x;
        const dy = node.y - other.y;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const force = repulsion / (dist * dist);
        node.vx += (dx / dist) * force;
        node.vy += (dy / dist) * force;
      }
    }
    for (const edge of edges) {
      const a = nodeById.get(edge.source);
      const b = nodeById.get(edge.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const force = attraction * (dist - 120);
      a.vx += (dx / dist) * force;
      a.vy += (dy / dist) * force;
      b.vx -= (dx / dist) * force;
      b.vy -= (dy / dist) * force;
    }
    for (const node of nodes) {
      node.x = Math.max(30, Math.min(width - 30, node.x + node.vx));
      node.y = Math.max(30, Math.min(height - 30, node.y + node.vy));
      node.vx *= 0.85;
      node.vy *= 0.85;
    }
  }
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "wiki-graph-svg");
  for (const edge of edges) {
    const a = nodeById.get(edge.source);
    const b = nodeById.get(edge.target);
    if (!a || !b) continue;
    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", a.x);
    line.setAttribute("y1", a.y);
    line.setAttribute("x2", b.x);
    line.setAttribute("y2", b.y);
    line.setAttribute("class", "wiki-graph-edge");
    svg.append(line);
  }
  for (const node of nodes) {
    const group = document.createElementNS(svgNS, "g");
    group.setAttribute("class", "wiki-graph-node");
    group.setAttribute("transform", `translate(${node.x},${node.y})`);
    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("r", "18");
    const label = document.createElementNS(svgNS, "text");
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("dy", "34");
    label.textContent = node.title.length > 10
      ? `${node.title.slice(0, 10)}…`
      : node.title;
    group.append(circle, label);
    group.addEventListener("click", () => jumpToWikiEntry(node.id));
    svg.append(group);
  }
  canvas.replaceChildren(svg);
}

async function generateWiki() {
  const button = $("#wiki-generate");
  const progress = $("#wiki-progress");
  const progressText = $("#wiki-progress-text");
  button.disabled = true;
  progress.hidden = false;
  const startedAt = Date.now();
  const timer = setInterval(() => {
    progressText.textContent = `正在生成知识点，已等待 ${Math.round((Date.now() - startedAt) / 1000)} 秒…`;
  }, 1000);
  try {
    const result = await api("/api/wiki/generate", {
      method: "POST",
      body: JSON.stringify({
        chapter: $("#wiki-chapter").value,
        count: $("#wiki-count").value,
        model: $("#model-select").value || undefined,
      }),
    });
    showToast(`已生成 ${result.added} 个知识点条目`);
    await loadWiki();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    clearInterval(timer);
    progress.hidden = true;
    button.disabled = false;
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
  try {
    const { papers } = await api("/api/real-exams");
    const choicePapers = (papers ?? []).filter((paper) => paper.questions > 0);
    if (!choicePapers.length) {
      select.replaceChildren(
        element("option", { text: "请先导入真题库", attrs: { value: "" } }),
      );
      select.disabled = true;
      start.disabled = true;
      $("#real-exam-availability").textContent = "未导入真题";
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
    $("#real-exam-availability").textContent = `${choicePapers.length} 套可开 · 最新 ${latest.term}`;
  } catch (error) {
    select.replaceChildren(
      element("option", { text: "真题目录加载失败", attrs: { value: "" } }),
    );
    select.disabled = true;
    start.disabled = true;
    $("#real-exam-availability").textContent = "加载失败";
    showToast(error.message, true);
  }
}

async function loadMockHistory() {
  const available = state.chapters.reduce(
    (sum, chapter) => sum + (chapter.counts?.all ?? 0),
    0,
  );
  $("#mock-availability").textContent = `生成题 ${available} 道可用`;
  $("#start-case-exam").disabled = !(await caseBankCount());
  try {
    const { exams } = await api("/api/case-exams");
    const { attempts } = await api("/api/attempts");
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
  } catch (error) {
    showToast(error.message, true);
  }
}

function examScorePercent(exam) {
  const max = exam.maxScore ?? 75;
  if (!max) return 0;
  return Math.round(((exam.totalScore ?? 0) / max) * 100);
}

async function caseBankCount() {
  try {
    const { cases } = await api("/api/cases");
    return cases.length;
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
    !window.confirm(
      "将从相邻仓库导入历年真题和模拟卷。导入按题号更新，不会覆盖生成题或练习进度。确认继续？",
    )
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
  try {
    const { exam } = await api("/api/case-exams/active");
    state.caseExam = exam;
    renderCaseExam();
  } catch (error) {
    showToast(error.message, true);
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
    });
  });
  fillCaseExamCountdown(exam);
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
    const remaining = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    countdown.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    countdown.classList.toggle("urgent", remaining <= 300);
    if (remaining === 0) {
      clearInterval(state.caseExamTimer);
      state.caseExamTimer = null;
      showToast("案例模拟时间到，请交卷");
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
  if (!window.confirm("将抽 3 道案例限时 90 分钟连做，交卷后 AI 一次性判分。开始？"))
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
  if (!window.confirm("确认放弃本次案例模拟？进度不会保留。")) return;
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
  const stage = document.querySelector("#case-exam-stage");
  const textareas = stage.querySelectorAll(".case-answer");
  const drafts = {};
  let unanswered = 0;
  for (const textarea of textareas) {
    const caseId = textarea.dataset.caseId;
    drafts[caseId] ??= {};
    drafts[caseId][textarea.dataset.questionId] = textarea.value;
    if (!textarea.value.trim()) unanswered += 1;
  }
  if (
    !window.confirm(
      unanswered
        ? `还有 ${unanswered} 个小问未作答，交卷后 AI 判分且不能重考。确认交卷？`
        : "交卷后 AI 一次性判分，且不能重考。确认交卷？",
    )
  )
    return;
  button.disabled = true;
  button.textContent = "AI 判分中，约需 1-2 分钟…";
  try {
    for (const [caseId, questions] of Object.entries(drafts)) {
      for (const [questionId, text] of Object.entries(questions)) {
        await api("/api/case-exams/draft", {
          method: "POST",
          body: JSON.stringify({ examId: exam.id, caseId, questionId, text }),
        });
      }
    }
    const grade = await api("/api/case-exams/grade", {
      method: "POST",
      body: JSON.stringify({
        examId: exam.id,
        model: $("#model-select").value || undefined,
      }),
    });
    state.caseExam = null;
    renderCaseExamGrade(grade);
    await loadMockHistory();
    showToast(`AI 判分完成：${grade.total_score}/${grade.max_score} 分`);
  } catch (error) {
    showToast(error.message, true);
    button.disabled = false;
    button.textContent = "交卷并由 AI 判分";
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
$("#plan-goal-select").addEventListener("change", (event) =>
  setDailyGoal(event.target.value),
);
$("#case-generate").addEventListener("click", generateCases);
$("#case-source").addEventListener("change", loadCases);
$("#paper-generate").addEventListener("click", generatePapers);
$("#paper-source").addEventListener("change", loadPapers);
$("#mc-save").addEventListener("click", saveModelConfig);
$("#mc-fetch").addEventListener("click", fetchModels);
$("#wiki-generate").addEventListener("click", generateWiki);
$("#wiki-search").addEventListener("input", () => renderWiki(state.wikiEntries));
$("#wiki-status-filter").addEventListener("change", () =>
  renderWiki(state.wikiEntries),
);
$("#wiki-graph-toggle").addEventListener("click", () => {
  const graph = $("#wiki-graph");
  graph.hidden = !graph.hidden;
  if (!graph.hidden) renderWikiGraph(state.wikiEntries);
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
