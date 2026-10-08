// 服务基类：持有依赖注入与章节/导图/题目索引等跨域共享方法。
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  chapterIds,
  findChapter,
  readMindMap,
  sectionsOfChapter,
} from "../mindmap.mjs";
import { ExamAssets } from "../exam-assets.mjs";

export class PracticeServiceBase {
  constructor({
    store,
    root = process.cwd(),
    now = () => new Date().toISOString(),
    random = Math.random,
  }) {
    this.store = store;
    this.root = root;
    this.now = now;
    this.random = random;
    this.chapters = [];
    this.seedQuestions = [];
    this.mindMap = null;
    this.assets = new ExamAssets({ root });
  }

  async init() {
    const chaptersRaw = await readFile(
      resolve(this.root, "data/chapters.json"),
      "utf8",
    );
    try {
      this.chapters = JSON.parse(chaptersRaw);
    } catch (error) {
      throw new Error(`无法解析 data/chapters.json: ${error.message}`, {
        cause: error,
      });
    }
    this.mindMap = await readMindMap(
      resolve(this.root, process.env.ARCHITECT_MINDMAP || "architect.mm"),
    );
    await this.assets.load();
  }

  allQuestions(state = this.store.snapshot()) {
    return state.generatedQuestions;
  }

  questionMap(state = this.store.snapshot()) {
    return new Map(
      this.allQuestions(state).map((question) => [question.id, question]),
    );
  }

  chapterList() {
    const questions = this.allQuestions();
    return this.chapters.map((chapter) => {
      const available = questions.filter(
        (question) =>
          question.chapter === chapter.id &&
          !question.disabledAt &&
          (question.sourceType ?? "generated") === "generated",
      );
      return {
        ...chapter,
        counts: {
          all: available.length,
          easy: available.filter((question) => question.difficulty === "easy")
            .length,
          medium: available.filter(
            (question) => question.difficulty === "medium",
          ).length,
          hard: available.filter((question) => question.difficulty === "hard")
            .length,
        },
      };
    });
  }

  async mindMapChapterNode(chapterId) {
    const mindMap = await readMindMap(
      resolve(this.root, process.env.ARCHITECT_MINDMAP || "architect.mm"),
    );
    return mindMap ? findChapter(mindMap, Number(chapterId)) : null;
  }

  async mindMapChapterIds() {
    const mindMap = await readMindMap(
      resolve(this.root, process.env.ARCHITECT_MINDMAP || "architect.mm"),
    );
    return mindMap ? chapterIds(mindMap) : new Set();
  }

  async chapterListWithSources() {
    const mappedChapters = await this.mindMapChapterIds();
    return this.chapterList().map((chapter) => ({
      ...chapter,
      source: mappedChapters.has(chapter.id) ? "mindmap" : "unavailable",
    }));
  }

  async sections(chapterId) {
    const mindMap = await readMindMap(
      resolve(this.root, process.env.ARCHITECT_MINDMAP || "architect.mm"),
    );
    const chapterNode = mindMap
      ? findChapter(mindMap, Number(chapterId))
      : null;
    if (!chapterNode) return [];
    const counts = this.allQuestions().filter(
      (question) =>
        question.chapter === Number(chapterId) &&
        !question.disabledAt &&
        (question.sourceType ?? "generated") === "generated",
    );
    return sectionsOfChapter(chapterNode, Number(chapterId)).map((section) => {
      const available = counts.filter(
        (question) => question.section === section.id,
      );
      return {
        id: section.id,
        title: section.title,
        counts: {
          all: available.length,
          easy: available.filter((question) => question.difficulty === "easy")
            .length,
          medium: available.filter(
            (question) => question.difficulty === "medium",
          ).length,
          hard: available.filter((question) => question.difficulty === "hard")
            .length,
        },
      };
    });
  }

  remainingSecondsOf(item, now = this.now()) {
    const deadline = this.deadlineAtOf(item);
    if (!deadline) return null;
    return Math.max(
      0,
      Math.round((new Date(deadline).getTime() - new Date(now).getTime()) / 1000),
    );
  }

  deadlineAtOf(item) {
    if (item?.deadlineAt) return item.deadlineAt;
    if (!item?.startedAt || !item?.durationSeconds) return null;
    const startedAt = new Date(item.startedAt).getTime();
    if (!Number.isFinite(startedAt)) return null;
    return new Date(startedAt + Number(item.durationSeconds) * 1000).toISOString();
  }

  isPastDeadline(item, now = this.now(), graceSeconds = 0) {
    const deadline = this.deadlineAtOf(item);
    if (!deadline) return false;
    return new Date(now).getTime() > new Date(deadline).getTime() + graceSeconds * 1000;
  }

  attempts() {
    return this.store.snapshot().attempts.slice(0, 100);
  }
}
