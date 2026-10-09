import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fields = ["why", "how", "confusions", "scenarios", "examFocus", "pitfalls"];
const knownTemplateTails = {
  how: "学习时请把上述机制与本单元的适用条件、关键约束和代价对应起来；涉及精确结论时回查来源。",
  confusions: "辨析时围绕本单元的核心概念与适用条件，明确相邻术语的区别；缺乏证据的结论保留待核验。",
};

export function auditLearningContent(content) {
  const units = Object.entries(content?.units ?? {});
  const duplicateFields = {};
  for (const field of fields) {
    const groups = new Map();
    for (const [id, unit] of units) {
      const value = String(unit?.[field] ?? "").replace(/\s+/g, " ").trim();
      if (!value) continue;
      if (!groups.has(value)) groups.set(value, []);
      groups.get(value).push(id);
    }
    const duplicates = [...groups.entries()]
      .filter(([, ids]) => ids.length > 1)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([text, ids]) => ({ count: ids.length, unitIds: ids, text: text.slice(0, 220) }));
    duplicateFields[field] = {
      groups: duplicates.length,
      unitsInDuplicateGroups: duplicates.reduce((sum, group) => sum + group.count, 0),
      largestGroups: duplicates.slice(0, 10),
    };
  }
  const templateTailOccurrences = {};
  for (const [field, tail] of Object.entries(knownTemplateTails)) {
    templateTailOccurrences[field] = units.filter(([, unit]) => String(unit?.[field] ?? "").trimEnd().endsWith(tail)).map(([id]) => id);
  }
  const statuses = {};
  for (const [, unit] of units) statuses[unit.status ?? "(missing)"] = (statuses[unit.status ?? "(missing)"] ?? 0) + 1;
  return {
    reportVersion: 1,
    readOnly: true,
    unitCount: units.length,
    statusDistribution: statuses,
    duplicateFields,
    knownTemplateTailOccurrences: Object.fromEntries(Object.entries(templateTailOccurrences).map(([field, ids]) => [field, { count: ids.length, unitIds: ids.slice(0, 30) }])),
    note: "重复检测只按规范化后的全文完全一致识别；不同措辞可能仍重复表达同一知识点。报告不判断事实正确性，不修改源数据。",
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = resolve(process.argv[2] ?? resolve(root, "data/learning-content.json"));
  const content = JSON.parse(await readFile(path, "utf8"));
  console.log(JSON.stringify({ sourcePath: path, ...auditLearningContent(content) }, null, 2));
}
