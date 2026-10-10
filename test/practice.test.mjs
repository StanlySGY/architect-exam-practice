import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { QuestionGenerator } from "../src/generator.mjs";
import { parseFreeplane } from "../src/mindmap.mjs";
import { ModelConfig } from "../src/model-config.mjs";
import { PracticeService } from "../src/questions.mjs";
import { JsonStore, SQLiteStore } from "../src/store.mjs";
import { auditSourceMapping } from "../scripts/audit-bank-source-mapping.mjs";

const root = resolve(import.meta.dirname, "..");
test("source mapping separates mock provenance and compares real question number, stem, options and answer", () => {
  const sourceRoot = "/tmp/source-root";
  const sourceFile = "/tmp/source-root/02-历年真题/2024年上半年-系统架构设计师-综合知识.md";
  const sourceText = [
    "## 第1题", "样例题干用于检验真实题干匹配逻辑？", "", "- **A.** 甲", "- **B.** 乙", "- **C.** 丙", "- **D.** 丁", "", "**正确答案：B**", "",
    "## 第2题", "另一道题？", "", "- **A.** 甲一", "- **B.** 乙一", "- **C.** 丙一", "- **D.** 丁一", "", "**正确答案：A**"
  ].join("\n");
  const bank = { choices: [
    { id: "mock-2024年上半年-模拟卷1-001", sourceType: "mock", term: "2024年上半年模拟卷", paper: "模拟卷1", questionNo: 1, stem: "模拟题", options: { A: "甲", B: "乙", C: "丙", D: "丁" }, answer: "B" },
    { id: "real-2024年上半年-001", sourceType: "real", term: "2024年上半年", paper: "2024年上半年", questionNo: 1, stem: "样例题干用于检验真实题干匹配逻辑？", options: { A: "甲", B: "乙", C: "丙", D: "丁" }, answer: "B" },
    { id: "real-2024年上半年-002", sourceType: "real", term: "2024年上半年", paper: "2024年上半年", questionNo: 2, stem: "样例题干用于检验真实题干匹配逻辑？", options: { A: "甲", B: "乙", C: "丙", D: "丁" }, answer: "B" }
  ] };
  const report = auditSourceMapping(bank, sourceRoot, [sourceFile], new Map([[sourceFile, sourceText]]));
  assert.equal(report.records[0].status, "simulated-no-original-source");
  assert.equal(report.records[1].status, "candidate-question-content-match-needs-human-review");
  assert.equal(report.records[1].candidates[0].matchedExactQuestion, true);
  assert.equal(report.records[2].status, "candidate-content-match-local-heading-number-differs");
  assert.equal(report.records[2].candidates[0].matchedQuestionNo, 1);
});



test("AI 生成题默认 pending_review，且缺 knowledgeDetail 审计为 quarantined", async (t) => {
  const { service } = await fixture(t);
  const added = await service.addGeneratedQuestions({ chapter: 1, difficulty: "easy", source: "mindmap", questions: [{ question: "默认审校状态测试题", options: { A: "正确", B: "错误一", C: "错误二", D: "错误三" }, knowledge_point: "测试", correct_answer: "A", analysis: "测试解析", knowledge_detail: "测试详解", source_node: "第1章" }] });
  assert.equal(added[0].reviewStatus, "pending_review");
  assert.deepEqual(added[0].reviewReasons, ["no_human_fact_check"]);
  await service.store.update((state) => { const q = state.generatedQuestions.find((item) => item.id === added[0].id); q.knowledgeDetail = ""; return state; });
  await service.auditGeneratedQuestionTrust();
  const audited = service.store.snapshot().generatedQuestions.find((item) => item.id === added[0].id);
  assert.equal(audited.reviewStatus, "quarantined");
  assert.ok(audited.reviewReasons.includes("knowledge_detail_missing"));
});

test("AI 题审校状态控制正式学习资格，真题保持原语义", async (t) => {
  const { service } = await fixture(t);
  const added = await addQuestions(service, { chapter: 7, difficulty: "easy", count: 1 });
  const id = added[0].id;
  await service.store.update((state) => { state.generatedQuestions.find((item) => item.id === id).sourceNode = "第7章 系统架构设计基础知识"; return state; });
  await service.store.update((state) => { const q = state.generatedQuestions.find((item) => item.id === id); q.reviewStatus = "pending_review"; q.reviewReasons = ["no_human_fact_check"]; return state; });
  await assert.rejects(() => service.createSession({ chapter: 7, difficulty: "easy", count: 1 }), /没有可用的练习题|该章节和难度暂无题目/);
  await service.store.update((state) => { const q = state.generatedQuestions.find((item) => item.id === id); q.reviewStatus = "quarantined"; q.reviewReasons = ["knowledge_detail_missing"]; return state; });
  await assert.rejects(() => service.createSession({ chapter: 7, difficulty: "easy", count: 1 }), /没有可用的练习题|该章节和难度暂无题目/);
  await service.reviewQuestion({ questionId: id, reviewer: "human-reviewer", evidenceType: "textbook", evidenceReference: "测试教材，第 1 章，第 1 页", evidenceNote: "人工事实核验记录：测试", reviewedFields: ["question", "options", "correctAnswer", "analysis"] });
  const session = await service.createSession({ chapter: 7, difficulty: "easy", count: 1 });
  assert.equal(session.questions[0].id, id);
  await service.updateQuestion({ questionId: id, updates: { correctAnswer: "B" } });
  const edited = service.store.snapshot().generatedQuestions.find((item) => item.id === id);
  assert.equal(edited.reviewStatus, "pending_review");
  assert.deepEqual(edited.reviewReasons, ["no_human_fact_check"]);
  assert.equal(edited.reviewedBy, undefined);
  assert.equal(edited.reviewEvidence, undefined);
  assert.equal(edited.reviewedAt, undefined);
  assert.equal(edited.reviewedRevision, undefined);
  assert.equal(edited.reviewEvidenceType, undefined);
  assert.equal(edited.reviewEvidenceReference, undefined);
  assert.equal(edited.reviewedFields, undefined);
  await assert.rejects(() => service.createSession({ chapter: 7, difficulty: "easy", count: 1 }), /没有可用的练习题|该章节和难度暂无题目/);
  await service.store.update((state) => { const q = state.generatedQuestions.find((item) => item.id === id); q.disabledAt = service.now(); return state; });
  await service.store.update((state) => { state.generatedQuestions.push({ id: "real-review-compat", sourceType: "real", sourceId: "real-review-compat", chapter: 7, difficulty: "easy", question: "真题兼容测试题", options: { A: "甲", B: "乙", C: "丙", D: "丁" }, correctAnswer: "A", analysis: "真题解析", knowledgeDetail: "真题资料", sourceNode: null, createdAt: service.now() }); return state; });
  assert.equal(service.allQuestions().find((item) => item.id === "real-review-compat").sourceType, "real");
  assert.equal(service.contentHealth().sources.questions.real, 1);
});

test("人工审校入口拒绝缺来源、仅备注或核验范围不完整的批准", async (t) => {
  const { service } = await fixture(t);
  const added = await addQuestions(service, { chapter: 8, difficulty: "easy", count: 1 });
  const common = { questionId: added[0].id, reviewer: "reviewer", evidenceType: "textbook", evidenceReference: "测试教材，第 1 章，第 1 页", evidenceNote: "核验答案与解析", reviewedFields: ["question", "options", "correctAnswer", "analysis"] };
  await service.store.update((state) => { state.generatedQuestions.find((item) => item.id === added[0].id).sourceNode = "第8章 系统质量属性与架构评估"; return state; });
  await service.store.update((state) => { state.generatedQuestions.find((item) => item.id === added[0].id).knowledgeDetail = ""; return state; });
  await assert.rejects(() => service.reviewQuestion(common), /题目结构仍有问题/);
  await service.store.update((state) => { state.generatedQuestions.find((item) => item.id === added[0].id).knowledgeDetail = "恢复后的知识点详解"; return state; });
  await assert.rejects(() => service.reviewQuestion({ ...common, evidenceReference: "" }), /来源定位/);
  await assert.rejects(() => service.reviewQuestion({ ...common, evidenceReference: "待补充来源" }), /来源定位/);
  await assert.rejects(() => service.reviewQuestion({ ...common, evidenceReference: "N/A" }), /来源定位/);
  await assert.rejects(() => service.reviewQuestion({ ...common, evidenceNote: "待核验" }), /核验结论/);
  await assert.rejects(() => service.reviewQuestion({ ...common, evidenceType: "manual_note" }), /可追溯/);
  await assert.rejects(() => service.reviewQuestion({ ...common, reviewedFields: ["question", "correctAnswer"] }), /必须明确核验/);
  const approved = await service.reviewQuestion(common);
  assert.equal(approved.reviewStatus, "approved");
  assert.equal(approved.reviewedRevision, 1);
  const question = service.store.snapshot().generatedQuestions.find((item) => item.id === added[0].id);
  assert.equal(question.reviewEvidenceReference, common.evidenceReference);
  assert.deepEqual(question.reviewedFields, common.reviewedFields);
  assert.ok(service.auditLog().some((entry) => entry.action === "questions.human-review" && entry.questionId === added[0].id));
});

test("审校凭据必须绑定当前题目版本", async (t) => {
  const { service } = await fixture(t);
  const added = await addQuestions(service, { chapter: 8, difficulty: "easy", count: 1 });
  await service.store.update((state) => {
    const question = state.generatedQuestions.find((item) => item.id === added[0].id);
    question.reviewStatus = "approved";
    question.reviewReasons = [];
    question.reviewedBy = "human-reviewer";
    question.reviewEvidence = "人工事实核验记录：测试";
    question.reviewedAt = service.now();
    question.reviewedRevision = (question.revision ?? 1) - 1;
    question.reviewEvidenceType = "textbook";
    question.reviewEvidenceReference = "测试教材，第 1 章，第 1 页";
    question.reviewedFields = ["question", "options", "correctAnswer", "analysis"];
    return state;
  });
  await service.auditGeneratedQuestionTrust();
  const question = service.store.snapshot().generatedQuestions.find((item) => item.id === added[0].id);
  assert.notEqual(question.reviewStatus, "approved");
  await assert.rejects(() => service.createSession({ chapter: 8, difficulty: "easy", count: 1 }), /没有可用的练习题|该章节和难度暂无题目/);
});
test("缺少有效审校时间的题目不能沿用 approved 状态", async (t) => {
  const { service } = await fixture(t);
  const added = await addQuestions(service, { chapter: 8, difficulty: "easy", count: 1 });
  await service.store.update((state) => { const q = state.generatedQuestions.find((item) => item.id === added[0].id); q.reviewStatus = "approved"; q.reviewReasons = []; q.reviewedBy = "human-reviewer"; q.reviewEvidence = "人工事实核验记录：测试"; q.reviewEvidenceType = "textbook"; q.reviewEvidenceReference = "测试教材，第 1 章，第 1 页"; q.reviewedFields = ["question", "options", "correctAnswer", "analysis"]; q.reviewedRevision = q.revision ?? 1; delete q.reviewedAt; return state; });
  await service.auditGeneratedQuestionTrust();
  const question = service.store.snapshot().generatedQuestions.find((item) => item.id === added[0].id);
  assert.notEqual(question.reviewStatus, "approved");
  assert.ok(["pending_review", "quarantined"].includes(question.reviewStatus));
  await assert.rejects(() => service.createSession({ chapter: 8, difficulty: "easy", count: 1 }), /没有可用的练习题|该章节和难度暂无题目/);
});
test("占位来源或占位核验摘要不能让历史题目继续保持 approved", async (t) => {
  const { service } = await fixture(t);
  const added = await addQuestions(service, { chapter: 8, difficulty: "easy", count: 1 });
  await service.store.update((state) => { const q = state.generatedQuestions.find((item) => item.id === added[0].id); q.reviewStatus = "approved"; q.reviewReasons = []; q.reviewedBy = "human-reviewer"; q.reviewEvidence = "待核验"; q.reviewEvidenceType = "textbook"; q.reviewEvidenceReference = "待补充来源"; q.reviewedFields = ["question", "options", "correctAnswer", "analysis"]; q.reviewedRevision = q.revision ?? 1; q.reviewedAt = service.now(); return state; });
  await service.auditGeneratedQuestionTrust();
  const question = service.store.snapshot().generatedQuestions.find((item) => item.id === added[0].id);
  assert.notEqual(question.reviewStatus, "approved");
  assert.ok(["pending_review", "quarantined"].includes(question.reviewStatus));
});

test("老生成题缺审校状态向后兼容但不能自动 approved", async (t) => {
  const { service } = await fixture(t);
  await service.store.update((state) => { state.generatedQuestions.push({ id: "legacy-generated", sourceType: "generated", chapter: 8, difficulty: "easy", question: "老数据测试题", options: { A: "甲", B: "乙", C: "丙", D: "丁" }, correctAnswer: "A", analysis: "解析", knowledgeDetail: "详解", sourceNode: "第8章", createdAt: service.now() }); return state; });
  const question = service.store.snapshot().generatedQuestions.find((item) => item.id === "legacy-generated");
  assert.equal(question.reviewStatus, undefined);
  assert.equal(service.questionReviewStats().pending_review >= 1, true);
  assert.notEqual(question.reviewStatus, "approved");
  await assert.rejects(() => service.createSession({ chapter: 8, difficulty: "easy", count: 1 }), /没有可用的练习题|该章节和难度暂无题目/);
});

test("审校统计包含三种状态和原因计数", async (t) => {
  const { service } = await fixture(t);
  const added = await addQuestions(service, { chapter: 9, difficulty: "easy", count: 3 });
  await service.store.update((state) => { const [p, q, a] = added.map((item) => state.generatedQuestions.find((question) => question.id === item.id)); p.reviewStatus = "pending_review"; p.reviewReasons = ["no_human_fact_check"]; q.reviewStatus = "quarantined"; q.reviewReasons = ["knowledge_detail_missing"]; a.reviewStatus = "approved"; a.reviewReasons = []; a.reviewedBy = "human-reviewer"; a.reviewEvidence = "人工事实核验记录：测试"; a.reviewedAt = service.now(); a.reviewedRevision = a.revision ?? 1; a.reviewEvidenceType = "textbook"; a.reviewEvidenceReference = "测试教材，第 1 章，第 1 页"; a.reviewedFields = ["question", "options", "correctAnswer", "analysis"]; return state; });
  const stats = service.questionReviewStats();
  assert.equal(stats.pending_review >= 1, true);
  assert.equal(stats.quarantined >= 1, true);
  assert.equal(stats.approved >= 1, true);
  assert.equal(stats.reasons.no_human_fact_check >= 1, true);
  assert.equal(stats.reasons.knowledge_detail_missing >= 1, true);
});
test("模型工作区支持多供应商并保留 API Key 掩码兼容", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "architect-model-config-test-"));
  const keys = [
    "ARCHITECT_LLM_BASE_URL",
    "ARCHITECT_LLM_API_KEY",
    "ARCHITECT_LLM_MODEL",
    "ARCHITECT_LLM_MODELS",
    "ARCHITECT_LLM_PROVIDER",
    "ARCHITECT_LLM_PROVIDERS",
    "ARCHITECT_LLM_AGENTS",
    "ARCHITECT_LLM_DEFAULT_AGENT",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(async () => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    await rm(directory, { recursive: true, force: true });
  });
  for (const key of keys) delete process.env[key];
  const config = new ModelConfig({ root: directory });
  const saved = await config.saveWorkspace({
    defaultAgentId: "agent-deepseek",
    providers: [
      {
        id: "provider-deepseek",
        name: "DeepSeek",
        baseUrl: "https://api.deepseek.com/v1",
        apiKey: "secret-1234",
        models: ["deepseek-chat"],
        defaultModel: "deepseek-chat",
      },
      {
        id: "provider-ollama",
        name: "Ollama",
        baseUrl: "http://127.0.0.1:11434/v1",
        models: ["qwen2.5"],
        defaultModel: "qwen2.5",
      },
    ],
    agents: [
      {
        id: "agent-deepseek",
        name: "题目 Agent",
        providerId: "provider-deepseek",
        model: "deepseek-chat",
        enabled: true,
      },
      {
        id: "agent-ollama",
        name: "本地评审 Agent",
        providerId: "provider-ollama",
        model: "qwen2.5",
        enabled: true,
      },
    ],
  });
  assert.equal(saved.providers.length, 2);
  assert.equal(process.env.ARCHITECT_LLM_MODEL, "deepseek-chat");
  assert.equal(config.publicWorkspace().providers[0].apiKey, "********1234");
  assert.equal(config.publicWorkspace().agents.length, 2);
  if (process.platform !== "win32") {
    assert.equal((await stat(join(directory, ".env"))).mode & 0o777, 0o600);
  }

  await config.saveWorkspace({
    defaultAgentId: "agent-deepseek",
    providers: [{
      id: "provider-deepseek",
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "********1234",
      models: ["deepseek-chat"],
      defaultModel: "deepseek-chat",
    }],
    agents: [{
      id: "agent-deepseek",
      name: "题目 Agent",
      providerId: "provider-deepseek",
      model: "deepseek-chat",
      enabled: true,
    }],
  });
  assert.equal(process.env.ARCHITECT_LLM_API_KEY, "secret-1234");
});

test("案例和论文列表支持分页且保留筛选总数", async (t) => {
  const { service } = await fixture(t);
  await service.addCases({
    chapter: 1,
    cases: Array.from({ length: 5 }, (_, index) => ({
      title: `案例 ${index + 1}`,
      scenario: "场景",
      knowledge_point: "架构",
      questions: [{ text: "问题", points: 5, reference_answer: "答案" }],
    })),
  });
  await service.addPapers({
    chapter: 1,
    papers: Array.from({ length: 5 }, (_, index) => ({
      title: `论文 ${index + 1}`,
      description: "说明",
      writing_points: ["要点"],
    })),
  });
  const cases = service.casePage({ limit: 2, offset: 2 });
  const papers = service.paperPage({ limit: 2, offset: 2 });
  assert.equal(cases.total, 5);
  assert.equal(cases.records.length, 2);
  assert.equal(cases.records[0].title, "案例 3");
  assert.equal(papers.total, 5);
  assert.equal(papers.records.length, 2);
  assert.equal(papers.records[0].title, "论文 3");
});

test("默认 Agent 工作流只调用一次模型", async (t) => {
  const { service } = await fixture(t);
  const modelConfig = {
    workspace: () => ({
      defaultAgentId: "agent-one",
      providers: [{
        id: "provider-one",
        type: "openai-compatible",
        baseUrl: "http://model.test/v1",
        apiKey: "secret",
        models: ["test-model"],
        defaultModel: "test-model",
      }],
      agents: [{
        id: "agent-one",
        name: "默认 Agent",
        providerId: "provider-one",
        model: "test-model",
        systemPrompt: "保持简洁",
        enabled: true,
      }],
    }),
  };
  const generator = new QuestionGenerator({ root, service, modelConfig });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => {
    calls += 1;
    return {
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          answer: "结论",
          confidence: 0.8,
          key_points: ["依据"],
          concerns: [],
        }) } }],
      }),
    };
  };
  const result = await generator.runAgentTask({ prompt: "比较两种架构", strategy: "single" });
  assert.equal(calls, 1);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].answer, "结论");
});

test("停止 Agent 任务会中断模型请求并释放运行锁", async (t) => {
  const { service } = await fixture(t);
  const modelConfig = {
    workspace: () => ({
      defaultAgentId: "agent-one",
      providers: [{
        id: "provider-one",
        type: "openai-compatible",
        baseUrl: "http://model.test/v1",
        apiKey: "secret",
        models: ["test-model"],
        defaultModel: "test-model",
      }],
      agents: [{
        id: "agent-one",
        name: "默认 Agent",
        providerId: "provider-one",
        model: "test-model",
        enabled: true,
      }],
    }),
  };
  const generator = new QuestionGenerator({ root, service, modelConfig });
  const originalFetch = globalThis.fetch;
  let requestOptions;
  let resolveFetchStarted;
  const fetchStarted = new Promise((resolve) => {
    resolveFetchStarted = resolve;
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, options) => {
    requestOptions = options;
    resolveFetchStarted();
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        reject(Object.assign(new Error("请求已中断"), { name: "AbortError" }));
      }, { once: true });
    });
  };
  const controller = new AbortController();
  const task = generator.runAgentTask({
    prompt: "比较两种架构",
    strategy: "single",
    signal: controller.signal,
  });
  await fetchStarted;
  assert.equal(requestOptions.signal.aborted, false);
  controller.abort();
  await assert.rejects(
    task,
    (error) => error.code === "LLM_GENERATION_CANCELLED" && error.status === 499,
  );
  assert.equal(requestOptions.signal.aborted, true);
  assert.equal(generator.running, false);
});

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
    llmRequests: 0,
    llmTokens: 0,
    ...overrides,
  };
}

async function fixture(t, now = () => "2026-04-01T08:00:00.000Z") {
  const directory = await mkdtemp(join(tmpdir(), "architect-test-"));
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
  const added = await service.addGeneratedQuestions({
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
        knowledge_detail: "测试知识点详解",
        source_node: `第${chapter}章`,
      };
    }),
  });
  await service.store.update((state) => {
    const ids = new Set(added.map((question) => question.id));
    for (const question of state.generatedQuestions) {
      if (!ids.has(question.id)) continue;
      question.reviewStatus = "approved";
      question.reviewReasons = [];
      question.reviewedBy = "test-fixture-human";
      question.reviewEvidence = "测试夹具中的人工事实核验凭据";
      question.reviewedAt = service.now();
      question.reviewedRevision = question.revision ?? 1;
      question.reviewEvidenceType = "textbook";
      question.reviewEvidenceReference = "测试教材，第 1 章，第 1 页";
      question.reviewedFields = ["question", "options", "correctAnswer", "analysis"];
    }
    return added;
  });
  return added;}

async function generatorWithFetch(t, fetchImplementation) {
  const { service } = await fixture(t);
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.ARCHITECT_LLM_BASE_URL;
  const originalModel = process.env.ARCHITECT_LLM_MODEL;
  const originalTimeout = process.env.ARCHITECT_AGENT_TIMEOUT_MS;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.ARCHITECT_LLM_BASE_URL;
    else process.env.ARCHITECT_LLM_BASE_URL = originalBaseUrl;
    if (originalModel === undefined) delete process.env.ARCHITECT_LLM_MODEL;
    else process.env.ARCHITECT_LLM_MODEL = originalModel;
    if (originalTimeout === undefined) delete process.env.ARCHITECT_AGENT_TIMEOUT_MS;
    else process.env.ARCHITECT_AGENT_TIMEOUT_MS = originalTimeout;
  });
  process.env.ARCHITECT_LLM_BASE_URL = "http://model.test/v1";
  process.env.ARCHITECT_LLM_MODEL = "test-model";
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

test("模型请求超时返回明确错误且测试不调用外部模型", async (t) => {
  const generator = await generatorWithFetch(t, async (_url, options) =>
    await new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        reject(Object.assign(new Error("mock request aborted"), { name: "AbortError" }));
      }, { once: true });
    }),
  );
  process.env.ARCHITECT_AGENT_TIMEOUT_MS = "10";
  await assert.rejects(
    () => generator.generate({ chapter: 1, difficulty: "easy", count: 1 }),
    (error) => error.code === "LLM_TIMEOUT" && error.status === 504 && error.message.includes("超时"),
  );
});

test("SQLite 存储在重新打开后保留学习状态", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "architect-sqlite-test-"));
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
  const directory = await mkdtemp(join(tmpdir(), "architect-migration-test-"));
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
  const backup = await service.exportData();
  assert.equal(backup.format, "architect-practice-backup");
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

test("问题题即使只剩历史快照也不会重新进入回顾", async (t) => {
  const { service, store } = await fixture(t);
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
  await service.reportQuestion({ questionId: question.id });
  // 模拟旧备份/外部清理留下的快照错题：题目已不在题库，错题记录仍在。
  await store.update((state) => {
    state.generatedQuestions = state.generatedQuestions.filter(
      (item) => item.id !== question.id,
    );
  });
  const summary = service.wrongQuestions().summary;
  assert.equal(summary.active, 0);
  assert.equal(summary.due, 0);
  assert.equal(summary.mastered, 0);
  await assert.rejects(
    () => service.createReviewSession({ limit: 1 }),
    (error) => error.code === "NO_DUE_QUESTIONS",
  );
  await assert.rejects(
    () => service.setMastered(question.id, false),
    (error) => error.code === "QUESTION_DISABLED",
  );
  const persisted = store.snapshot().wrongBook[question.id];
  assert.equal(persisted.disabledByIssue, true);
});

test("旧错题记录缺少快照时优先使用当前题库内容", async (t) => {
  const { service, store } = await fixture(t);
  await addQuestions(service, { chapter: 6, difficulty: "easy", count: 1 });
  const question = service.allQuestions()[0];
  await store.update((state) => {
    state.wrongBook = {
      [question.id]: {
        questionId: question.id,
        mastered: false,
        disabledByIssue: false,
        timesWrong: 1,
        nextReviewAt: "2026-04-01T00:00:00.000Z",
        lastWrongAt: "2026-04-01T00:00:00.000Z",
      },
    };
  });
  const record = service.wrongQuestions().records[0];
  assert.equal(record.question, question.question);
  assert.deepEqual(record.options, question.options);
  assert.equal(record.correctAnswer, question.correctAnswer);
});

test("问题题状态会随备份恢复并在清空题库时移除", async (t) => {
  const { service } = await fixture(t);
  await addQuestions(service, { chapter: 6, difficulty: "easy", count: 1 });
  const question = service.allQuestions()[0];
  await service.reportQuestion({ questionId: question.id, note: "题干有误" });
  const backup = await service.exportData();
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

test("案例模拟卷固定创建时快照并按快照保存草稿与判分上下文", async (t) => {
  const { service, store } = await fixture(t);
  await service.addCases({
    chapter: 3,
    cases: [{
      title: "原始案例",
      scenario: "原始场景",
      questions: [{ text: "原始小问", points: 10, reference_answer: "原始参考答案" }],
    }],
  });
  const exam = await service.createCaseExam({ count: 1, durationMinutes: 10 });
  const original = exam.cases[0];
  await store.update((state) => {
    const current = state.caseQuestions.find((item) => item.id === original.id);
    current.title = "重新导入后的案例";
    current.scenario = "重新导入后的场景";
    current.questions = [{
      id: original.questions[0].id,
      text: "重新导入后的小问",
      points: 10,
      referenceAnswer: "重新导入后的参考答案",
    }];
  });
  const active = service.activeCaseExam();
  assert.equal(active.cases[0].title, "原始案例");
  assert.equal(active.cases[0].questions[0].text, "原始小问");
  assert.equal("referenceAnswer" in active.cases[0].questions[0], false);
  await service.saveCaseExamDraft({
    examId: exam.id,
    caseId: original.id,
    questionId: original.questions[0].id,
    text: "我的作答",
  });
  const context = service.caseExamForGrading(exam.id);
  assert.equal(context.cases[0].questions[0].referenceAnswer, "原始参考答案");
  assert.equal(context.exam.drafts[original.id][original.questions[0].id], "我的作答");
});

test("删除生成题后自有备份仍可导入", async (t) => {
  const { service } = await fixture(t);
  await addQuestions(service, { chapter: 8, difficulty: "easy", count: 1 });
  const session = await service.createSession({ chapter: 8, difficulty: "easy", count: 1 });
  await service.grade({ sessionId: session.id, answers: {} });
  const questionId = session.questions[0].id;
  await service.deleteQuestion({ questionId, confirm: "DELETE" });
  const backup = await service.exportData();
  const result = await service.importData({ backup, confirm: "IMPORT" });
  assert.equal(result.questions, 0);
  assert.equal(result.attempts, 1);
});

test("未来六天复习负载按到期日去重", async (t) => {
  const { service, store } = await fixture(t, () => "2026-04-01T08:00:00.000Z");
  const snapshot = (id) => ({
    id,
    question: id,
    options: { A: "正确", B: "错", C: "错", D: "错" },
    correctAnswer: "A",
    analysis: "解析",
    sourceType: "generated",
    createdAt: "2026-03-01T00:00:00.000Z",
  });
  await store.update((state) => {
    state.wrongBook = {
      today: { questionId: "today", questionSnapshot: snapshot("today"), mastered: false, disabledByIssue: false, nextReviewAt: "2026-04-01T09:00:00.000Z", lastReviewAt: "2026-03-31T09:00:00.000Z", lastWrongAt: "2026-03-31T09:00:00.000Z" },
      later: { questionId: "later", questionSnapshot: snapshot("later"), mastered: false, disabledByIssue: false, nextReviewAt: "2026-04-03T09:00:00.000Z", lastReviewAt: "2026-03-31T09:00:00.000Z", lastWrongAt: "2026-03-31T09:00:00.000Z" },
      far: { questionId: "far", questionSnapshot: snapshot("far"), mastered: false, disabledByIssue: false, nextReviewAt: "2026-04-05T09:00:00.000Z", lastReviewAt: "2026-03-31T09:00:00.000Z", lastWrongAt: "2026-03-31T09:00:00.000Z" },
    };
  });
  const upcoming = service.statistics().memory.upcomingDistinct;
  assert.deepEqual(upcoming.slice(0, 5).map((day) => day.due), [1, 0, 1, 0, 1]);
  assert.equal(upcoming.slice(1).reduce((sum, day) => sum + day.due, 0), 2);
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
  // 测试模板的正确答案固定为 A，用合法的错误选项 B 判错。
  const answers = Object.fromEntries(
    session.questions.map((question) => [question.id, "B"]),
  );
  const result = await service.grade({ sessionId: session.id, answers });
  assert.equal(result.correct, 0);
  assert.equal(result.incorrect, 3);
  assert.equal(service.wrongQuestions().summary.due, 3);
});

test("错题复习按 FSRS-6 调度,连续答对 5 次后毕业", async (t) => {
  const base = Date.parse("2026-04-01T08:00:00.000Z");
  let time = new Date(base).toISOString();
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
    answers: { [question.id]: "B" },
  });
  const correctAnswer = graded.details[0].correctAnswer;

  // FSRS 只接管间隔计算；毕业语义保持"连续 5 次复习答对"。
  let previousInterval = 0;
  for (let round = 1; round <= 5; round += 1) {
    const record = service
      .wrongQuestions()
      .records.find((item) => item.questionId === question.id);
    time = new Date(
      Math.max(Date.parse(record.nextReviewAt), Date.parse(time) + 86_400_000),
    ).toISOString();
    const review = await service.createReviewSession({ limit: 1 });
    assert.ok(review, `第 ${round} 次复习应有到期的错题`);
    const checked = await service.checkAnswer({
      sessionId: review.id,
      questionId: question.id,
      answer: correctAnswer,
      confidence: 3,
    });
    assert.ok(checked.schedule, "复习模式应返回四档调度预览");
    assert.equal(checked.schedule.grades.length, 4);
    assert.deepEqual(
      checked.schedule.grades.map((grade) => grade.name),
      ["再记", "困难", "良好", "简单"],
    );
    await service.grade({
      sessionId: review.id,
      answers: { [question.id]: correctAnswer },
    });
    const after = service
      .wrongQuestions()
      .records.find((item) => item.questionId === question.id);
    assert.equal(
      after.mastered,
      round === 5,
      `第 ${round} 次答对后掌握状态应为 ${round === 5}`,
    );
    if (round < 5) {
      const interval = Date.parse(after.nextReviewAt) - Date.parse(time);
      assert.ok(interval > 0, "FSRS 应给出未来的到期时间");
      assert.ok(
        interval >= previousInterval,
        `间隔应单调不减：${interval} < ${previousInterval}`,
      );
      previousInterval = interval;
    }
  }
  assert.equal(service.wrongQuestions().summary.active, 0);
  assert.equal(service.wrongQuestions().summary.mastered, 1);
});

test("复习答错会用 FSRS 记一次遗忘并保持到期", async (t) => {
  const base = Date.parse("2026-04-01T08:00:00.000Z");
  let time = new Date(base).toISOString();
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
    answers: { [question.id]: "B" },
  });
  const correctAnswer = graded.details[0].correctAnswer;
  const wrongAnswer = ["A", "B", "C", "D"].find((key) => key !== correctAnswer);
  const review = await service.createReviewSession({ limit: 1 });
  await service.grade({
    sessionId: review.id,
    answers: { [question.id]: wrongAnswer },
  });
  const record = service
    .wrongQuestions()
    .records.find((item) => item.questionId === question.id);
  assert.equal(record.correctStreak, 0);
  assert.equal(record.timesWrong, 2);
  assert.equal(record.memory.lapses, 2);
  assert.equal(record.nextReviewAt, time);
});

test("手动恢复错题会重置复习阶梯", async (t) => {
  const base = Date.parse("2026-04-01T08:00:00.000Z");
  let time = new Date(base).toISOString();
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
    answers: { [question.id]: "B" },
  });
  const correctAnswer = graded.details[0].correctAnswer;

  const review = await service.createReviewSession({ limit: 1 });
  await service.grade({
    sessionId: review.id,
    answers: { [question.id]: correctAnswer },
  });
  // 答对一次后标记掌握再恢复，阶梯应从头开始而不是跳档。
  await service.setMastered(question.id, true);
  await service.setMastered(question.id, false);
  const record = service
    .wrongQuestions()
    .records.find((item) => item.questionId === question.id);
  assert.equal(record.correctStreak, 0);
  assert.equal(record.mastered, false);
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
  const originalBaseUrl = process.env.ARCHITECT_LLM_BASE_URL;
  const originalModel = process.env.ARCHITECT_LLM_MODEL;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.ARCHITECT_LLM_BASE_URL;
    else process.env.ARCHITECT_LLM_BASE_URL = originalBaseUrl;
    if (originalModel === undefined) delete process.env.ARCHITECT_LLM_MODEL;
    else process.env.ARCHITECT_LLM_MODEL = originalModel;
  });
  process.env.ARCHITECT_LLM_BASE_URL = "http://model.test/v1";
  process.env.ARCHITECT_LLM_MODEL = "test-model";
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
        source_node: "第1章 绪论",
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
        source_node: "第1章 绪论",
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
        source_node: "第1章 绪论",
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

test("生成题来源节点必须存在于当前导图范围内", async (t) => {
  const { service } = await fixture(t);
  const generator = new QuestionGenerator({ root, service });
  const candidates = [
    { question: "来源不明的题目应该被加入题库吗？", source_node: "不存在的架构知识点" },
    { question: "架构师应如何界定系统边界？", source_node: "第1章 绪论" },
  ];
  let calls = 0;
  generator.callModel = async () => JSON.stringify({
    questions: [
      {
        ...candidates[calls++],
        options: { A: "区分职责与接口", B: "忽略约束", C: "隐藏需求", D: "取消架构" },
        correct_answer: "A",
        knowledge_point: "系统边界",
        analysis: "边界帮助界定架构职责和系统交互。",
      },
    ],
  });
  const result = await generator.generate({ chapter: 1, difficulty: "medium", count: 1 });
  assert.equal(calls, 2);
  assert.equal(result.added, 1);
  assert.equal(result.invalidSourcesSkipped, 1);
  assert.equal(result.duplicatesSkipped, 0);
  assert.equal(service.allQuestions().length, 1);
  assert.equal(service.allQuestions()[0].sourceNode, "第1章 绪论");
});

test("停止生成会中断模型请求且不写入题库", async (t) => {
  let requestOptions;
  let resolveFetchStarted;
  const fetchStarted = new Promise((resolve) => {
    resolveFetchStarted = resolve;
  });
  const generator = await generatorWithFetch(t, async (_url, options) => {
    requestOptions = options;
    resolveFetchStarted();
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        reject(Object.assign(new Error("请求已中断"), { name: "AbortError" }));
      }, { once: true });
    });
  });
  const controller = new AbortController();
  const generation = generator.generate({
    chapter: 1,
    difficulty: "easy",
    count: 1,
    signal: controller.signal,
  });
  await fetchStarted;
  assert.equal(requestOptions.signal.aborted, false);
  controller.abort();
  await assert.rejects(
    generation,
    (error) => error.code === "LLM_GENERATION_CANCELLED" && error.status === 499,
  );
  assert.equal(generator.service.allQuestions().length, 0);
  assert.equal(generator.running, false);
});

test("停止 Wiki 生成会跳过共享流程持久化", async (t) => {
  let resolveFetchStarted;
  const fetchStarted = new Promise((resolve) => {
    resolveFetchStarted = resolve;
  });
  const generator = await generatorWithFetch(t, async (_url, options) => {
    resolveFetchStarted();
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        reject(Object.assign(new Error("请求已中断"), { name: "AbortError" }));
      }, { once: true });
    });
  });
  const controller = new AbortController();
  const generation = generator.generateWiki({
    chapter: 1,
    count: 1,
    signal: controller.signal,
  });
  await fetchStarted;
  controller.abort();
  await assert.rejects(
    generation,
    (error) => error.code === "LLM_GENERATION_CANCELLED" && error.status === 499,
  );
  assert.equal(generator.service.wikiList().length, 0);
  assert.equal(generator.running, false);
});

test("模型返回后取消也不会在持久化入口写入题库", async (t) => {
  const { service } = await fixture(t);
  const generator = new QuestionGenerator({ root, service });
  const controller = new AbortController();
  generator.callModel = async () => JSON.stringify({
    questions: [{
      question: "模型已经返回但任务随后取消时是否会写入？",
      options: {
        A: "不会写入",
        B: "立即写入",
        C: "写入两次",
        D: "忽略取消",
      },
      knowledge_point: "取消语义",
      correct_answer: "A",
      analysis: "取消信号必须在持久化入口再次检查。",
      source_node: "第1章 绪论",
    }],
  });
  const addGeneratedQuestions = service.addGeneratedQuestions.bind(service);
  service.addGeneratedQuestions = async (args) => {
    controller.abort();
    return addGeneratedQuestions({ ...args, signal: controller.signal });
  };

  await assert.rejects(
    generator.generate({
      chapter: 1,
      difficulty: "easy",
      count: 1,
      signal: controller.signal,
    }),
    (error) => error.code === "LLM_GENERATION_CANCELLED" && error.status === 499,
  );
  assert.equal(service.allQuestions().length, 0);
  assert.equal(generator.running, false);
});

test("生成题选项必须严格包含四个非空选项", async (t) => {
  const { service } = await fixture(t);
  await assert.rejects(
    () => service.addGeneratedQuestions({
      chapter: 1,
      difficulty: "easy",
      questions: [{
        question: "选项结构校验",
        options: { A: "甲", B: "乙", C: "丙", D: "丁", E: "多余" },
        correct_answer: "A",
      }],
    }),
    (error) => error.status === 502,
  );
});

test("按小节生成题会保存从章节根开始的完整来源路径", async (t) => {
  const { service } = await fixture(t);
  const generator = new QuestionGenerator({ root, service });
  generator.callModel = async () => JSON.stringify({
    questions: [{
      question: "冯·诺伊曼结构包含哪些基本部分？",
      options: { A: "运算器、控制器、存储器、输入和输出", B: "显示器和键盘", C: "网络和电源", D: "浏览器和数据库" },
      correct_answer: "A",
      knowledge_point: "冯·诺伊曼结构",
      analysis: "该结构将计算机组织为五个基本部分。",
      source_node: "冯·诺伊曼结构基础",
    }],
  });
  await generator.generate({ chapter: 2, section: "2.1", difficulty: "easy", count: 1 });
  assert.equal(
    service.allQuestions()[0].sourceNode,
    "第2章 计算机系统基础知识 › 2.1 计算机系统概述 › 冯·诺伊曼结构基础",
  );
});

test("导图节点来源可识别未写章节编号的唯一标题", async () => {
  const { nodePath, readMindMap, findChapter } = await import("../src/mindmap.mjs");
  const chapter = findChapter(await readMindMap("architect.mm"), 6);
  const path = nodePath(chapter, "概念结构设计");
  assert.equal(path.at(-1), "6.3.3 概念结构设计");
  assert.equal(nodePath(chapter, "不存在的概念结构"), null);
  const futureChapter = findChapter(await readMindMap("architect.mm"), 11);
  assert.equal(nodePath(futureChapter, "发展历程"), null);
  assert.equal(nodePath(futureChapter, "11.5.1 发展历程").at(-1), "11.5.1 发展历程");
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

test("案例模拟考到期后拒绝新草稿，仍可判已有草稿", async (t) => {
  const startedAt = Date.parse("2026-04-01T08:00:00.000Z");
  let time = new Date(startedAt).toISOString();
  const { service } = await fixture(t, () => time);
  await service.addCases({
    chapter: 1,
    cases: [{
      title: "支付系统设计",
      scenario: "设计高可用支付系统。",
      questions: [{ text: "如何容灾？", points: 5, reference_answer: "多活" }],
    }],
  });
  const exam = await service.createCaseExam({ count: 1, durationMinutes: 10 });
  const caseId = exam.cases[0].id;
  const questionId = exam.cases[0].questions[0].id;
  const save = (text) => service.saveCaseExamDraft({ examId: exam.id, caseId, questionId, text });

  time = new Date(startedAt + 10 * 60 * 1000).toISOString();
  await save("截止时作答");
  time = new Date(startedAt + 12 * 60 * 1000).toISOString();
  await save("宽限期作答");
  time = new Date(startedAt + 12 * 60 * 1000 + 1).toISOString();
  await assert.rejects(
    () => save("迟到作答"),
    (error) => error.code === "EXAM_TIME_OVER" && error.status === 409,
  );
  assert.equal(service.activeCaseExam().drafts[caseId][questionId], "宽限期作答");

  const graded = await service.saveCaseExamGrade({ examId: exam.id, grade: { total_score: 5 } });
  assert.equal(graded.gradedAt, time);
  await assert.rejects(
    () => service.saveCaseExamGrade({ examId: exam.id, grade: { total_score: 0 } }),
    (error) => error.status === 409,
  );

  const abandoned = await service.createCaseExam({ count: 1 });
  await service.abandonCaseExam(abandoned.id);
  await assert.rejects(
    () => service.saveCaseExamGrade({ examId: abandoned.id, grade: { total_score: 5 } }),
    (error) => error.status === 409,
  );
  assert.equal(service.caseExamList()[0].totalScore, null);
});

test("学习计划按设定时区的自然日统计实际作答并计算连续打卡", async (t) => {
  const previousZone = process.env.ARCHITECT_STUDY_TIME_ZONE;
  delete process.env.ARCHITECT_STUDY_TIME_ZONE;
  t.after(() => {
    if (previousZone === undefined) delete process.env.ARCHITECT_STUDY_TIME_ZONE;
    else process.env.ARCHITECT_STUDY_TIME_ZONE = previousZone;
  });
  const { service, store } = await fixture(t, () => "2026-04-02T16:30:00.000Z");
  await service.setDailyGoal(2);
  await store.update((state) => {
    state.attempts = [
      { total: 4, unanswered: 3, gradedAt: "2026-04-01T16:10:00.000Z" },
      { total: 1, unanswered: 0, gradedAt: "2026-04-02T00:10:00.000Z" },
      { total: 3, unanswered: 1, gradedAt: "2026-04-02T16:05:00.000Z" },
      { total: 4, unanswered: 4, gradedAt: "2026-04-02T18:00:00.000Z" },
    ];
  });
  assert.deepEqual(service.getStudyPlan(), {
    dailyGoal: 2,
    todayAnswered: 2,
    todayDone: true,
    streak: 2,
    totalAnswered: 4,
  });
  process.env.ARCHITECT_STUDY_TIME_ZONE = "UTC";
  assert.deepEqual(service.getStudyPlan(), {
    dailyGoal: 2,
    todayAnswered: 3,
    todayDone: true,
    streak: 1,
    totalAnswered: 4,
  });
});

test("考试准备度聚合章节、题库覆盖、模拟考试与下一步行动", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "architect-readiness-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new JsonStore(join(directory, "state.json"));
  const service = new PracticeService({ store, root });
  const readiness = service.examReadiness();
  assert.equal(typeof readiness.score, "number");
  assert.match(readiness.level, /起步|基础构建|稳步提升|冲刺/);
  assert.ok(readiness.coverage.total >= 0);
  assert.ok(Array.isArray(readiness.weakPoints));
  assert.ok(Array.isArray(readiness.weakChapters));
  assert.ok(Array.isArray(readiness.nextActions));
});

test("系统学习单元按最深编号节点拆分并保留来源状态", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "architect-learning-granularity-test-"));
  const store = new JsonStore(join(directory, "state.json"));
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  await store.init();
  const service = new PracticeService({ store, root });
  await service.init();
  const units = service.learningUnits();
  assert.ok(units.some((unit) => unit.id === "1.1"));
  assert.ok(units.every((unit) => unit.source?.type === "mindmap"));
  assert.ok(units.every((unit) => ["verified", "partial", "missing"].includes(unit.contentStatus)));
  const chapterOne = units.find((unit) => unit.id === "1.1");
  assert.equal(chapterOne.contentStatus, "verified");
  assert.equal(chapterOne.teaching.what.includes("基本组织"), true);
});

test("系统学习单元 ID 全局唯一，缺少专属课程内容时明确隔离章节摘要", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "architect-learning-coverage-test-"));
  const store = new JsonStore(join(directory, "state.json"));
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  await store.init();
  const service = new PracticeService({ store, root });
  await service.init();
  const units = service.learningUnits();
  assert.equal(units.length, 324);
  assert.equal(new Set(units.map((unit) => unit.id)).size, units.length, "learning IDs must be globally unique");
  const authored = units.filter((unit) => unit.contentSource?.type === "course-content");
  const fallback = units.filter((unit) => unit.contentSource?.type === "mindmap-fallback");
  assert.equal(authored.length, 324);
  assert.equal(fallback.length, 0);
  assert.ok(authored.every((unit) => ["verified", "partial"].includes(unit.contentStatus)), "authored lessons must expose an explicit review status");
  const newlyAuthoredIds = ["4.4.2.3","6.2.3.1","6.2.3.2","6.2.3.3","9.2.3.1","9.2.3.2","9.2.3.3","9.2.3.4","9.2.3.5","9.2.3.6","9.2.3.7","9.2.3.8","9.2.3.9","9.2.3.10","10.4.1","10.4.2","10.4.3","10.4.4","10.4.5","10.4.6","10.4.7","10.4.8","10.4.9","10.4.10","10.4.11","10.4.12","10.4.13","10.4.14","10.4.15","10.4.16","10.4.17","10.4.18","17.2.3.4","17.2.3.5","19.3.5.1","19.3.7","19.4.4.1","19.4.4.2"];
  const newlyAuthored = newlyAuthoredIds.map((id) => units.find((unit) => unit.id === id));
  assert.equal(newlyAuthored.length, 38);
  assert.ok(newlyAuthored.every((unit) => unit?.contentSource?.type === "course-content" && unit.contentSource.status === "partial" && unit.contentStatus === "partial"), "all previously missing lessons must now have explicit partial course records");
  const required = ["what", "why", "how", "confusions", "scenarios", "examples", "examFocus", "pitfalls"];
  for (const unit of authored) {
    assert.ok(["verified", "partial"].includes(unit.contentSource.status), "invalid content status: " + unit.id);
    for (const key of required) assert.ok(Object.prototype.hasOwnProperty.call(unit.teaching, key), unit.id + " missing " + key);
  }
  for (const unit of fallback) {
    assert.equal(unit.contentStatus, "missing", "fallback must not imply authored course coverage: " + unit.id);
    assert.equal(unit.contentSource.status, "missing");
  }
  assert.deepEqual(units.filter((unit) => unit.title === "1NF").map((unit) => unit.id), ["6.2.3.1"]);
  assert.deepEqual(units.filter((unit) => unit.title === "3NF").map((unit) => unit.id), ["6.2.3.3"]);
  const firstNormalForm = units.find((unit) => unit.id === "6.2.3.1");
  assert.match(firstNormalForm.teaching.what, /属性值不可再分|原子性/);
  assert.doesNotMatch(firstNormalForm.teaching.what, /本章围绕《计算机系统基础知识》展开/);
  assert.deepEqual(units.filter((unit) => unit.title === "4G/5G演进").map((unit) => unit.id), ["17.2.3.4"]);
  assert.ok(units.some((unit) => unit.id === "19.3.5.1" && unit.title === "缺点"));
  assert.ok(units.some((unit) => unit.id === "19.4.4.1" && unit.title === "优点"));
  assert.ok(units.some((unit) => unit.id === "19.4.4.2" && unit.title === "缺点"));
  assert.ok(!units.some((unit) => /^\d+$/.test(unit.id)), "chapter summaries must not be lesson IDs");
  assert.ok(!units.some((unit) => unit.id === "19.4.4" || unit.id === "19.3.5"));
});

test("系统学习按思维导图建立单元、记录学习状态并衔接章节练习", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "architect-learning-test-"));
  const store = new JsonStore(join(directory, "state.json"));
  t.after(async () => {
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  await store.init();
  const service = new PracticeService({ store, root });
  await service.init();  const plan = service.learningPlan();
  assert.ok(plan.total > 0);
  assert.equal(plan.completed, 0);
  assert.equal(plan.current.status, "not-started");
  assert.ok(plan.current.coreKnowledge);
  assert.equal(plan.current.practiceAction.type, "start-practice");
  await service.startLearning(plan.current.id);
  assert.equal(service.learningPlan().current.status, "learning");
  await service.completeLearning(plan.current.id, 3);
  const next = service.learningPlan();
  assert.equal(next.completed, 1);
  assert.equal(next.consolidating, 1);  assert.notEqual(next.current?.id, plan.current.id);
  const persisted = store.snapshot().learningProgress[plan.current.id];
  assert.equal(persisted.status, "consolidating");
  assert.equal(persisted.confidence, 3);
});

test("考试准备度覆盖率兼容历史题目 stats，避免 attempts.details 缺失导致显示 0", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "architect-readiness-coverage-test-"));
  const store = new JsonStore(join(directory, "state.json"));
  t.after(async () => {
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const service = new PracticeService({ store, root });
  await store.init();
  await store.update((state) => {
    state.generatedQuestions = [
      { id: "q1", chapter: 1, sourceType: "generated", question: "q1", stats: { seen: 1, correct: 1 } },
      { id: "q2", chapter: 1, sourceType: "generated", question: "q2", stats: { seen: 2, correct: 2 } },
    ];
    state.attempts = [{ total: 2, unanswered: 0, details: [] }];
  });
  assert.equal(service.examReadiness().coverage.attempted, 2);  assert.equal(service.examReadiness().coverage.attempted, 2);
});

test("学习队列按恢复、到期复习、薄弱章节排序，并过滤不可执行错题", async (t) => {
  const { service, store } = await fixture(t);
  await addQuestions(service, { chapter: 4, difficulty: "easy", count: 2 });
  const questions = service.allQuestions();
  await store.update((state) => {
    state.sessions.active = {
      id: "active",
      chapter: 4,
      section: null,
      difficulty: "easy",
      mode: "practice",
      questionIds: [questions[0].id],
      checkedAnswers: {},
      createdAt: "2026-04-01T07:00:00.000Z",
      gradedAt: null,
      abandonedAt: null,
    };
    state.wrongBook = {
      due: {
        questionId: questions[1].id,
        chapter: 4,
        mastered: false,
        disabledByIssue: false,
        nextReviewAt: "2026-03-31T08:00:00.000Z",
        lastWrongAt: "2026-03-31T08:00:00.000Z",
      },
      unavailable: {
        questionId: "removed",
        chapter: 4,
        mastered: false,
        disabledByIssue: false,
        nextReviewAt: "2026-03-30T08:00:00.000Z",
        lastWrongAt: "2026-03-30T08:00:00.000Z",
      },
    };
  });
  const queue = service.studyQueue({ limit: 5 });
  assert.equal(queue.next.action.type, "resume-session");
  assert.deepEqual(
    queue.items.slice(0, 3).map((item) => item.kind),
    ["resume-session", "review", "practice"],
  );
  assert.equal(queue.counts.dueReviews, 1);
  assert.equal(queue.items.find((item) => item.kind === "review").count, 1);
});

test("学习队列对零记录新手给出入门路径，产生学习记录后消失", async (t) => {
  const { service } = await fixture(t);
  // 空题库：入门路径收缩为"读教材 → 导入/生成"，且不再重复给准备题库条目。
  const emptyQueue = service.studyQueue({ limit: 5 });
  const emptyBeginner = emptyQueue.items.find(
    (item) => item.id === "beginner:path",
  );
  assert.ok(emptyBeginner, "空学习状态应包含入门路径条目");
  assert.deepEqual(
    emptyBeginner.action.options.map((option) => option.type),
    ["open-materials", "import-bank", "generate"],
  );
  assert.equal(
    emptyQueue.items.find((item) => item.id === "setup:question-bank"),
    undefined,
  );

  await addQuestions(service, { chapter: 1, difficulty: "easy", count: 2 });
  const queue = service.studyQueue({ limit: 5 });
  const beginner = queue.items.find((item) => item.id === "beginner:path");
  assert.ok(beginner, "题库就绪后仍应保留入门路径");
  assert.equal(beginner.priority, 0);
  assert.equal(queue.next?.id, "beginner:path");
  const options = beginner.action.options.map((option) => option.type);
  assert.deepEqual(options, ["open-materials", "start-practice", "open-mock"]);

  // 产生一条练习记录后，入门路径应退出队列。
  await service.createSession({ chapter: 1, section: "all", difficulty: "mixed", count: 2 });
  const afterPractice = service.studyQueue({ limit: 5 });
  assert.equal(
    afterPractice.items.find((item) => item.id === "beginner:path"),
    undefined,
  );
});

test("新手路径只把已通过核验的生成题视为可用，并识别已导入题库", async (t) => {
  const { service } = await fixture(t);
  await service.addGeneratedQuestions({
    chapter: 1,
    difficulty: "easy",
    source: "mindmap",
    sourceNode: "第1章 绪论",
    questions: [{
      question: "待核验题目",
      options: { A: "选项A", B: "选项B", C: "选项C", D: "选项D" },
      correct_answer: "A",
      analysis: "尚未人工核验的测试解析",
      knowledge_detail: "测试知识点",
    }],
  });

  const pendingOnly = service.studyQueue({ limit: 5 });
  const pendingBeginner = pendingOnly.items.find((item) => item.id === "beginner:path");
  assert.deepEqual(
    pendingBeginner.action.options.map((option) => option.type),
    ["open-materials", "import-bank", "generate"],
  );
  assert.doesNotMatch(pendingBeginner.description, /练 10 道第 1 章题/);
  assert.equal(pendingBeginner.action.options.some((option) => option.type === "start-practice"), false);
  assert.equal(pendingBeginner.action.options.some((option) => option.type === "open-mock"), false);

  await importSampleBank(service, t);
  const importedAvailable = service.studyQueue({ limit: 5 });
  const importedBeginner = importedAvailable.items.find((item) => item.id === "beginner:path");
  assert.deepEqual(
    importedBeginner.action.options.map((option) => option.type),
    ["open-materials", "open-mock"],
  );
  assert.match(importedBeginner.description, /已导入题库/);
  assert.equal(importedAvailable.items.some((item) => item.id === "setup:question-bank"), false);
});

test("已有练习记录且仅有导入题时，队列提供可执行入口而不误导重复导入", async (t) => {
  const { service } = await fixture(t);
  await importSampleBank(service, t);
  await service.store.update((state) => {
    state.attempts.push({ id: "history-exists", createdAt: service.now(), total: 1, correct: 1 });
    return state;
  });
  const queue = service.studyQueue({ limit: 5 });
  const setup = queue.items.find((item) => item.id === "setup:question-bank");
  assert.equal(setup.title, "章节题待核验 · 可以先做真题");
  assert.deepEqual(
    setup.action.options.map((option) => option.type),
    ["open-mock", "open-bank", "generate"],
  );
  assert.match(setup.description, /已导入的真题和模拟题仍可在模拟考试页使用/);
});

test("内容质量摘要区分来源、答案信任、套卷缺题、Wiki 校对和问题题", async (t) => {
  const { service } = await fixture(t);
  await addQuestions(service, {
    chapter: 4,
    difficulty: "easy",
    count: 1,
  });
  await service.store.update((state) => {
    state.generatedQuestions.find((item) => item.chapter === 4).sourceNode = null;
    return state;
  });
  await service.addWikiEntries({
    chapter: 1,
    entries: [{
      title: "待校对知识点",
      summary: "摘要",
      key_points: [],
      common_mistakes: [],
      related: [],
    }],
  });
  await importSampleBank(service, t);
  await service.reportQuestion({
    questionId: "real-2025-1",
    note: "待确认",
  });
  const health = service.contentHealth();
  assert.equal(health.sources.questions.generated, 1);
  assert.equal(health.sources.questions.real, 2);
  assert.equal(health.sources.questions.mock, 1);
  assert.ok(
    health.answerTrust.some(
      (item) =>
        item.code === "third-party" &&
        item.count >= 3,
    ),
  );
  assert.equal(health.generatedQuality.missingSourceNode, 1);
  assert.equal(health.examCoverage.incompletePapers, 1);
  assert.equal(health.examCoverage.missingQuestionCount, 73);
  assert.equal(health.wiki.draft, 1);
  assert.equal(health.questionIssues.unresolved, 1);
});

test("统计学习天数按本地自然日计算且不计未作答的交卷", async (t) => {
  const previousZone = process.env.ARCHITECT_STUDY_TIME_ZONE;
  process.env.ARCHITECT_STUDY_TIME_ZONE = "Asia/Shanghai";
  t.after(() => {
    if (previousZone === undefined) delete process.env.ARCHITECT_STUDY_TIME_ZONE;
    else process.env.ARCHITECT_STUDY_TIME_ZONE = previousZone;
  });
  const { service, store } = await fixture(t);
  await store.update((state) => {
    state.attempts = [
      { total: 1, unanswered: 0, gradedAt: "2026-04-01T16:10:00.000Z" },
      { total: 1, unanswered: 0, gradedAt: "2026-04-02T00:10:00.000Z" },
      { total: 4, unanswered: 4, gradedAt: "2026-04-03T12:00:00.000Z" },
    ];
  });
  assert.equal(service.statistics().summary.studyDays, 1);
  process.env.ARCHITECT_STUDY_TIME_ZONE = "UTC";
  assert.equal(service.statistics().summary.studyDays, 2);
});

test("Wiki 自检能发现同名、断链、孤立与缺溯源条目", async (t) => {
  const { service } = await fixture(t);
  await service.addWikiEntries({
    chapter: 1,
    // 故意种下同名重复条目验证 lint，因此绕过写入时的去重。
    dedupe: false,
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
    // 故意种下同名重复条目验证合并，因此绕过写入时的去重。
    dedupe: false,
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
  const directory = await mkdtemp(join(tmpdir(), "architect-bank-"));
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

test("导入 ID 与生成题冲突时隔离命名空间，并拒绝同批重复外部 ID", async (t) => {
  const { service } = await fixture(t);
  await addQuestions(service, { chapter: 7, difficulty: "easy", count: 1 });
  const directory = await mkdtemp(join(tmpdir(), "architect-bank-conflict-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "bank.json");
  const bank = sampleBank();
  bank.choices = [
    {
      id: service.allQuestions()[0].id,
      sourceType: "real",
      module: "architecture",
      stem: "与生成题 ID 冲突的真题？",
      options: { A: "甲", B: "乙", C: "丙", D: "丁" },
      answer: "A",
      term: "2025年下半年",
      questionNo: 1,
    },
  ];
  await writeFile(file, JSON.stringify(bank), "utf8");
  const imported = await service.importArchitectBank({ file });
  assert.equal(imported.questions.added, 1);
  const rows = service.allQuestions();
  assert.equal(rows.filter((item) => item.sourceType === "generated").length, 1);
  const importedRow = rows.find((item) => item.sourceType === "real");
  assert.match(importedRow.id, /^import:real:/);
  assert.equal(importedRow.sourceId, service.allQuestions()[0].id);

  bank.choices.push({ ...bank.choices[0], stem: "批内重复" });
  await writeFile(file, JSON.stringify(bank), "utf8");
  await assert.rejects(
    () => service.importArchitectBank({ file }),
    (error) => error.code === "IMPORT_DUPLICATE_ID" && error.status === 400,
  );
});

test("导入原始 ID 和命名空间 ID 同时冲突时分配稳定的第三个 ID", async (t) => {
  const { service, store } = await fixture(t);
  await addQuestions(service, { chapter: 7, difficulty: "easy", count: 1 });
  const original = service.allQuestions()[0];
  const sourceId = "collision-source";
  const namespaceId = `import:real:${encodeURIComponent(sourceId)}`;
  await store.update((state) => {
    state.generatedQuestions[0] = { ...state.generatedQuestions[0], id: sourceId };
    state.generatedQuestions.push({ ...original, id: namespaceId });
  });
  const directory = await mkdtemp(join(tmpdir(), "architect-bank-double-conflict-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "bank.json");
  const bank = sampleBank();
  bank.choices = [
    {
      id: sourceId,
      sourceType: "real",
      module: "architecture",
      stem: "双重冲突的真题？",
      options: { A: "甲", B: "乙", C: "丙", D: "丁" },
      answer: "A",
      term: "2025年下半年",
      questionNo: 1,
    },
  ];
  await writeFile(file, JSON.stringify(bank), "utf8");

  const imported = await service.importArchitectBank({ file });
  assert.equal(imported.questions.added, 1);
  const rows = service.allQuestions();
  const importedRow = rows.find((item) => item.question === "双重冲突的真题？");
  assert.equal(importedRow.sourceId, sourceId);
  assert.equal(importedRow.id, `${namespaceId}:2`);
  assert.equal(new Set(rows.map((item) => item.id)).size, rows.length);

  const second = await service.importArchitectBank({ file });
  assert.equal(second.questions.updated, 1);
  assert.equal(service.allQuestions().find((item) => item.sourceId === sourceId).id, `${namespaceId}:2`);
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


test("模拟考会话交卷前不提供逐题判题反馈", async (t) => {
  const { service } = await fixture(t);
  await addQuestions(service, { chapter: 7, difficulty: "easy", count: 1 });
  const exam = await service.createMockExamSession({ count: 1 });
  await assert.rejects(
    () =>
      service.checkAnswer({
        sessionId: exam.id,
        questionId: exam.questions[0].id,
        answer: "A",
      }),
    (error) => error.code === "EXAM_NO_FEEDBACK" && error.status === 400,
  );
  // 模拟考作答本身不受影响，且不会泄露答案。
  const saved = await service.saveExamAnswer({
    sessionId: exam.id,
    questionId: exam.questions[0].id,
    answer: "B",
  });
  assert.equal(saved.saved, true);
  const active = await service.activeSession();
  assert.ok(
    active.questions.every(
      (question) => !Object.hasOwn(question, "correctAnswer"),
    ),
  );
});

test("模拟考超过时限后不再受理新的作答", async (t) => {
  const base = Date.parse("2026-04-01T08:00:00.000Z");
  let time = new Date(base).toISOString();
  const { service } = await fixture(t, () => time);
  await addQuestions(service, { chapter: 7, difficulty: "easy", count: 1 });
  const exam = await service.createMockExamSession({
    count: 1,
    durationMinutes: 60,
  });
  assert.equal(exam.status, "active");
  assert.equal(exam.deadlineAt, new Date(base + 60 * 60 * 1000).toISOString());
  // 宽限期内的补交仍然允许。
  time = new Date(base + 60 * 60 * 1000).toISOString();
  await service.saveExamAnswer({
    sessionId: exam.id,
    questionId: exam.questions[0].id,
    answer: "A",
  });
  // 超过宽限期后拒绝。
  time = new Date(base + 62 * 60 * 1000 + 1000).toISOString();
  await assert.rejects(
    () =>
      service.saveExamAnswer({
        sessionId: exam.id,
        questionId: exam.questions[0].id,
        answer: "C",
      }),
    (error) => error.code === "EXAM_TIME_OVER" && error.status === 409,
  );
  // 超时后的请求体不能补交新答案，只能按服务端已保存答案自动交卷。
  await assert.rejects(
    () => service.grade({ sessionId: exam.id, answers: { [exam.questions[0].id]: "B" } }),
    (error) => error.code === "EXAM_TIME_OVER" && error.status === 409,
  );
  const graded = await service.grade({ sessionId: exam.id, answers: {} });
  assert.equal(graded.total, 1);
  assert.equal(graded.details[0].userAnswer, "A");
  assert.equal(graded.submissionStatus, "expired");
  assert.equal(service.store.snapshot().sessions[exam.id].status, "graded");
});

test("模拟考答案 revision 拒绝乱序旧请求", async (t) => {
  const { service } = await fixture(t);
  await addQuestions(service, { chapter: 7, difficulty: "easy", count: 1 });
  const exam = await service.createMockExamSession({ count: 1 });
  const questionId = exam.questions[0].id;
  const latest = await service.saveExamAnswer({
    sessionId: exam.id,
    questionId,
    answer: "B",
    revision: 2,
  });
  const stale = await service.saveExamAnswer({
    sessionId: exam.id,
    questionId,
    answer: "A",
    revision: 1,
  });
  assert.equal(latest.revision, 2);
  assert.equal(stale.stale, true);
  assert.equal(service.store.snapshot().sessions[exam.id].checkedAnswers[questionId], "B");
});

test("模拟考答案 revision 不会因重复的旧值回退", async (t) => {
  const { service } = await fixture(t);
  await addQuestions(service, { chapter: 7, difficulty: "easy", count: 1 });
  const exam = await service.createMockExamSession({ count: 1 });
  const questionId = exam.questions[0].id;
  await service.saveExamAnswer({ sessionId: exam.id, questionId, answer: "B", revision: 3 });
  const stale = await service.saveExamAnswer({ sessionId: exam.id, questionId, answer: "B", revision: 2 });
  assert.equal(stale.stale, true);
  assert.equal(stale.revision, 3);
  assert.equal(service.store.snapshot().sessions[exam.id].answerRevisions[questionId], 3);
});

test("并发判卷只允许一次状态转换", async (t) => {
  const { service } = await fixture(t);
  await addQuestions(service, { chapter: 7, difficulty: "easy", count: 1 });
  const session = await service.createSession({ chapter: 7, difficulty: "easy", count: 1 });
  const results = await Promise.allSettled([
    service.grade({ sessionId: session.id, answers: {} }),
    service.grade({ sessionId: session.id, answers: {} }),
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(results.filter((item) => item.status === "rejected")[0].reason.code, "SESSION_ALREADY_GRADED");
  assert.equal(service.store.snapshot().attempts.length, 1);
});

test("备份导入拒绝重复 ID、悬空会话题目和无效时间", async (t) => {
  const { service } = await fixture(t);
  await addQuestions(service, { chapter: 4, difficulty: "easy", count: 1 });
  const backup = await service.exportData();
  const duplicate = structuredClone(backup);
  duplicate.data.generatedQuestions.push(structuredClone(duplicate.data.generatedQuestions[0]));
  await assert.rejects(
    () => service.importData({ backup: duplicate, confirm: "IMPORT" }),
    (error) => error.code === "INVALID_BACKUP",
  );
  const dangling = structuredClone(backup);
  dangling.data.sessions = {
    "session-bad": {
      id: "session-bad",
      questionIds: ["missing-question"],
      checkedAnswers: {},
      createdAt: "2026-04-01T08:00:00.000Z",
    },
  };
  await assert.rejects(
    () => service.importData({ backup: dangling, confirm: "IMPORT" }),
    (error) => error.code === "INVALID_BACKUP",
  );
  const invalidTime = structuredClone(backup);
  invalidTime.data.generatedQuestions[0].createdAt = "not-a-date";
  await assert.rejects(
    () => service.importData({ backup: invalidTime, confirm: "IMPORT" }),
    (error) => error.code === "INVALID_BACKUP",
  );
});

test("不支持的备份版本与损坏备份被拒绝且不改变现有学习数据", async (t) => {
  const { service } = await fixture(t);
  await addQuestions(service, { chapter: 4, difficulty: "easy", count: 2 });
  const before = service.store.snapshot();
  const backup = await service.exportData();

  const unsupportedVersion = structuredClone(backup);
  unsupportedVersion.version += 1;
  await assert.rejects(
    () => service.importData({ backup: unsupportedVersion, confirm: "IMPORT" }),
    (error) => error.code === "INVALID_BACKUP",
  );

  const corrupt = structuredClone(backup);
  corrupt.data.sessions = {
    "session-with-missing-question": {
      id: "session-with-missing-question",
      questionIds: ["question-that-does-not-exist"],
      checkedAnswers: {},
      createdAt: "2026-04-01T08:00:00.000Z",
    },
  };
  await assert.rejects(
    () => service.importData({ backup: corrupt, confirm: "IMPORT" }),
    (error) => error.code === "INVALID_BACKUP",
  );

  const after = service.store.snapshot();
  assert.deepEqual(after.generatedQuestions, before.generatedQuestions);
  assert.deepEqual(after.sessions, before.sessions);
  assert.deepEqual(after.attempts, before.attempts);
  assert.deepEqual(after.wrongBook, before.wrongBook);
  assert.deepEqual(after.questionIssues, before.questionIssues);
});

test("论文模拟的草稿和评分都受服务端截止时间约束", async (t) => {
  const base = Date.parse("2026-04-01T08:00:00.000Z");
  let time = new Date(base).toISOString();
  const { service } = await fixture(t, () => time);
  const papers = await service.addPapers({
    chapter: 4,
    papers: [{ title: "论架构", description: "结合项目论述架构设计" }],
  });
  await service.setPaperMockStart({ paperId: papers[0].id });
  assert.equal(
    service.paperList()[0].mock.deadlineAt,
    new Date(base + 120 * 60 * 1000).toISOString(),
  );
  time = new Date(base + 120 * 60 * 1000 + 121 * 1000).toISOString();
  await assert.rejects(
    () => service.savePaperDraft({ paperId: papers[0].id, draft: "超时草稿" }),
    (error) => error.code === "ESSAY_TIME_OVER" && error.status === 409,
  );
  await assert.rejects(
    () => service.savePaperGrade({ paperId: papers[0].id, grade: { total_score: 1 } }),
    (error) => error.code === "ESSAY_TIME_OVER" && error.status === 409,
  );
});

test("恢复问题题目会按上报前状态归还错题复习", async (t) => {
  const { service } = await fixture(t);
  await addQuestions(service, { chapter: 7, difficulty: "easy", count: 1 });
  const session = await service.createSession({
    chapter: 7,
    difficulty: "easy",
    count: 1,
  });
  const question = session.questions[0];
  await service.grade({ sessionId: session.id, answers: { [question.id]: "B" } });
  await service.reportQuestion({ questionId: question.id });
  let record = service
    .wrongQuestions()
    .records.find((item) => item.questionId === question.id);
  assert.equal(record.disabledByIssue, true);
  assert.equal(record.mastered, true);

  await service.restoreQuestion(question.id);
  record = service
    .wrongQuestions()
    .records.find((item) => item.questionId === question.id);
  assert.equal(record.disabledByIssue, false);
  assert.equal(record.mastered, false);
  assert.equal(record.nextReviewAt <= service.now(), true);
});

test("重复上报问题题目不会覆盖错题掌握状态的恢复依据", async (t) => {
  const { service } = await fixture(t);
  await addQuestions(service, { chapter: 7, difficulty: "easy", count: 1 });
  const session = await service.createSession({
    chapter: 7,
    difficulty: "easy",
    count: 1,
  });
  const question = session.questions[0];
  await service.grade({ sessionId: session.id, answers: { [question.id]: "B" } });
  const original = service.wrongQuestions().records.find((item) => item.questionId === question.id);
  assert.equal(original.mastered, false);

  await service.reportQuestion({ questionId: question.id, note: "首次上报" });
  await service.reportQuestion({ questionId: question.id, note: "补充说明后再次上报" });
  let record = service.wrongQuestions().records.find((item) => item.questionId === question.id);
  assert.equal(record.disabledByIssue, true);
  assert.equal(record.mastered, true);

  await service.restoreQuestion(question.id);
  record = service.wrongQuestions().records.find((item) => item.questionId === question.id);
  assert.equal(record.disabledByIssue, false);
  assert.equal(record.mastered, false);
  assert.equal(record.nextReviewAt <= service.now(), true);
});

test("判卷会忽略合法范围之外的选项值", async (t) => {
  const { service } = await fixture(t);
  await addQuestions(service, { chapter: 7, difficulty: "easy", count: 1 });
  const session = await service.createSession({
    chapter: 7,
    difficulty: "easy",
    count: 1,
  });
  const result = await service.grade({
    sessionId: session.id,
    answers: { [session.questions[0].id]: "Z" },
  });
  assert.equal(result.details[0].userAnswer, null);
  assert.equal(result.unanswered, 1);
  assert.equal(result.incorrect, 0);
});

test("生成案例、论文与 Wiki 条目会按标题去重", async (t) => {
  const { service } = await fixture(t);
  const firstCases = await service.addCases({
    chapter: 7,
    cases: [
      {
        title: "论数据中台建设",
        scenario: "某银行构建数据中台",
        questions: [{ text: "说明数据中台的边界", reference_answer: "略" }],
      },
      {
        title: "论数据中台建设",
        scenario: "同批重复案例",
        questions: [{ text: "q", reference_answer: "略" }],
      },
    ],
  });
  assert.equal(firstCases.length, 1);
  const duplicateCases = await service.addCases({
    chapter: 7,
    cases: [
      {
        title: "论数据中台建设！ ",
        scenario: "同名近似标点",
        questions: [{ text: "q2", reference_answer: "略" }],
      },
    ],
  });
  assert.equal(duplicateCases.length, 0);
  const otherChapterCases = await service.addCases({
    chapter: 5,
    cases: [
      {
        title: "论数据中台建设",
        scenario: "不同章节允许同名",
        questions: [{ text: "q3", reference_answer: "略" }],
      },
    ],
  });
  assert.equal(otherChapterCases.length, 1);
  const papers = await service.addPapers({
    chapter: 4,
    papers: [
      { title: "论微服务", description: "d" },
      { title: "论微服务", description: "d2" },
    ],
  });
  assert.equal(papers.length, 1);
  const entries = await service.addWikiEntries({
    chapter: 7,
    entries: [
      { title: "缓存穿透", summary: "s" },
      { title: "缓存穿透。", summary: "s2" },
    ],
  });
  assert.equal(entries.length, 1);
});

test("论文模拟超时后默认拒绝评分，但进行中的评分可豁免落库", async (t) => {
  const base = Date.parse("2026-04-01T08:00:00.000Z");
  let time = new Date(base).toISOString();
  const { service } = await fixture(t, () => time);
  const papers = await service.addPapers({
    chapter: 4,
    papers: [{ title: "论架构评审", description: "结合项目论述" }],
  });
  await service.setPaperMockStart({ paperId: papers[0].id });
  time = new Date(base + 120 * 60 * 1000 + 121 * 1000).toISOString();
  await assert.rejects(
    () =>
      service.savePaperGrade({ paperId: papers[0].id, grade: { total_score: 1 } }),
    (error) => error.code === "ESSAY_TIME_OVER" && error.status === 409,
  );
  await service.savePaperGrade({
    paperId: papers[0].id,
    grade: { total_score: 60 },
    allowAfterDeadline: true,
  });
  assert.equal(service.paperList()[0].grade.total_score, 60);
});

test("数据管理操作写入审计日志并按时间倒序读取", async (t) => {
  let time = "2026-04-01T08:00:00.000Z";
  const { service } = await fixture(t, () => time);
  await service.exportData();
  time = "2026-04-01T09:00:00.000Z";
  await service.clearData({ scope: "wrongBook", confirm: "CLEAR" });
  const records = service.auditLog();
  assert.deepEqual(
    records.map((record) => record.action),
    ["data.clear", "data.export"],
  );
  assert.equal(records[0].scope, "wrongBook");
  assert.ok(records[0].id);
});

test("错题本支持分页且汇总统计基于全量记录", async (t) => {
  const { service } = await fixture(t);
  await addQuestions(service, { chapter: 7, difficulty: "easy", count: 3 });
  const session = await service.createSession({
    chapter: 7,
    difficulty: "easy",
    count: 3,
  });
  await service.grade({ sessionId: session.id, answers: {} });
  const page = service.wrongQuestions({ limit: 2, offset: 0 });
  assert.equal(page.records.length, 2);
  assert.equal(page.total, 3);
  assert.equal(page.summary.total, 3);
  const secondPage = service.wrongQuestions({ limit: 2, offset: 2 });
  assert.equal(secondPage.records.length, 1);
  const full = service.wrongQuestions();
  assert.equal(full.records.length, 3);
  assert.equal(full.limit, 3);
});

// ===== 2026 升级功能:FSRS 调度 / 题目版本 / 问题题状态机 / 用量记账 / 数据库备份 =====

test("编辑生成题会保留历史版本并递增 revision", async (t) => {
  const { service } = await fixture(t);
  await addQuestions(service, { chapter: 5, difficulty: "easy", count: 1 });
  const question = service.allQuestions()[0];
  const original = question.question;
  await service.updateQuestion({
    questionId: question.id,
    updates: { question: "改写后的题干？", analysis: "更正后的解析" },
  });
  const updated = service.allQuestions()[0];
  assert.equal(updated.question, "改写后的题干？");
  assert.equal(updated.revision, 2);
  assert.equal(updated.revisions.length, 1);
  assert.equal(updated.revisions[0].snapshot.question, original);
  assert.equal(updated.revisions[0].revision, 1);
  // 导入题只读
  await importSampleBank(service, t);
  const imported = service.allQuestions().find((item) => item.sourceType === "real");
  await assert.rejects(
    () => service.updateQuestion({ questionId: imported.id, updates: { question: "x" } }),
    (error) => error.code === "IMPORTED_QUESTION_READONLY",
  );
});

test("问题题支持 待处理 → 已确认 状态流转,恢复后关闭", async (t) => {
  const { service } = await fixture(t);
  await addQuestions(service, { chapter: 6, difficulty: "easy", count: 1 });
  const question = service.allQuestions()[0];
  await service.reportQuestion({ questionId: question.id, note: "题干有误" });
  assert.equal(service.questionIssues()[0].status, "open");
  await service.setIssueStatus({ questionId: question.id, status: "acknowledged" });
  assert.equal(service.questionIssues()[0].status, "acknowledged");
  await assert.rejects(
    () => service.setIssueStatus({ questionId: question.id, status: "bogus" }),
    (error) => error.status === 400,
  );
  await service.restoreQuestion(question.id);
  assert.equal(service.questionIssues().length, 0);
});

test("模型调用会记录 token 用量并可汇总", async (t) => {
  const { service } = await fixture(t);
  await service.recordLlmUsage({
    kind: "mcq",
    model: "test-model",
    promptTokens: 1200,
    completionTokens: 800,
    requests: 1,
  });
  await service.recordLlmUsage({
    kind: "mcq",
    model: "test-model",
    promptTokens: 500,
    completionTokens: 200,
    requests: 2,
  });
  const summary = service.llmUsageSummary();
  assert.equal(summary.requests, 3);
  assert.equal(summary.promptTokens, 1700);
  assert.equal(summary.completionTokens, 1000);
  assert.ok(summary.recent.length >= 2);
});

test("VACUUM INTO 在线备份生成独立数据库文件", async (t) => {
  const { service, directory } = await fixture2(t);
  await addQuestions(service, { chapter: 3, difficulty: "easy", count: 2 });
  const result = await service.backupDatabase();
  const { stat } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const info = await stat(join(directory, "backups", result.file));
  assert.ok(info.size > 0);
  // 再备份一次应保留两份并清理到上限内
  const second = await service.backupDatabase();
  assert.notEqual(second.file, result.file);
});

// 供备份测试使用的目录可见 fixture(返回 service 与临时目录)。
async function fixture2(t) {
  const directory = await mkdtemp(join(tmpdir(), "architect-test-"));
  const store = new JsonStore(join(directory, "state.json"));
  t.after(() => {
    store.close();
    return rm(directory, { recursive: true, force: true });
  });
  await store.init();
  const service = new PracticeService({ store, root });
  await service.init();
  return { service, directory };
}
