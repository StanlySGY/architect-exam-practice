import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  confinedMaterialPath,
  ExamAssets,
  materialFormat,
  materialMimeType,
} from "../src/exam-assets.mjs";
import { validateEssaySample } from "../src/essay.mjs";
import { renderQuestionFigure } from "../src/figures.mjs";
import { QuestionGenerator } from "../src/generator.mjs";
import { renderMarkdown } from "../src/markdown.mjs";
import { PracticeService } from "../src/questions.mjs";
import { JsonStore } from "../src/store.mjs";

const root = resolve(import.meta.dirname, "..");

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "architect-assets-"));
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
  const directory = await mkdtemp(join(tmpdir(), "architect-material-"));
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

test("资料支持 Markdown、Mermaid、HTML、SVG 和纯文本格式", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "architect-material-formats-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const dataDir = join(directory, "data");
  const materialsDir = join(dataDir, "study-materials");
  await mkdir(materialsDir, { recursive: true });
  await writeFile(join(materialsDir, "guide.md"), "# Guide\n\n正文", "utf8");
  await writeFile(join(materialsDir, "diagram.mmd"), "flowchart TD\n A --> B", "utf8");
  await writeFile(join(materialsDir, "preview.html"), "<h1>Preview</h1>", "utf8");
  await writeFile(join(materialsDir, "icon.svg"), "<svg><text>Icon</text></svg>", "utf8");
  await writeFile(join(materialsDir, "notes.txt"), "plain text", "utf8");
  const assets = new ExamAssets({ dataDir });
  assets.materials = [
    { id: "guide", title: "Guide", localUrl: "./data/study-materials/guide.md" },
    { id: "diagram", title: "Diagram", localUrl: "./data/study-materials/diagram.mmd" },
    { id: "preview", title: "Preview", localUrl: "./data/study-materials/preview.html" },
    { id: "icon", title: "Icon", localUrl: "./data/study-materials/icon.svg" },
    { id: "notes", title: "Notes", localUrl: "./data/study-materials/notes.txt" },
  ];
  const listing = assets.studyMaterials().materials;
  assert.deepEqual(
    listing.map(({ id, format }) => [id, format]),
    [
      ["guide", "markdown"],
      ["diagram", "mermaid"],
      ["preview", "html"],
      ["icon", "svg"],
      ["notes", "text"],
    ],
  );
  assert.equal(materialFormat("diagram.mermaid"), "mermaid");
  assert.equal(materialMimeType("preview.html"), "text/html; charset=utf-8");
  const html = await assets.studyMaterial("preview");
  assert.equal(html.format, "html");
  assert.equal(html.content, "<h1>Preview</h1>");
  assert.equal(html.markdown, html.content);
});

test("论文挂载 AI 参考范文，无样本时字段为 null", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "architect-essay-sample-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    join(directory, "ai-essay-samples.json"),
    JSON.stringify({
      schemaVersion: 1,
      samples: {
        "essay-real-1": {
          content: "摘要\n我负责某电商架构项目……\n正文\n我于 2024 年……",
          generatedAt: "2026-10-05T00:00:00.000Z",
          model: "test-model",
        },
        "essay-broken": { content: "   " },
      },
    }),
    "utf8",
  );
  const assets = new ExamAssets({ dataDir: directory });
  await assets.load();
  const withSample = assets.attachPaper({ id: "essay-real-1", title: "论微服务" });
  assert.equal(withSample.aiSample.model, "test-model");
  assert.match(withSample.aiSample.content, /摘要/);
  assert.match(withSample.aiSample.note, /非官方/);
  const blank = assets.attachPaper({ id: "essay-broken", title: "空白样本" });
  assert.equal(blank.aiSample, null);
  const missing = assets.attachPaper({ id: "essay-none", title: "无样本" });
  assert.equal(missing.aiSample, null);
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

test("论文评分拒绝超范围或与维度合计不一致的模型结果", async (t) => {
  const { service } = await fixture(t);
  const papers = await service.addPapers({
    chapter: 4,
    papers: [{ title: "论软件架构", description: "结合项目论述" }],
  });
  const generator = new QuestionGenerator({ root, service });
  const dimensionNames = [
    ["切合题意", 20],
    ["观点正确", 20],
    ["逻辑清晰", 15],
    ["论据充分", 20],
    ["语言流畅", 10],
    ["格式规范", 15],
  ];
  const validDimensions = Object.fromEntries(
    dimensionNames.map(([name, max]) => [name, { score: max, max, comment: "好" }]),
  );
  generator.callModel = async () => JSON.stringify({
    total_score: 101,
    max_score: 100,
    dimensions: validDimensions,
  });
  await assert.rejects(
    () => generator.gradePaper({ paperId: papers[0].id, draft: essayDraft() }),
    (error) => error.code === "LLM_INVALID_RESPONSE" && error.status === 502,
  );
  generator.callModel = async () => JSON.stringify({
    total_score: 99,
    max_score: 100,
    dimensions: validDimensions,
  });
  await assert.rejects(
    () => generator.gradePaper({ paperId: papers[0].id, draft: essayDraft() }),
    (error) => error.code === "LLM_INVALID_RESPONSE" && error.status === 502,
  );
  assert.equal(service.paperList()[0].grade, null);
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
  assert.match(flow, /data-figure-edge-count="1"/);
  assert.doesNotMatch(flow, />flowchart</);
  const unquotedLabels = renderQuestionFigure(
    {
      kind: "mermaid",
      code: "flowchart TB\n A -. 迭代 .-> B\n B --约束--> C",
    },
    false,
  );
  assert.match(unquotedLabels, /data-figure-edge-count="2"/);
  assert.match(unquotedLabels, /迭代/);
  assert.match(unquotedLabels, /约束/);
  const reverseEdge = renderQuestionFigure(
    { kind: "mermaid", code: "flowchart TB\n A <-- B" },
    false,
  );
  assert.match(reverseEdge, /marker-start="url\(#figure-arrow\)"/);
  assert.doesNotMatch(reverseEdge, /marker-end="url\(#figure-arrow\)"/);
  const bidirectionalLabel = renderQuestionFigure(
    { kind: "mermaid", code: 'flowchart TB\n A <-. "双向" .-> B' },
    false,
  );
  assert.match(bidirectionalLabel, /marker-start="url\(#figure-arrow\)"/);
  assert.match(bidirectionalLabel, /marker-end="url\(#figure-arrow\)"/);
  assert.match(bidirectionalLabel, /figure-edge dashed/);
  const standardShapes = renderQuestionFigure(
    {
      kind: "mermaid",
      code: 'flowchart LR\n U(["Actor"])\n V(["View"])\n P(["Presenter"])\n U -- "1: makes action" --> V\n V -. "2: action notification" .-> P',
    },
    false,
  );
  assert.doesNotMatch(standardShapes, /无法解析/);
  assert.match(standardShapes, /Actor/);
  assert.match(standardShapes, /dashed/);
  const grouped = renderQuestionFigure(
    {
      kind: "mermaid",
      code: 'flowchart TD\n  subgraph Group["分组"]\n    A["A"] --> B["B"]\n  end',
    },
    false,
  );
  assert.doesNotMatch(grouped, />分组</);
  assert.match(grouped, /figure-render-warning/);
  const sequence = renderQuestionFigure(
    { kind: "mermaid", code: "sequenceDiagram\n A->>B: 请求" },
    false,
  );
  assert.match(sequence, /figure-sequence-message/);
  const state = renderQuestionFigure(
    { kind: "mermaid", code: "stateDiagram-v2\n [*] --> Idle\n Idle --> Ready : start" },
    false,
  );
  assert.match(state, /Ready/);
});

test("Markdown Mermaid 代码块保留语言标记，供阅读器增强渲染", () => {
  const html = renderMarkdown("```mermaid\nflowchart TD\n A --> B\n```");
  assert.match(html, /class="markdown-code-block"/);
  assert.match(html, /data-language="mermaid"/);
});

test("Markdown 内嵌 SVG 只保留安全的本地结构", () => {
  const html = renderMarkdown(
    [
      "<div align=\"center\">",
      "<svg viewBox=\"0 0 10 10\" onclick=\"alert(1)\" onload=\"alert(2)\">",
      "  <style>svg { fill: url(https://example.com/style) }</style>",
      "  <script>alert(1)</script>",
      "  <foreignObject><div>危险内容</div></foreignObject>",
      "  <image href=\"https://example.com/x.png\" />",
      "  <image href=\"data:image/svg+xml,evil\" />",
      "  <rect fill=\"url(https://example.com/pattern)\" />",
      "  <animate attributeName=\"href\" to=\"javascript:alert(3)\" />",
      "  <use href=\"#local-image\" />",
      "  <rect fill=\"url(#safe-pattern)\" />",
      "</svg>",
      "</div>",
    ].join("\n"),
  );
  assert.match(html, /class="markdown-svg"/);
  assert.match(html, /viewBox="0 0 10 10"/);
  assert.doesNotMatch(html, /<script|<style|<foreignObject|<image|<animate|onclick|onload|style=|example\.com|data:image|javascript:/);
  assert.match(html, /href="#local-image"/);
  assert.match(html, /fill="url\(#safe-pattern\)"/);
  assert.match(html, /href="#local-image"/);
});
