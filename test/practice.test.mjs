import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { QuestionGenerator } from "../src/generator.mjs";
import { parseFreeplane } from "../src/mindmap.mjs";
import { PracticeService } from "../src/questions.mjs";
import { JsonStore, SQLiteStore } from "../src/store.mjs";

const root = resolve(import.meta.dirname, "..");

function emptySummary(overrides = {}) {
  return {
    questions: 0,
    generatedQuestions: 0,
    realQuestions: 0,
    mockQuestions: 0,
    wrongQuestions: 0,
    attempts: 0,
    activeSessions: 0,
    questionIssues: 0,
    cases: 0,
    generatedCases: 0,
    realCases: 0,
    mockCases: 0,
    papers: 0,
    generatedPapers: 0,
    realPapers: 0,
    mockPapers: 0,
    wikiEntries: 0,
    caseExams: 0,
    ...overrides,
  };
}

async function fixture(t, now = () => "2026-04-01T08:00:00.000Z") {
  const directory = await mkdtemp(join(tmpdir(), "ruankao-test-"));
  t.after(() => {
    store.close();
    return rm(directory, { recursive: true, force: true });
  });
  const store = new JsonStore(join(directory, "state.json"));
  await store.init();
  const service = new PracticeService({ store, root, now, random: () => 0.25 });
  await service.init();
  return { service, store };
}

async function addQuestions(
  service,
  { chapter, section = null, difficulty, count = 3 },
) {
  const templates = [
    {
      question: "分层架构中限制跨层调用的主要目的是什么？",
      options: {
        A: "控制依赖方向",
        B: "取消模块边界",
        C: "共享全部状态",
        D: "绕过接口契约",
      },
      knowledge_point: "架构分层",
    },
    {
      question: "质量属性场景中的响应度量用于描述什么？",
      options: {
        A: "可验证的响应目标",
        B: "开发者人数",
        C: "代码文件数量",
        D: "产品发布日期",
      },
      knowledge_point: "质量属性场景",
    },
    {
      question: "使用适配器模式解决外部接口不兼容时，适配器承担什么职责？",
      options: {
        A: "转换接口契约",
        B: "删除领域模型",
        C: "替代所有业务规则",
        D: "取消错误处理",
      },
      knowledge_point: "适配器模式",
    },
  ];
  return service.addGeneratedQuestions({
    chapter,
    section,
    difficulty,
    source: "mindmap",
    questions: Array.from({ length: count }, (_, index) => {
      const template = templates[index] ?? {
        question: `知识点 ${index + 1} 的独立测试问题是什么？`,
        options: {
          A: `正确项 ${index + 1}`,
          B: "错误项乙",
          C: "错误项丙",
          D: "错误项丁",
        },
        knowledge_point: `知识点 ${index + 1}`,
      };
      return {
        ...template,
        question: `第 ${chapter} 章：${template.question}`,
        correct_answer: "A",
        analysis: "测试解析",
      };
    }),
  });
}

async function generatorWithFetch(t, fetchImplementation) {
  const { service } = await fixture(t);
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.RUANKAO_LLM_BASE_URL;
  const originalModel = process.env.RUANKAO_LLM_MODEL;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.RUANKAO_LLM_BASE_URL;
    else process.env.RUANKAO_LLM_BASE_URL = originalBaseUrl;
    if (originalModel === undefined) delete process.env.RUANKAO_LLM_MODEL;
    else process.env.RUANKAO_LLM_MODEL = originalModel;
  });
  process.env.RUANKAO_LLM_BASE_URL = "http://model.test/v1";
  process.env.RUANKAO_LLM_MODEL = "test-model";
  globalThis.fetch = fetchImplementation;
  return new QuestionGenerator({ root, service });
}

async function assertGeneratorError(t, fetchImplementation, expected) {
  const generator = await generatorWithFetch(t, fetchImplementation);
  await assert.rejects(
    () => generator.generate({ chapter: 1, difficulty: "easy", count: 1 }),
    (error) =>
      error.code === expected.code &&
      error.status === expected.status &&
      error.message.includes(expected.message),
  );
}

test("模型网络不可达会返回可操作的错误", async (t) => {
  await assertGeneratorError(
    t,
    async () => {
      throw new TypeError("fetch failed");
    },
    {
      code: "LLM_NETWORK_FAILED",
      status: 503,
      message: "无法连接模型接口",
    },
  );
});

test("模型鉴权失败会返回明确错误码", async (t) => {
  await assertGeneratorError(
    t,
    async () => ({ ok: false, status: 401, json: async () => ({}) }),
    { code: "LLM_AUTH_FAILED", status: 502, message: "鉴权失败" },
  );
});

test("模型限流会提示稍后重试", async (t) => {
  await assertGeneratorError(
    t,
    async () => ({ ok: false, status: 429, json: async () => ({}) }),
    { code: "LLM_RATE_LIMITED", status: 503, message: "请求过于频繁" },
  );
});

test("模型返回非法 JSON 会被识别为格式错误", async (t) => {
  await assertGeneratorError(
    t,
    async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "这不是 JSON" } }],
      }),
    }),
    { code: "LLM_INVALID_RESPONSE", status: 502, message: "JSON" },
  );
});

test("SQLite 存储在重新打开后保留学习状态", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ruankao-sqlite-test-"));
  const file = join(directory, "state.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = new SQLiteStore(file);
  await first.init();
  await first.update((state) => {
    state.generatedQuestions.push({ id: "persisted-question" });
    state.attempts.push({ id: "persisted-attempt" });
  });
  first.close();
  const reopened = new SQLiteStore(file);
  await reopened.init();
  assert.deepEqual(
    reopened.snapshot().generatedQuestions.map((question) => question.id),
    ["persisted-question"],
  );
  assert.deepEqual(
    reopened.snapshot().attempts.map((attempt) => attempt.id),
    ["persisted-attempt"],
  );
  reopened.close();
});

test("旧 JSON 学习数据会自动迁移到 SQLite", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ruankao-migration-test-"));
  const legacyFile = join(directory, "state.json");
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    legacyFile,
    JSON.stringify({
      version: 1,
      generatedQuestions: [{ id: "legacy-question" }],
      sessions: { "legacy-session": { id: "legacy-session" } },
      attempts: [{ id: "legacy-attempt" }],
      wrongBook: { "legacy-question": { questionId: "legacy-question" } },
    }),
  );
  const store = new SQLiteStore(join(directory, "state.sqlite"));
  await store.init();
  assert.equal(store.file, join(directory, "state.sqlite"));
  assert.equal(store.snapshot().generatedQuestions[0].id, "legacy-question");
  assert.equal(
    store.snapshot().sessions["legacy-session"].id,
    "legacy-session",
  );
  assert.equal(store.snapshot().attempts[0].id, "legacy-attempt");
  assert.equal(
    store.snapshot().wrongBook["legacy-question"].questionId,
    "legacy-question",
  );
  assert.equal(
    JSON.parse(await readFile(`${legacyFile}.migrated-backup`, "utf8"))
      .generatedQuestions[0].id,
    "legacy-question",
  );
  store.close();
});

test("完整备份可在清空后恢复", async (t) => {
  const { service } = await fixture(t);
  await addQuestions(service, { chapter: 4, difficulty: "easy", count: 1 });
  const session = await service.createSession({
    chapter: 4,
    difficulty: "easy",
    count: 1,
  });
  await service.grade({ sessionId: session.id, answers: {} });
  const backup = service.exportData();
  assert.equal(backup.format, "ruankao-practice-backup");
  assert.equal(service.dataSummary().questions, 1);
  assert.equal(service.dataSummary().attempts, 1);
  await service.clearData({ scope: "all", confirm: "CLEAR" });
  assert.deepEqual(service.dataSummary(), emptySummary());
  await service.importData({ backup, confirm: "IMPORT" });
  assert.equal(service.dataSummary().questions, 1);
  assert.equal(service.dataSummary().wrongQuestions, 1);
  assert.equal(service.dataSummary().attempts, 1);
});

test("分项清空保持数据边界且要求确认口令", async (t) => {
  const { service } = await fixture(t);
  await addQuestions(service, { chapter: 4, difficulty: "easy", count: 1 });
  const session = await service.createSession({
    chapter: 4,
    difficulty: "easy",
    count: 1,
  });
  await service.grade({ sessionId: session.id, answers: {} });
  await assert.rejects(
    () => service.clearData({ scope: "wrongBook", confirm: "" }),
    (error) => error.code === "CONFIRMATION_REQUIRED",
  );
  await service.clearData({ scope: "wrongBook", confirm: "CLEAR" });
  assert.equal(service.dataSummary().wrongQuestions, 0);
  assert.equal(service.dataSummary().questions, 1);
  assert.equal(service.dataSummary().attempts, 1);
  await service.clearData({ scope: "attempts", confirm: "CLEAR" });
  assert.equal(service.dataSummary().attempts, 0);
  assert.equal(service.dataSummary().questions, 1);
});

test("问题题目会退出普通题库并可恢复", async (t) => {
  const { service } = await fixture(t);
  await addQuestions(service, { chapter: 6, difficulty: "easy", count: 2 });
  const disabled = service.allQuestions()[0];
  await service.reportQuestion({
    questionId: disabled.id,
    note: "答案和解析不一致",
  });
  assert.equal(service.questionIssues().length, 1);
  assert.equal(service.questionIssues()[0].note, "答案和解析不一致");
  assert.equal(service.dataSummary().questionIssues, 1);
  const session = await service.createSession({
    chapter: 6,
    difficulty: "easy",
    count: 10,
  });
  assert.equal(session.questions.length, 1);
  assert.notEqual(session.questions[0].id, disabled.id);
  await service.restoreQuestion(disabled.id);
  assert.equal(service.questionIssues().length, 0);
  const restored = await service.createSession({
    chapter: 6,
    difficulty: "easy",
    count: 10,
  });
  assert.equal(restored.questions.length, 2);
});

test("标记错题为问题题后停止安排回顾", async (t) => {
  const { service } = await fixture(t);
  await addQuestions(service, { chapter: 6, difficulty: "easy", count: 1 });
  const session = await service.createSession({
    chapter: 6,
    difficulty: "easy",
    count: 1,
  });
  const question = session.questions[0];
  await service.grade({
    sessionId: session.id,
    answers: { [question.id]: "B" },
  });
  assert.equal(service.wrongQuestions().summary.due, 1);
  await service.reportQuestion({ questionId: question.id, note: "答案有误" });
  assert.equal(service.wrongQuestions().summary.due, 0);
  assert.equal(service.wrongQuestions().records[0].disabledByIssue, true);
  await assert.rejects(
    () => service.createReviewSession({ limit: 1 }),
    (error) => error.code === "NO_DUE_QUESTIONS",
  );
});

test("问题题状态会随备份恢复并在清空题库时移除", async (t) => {
  const { service } = await fixture(t);
  await addQuestions(service, { chapter: 6, difficulty: "easy", count: 1 });
  const question = service.allQuestions()[0];
  await service.reportQuestion({ questionId: question.id, note: "题干有误" });
  const backup = service.exportData();
  await service.clearData({ scope: "all", confirm: "CLEAR" });
  assert.equal(service.dataSummary().questionIssues, 0);
  await service.importData({ backup, confirm: "IMPORT" });
  assert.equal(service.dataSummary().questionIssues, 1);
  assert.ok(service.allQuestions()[0].disabledAt);
});

test("题库浏览支持组合筛选搜索与分页", async (t) => {
  const { service } = await fixture(t);
  await addQuestions(service, {
    chapter: 1,
    section: "1.1",
    difficulty: "easy",
    count: 2,
  });
  await service.addGeneratedQuestions({
    chapter: 1,
    section: "1.2",
    difficulty: "hard",
    source: "mindmap",
    questions: [
      {
        question: "在架构权衡分析中，敏感点主要描述什么？",
        options: {
          A: "架构决策对质量属性的显著影响",
          B: "项目成员的个人偏好",
          C: "代码仓库的目录数量",
          D: "会议室的使用计划",
        },
        knowledge_point: "架构权衡",
        correct_answer: "A",
        analysis: "敏感点用于识别质量属性对架构决策的敏感关系。",
      },
    ],
  });
  const disabled = service.allQuestions()[0];
  await service.reportQuestion({ questionId: disabled.id, note: "待检查" });
  const filtered = service.questionBank({
    query: "质量属性",
    chapter: 1,
    section: "1.1",
    difficulty: "easy",
    status: "active",
  });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.records[0].knowledgePoint, "质量属性场景");
  const disabledOnly = service.questionBank({ status: "disabled" });
  assert.equal(disabledOnly.total, 1);
  assert.equal(disabledOnly.records[0].id, disabled.id);
  const firstPage = service.questionBank({ limit: 2, offset: 0 });
  const secondPage = service.questionBank({ limit: 2, offset: 2 });
  assert.equal(firstPage.total, 3);
  assert.equal(firstPage.records.length, 2);
  assert.equal(secondPage.records.length, 1);
});

test("永久删除题目清理关联状态但保留历史汇总", async (t) => {
  const { service } = await fixture(t);
  await addQuestions(service, { chapter: 6, difficulty: "easy", count: 2 });
  const firstSession = await service.createSession({
    chapter: 6,
    difficulty: "easy",
    count: 2,
  });
  const target = firstSession.questions[0];
  await service.grade({
    sessionId: firstSession.id,
    answers: { [target.id]: "B" },
  });
  const activeSession = await service.createReviewSession({
    limit: 2,
    includeNotDue: true,
  });
  assert.ok(activeSession.questionIds.includes(target.id));
  await service.reportQuestion({ questionId: target.id, note: "删除测试" });
  await assert.rejects(
    () => service.deleteQuestion({ questionId: target.id, confirm: "" }),
    (error) => error.code === "CONFIRMATION_REQUIRED",
  );
  await service.deleteQuestion({ questionId: target.id, confirm: "DELETE" });
  const state = service.store.snapshot();
  assert.equal(
    service.allQuestions().some((question) => question.id === target.id),
    false,
  );
  assert.equal(Boolean(state.wrongBook[target.id]), false);
  assert.equal(Boolean(state.questionIssues[target.id]), false);
  assert.equal(state.attempts.length, 1);
  assert.equal(
    state.sessions[activeSession.id].questionIds.includes(target.id),
    false,
  );
});

test("学习统计按题数加权并聚合章节和薄弱知识点", async (t) => {
  const { service, store } = await fixture(t);
  await store.update((state) => {
    state.attempts = [
      {
        id: "attempt-new",
        mode: "practice",
        chapter: 4,
        total: 10,
        correct: 8,
        percentage: 80,
        gradedAt: "2026-04-02T08:00:00.000Z",
      },
      {
        id: "attempt-old",
        mode: "practice",
        chapter: 4,
        total: 2,
        correct: 0,
        percentage: 0,
        gradedAt: "2026-04-01T08:00:00.000Z",
      },
      {
        id: "review-one",
        mode: "review",
        chapter: null,
        total: 1,
        correct: 1,
        percentage: 100,
        gradedAt: "2026-04-02T09:00:00.000Z",
      },
    ];
    state.wrongBook = {
      q1: {
        knowledgePoint: "架构风格",
        timesWrong: 3,
        mastered: false,
        disabledByIssue: false,
        nextReviewAt: "2026-04-01T00:00:00.000Z",
        lastWrongAt: "2026-04-02T00:00:00.000Z",
      },
      q2: {
        knowledgePoint: "架构风格",
        timesWrong: 1,
        mastered: false,
        disabledByIssue: false,
        nextReviewAt: "2026-04-03T00:00:00.000Z",
        lastWrongAt: "2026-04-01T00:00:00.000Z",
      },
      q3: {
        knowledgePoint: "设计模式",
        timesWrong: 2,
        mastered: true,
        disabledByIssue: false,
        nextReviewAt: "2026-04-03T00:00:00.000Z",
        lastWrongAt: "2026-04-01T00:00:00.000Z",
      },
    };
  });
  const stats = service.statistics();
  assert.deepEqual(stats.summary, {
    attempts: 3,
    totalQuestions: 13,
    correct: 9,
    accuracy: 69,
    studyDays: 2,
  });
  assert.equal(stats.chapters.length, 1);
  assert.equal(stats.chapters[0].accuracy, 67);
  assert.equal(stats.weakKnowledgePoints[0].knowledgePoint, "架构风格");
  assert.equal(stats.weakKnowledgePoints[0].timesWrong, 4);
  assert.deepEqual(stats.review, { total: 3, active: 2, mastered: 1, due: 1 });
  assert.deepEqual(
    stats.trend.map((point) => point.id),
    ["review-one", "attempt-old", "attempt-new"],
  );
});

test("空学习数据返回可渲染的零值统计", async (t) => {
  const { service } = await fixture(t);
  const stats = service.statistics();
  assert.deepEqual(stats.summary, {
    attempts: 0,
    totalQuestions: 0,
    correct: 0,
    accuracy: 0,
    studyDays: 0,
  });
  assert.deepEqual(stats.chapters, []);
  assert.deepEqual(stats.trend, []);
  assert.deepEqual(stats.weakKnowledgePoints, []);
});

test("动态识别思维导图已有章节，初始题库为空", async (t) => {
  const { service } = await fixture(t);
  const chapters = service.chapterList();
  assert.equal(chapters.length, 20);
  assert.equal(chapters.find((chapter) => chapter.id === 2).counts.all, 0);
  assert.equal(chapters.find((chapter) => chapter.id === 1).counts.all, 0);
  const sourced = await service.chapterListWithSources();
  assert.equal(sourced.find((chapter) => chapter.id === 1).source, "mindmap");
  assert.equal(sourced.find((chapter) => chapter.id === 8).source, "mindmap");
});

test("练习接口不泄露答案，判卷后写入错题本", async (t) => {
  const { service } = await fixture(t);
  await addQuestions(service, { chapter: 4, difficulty: "medium" });
  const session = await service.createSession({
    chapter: 4,
    difficulty: "mixed",
    count: 3,
  });
  assert.equal(session.questions.length, 3);
  assert.ok(
    session.questions.every(
      (question) => !Object.hasOwn(question, "correctAnswer"),
    ),
  );
  const answers = Object.fromEntries(
    session.questions.map((question) => [question.id, "Z"]),
  );
  const result = await service.grade({ sessionId: session.id, answers });
  assert.equal(result.correct, 0);
  assert.equal(result.incorrect, 3);
  assert.equal(service.wrongQuestions().summary.due, 3);
});

test("错题连续回顾答对两次后标记为已掌握", async (t) => {
  let time = "2026-04-01T08:00:00.000Z";
  const { service } = await fixture(t, () => time);
  await addQuestions(service, { chapter: 5, difficulty: "easy", count: 1 });
  const first = await service.createSession({
    chapter: 5,
    difficulty: "easy",
    count: 1,
  });
  const question = first.questions[0];
  const graded = await service.grade({
    sessionId: first.id,
    answers: { [question.id]: "Z" },
  });
  const correctAnswer = graded.details[0].correctAnswer;

  const reviewOne = await service.createReviewSession({ limit: 1 });
  await service.grade({
    sessionId: reviewOne.id,
    answers: { [question.id]: correctAnswer },
  });
  assert.equal(service.wrongQuestions().summary.mastered, 0);

  time = "2026-04-03T08:00:00.000Z";
  const reviewTwo = await service.createReviewSession({ limit: 1 });
  await service.grade({
    sessionId: reviewTwo.id,
    answers: { [question.id]: correctAnswer },
  });
  assert.equal(service.wrongQuestions().summary.mastered, 1);
  assert.equal(service.wrongQuestions().summary.active, 0);
});

test("按小节识别导图并即时判题", async (t) => {
  const { service } = await fixture(t);
  const sections = await service.sections(1);
  assert.deepEqual(
    sections.map((section) => section.id),
    ["1.1", "1.2", "1.3"],
  );
  await addQuestions(service, {
    chapter: 1,
    section: "1.1",
    difficulty: "easy",
    count: 1,
  });
  const session = await service.createSession({
    chapter: 1,
    section: "1.1",
    difficulty: "easy",
    count: 1,
  });
  assert.equal(session.section, "1.1");
  assert.equal(session.questions[0].section, "1.1");
  const checked = await service.checkAnswer({
    sessionId: session.id,
    questionId: session.questions[0].id,
    answer: "A",
  });
  assert.equal(checked.isCorrect, true);
  assert.equal(checked.correctAnswer, "A");
  assert.equal(service.wrongQuestions().summary.total, 0);
});

test("新增题目会过滤同章重复和近似重复", async (t) => {
  const { service } = await fixture(t);
  await addQuestions(service, { chapter: 6, difficulty: "easy", count: 1 });
  const first = service.allQuestions()[0];
  const added = await service.addGeneratedQuestions({
    chapter: 6,
    section: null,
    difficulty: "easy",
    questions: [
      {
        question: first.question,
        options: first.options,
        correct_answer: "A",
        knowledge_point: "重复题",
      },
      {
        question: "在分布式系统中，哪项做法最有助于隔离故障影响范围？",
        options: {
          A: "服务拆分",
          B: "取消边界",
          C: "共享全部状态",
          D: "忽略超时",
        },
        correct_answer: "A",
        knowledge_point: "故障隔离",
      },
    ],
  });
  assert.equal(added.length, 1);
  assert.equal(service.allQuestions().length, 2);
});

test("旧题库中的重复题不会进入同一练习", async (t) => {
  const { service, store } = await fixture(t);
  await addQuestions(service, { chapter: 9, difficulty: "easy", count: 1 });
  const original = service.allQuestions()[0];
  await store.update((state) => {
    state.generatedQuestions.push({
      ...original,
      id: "legacy-duplicate",
    });
  });
  const session = await service.createSession({
    chapter: 9,
    difficulty: "easy",
    count: 10,
  });
  assert.equal(session.questions.length, 1);
});

test("未完成练习可恢复且不会泄露未答题答案", async (t) => {
  const { service } = await fixture(t);
  await addQuestions(service, { chapter: 7, difficulty: "easy", count: 2 });
  const session = await service.createSession({
    chapter: 7,
    difficulty: "easy",
    count: 2,
  });
  const answered = session.questions[0];
  const unanswered = session.questions[1];
  await service.checkAnswer({
    sessionId: session.id,
    questionId: answered.id,
    answer: "B",
  });
  const active = service.activeSession();
  assert.equal(active.id, session.id);
  assert.equal(active.answers[answered.id], "B");
  assert.equal(active.checks[answered.id].isCorrect, false);
  assert.equal(active.checks[answered.id].correctAnswer, "A");
  assert.equal(Object.hasOwn(active.checks, unanswered.id), false);
  assert.ok(
    active.questions.every(
      (question) => !Object.hasOwn(question, "correctAnswer"),
    ),
  );
  await service.abandonSession(session.id);
  assert.equal(service.activeSession(), null);
  await assert.rejects(
    () =>
      service.checkAnswer({
        sessionId: session.id,
        questionId: unanswered.id,
        answer: "A",
      }),
    /已经放弃/,
  );
});

test("新练习会自动放弃旧的未完成练习", async (t) => {
  const { service } = await fixture(t);
  await addQuestions(service, { chapter: 7, difficulty: "easy", count: 1 });
  const first = await service.createSession({
    chapter: 7,
    difficulty: "easy",
    count: 1,
  });
  const second = await service.createSession({
    chapter: 7,
    difficulty: "easy",
    count: 1,
  });
  assert.equal(service.activeSession().id, second.id);
  assert.ok(service.store.snapshot().sessions[first.id].abandonedAt);
});

test("即时判题后答案锁定且判卷采用首次答案", async (t) => {
  const { service } = await fixture(t);
  await addQuestions(service, { chapter: 7, difficulty: "easy", count: 1 });
  const session = await service.createSession({
    chapter: 7,
    difficulty: "easy",
    count: 1,
  });
  const question = session.questions[0];
  const first = await service.checkAnswer({
    sessionId: session.id,
    questionId: question.id,
    answer: "B",
  });
  assert.equal(first.isCorrect, false);
  await assert.rejects(
    () =>
      service.checkAnswer({
        sessionId: session.id,
        questionId: question.id,
        answer: "A",
      }),
    (error) => error.code === "ANSWER_LOCKED",
  );
  const result = await service.grade({
    sessionId: session.id,
    answers: { [question.id]: "A" },
  });
  assert.equal(result.details[0].userAnswer, "B");
  assert.equal(result.correct, 0);
});

test("生成器过滤重复后会再次请求补足题数", async (t) => {
  const { service } = await fixture(t);
  await addQuestions(service, { chapter: 1, difficulty: "easy", count: 1 });
  const existing = service.allQuestions()[0];
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.RUANKAO_LLM_BASE_URL;
  const originalModel = process.env.RUANKAO_LLM_MODEL;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.RUANKAO_LLM_BASE_URL;
    else process.env.RUANKAO_LLM_BASE_URL = originalBaseUrl;
    if (originalModel === undefined) delete process.env.RUANKAO_LLM_MODEL;
    else process.env.RUANKAO_LLM_MODEL = originalModel;
  });
  process.env.RUANKAO_LLM_BASE_URL = "http://model.test/v1";
  process.env.RUANKAO_LLM_MODEL = "test-model";
  const responses = [
    [
      {
        question: existing.question,
        options: existing.options,
        correct_answer: "A",
        knowledge_point: "重复题",
        analysis: "重复",
        knowledge_detail: "",
        common_mistake: "",
        memory_tip: "",
      },
      {
        question: "架构设计中，使用信息隐藏原则主要降低哪类影响？",
        options: {
          A: "局部变更的传播",
          B: "编译器版本",
          C: "屏幕亮度",
          D: "办公地点",
        },
        correct_answer: "A",
        knowledge_point: "信息隐藏",
        analysis: "隔离变化。",
        knowledge_detail: "",
        common_mistake: "",
        memory_tip: "",
      },
    ],
    [
      {
        question: "系统边界内设置明确接口契约的首要价值是什么？",
        options: {
          A: "稳定协作边界",
          B: "取消模块职责",
          C: "隐藏所有故障",
          D: "替代需求分析",
        },
        correct_answer: "A",
        knowledge_point: "接口契约",
        analysis: "约束模块协作。",
        knowledge_detail: "",
        common_mistake: "",
        memory_tip: "",
      },
    ],
  ];
  let calls = 0;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({ questions: responses[calls++] }),
          },
        },
      ],
    }),
  });
  const generator = new QuestionGenerator({ root, service });
  const result = await generator.generate({
    chapter: 1,
    difficulty: "easy",
    count: 2,
  });
  assert.equal(calls, 2);
  assert.equal(result.added, 2);
  assert.equal(result.duplicatesSkipped, 1);
  assert.equal(result.complete, true);
  assert.equal(service.allQuestions().length, 3);
});

test("尚未加入思维导图的章节不能开始练习", async (t) => {
  const { service } = await fixture(t);
  await assert.rejects(
    () => service.createSession({ chapter: 99, difficulty: "mixed", count: 1 }),
    (error) => error.code === "MINDMAP_CHAPTER_MISSING",
  );
});

test("重复提交同一练习会被拒绝", async (t) => {
  const { service } = await fixture(t);
  await addQuestions(service, { chapter: 4, difficulty: "medium", count: 1 });
  const session = await service.createSession({
    chapter: 4,
    difficulty: "medium",
    count: 1,
  });
  await service.grade({ sessionId: session.id, answers: {} });
  await assert.rejects(
    () => service.grade({ sessionId: session.id, answers: {} }),
    /已经提交过/,
  );
});

// ---- AI 评分 × 知识库集成 ----

function modelResponse(payload) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(payload) } }],
    }),
  };
}

test("案例 AI 评分按命中知识点关联 Wiki 条目", async (t) => {
  // generatorWithFetch 自建全新 fixture，播种必须走 generator.service。
  // fetch 回调在评分时才执行，闭包引用稍后定义的 payload 是安全的。
  const generator = await generatorWithFetch(t, async () =>
    modelResponse(payload),
  );
  const service = generator.service;
  await service.addWikiEntries({
    chapter: 1,
    entries: [
      {
        title: "微服务架构",
        summary: "将单体应用拆分为一组可独立部署的小服务。",
        key_points: ["服务自治"],
        common_mistakes: ["误认为微服务一定优于单体"],
        related: [],
        source_node: "微服务",
      },
      {
        title: "服务注册中心",
        summary: "记录服务实例地址供消费者发现服务。",
        key_points: [],
        common_mistakes: [],
        related: ["微服务架构"],
        source_node: "服务治理",
      },
    ],
  });
  const micro = service
    .wikiList()
    .find((entry) => entry.title === "微服务架构");
  const registry = service
    .wikiList()
    .find((entry) => entry.title === "服务注册中心");
  const payload = {
    results: [
      {
        id: "1",
        score: 8,
        max: 10,
        comment: "命中主要得分点",
        knowledge_points: ["微服务架构", "资料里没有的知识点"],
      },
      {
        id: "2",
        score: 5,
        max: 15,
        comment: "遗漏服务发现论述",
        knowledge_points: ["服务注册中心"],
      },
    ],
    total_score: 13,
    max_score: 25,
    overall_comment: "整体结构合理",
  };
  await service.addCases({
    chapter: 1,
    cases: [
      {
        title: "支付系统改造",
        scenario: "某公司计划将单体支付系统改造为微服务架构。",
        knowledge_point: "微服务",
        questions: [
          {
            text: "请说明微服务拆分的原则。",
            points: 10,
            reference_answer: "高内聚低耦合，按业务能力拆分。",
          },
          {
            text: "请说明服务注册中心的作用。",
            points: 15,
            reference_answer: "服务发现与容错。",
          },
        ],
      },
    ],
  });
  const caseItem = service.caseList()[0];
  const grade = await generator.gradeCaseWithAI({
    caseItem,
    answers: { 1: "按业务能力拆分", 2: "服务发现与容错" },
  });
  assert.equal(grade.caseId, caseItem.id);
  assert.equal(grade.total_score, 13);
  assert.equal(grade.max_score, 25);
  // 精确命中的知识点去重后按库内顺序返回，未命中的标题被忽略。
  assert.deepEqual(grade.wikiEntries, [
    { id: micro.id, title: "微服务架构" },
    { id: registry.id, title: "服务注册中心" },
  ]);
  assert.deepEqual(grade.results[0].knowledgePoints, [
    "微服务架构",
    "资料里没有的知识点",
  ]);
  // 单案例评分与模拟卷对齐：持久化到案例记录，刷新后可回看。
  const stored = service.caseList().find((item) => item.id === caseItem.id);
  assert.equal(stored.grade.total_score, 13);
  assert.deepEqual(stored.grade.wikiEntries, grade.wikiEntries);
  assert.ok(stored.gradedAt);
});

test("案例模拟卷交卷 AI 判分逐卷挂接 Wiki 条目并持久化", async (t) => {
  // generatorWithFetch 自建全新 fixture，播种必须走 generator.service。
  let call = 0;
  const generator = await generatorWithFetch(t, async () =>
    modelResponse(payloads[call++]),
  );
  const service = generator.service;
  await service.addWikiEntries({
    chapter: 1,
    entries: [
      {
        title: "微服务架构",
        summary: "架构风格。",
        key_points: [],
        common_mistakes: [],
        related: [],
        source_node: "微服务",
      },
    ],
  });
  const micro = service
    .wikiList()
    .find((entry) => entry.title === "微服务架构");
  await service.addCases({
    chapter: 1,
    cases: [
      {
        title: "支付系统改造",
        scenario: "单体改微服务。",
        knowledge_point: "微服务",
        questions: [
          { text: "拆分原则", points: 10, reference_answer: "高内聚低耦合" },
        ],
      },
      {
        title: "日志系统设计",
        scenario: "设计统一日志。",
        knowledge_point: "可观测性",
        questions: [
          { text: "日志分级", points: 5, reference_answer: "分级存储" },
        ],
      },
    ],
  });
  await service.createCaseExam({ count: 2 });
  const active = service.activeCaseExam();
  assert.ok(active);
  for (const caseItem of active.cases) {
    await service.saveCaseExamDraft({
      examId: active.id,
      caseId: caseItem.id,
      questionId: caseItem.questions[0].id,
      text: "考生作答",
    });
  }
  const storedCases = active.cases.map((pub) =>
    service.caseList().find((item) => item.id === pub.id),
  );
  const microCase = storedCases.find((item) => item.title === "支付系统改造");
  const payloads = storedCases.map((caseItem) => ({
    results: [
      {
        id: "1",
        score: caseItem.id === microCase.id ? 8 : 3,
        max: caseItem.questions[0].points,
        comment: "说明",
        knowledge_points: [caseItem.id === microCase.id ? "微服务架构" : "消息队列"],
      },
    ],
    total_score: caseItem.id === microCase.id ? 8 : 3,
    max_score: caseItem.questions[0].points,
    overall_comment: "评语",
  }));
  const grade = await generator.gradeCaseExam({
    exam: { id: active.id, drafts: active.drafts },
    cases: storedCases,
  });
  assert.equal(grade.total_score, 11);
  assert.equal(grade.max_score, 15);
  assert.deepEqual(grade.cases.find((c) => c.caseId === microCase.id).wikiEntries, [
    { id: micro.id, title: "微服务架构" },
  ]);
  assert.deepEqual(
    grade.cases.find((c) => c.caseId !== microCase.id).wikiEntries,
    [],
  );
  assert.equal(service.activeCaseExam(), null);
  const listed = service.caseExamList()[0];
  assert.equal(listed.totalScore, 11);
  assert.equal(listed.maxScore, 15);
});

test("Wiki 自检能发现同名、断链、孤立与缺溯源条目", async (t) => {
  const { service } = await fixture(t);
  await service.addWikiEntries({
    chapter: 1,
    entries: [
      {
        title: "负载均衡",
        summary: "把流量分摊到多个节点。",
        key_points: [],
        common_mistakes: [],
        related: ["不存在的知识点"],
        source_node: "负载均衡",
      },
      {
        title: "负载均衡",
        summary: "重复条目。",
        key_points: [],
        common_mistakes: [],
        related: [],
        source_node: "负载均衡",
      },
      {
        title: "缓存",
        summary: "加速读取。",
        key_points: [],
        common_mistakes: [],
        related: ["消息队列"],
        source_node: "缓存",
      },
      {
        title: "消息队列",
        summary: "异步解耦。",
        key_points: [],
        common_mistakes: [],
        related: ["缓存"],
        source_node: "消息队列",
      },
      {
        title: "孤儿知识点",
        summary: "孤立条目。",
        key_points: [],
        common_mistakes: [],
        related: [],
        source_node: "",
      },
    ],
  });
  const lint = service.wikiLint();
  assert.equal(lint.total, 5);
  assert.equal(lint.problems, 3);
  const issuesByTitle = lint.issues.reduce((map, item) => {
    if (!map.has(item.title)) map.set(item.title, []);
    map.get(item.title).push(item.issues);
    return map;
  }, new Map());
  // 同名两条都报 duplicate_title：一条断链后成了孤立条目，另一条本来就孤立。
  assert.deepEqual(issuesByTitle.get("负载均衡"), [
    ["duplicate_title", "broken_related", "orphan"],
    ["duplicate_title", "orphan"],
  ]);
  assert.deepEqual(issuesByTitle.get("孤儿知识点"), [["missing_source", "orphan"]]);
  assert.ok(!issuesByTitle.has("缓存"));
  assert.ok(!issuesByTitle.has("消息队列"));
});

test("模型未标注知识点时案例评分仍向后兼容", async (t) => {
  // generatorWithFetch 自建全新 fixture，播种必须走 generator.service。
  const generator = await generatorWithFetch(t, async () =>
    modelResponse(payload),
  );
  const service = generator.service;
  await service.addCases({
    chapter: 1,
    cases: [
      {
        title: "缓存设计",
        scenario: "某电商系统缓存频繁失效。",
        knowledge_point: "缓存",
        questions: [
          { text: "请说明缓存穿透的应对。", points: 10, reference_answer: "布隆过滤器" },
        ],
      },
    ],
  });
  // 旧版模型输出没有 knowledge_points 字段，评分流程不应报错。
  const payload = {
    results: [{ id: "1", score: 6, max: 10, comment: "基本正确" }],
    total_score: 6,
    max_score: 10,
    overall_comment: "可以",
  };
  const grade = await generator.gradeCaseWithAI({
    caseItem: service.caseList()[0],
    answers: { 1: "布隆过滤器" },
  });
  assert.deepEqual(grade.wikiEntries, []);
  assert.deepEqual(grade.results[0].knowledgePoints, []);
  // 兼容路径同样持久化。
  assert.equal(service.caseList()[0].grade.total_score, 6);
});

test("知识点匹配精确优先、短词不模糊、相似度兜底", async (t) => {
  const { service } = await fixture(t);
  await service.addWikiEntries({
    chapter: 1,
    entries: [
      {
        title: "缓存穿透",
        summary: "查询不存在的数据穿过缓存直达数据库。",
        key_points: [],
        common_mistakes: [],
        related: [],
        source_node: "缓存",
      },
      {
        title: "布隆过滤器",
        summary: "判断元素是否存在的概率型数据结构。",
        key_points: [],
        common_mistakes: [],
        related: ["缓存穿透"],
        source_node: "缓存",
      },
      {
        title: "负载均衡算法",
        summary: "轮询、加权、最少连接等分发策略。",
        key_points: [],
        common_mistakes: [],
        related: [],
        source_node: "负载均衡",
      },
    ],
  });
  const list = service.wikiList();
  const bloom = list.find((entry) => entry.title === "布隆过滤器");
  const cachePenetration = list.find((entry) => entry.title === "缓存穿透");
  const balance = list.find((entry) => entry.title === "负载均衡算法");
  // 精确命中优先。
  assert.deepEqual(service.matchWikiEntries(["布隆过滤器"]), [
    { id: bloom.id, title: "布隆过滤器" },
  ]);
  // 少于 4 字的知识点不做模糊匹配：避免「缓存」被吸到「缓存穿透」。
  assert.deepEqual(service.matchWikiEntries(["缓存"]), []);
  // 互相包含（双方 ≥4 字）可命中。
  assert.deepEqual(service.matchWikiEntries(["缓存穿透机制"]), [
    { id: cachePenetration.id, title: "缓存穿透" },
  ]);
  // bigram 相似度兜底：「负载均衡策略」与「负载均衡算法」。
  assert.deepEqual(service.matchWikiEntries(["负载均衡策略"]), [
    { id: balance.id, title: "负载均衡算法" },
  ]);
});

test("generateWiki 提示词注入已有条目标题并解析双链", async (t) => {
  let captured = null;
  const generator = await generatorWithFetch(t, async (url, options) => {
    captured = JSON.parse(options.body);
    return modelResponse({
      entries: [
        {
          title: "限流算法",
          summary: "令牌桶与漏桶。",
          key_points: ["令牌桶"],
          common_mistakes: [],
          related: ["微服务架构"],
          source_node: "限流",
        },
      ],
    });
  });
  const service = generator.service;
  await service.addWikiEntries({
    chapter: 1,
    entries: [
      {
        title: "微服务架构",
        summary: "架构风格。",
        key_points: [],
        common_mistakes: [],
        related: [],
        source_node: "微服务",
      },
    ],
  });
  const micro = service.wikiList().find((entry) => entry.title === "微服务架构");
  const result = await generator.generateWiki({ chapter: 1, count: 1 });
  assert.equal(result.added, 1);
  // 已有条目标题注入用户消息，模型才能用标题原文建双链。
  const userMessage =
    captured.messages?.find((message) => message.role === "user")?.content ??
    "";
  assert.ok(userMessage.includes("已有知识点条目标题"));
  assert.ok(userMessage.includes("微服务架构"));
  // 新条目的 related 能解析为可点击的双链。
  const entry = service.wikiList().find((item) => item.title === "限流算法");
  assert.deepEqual(entry.links, [micro.id]);
});

test("同名条目可合并、断链引用可一键修复", async (t) => {
  const { service } = await fixture(t);
  await service.addWikiEntries({
    chapter: 1,
    entries: [
      {
        title: "负载均衡",
        summary: "把流量分摊到多个节点。",
        key_points: ["轮询"],
        common_mistakes: [],
        related: ["不存在的引用"],
        source_node: "负载均衡",
      },
      {
        title: "负载均衡",
        summary: "重复条目。",
        key_points: ["加权轮询"],
        common_mistakes: ["误配置健康检查"],
        related: [],
        source_node: "",
      },
      {
        title: "缓存",
        summary: "加速读取。",
        key_points: [],
        common_mistakes: [],
        related: [],
        source_node: "缓存",
      },
    ],
  });
  const list = service.wikiList();
  const first = list.find(
    (entry) => entry.title === "负载均衡" && entry.summary.includes("分摊"),
  );
  const dup = list.find(
    (entry) => entry.title === "负载均衡" && entry.summary === "重复条目。",
  );
  const cache = list.find((entry) => entry.title === "缓存");
  // 合并：内容并入最早条目，重复条目删除，缺溯源由来源补齐。
  await service.mergeWikiEntry({ entryId: dup.id, intoId: first.id });
  const after = service.wikiList();
  assert.equal(after.filter((entry) => entry.title === "负载均衡").length, 1);
  const target = after.find((entry) => entry.id === first.id);
  assert.deepEqual(target.keyPoints, ["轮询", "加权轮询"]);
  assert.deepEqual(target.commonMistakes, ["误配置健康检查"]);
  assert.equal(target.sourceNode, "负载均衡");
  // 合并后同名告警消除。
  const lint = service.wikiLint();
  const firstIssue = lint.issues.find((item) => item.id === first.id);
  assert.ok(!firstIssue.issues.includes("duplicate_title"));
  // 断链一键修复：把解析不到的引用替换为现有条目标题。
  await service.fixWikiRelated({
    entryId: first.id,
    name: "不存在的引用",
    candidate: "缓存",
  });
  const fixed = service.wikiList().find((entry) => entry.id === first.id);
  assert.deepEqual(fixed.related, ["缓存"]);
  assert.deepEqual(fixed.links, [cache.id]);
});

test("知识库问答基于条目作答并返回引用", async (t) => {
  let call = 0;
  const calls = [];
  const generator = await generatorWithFetch(t, async (url, options) => {
    calls.push(JSON.parse(options.body));
    return modelResponse(
      call++ === 0
        ? { titles: ["微服务架构"] }
        : {
            answer: "微服务架构将单体拆分为一组小服务（引用：微服务架构）。",
            used_titles: ["微服务架构"],
          },
    );
  });
  const service = generator.service;
  await service.addWikiEntries({
    chapter: 1,
    entries: [
      {
        title: "微服务架构",
        summary: "将单体应用拆分为一组可独立部署的小服务。",
        key_points: ["服务自治"],
        common_mistakes: [],
        related: [],
        source_node: "微服务",
      },
    ],
  });
  const result = await generator.answerFromWiki({
    question: "什么是微服务架构？",
  });
  // 第一阶段：把问题与标题清单都送进模型选题。
  assert.ok(calls[0].messages[1].content.includes("什么是微服务架构"));
  assert.ok(calls[0].messages[1].content.includes("微服务架构"));
  // 第二阶段：把选中条目的全文作为上下文。
  assert.ok(calls[1].messages[1].content.includes("将单体应用拆分"));
  assert.ok(result.answer.includes("微服务架构"));
  assert.deepEqual(result.references, [
    { id: service.wikiList()[0].id, title: "微服务架构" },
  ]);
});

test("知识库无相关条目时问答明确提示", async (t) => {
  const generator = await generatorWithFetch(t, async () =>
    modelResponse({ titles: ["不存在的条目"] }),
  );
  const service = generator.service;
  // 空知识库直接拒绝提问。
  await assert.rejects(
    () => generator.answerFromWiki({ question: "什么是 Kubernetes？" }),
    /知识库还是空的/,
  );
  await service.addWikiEntries({
    chapter: 1,
    entries: [
      {
        title: "微服务架构",
        summary: "架构风格。",
        key_points: [],
        common_mistakes: [],
        related: [],
        source_node: "微服务",
      },
    ],
  });
  const result = await generator.answerFromWiki({
    question: "什么是 Kubernetes？",
  });
  assert.equal(result.references.length, 0);
  assert.ok(result.answer.includes("暂无"));
});

function sampleBank() {
  const choice = (id, term, sourceType, questionNo, stem) => ({
    id,
    sourceType,
    module: "architecture",
    knowledge: "分层架构",
    stem,
    options: { A: "控制依赖", B: "取消边界", C: "共享状态", D: "绕过接口" },
    answer: "A",
    analysis: "控制依赖方向。",
    term,
    paper: "综合知识",
    questionNo,
  });
  return {
    choices: [
      choice("real-2025-2", "2025年下半年", "real", 2, "真题第二题？"),
      choice("real-2025-1", "2025年下半年", "real", 1, "真题第一题？"),
      choice("mock-2026-1", "2026年5月 模拟卷1", "mock", 1, "模拟卷第一题？"),
    ],
    cases: [
      {
        id: "case-2025-1",
        sourceType: "real",
        module: "software_engineering",
        title: "某电商系统改造",
        description: "",
        subQuestions: [
          {
            question_label: "问题1",
            prompt: "指出问题",
            reference_answer: "参考答案",
          },
        ],
        term: "2025年下半年",
      },
    ],
    essays: [
      {
        id: "essay-2025-1",
        sourceType: "real",
        module: "architecture",
        title: "论微服务架构",
        prompt: "结合实践论述。",
        writingPoints: "1. 拆分原则",
        term: "2025年下半年",
      },
    ],
  };
}

async function importSampleBank(service, t) {
  const directory = await mkdtemp(join(tmpdir(), "ruankao-bank-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "bank.json");
  await writeFile(file, JSON.stringify(sampleBank()), "utf8");
  return service.importArchitectBank({ file });
}

test("导图解析会合并 NOTE 与 DETAILS", () => {
  const xml = `<?xml version="1.0"?>
<map>
  <node TEXT="根">
    <node TEXT="第12章 信息系统架构设计理论与实践">
      <richcontent TYPE="DETAILS"><html><body><p>DETAILS 正文</p></body></html></richcontent>
      <richcontent TYPE="NOTE"><html><body><p>NOTE 笔记</p></body></html></richcontent>
      <node TEXT="12.1 概述">
        <richcontent TYPE="NOTE"><html><body><p>小节笔记</p></body></html></richcontent>
      </node>
    </node>
  </node>
</map>`;
  const rootNode = parseFreeplane(xml);
  const chapter = rootNode.children[0];
  assert.equal(chapter.text, "第12章 信息系统架构设计理论与实践");
  assert.ok(chapter.details.includes("DETAILS 正文"));
  assert.ok(chapter.details.includes("NOTE 笔记"));
  assert.equal(chapter.children[0].details, "小节笔记");
});

test("导入真题库按 id 幂等更新并保留生成题", async (t) => {
  const { service } = await fixture(t);
  await addQuestions(service, { chapter: 7, difficulty: "easy", count: 1 });
  const first = await importSampleBank(service, t);
  assert.equal(first.questions.added, 3);
  assert.equal(first.questions.updated, 0);
  assert.equal(first.cases.added, 1);
  assert.equal(first.papers.added, 1);
  assert.deepEqual(
    first.catalog.map((item) => `${item.sourceType}:${item.term}`),
    ["real:2025年下半年", "mock:2026年5月 模拟卷1"],
  );
  assert.equal(service.dataSummary().generatedQuestions, 1);
  assert.equal(service.dataSummary().realQuestions, 2);
  assert.equal(service.dataSummary().mockQuestions, 1);
  const generatedId = service.allQuestions().find((item) => item.sourceType === "generated").id;
  const second = await importSampleBank(service, t);
  assert.equal(second.questions.added, 0);
  assert.equal(second.questions.updated, 3);
  assert.ok(service.allQuestions().some((item) => item.id === generatedId));
  assert.deepEqual(
    service.realExamCatalog().map((item) => item.term),
    ["2025年下半年", "2026年5月 模拟卷1"],
  );
});

test("章节练习和随机模拟卷只抽生成题", async (t) => {
  const { service } = await fixture(t);
  await addQuestions(service, { chapter: 7, difficulty: "easy", count: 1 });
  await importSampleBank(service, t);
  const chapter = service.chapterList().find((item) => item.id === 7);
  assert.equal(chapter.counts.all, 1);
  const session = await service.createSession({
    chapter: 7,
    difficulty: "easy",
    count: 1,
  });
  assert.equal(session.questions.length, 1);
  assert.equal(session.questions[0].sourceType, "generated");
  const mock = await service.createMockExamSession({ count: 10 });
  assert.equal(mock.sourceType, "generated");
  assert.equal(mock.questions.length, 1);
  assert.equal(mock.questions[0].sourceType, "generated");
});

test("按考期套卷依题号顺序组卷", async (t) => {
  const { service } = await fixture(t);
  await importSampleBank(service, t);
  const session = await service.createMockExamSession({
    term: "2025年下半年",
    sourceType: "real",
  });
  assert.equal(session.mode, "exam-mcq");
  assert.equal(session.term, "2025年下半年");
  assert.equal(session.sourceType, "real");
  assert.deepEqual(
    session.questions.map((item) => item.id),
    ["real-2025-1", "real-2025-2"],
  );
  await assert.rejects(
    () => service.createMockExamSession({ term: "2099年上半年", sourceType: "real" }),
    (error) => error.code === "EXAM_PAPER_EMPTY" && error.status === 409,
  );
});

test("导入题不参与生成去重且不能永久删除", async (t) => {
  const { service } = await fixture(t);
  await importSampleBank(service, t);
  const unique = service.filterUniqueGeneratedQuestions(7, [
    {
      question: "真题第一题？",
      options: { A: "控制依赖", B: "取消边界", C: "共享状态", D: "绕过接口" },
    },
  ]);
  assert.equal(unique.length, 1);
  await assert.rejects(
    () => service.deleteQuestion({ questionId: "real-2025-1", confirm: "DELETE" }),
    (error) => error.code === "IMPORTED_QUESTION_READONLY" && error.status === 409,
  );
});

test("清空题库和全部数据会保留导入的真题模拟题", async (t) => {
  const { service } = await fixture(t);
  await addQuestions(service, { chapter: 7, difficulty: "easy", count: 1 });
  await importSampleBank(service, t);
  await service.clearData({ scope: "questions", confirm: "CLEAR" });
  assert.equal(service.dataSummary().generatedQuestions, 0);
  assert.equal(service.dataSummary().realQuestions, 2);
  assert.equal(service.dataSummary().mockQuestions, 1);
  await service.clearData({ scope: "all", confirm: "CLEAR" });
  assert.deepEqual(
    service.dataSummary(),
    emptySummary({
      questions: 3,
      realQuestions: 2,
      mockQuestions: 1,
      cases: 1,
      realCases: 1,
      papers: 1,
      realPapers: 1,
    }),
  );
});

