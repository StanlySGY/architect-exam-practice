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
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (view === "home") loadActiveSession();
  if (view === "wrong") loadWrong();
  if (view === "history") loadHistory();
  if (view === "bank") prepareQuestionBank();
  if (view === "stats") loadStatistics();
  if (view === "data") {
    loadDataStatus();
    loadQuestionIssues();
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
  if (state.checks[question.id] || state.pendingChecks.has(question.id)) {
    input.disabled = true;
  }
  return element("label", { className: "option" }, [
    input,
    element("span", { className: "option-key", text: key }),
    element("span", { text: value }),
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
      ],
    );
    card.append(feedback);
  }
  return card;
}

function renderAnswerSheet() {
  const questions = state.session.questions;
  const items = questions.map((question, index) => {
    const checked = state.checks[question.id];
    let className = "sheet-item";
    if (index === state.currentIndex) className += " current";
    if (state.answers[question.id]) className += " answered";
    if (checked) className += checked.isCorrect ? " correct" : " incorrect";
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
      input.addEventListener("change", () => checkCurrentAnswer(input.value)),
    );
  renderAnswerSheet();
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
  $("#practice-title").textContent = title;
  $("#practice-meta").textContent =
    state.session.mode === "review"
      ? "间隔回顾 · 错题本"
      : `系统架构设计师 · ${difficultyNames[state.session.difficulty]}难度`;
  $("#submit-hint").textContent =
    `已加载 ${questions.length} 道题，选择答案后立即判题`;
  renderCurrentQuestion();
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
  button.disabled = true;
  button.textContent = "Agent 生成中，请稍候…";
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
  event.preventDefault();
  if (!state.session) return;
  if (
    !window.confirm(
      "提交后将显示答案与解析，且本次练习不能再次提交。确认提交？",
    )
  )
    return;
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
  const circle = element("div", { className: "score-circle" }, [
    element("div", {}, [
      element("strong", { text: `${result.correct}/${result.total}` }),
      element("span", { text: `${result.percentage}% 正确` }),
    ]),
  ]);
  $("#score-hero").replaceChildren(
    circle,
    element("h1", { text: result.mode === "review" ? "回顾完成" : "练习完成" }),
    element("p", {
      className: "result-summary",
      text: `${result.incorrect} 道错误 · ${result.unanswered} 道未作答 · 错题已记录`,
    }),
  );
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
    element("div", { className: "wrong-actions" }, [
      element("span", { className: "muted", text: record.analysis }),
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
    renderWrong(await api("/api/wrong-questions"));
  } catch (error) {
    showToast(error.message, true);
  }
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
  const title =
    attempt.mode === "review"
      ? "错题回顾"
      : `第 ${attempt.chapter} 章 · ${difficultyNames[attempt.difficulty]}`;
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
  return element("article", { className: `panel bank-card${statusClass}` }, [
    element("div", { className: "bank-card-header" }, [
      element("div", { className: "bank-tags" }, [
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
    element("ol", { className: "bank-options" }, options),
    element("div", {
      className: "bank-answer",
      text: `正确答案：${question.correctAnswer}`,
    }),
    element("div", { className: "analysis" }, [
      element("h4", { text: "解析" }),
      element("p", { text: question.analysis }),
    ]),
    element("div", { className: "bank-actions" }, [toggle, remove]),
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
  const label = point.mode === "review" ? "回顾" : `第${point.chapter}章`;
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
      wrongSummaryNode(summary.wrongQuestions, "错题记录"),
      wrongSummaryNode(summary.attempts, "练习记录"),
      wrongSummaryNode(summary.activeSessions, "未完成练习"),
      wrongSummaryNode(summary.questionIssues, "问题题目"),
    );
  } catch (error) {
    showToast(error.message, true);
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
    link.download = `ruankao-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("备份已导出");
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
  } catch {
    $("#model-status").textContent = "模型状态未知";
  }
}

async function loadChapters() {
  const data = await api("/api/chapters");
  state.chapters = data.chapters;
  state.chapterMap = new Map(state.chapters.map((item) => [item.id, item]));
  renderChapters();
}

document.querySelectorAll("[data-view]").forEach((button) =>
  button.addEventListener("click", (event) => {
    event.preventDefault();
    switchView(button.dataset.view);
  }),
);
$("#practice-form").addEventListener("submit", startPractice);
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
$("#bank-previous").addEventListener("click", () => {
  state.bankOffset = Math.max(0, state.bankOffset - state.bankLimit);
  loadQuestionBank();
});
$("#bank-next").addEventListener("click", () => {
  if (state.bankOffset + state.bankLimit >= state.bankTotal) return;
  state.bankOffset += state.bankLimit;
  loadQuestionBank();
});
$("#export-data").addEventListener("click", exportData);
$("#import-data").addEventListener("click", () => $("#import-file").click());
$("#import-file").addEventListener("change", (event) =>
  importDataFile(event.target.files[0]),
);
document
  .querySelectorAll("[data-clear]")
  .forEach((button) =>
    button.addEventListener("click", () => clearData(button.dataset.clear)),
  );

await loadChapters();
await loadSections();
await loadModelStatus();
await loadActiveSession();
await refreshReviewBadge();
