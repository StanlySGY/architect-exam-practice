import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chapterOutline, findChapter, findSection, parseFreeplane } from "../src/mindmap.mjs";

const mapFile = new URL("../architect.mm", import.meta.url);
const guideFile = new URL("../docs/agent-super-agent-architecture.md", import.meta.url);

test("11.2.4 Agent 架构拓展专题可从人工智能知识单元读取", async () => {
  const xml = await readFile(mapFile, "utf8");
  const mindmap = parseFreeplane(xml);
  const chapter = findChapter(mindmap, 11);
  const ai = findSection(chapter, "11.2");
  assert.ok(ai, "第 11 章应包含人工智能技术");
  const topic = ai.children.find((item) => item.text.startsWith("11.2.4 "));
  assert.ok(topic, "人工智能技术下应有独立的 Agent 拓展专题");
  assert.match(topic.text, /前沿拓展/);
  assert.match(topic.details, /不是.*必考术语/);
  for (const phrase of ["Router / Worker", "事件驱动", "异步执行", "计算、状态", "Watchdog"]) {
    assert.ok(
      chapterOutline(ai).includes(phrase),
      "11.2 学习大纲缺少 " + phrase,
    );
  }
});

test("Agent 拓展讲义包含考试边界、概念辨析和综合案例", async () => {
  const guide = await readFile(guideFile, "utf8");
  for (const phrase of [
    "不是考试大纲新增章节",
    "Inline / Spill",
    "Liveness",
    "幂等",
    "投机执行",
    "综合案例练习",
    "参考答题要点",
    "高风险操作",
  ]) {
    assert.ok(guide.includes(phrase), "讲义缺少 " + phrase);
  }
});
