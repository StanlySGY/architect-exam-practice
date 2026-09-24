import { readFile } from "node:fs/promises";

function decodeXml(value = "") {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#([0-9]+);/g, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function attribute(tag, name) {
  const attributes = [...tag.matchAll(/\b([A-Za-z_:][\w:.-]*)="([^"]*)"/g)];
  const match = attributes.find((item) => item[1] === name);
  return match ? decodeXml(match[2]) : "";
}

function richText(xml) {
  const withBreaks = xml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n");
  return decodeXml(withBreaks.replace(/<[^>]+>/g, ""))
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export function parseFreeplane(xml) {
  const documentRoot = { text: "", details: "", children: [] };
  const stack = [documentRoot];
  const tokens =
    xml.match(
      /<richcontent\b[^>]*\/>|<richcontent\b[^>]*>[\s\S]*?<\/richcontent>|<node\b[^>]*\/?>|<\/node>/gi,
    ) ?? [];
  for (const token of tokens) {
    if (/^<node\b/i.test(token)) {
      const node = {
        text: attribute(token, "TEXT"),
        details: "",
        children: [],
      };
      stack.at(-1).children.push(node);
      if (!/\/>$/.test(token)) stack.push(node);
      continue;
    }
    if (/^<\/node/i.test(token)) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (
      /^<richcontent\b/i.test(token) &&
      ["DETAILS", "NOTE"].includes(attribute(token, "TYPE")) &&
      stack.length > 1
    ) {
      const text = richText(token);
      const current = stack.at(-1);
      current.details = current.details ? `${current.details}\n${text}` : text;
    }
  }
  return documentRoot.children[0] ?? documentRoot;
}

function visit(node, callback) {
  callback(node);
  for (const child of node.children) visit(child, callback);
}

function chapterNumber(text) {
  const match = text.trim().match(/^第\s*(\d+)\s*章(?:\s|$)/);
  return match ? Number(match[1]) : null;
}

function sectionNumber(text) {
  const match = text.trim().match(/^(\d+\.\d+)(?:\s|$)/);
  return match ? match[1] : null;
}

export function findChapter(root, chapterId) {
  let found = null;
  visit(root, (node) => {
    if (!found && chapterNumber(node.text) === Number(chapterId)) found = node;
  });
  return found;
}

export function findSection(chapterNode, sectionId) {
  if (!chapterNode || !sectionId) return null;
  return (
    chapterNode.children.find(
      (node) => sectionNumber(node.text) === String(sectionId),
    ) ?? null
  );
}

export function sectionsOfChapter(chapterNode, chapterId) {
  if (!chapterNode) return [];
  return chapterNode.children
    .filter((node) => {
      const sectionId = sectionNumber(node.text);
      return sectionId?.startsWith(`${chapterId}.`);
    })
    .map((node) => ({
      id: sectionNumber(node.text) ?? node.text.trim(),
      title: node.text.trim(),
      details: node.details,
    }));
}

export function chapterIds(root) {
  const ids = new Set();
  visit(root, (node) => {
    const match = chapterNumber(node.text);
    if (match) ids.add(match);
  });
  return ids;
}

// 返回从根到目标节点的标题路径，例如 ["第1章 绪论", "1.1 系统架构的概念", "架构风格"]。
// 找不到时返回 null。用于给题目标注来源节点，便于回溯核对导图内容。
export function nodePath(root, targetText) {
  const normalized = normalizeNodeText(targetText);
  if (!normalized) return null;
  let found = null;
  const walk = (node, path) => {
    if (found) return;
    const next = [...path, node.text];
    if (normalizeNodeText(node.text) === normalized) {
      found = next;
      return;
    }
    for (const child of node.children) walk(child, next);
  };
  walk(root, []);
  return found;
}

function normalizeNodeText(value = "") {
  return String(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function outline(node, depth, lines) {
  const marker = "#".repeat(Math.min(depth + 1, 6));
  lines.push(`${marker} ${node.text}`);
  if (node.details) lines.push(node.details);
  for (const child of node.children) outline(child, depth + 1, lines);
}

export function chapterOutline(chapterNode) {
  const lines = [];
  outline(chapterNode, 0, lines);
  return lines.join("\n\n");
}

export async function readMindMap(file) {
  let xml;
  try {
    xml = await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  return parseFreeplane(xml);
}
