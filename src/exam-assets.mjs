import { readFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { extractMermaidFigure, hasFigureReference } from "./figures.mjs";
import { defaultBankFile } from "./import-bank.mjs";

export function defaultBankDataDir(root = process.cwd()) {
  return dirname(defaultBankFile(root));
}

const jsonCache = new Map();

async function readOptionalJson(file) {
  if (jsonCache.has(file)) return jsonCache.get(file);
  const pending = readFile(file, "utf8")
    .then((text) => JSON.parse(text))
    .catch(() => null);
  jsonCache.set(file, pending);
  return pending;
}

function forbiddenPath() {
  return Object.assign(new Error("禁止访问资料路径"), {
    status: 403,
    code: "MATERIAL_PATH_FORBIDDEN",
  });
}

const MATERIAL_FORMATS = {
  ".md": { format: "markdown", mimeType: "text/markdown; charset=utf-8" },
  ".markdown": { format: "markdown", mimeType: "text/markdown; charset=utf-8" },
  ".mmd": { format: "mermaid", mimeType: "text/plain; charset=utf-8" },
  ".mermaid": { format: "mermaid", mimeType: "text/plain; charset=utf-8" },
  ".html": { format: "html", mimeType: "text/html; charset=utf-8" },
  ".htm": { format: "html", mimeType: "text/html; charset=utf-8" },
  ".svg": { format: "svg", mimeType: "image/svg+xml; charset=utf-8" },
  ".txt": { format: "text", mimeType: "text/plain; charset=utf-8" },
  ".json": { format: "text", mimeType: "application/json; charset=utf-8" },
  ".xml": { format: "text", mimeType: "application/xml; charset=utf-8" },
  ".yaml": { format: "text", mimeType: "text/yaml; charset=utf-8" },
  ".yml": { format: "text", mimeType: "text/yaml; charset=utf-8" },
};

export function materialFormat(localUrl, declaredFormat = "") {
  const explicit = String(declaredFormat || "").toLowerCase();
  if (["markdown", "mermaid", "html", "svg", "text"].includes(explicit)) {
    return explicit;
  }
  return MATERIAL_FORMATS[extname(String(localUrl || "")).toLowerCase()]?.format || "text";
}

export function materialMimeType(localUrl, declaredFormat = "") {
  const format = materialFormat(localUrl, declaredFormat);
  if (format === "markdown") return "text/markdown; charset=utf-8";
  if (format === "mermaid" || format === "text") return "text/plain; charset=utf-8";
  if (format === "html") return "text/html; charset=utf-8";
  if (format === "svg") return "image/svg+xml; charset=utf-8";
  return "text/plain; charset=utf-8";
}

export function confinedMaterialPath(dataDir, localUrl) {
  const materialsRoot = resolve(dataDir, "study-materials");
  const raw = String(localUrl || "");
  if (!raw || raw.includes("\0")) throw forbiddenPath();
  let relative = raw.replace(/^\.\//, "").replace(/^data\/study-materials\/?/, "");
  try {
    relative = decodeURIComponent(relative);
  } catch {
    throw forbiddenPath();
  }
  if (
    !relative ||
    relative.startsWith("/") ||
    relative.startsWith("\\") ||
    /^[a-zA-Z]:/.test(relative) ||
    relative.includes("\0") ||
    relative.split(/[\\/]/).includes("..")
  ) {
    throw forbiddenPath();
  }
  const file = resolve(materialsRoot, relative);
  const rootWithSep = materialsRoot.endsWith(sep) ? materialsRoot : `${materialsRoot}${sep}`;
  if (file !== materialsRoot && !file.startsWith(rootWithSep)) throw forbiddenPath();
  return file;
}

function explanationMap(raw) {
  const entries = raw?.explanations;
  return entries && typeof entries === "object" && !Array.isArray(entries)
    ? new Map(Object.entries(entries))
    : new Map();
}

export class ExamAssets {
  constructor({ root = process.cwd(), dataDir } = {}) {
    this.root = root;
    this.dataDir = dataDir || defaultBankDataDir(root);
    this.figures = new Map();
    this.choiceExplanations = new Map();
    this.caseExplanations = new Map();
    this.essaySamples = new Map();
    this.materials = [];
    this.materialsNote = "";
    this.loaded = false;
  }

  async load() {
    const figures = await readOptionalJson(resolve(this.dataDir, "figures.json"));
    this.figures = new Map(Object.entries(figures?.figures ?? {}));
    this.choiceExplanations = explanationMap(
      await readOptionalJson(resolve(this.dataDir, "ai-explanations.json")),
    );
    this.caseExplanations = explanationMap(
      await readOptionalJson(resolve(this.dataDir, "ai-case-explanations.json")),
    );
    const essaySamples = await readOptionalJson(
      resolve(this.dataDir, "ai-essay-samples.json"),
    );
    this.essaySamples = new Map(Object.entries(essaySamples?.samples ?? {}));
    const materials = await readOptionalJson(
      resolve(this.dataDir, "study-materials.json"),
    );
    this.materials = Array.isArray(materials?.materials) ? materials.materials : [];
    const sourceNote = String(materials?.note ?? "").trim();
    this.materialsNote = [
      sourceNote,
      "资料是第三方同步副本，不等同于出版社原始电子版；正文中的 Mermaid 和 SVG 均属于结构化重绘或转录，图形布局、文字和连线应以页面标注的来源为准。",
    ]
      .filter(Boolean)
      .join(" ");
    this.loaded = true;
  }

  attachChoice(question) {
    if (!question) return question;
    const extracted = extractMermaidFigure(question.question);
    const stored = this.figures.get(question.id) || null;
    const figure = stored || extracted.figure || null;
    const ai = this.choiceExplanations.get(question.id);
    const aiAnalysis =
      typeof ai?.content === "string" && ai.content.trim() ? ai.content : null;
    return {
      ...question,
      question: extracted.stem,
      figure,
      figureMissing: !figure && hasFigureReference(extracted.stem),
      aiAnalysis,
    };
  }

  attachCase(caseItem) {
    if (!caseItem) return caseItem;
    const ai = this.caseExplanations.get(caseItem.id);
    const aiExplanation =
      typeof ai?.content === "string" && ai.content.trim() ? ai.content : null;
    return { ...caseItem, aiExplanation };
  }

  // 论文 AI 参考范文：按题目 id 挂载，供阅读学习结构，不代表官方范文。
  attachPaper(paper) {
    if (!paper) return paper;
    const sample = this.essaySamples.get(paper.id) ?? null;
    const aiSample =
      sample && typeof sample.content === "string" && sample.content.trim()
        ? {
            content: sample.content.trim(),
            generatedAt: sample.generatedAt ?? null,
            model: sample.model ?? null,
            note: sample.note ?? "AI 参考范文（非官方），仅供学习论文结构与写法。",
          }
        : null;
    return { ...paper, aiSample };
  }

  studyMaterials() {
    return {
      note: this.materialsNote,
      available: this.materials.length > 0,
      materials: this.materials.map((item) => ({
        id: item.id,
        group: item.group || "other",
        groupLabel: item.groupLabel || item.group || "资料",
        title: item.title,
        format: materialFormat(item.localUrl, item.format),
        mimeType: materialMimeType(item.localUrl, item.format),
        charCount: item.charCount ?? null,
        sourceUrl: item.sourceUrl || null,
      })),
    };
  }

  async studyMaterial(id) {
    const item = this.materials.find((entry) => entry.id === String(id || ""));
    if (!item) {
      throw Object.assign(new Error("资料不存在"), {
        status: 404,
        code: "MATERIAL_NOT_FOUND",
      });
    }
    const file = confinedMaterialPath(this.dataDir, item.localUrl);
    let content;
    try {
      content = await readFile(file, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        throw Object.assign(new Error("资料正文不存在"), {
          status: 404,
          code: "MATERIAL_FILE_MISSING",
        });
      }
      throw error;
    }
    return {
      id: item.id,
      group: item.group || "other",
      groupLabel: item.groupLabel || item.group || "资料",
      title: item.title,
      sourceUrl: item.sourceUrl || null,
      format: materialFormat(item.localUrl, item.format),
      mimeType: materialMimeType(item.localUrl, item.format),
      content,
      // 保留旧字段，已有客户端仍可按 Markdown 资料读取。
      markdown: content,
    };
  }
}
