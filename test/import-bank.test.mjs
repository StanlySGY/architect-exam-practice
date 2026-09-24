import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  catalogFromImported,
  mapArchitectBank,
  mapCase,
  mapChoice,
  mapDifficulty,
  mapModule,
  mapPaper,
  readArchitectBank,
  splitWritingPoints,
} from "../src/import-bank.mjs";

test("模块映射到教材章节", () => {
  assert.equal(mapModule("architecture"), 7);
  assert.equal(mapModule("software_engineering"), 5);
  assert.equal(mapModule("computer_foundation"), 2);
  assert.equal(mapModule("database"), 6);
  assert.equal(mapModule("security"), 4);
  assert.equal(mapModule("network"), 17);
  assert.equal(mapModule("project_management"), 5);
  assert.equal(mapModule("english"), 1);
  assert.equal(mapModule("legal_ip"), 1);
  assert.equal(mapModule("new_technology"), 11);
  assert.equal(mapModule("embedded"), 16);
  assert.equal(mapModule("other"), 3);
  assert.equal(mapModule("unknown"), 3);
});

test("难度星级映射为空时按中等处理", () => {
  assert.equal(mapDifficulty(""), "medium");
  assert.equal(mapDifficulty(null), "medium");
  assert.equal(mapDifficulty("★"), "easy");
  assert.equal(mapDifficulty("★★"), "medium");
  assert.equal(mapDifficulty("★★★"), "medium");
  assert.equal(mapDifficulty("★★★★"), "hard");
  assert.equal(mapDifficulty("★★★★★"), "hard");
});

test("论文写作要点按行拆分并去掉序号", () => {
  assert.deepEqual(splitWritingPoints(["  论点一  ", ""]), ["论点一"]);
  assert.deepEqual(
    splitWritingPoints("1. 背景\n- 问题\n（3）对策"),
    ["背景", "问题", "对策"],
  );
});

test("选择题映射保留考期题号并规范化答案", () => {
  const mapped = mapChoice(
    {
      id: "real-2025-1",
      sourceType: "real",
      module: "architecture",
      knowledge: "分层架构",
      stem: "分层架构限制跨层调用的目的是？",
      options: { A: "控制依赖", B: "取消边界", C: "共享状态", D: "绕过接口" },
      answer: "a",
      analysis: "控制依赖方向。",
      term: "2025年下半年",
      paper: "综合知识",
      questionNo: "12",
      sourceFile: "2025-2.md",
    },
    "2026-04-01T08:00:00.000Z",
  );
  assert.equal(mapped.sourceType, "real");
  assert.equal(mapped.chapter, 7);
  assert.equal(mapped.question, "分层架构限制跨层调用的目的是？");
  assert.equal(mapped.correctAnswer, "A");
  assert.equal(mapped.questionNo, 12);
  assert.equal(mapped.knowledgePoint, "分层架构");
});

test("案例空描述回退到标题，子题默认均分 25 分", () => {
  const mapped = mapCase(
    {
      id: "case-2025-1",
      sourceType: "real",
      module: "software_engineering",
      title: "某电商系统改造",
      description: "",
      subQuestions: [
        { question_label: "问题1", prompt: "指出问题", reference_answer: "参考1" },
        { question_label: "问题2", prompt: "给出方案", reference_answer: "参考2" },
      ],
      term: "2025年下半年",
    },
    "2026-04-01T08:00:00.000Z",
  );
  assert.equal(mapped.scenario, "某电商系统改造");
  assert.equal(mapped.questions.length, 2);
  assert.equal(mapped.questions[0].id, "问题1");
  assert.equal(mapped.questions[0].points, 13);
  assert.equal(mapped.questions[1].points, 13);
});

test("论文写作要点字符串会拆成条目", () => {
  const mapped = mapPaper(
    {
      id: "essay-2025-1",
      source_type: "mock",
      module: "architecture",
      title: "论微服务架构",
      prompt: "结合实践论述。",
      writingPoints: "1. 拆分原则\n2. 治理",
      term: "2026年5月 模拟卷1",
    },
    "2026-04-01T08:00:00.000Z",
  );
  assert.equal(mapped.sourceType, "mock");
  assert.equal(mapped.chapter, 7);
  assert.deepEqual(mapped.writingPoints, ["拆分原则", "治理"]);
});

test("无效选择题会被丢弃", () => {
  const mapped = mapArchitectBank({
    choices: [
      {
        id: "bad",
        stem: "缺选项",
        options: { A: "只有A" },
        answer: "A",
      },
      {
        id: "good",
        stem: "有效题干",
        options: { A: "A", B: "B", C: "C", D: "D" },
        answer: "B",
        module: "database",
      },
    ],
  });
  assert.equal(mapped.questions.length, 1);
  assert.equal(mapped.questions[0].id, "good");
  assert.equal(mapped.questions[0].chapter, 6);
});

test("考期目录按真题在前、考期倒序排列", () => {
  const catalog = catalogFromImported({
    questions: [
      { term: "2024年下半年", sourceType: "real" },
      { term: "2025年下半年", sourceType: "real" },
      { term: "2026年5月 模拟卷1", sourceType: "mock" },
    ],
    cases: [{ term: "2025年下半年", sourceType: "real" }],
    papers: [{ term: "2026年5月 模拟卷1", sourceType: "mock" }],
  });
  assert.deepEqual(
    catalog.map((item) => `${item.sourceType}:${item.term}`),
    ["real:2025年下半年", "real:2024年下半年", "mock:2026年5月 模拟卷1"],
  );
  assert.equal(catalog[0].questions, 1);
  assert.equal(catalog[0].cases, 1);
  assert.equal(catalog[2].papers, 1);
});

test("缺失真题库文件返回 BANK_FILE_MISSING", async () => {
  await assert.rejects(
    () => readArchitectBank(join(tmpdir(), "missing-bank.json")),
    (error) => error.code === "BANK_FILE_MISSING" && error.status === 404,
  );
});

test("损坏的真题库返回 INVALID_BANK", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "architect-bank-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "bank.json");
  await writeFile(file, "{not json", "utf8");
  await assert.rejects(
    () => readArchitectBank(file),
    (error) => error.code === "INVALID_BANK" && error.status === 400,
  );
});
