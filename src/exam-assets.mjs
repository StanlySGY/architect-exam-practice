import { readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
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
    const materials = await readOptionalJson(
      resolve(this.dataDir, "study-materials.json"),
    );
    this.materials = Array.isArray(materials?.materials) ? materials.materials : [];
    this.materialsNote = String(materials?.note ?? "");
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

  studyMaterials() {
    return {
      note: this.materialsNote,
      available: this.materials.length > 0,
      materials: this.materials.map((item) => ({
        id: item.id,
        group: item.group || "other",
        groupLabel: item.groupLabel || item.group || "资料",
        title: item.title,
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
    let markdown;
    try {
      markdown = await readFile(file, "utf8");
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
      markdown,
    };
  }
}
