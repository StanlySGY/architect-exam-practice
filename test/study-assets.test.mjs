import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { confinedMaterialPath, ExamAssets } from "../src/exam-assets.mjs";
import { validateEssaySample } from "../src/essay.mjs";
import { renderQuestionFigure } from "../src/figures.mjs";
import { QuestionGenerator } from "../src/generator.mjs";
import { PracticeService } from "../src/questions.mjs";
import { JsonStore } from "../src/store.mjs";

const root = resolve(import.meta.dirname, "..");

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "ruankao-assets-"));
  const store = new JsonStore(join(directory, "state.json"));
  await store.init();
  const service = new PracticeService({
    store,
    root,
    now: () => "2026-04-01T08:00:00.000Z",
    random: () => 0.25,
  });
  t.after(() => {
    store.close();
    return rm(directory, { recursive: true, force: true });
  });
  await service.init();
  return { service, directory };
}

function essayDraft({ summary = 320, body = 2200 } = {}) {
  const summaryText = "摘".repeat(summary);
  const bodyText = `我负责${"正".repeat(Math.max(0, body - 3))}`;
  return `摘要\n${summaryText}\n正文\n${bodyText}`;
}

test("引用图但没有图数据时，练习题只标缺失且不泄露答案", async (t) => {
  const { service } = await fixture(t);
  await service.addGeneratedQuestions({
    chapter: 4,
    difficulty: "easy",
    source: "mindmap",
    questions: [
      {
        question: "第 4 章：如下图所示，最上层编号表示什么？",
        options: { A: "待观察的层", B: "错误项乙", C: "错误项丙", D: "错误项丁" },
        correct_answer: "A",
        analysis: "不能提前看到的解析",
        knowledge_point: "架构分层",
      },
    ],
  });
  const session = await service.createSession({
    chapter: 4,
    difficulty: "easy",
    count: 1,
  });
  const question = session.questions[0];
  assert.equal(question.figureMissing, true);
  assert.equal(question.figure, null);
  assert.equal("correctAnswer" in question, false);
  assert.equal("aiAnalysis" in question, false);
  assert.equal("analysis" in question, false);
});

test("资料路径会解码中文文件名，并拒绝逃出资料目录", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ruankao-material-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const dataDir = join(directory, "data");
  await mkdir(join(dataDir, "study-materials", "outline"), { recursive: true });
  await writeFile(
    join(dataDir, "study-materials", "outline", "第01章-考试说明.md"),
    "# 说明\n\nhello",
    "utf8",
  );
  assert.throws(
    () => confinedMaterialPath(dataDir, "../bank.json"),
    (error) => error.code === "MATERIAL_PATH_FORBIDDEN",
  );
  assert.throws(
    () => confinedMaterialPath(dataDir, "/etc/passwd"),
    (error) => error.code === "MATERIAL_PATH_FORBIDDEN",
  );
  assert.throws(
    () =>
      confinedMaterialPath(
        dataDir,
        "./data/study-materials/%2e%2e/%2e%2e/secret.md",
      ),
    (error) => error.code === "MATERIAL_PATH_FORBIDDEN",
  );
  const assets = new ExamAssets({ dataDir });
  assets.materials = [
    {
      id: "outline-第01章-考试说明",
      title: "考试说明",
      group: "outline",
      groupLabel: "考试大纲",
      localUrl:
        "./data/study-materials/outline/%E7%AC%AC01%E7%AB%A0-%E8%80%83%E8%AF%95%E8%AF%B4%E6%98%8E.md",
    },
  ];
  const doc = await assets.studyMaterial("outline-第01章-考试说明");
  assert.match(doc.markdown, /hello/);
  assert.equal("localUrl" in doc, false);
});

test("论文结构：合格草稿通过，缺摘要或过短则拒绝", () => {
  const valid = validateEssaySample({}, essayDraft());
  assert.equal(valid.valid, true);
  assert.equal(valid.errors.length, 0);
  assert.equal(validateEssaySample({}, "正文\n我负责项目").valid, false);
  assert.equal(validateEssaySample({}, essayDraft({ summary: 20, body: 30 })).valid, false);
  const near = validateEssaySample({}, essayDraft({ summary: 280, body: 2200 }));
  assert.equal(near.valid, true);
  assert.ok(near.warnings.some((item) => item.includes("摘要")));
});

test("结构不合格的论文不会进入模型评分", async (t) => {
  const { service } = await fixture(t);
  const papers = await service.addPapers({
    chapter: 4,
    papers: [
      {
        title: "论软件架构",
        description: "结合项目论述分层与职责",
        knowledge_point: "架构",
      },
    ],
  });
  const generator = new QuestionGenerator({ root, service });
  await assert.rejects(
    () => generator.gradePaper({ paperId: papers[0].id, draft: "摘要\n太短" }),
    (error) =>
      error.code === "ESSAY_STRUCTURE_INVALID" &&
      error.message.startsWith("论文未满足书写条件："),
  );
  assert.equal(generator.running, false);
});

test("空练习也能导出不含密钥的架构师诊断", async (t) => {
  const { service } = await fixture(t);
  const diagnosis = service.diagnosisExport();
  assert.equal(diagnosis.schemaVersion, 1);
  assert.equal(diagnosis.subject, "系统架构设计师");
  assert.deepEqual(diagnosis.learner.recentWrong, []);
  assert.deepEqual(diagnosis.learner.bookmarkedQuestionIds, []);
  const serialized = JSON.stringify(diagnosis);
  assert.doesNotMatch(serialized, /apiKey|localUrl|sqlite|sk-/i);
});

test("图示渲染转义标签，缺失图只给待补录说明", () => {
  const stack = renderQuestionFigure(
    { kind: "layer-stack", layers: ["<script>", "计算机硬件"] },
    false,
  );
  assert.match(stack, /&lt;script&gt;/);
  assert.doesNotMatch(stack, /<script>/);
  assert.match(renderQuestionFigure(null, true), /原图待补录/);
  const flow = renderQuestionFigure(
    {
      kind: "mermaid",
      code: 'flowchart TB\n  A["开始"] --> B["结束"]',
    },
    false,
  );
  assert.match(flow, /开始/);
  assert.match(flow, /结束/);
});
