import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { QuestionGenerator } from "../src/generator.mjs";
import { PracticeService } from "../src/questions.mjs";
import { JsonStore, SQLiteStore } from "../src/store.mjs";

const root = resolve(import.meta.dirname, "..");

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
  assert.deepEqual(service.dataSummary(), {
    questions: 0,
    wrongQuestions: 0,
    attempts: 0,
    activeSessions: 0,
    questionIssues: 0,
  });
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
