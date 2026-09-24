const defaultEssayTemplate = {
  targetChars: 2800,
  sections: [
    { title: "摘要", minChars: 300, maxChars: 400 },
    { title: "正文", minChars: 2000, maxChars: 3000 },
  ],
};

const projectNarration =
  /(?:我|本人)(?:在|参与|担任|作为|(?:全面)?负责|主导|承担|组织|设计|制定|完成)/;

export function getEssaySampleTemplate() {
  return {
    targetChars: defaultEssayTemplate.targetChars,
    sections: defaultEssayTemplate.sections.map((section) => ({ ...section })),
  };
}

export function validateEssaySample(_essay, content) {
  const text = normalizeEssayText(content);
  const template = getEssaySampleTemplate();
  const errors = [];
  const warnings = [];
  if (!text) {
    return { valid: false, text, template, sections: [], charCount: 0, errors: ["内容为空"], warnings };
  }
  if (text.includes("�")) errors.push("包含损坏字符");
  const summaryHeadings = findEssayHeadings(text, "摘要");
  const explicitBodyHeadings = findEssayHeadings(text, "正文");
  if (summaryHeadings.length !== 1) errors.push("章节“摘要”必须独占一行且仅出现一次");
  if (explicitBodyHeadings.length > 1) errors.push("章节“正文”只能出现一次");

  const summaryHeading = summaryHeadings[0];
  let bodyHeading = explicitBodyHeadings[0]
    ? { match: explicitBodyHeadings[0], explicit: true }
    : null;
  if (!bodyHeading && summaryHeading) {
    bodyHeading = findEssayBodyHeading(text, summaryHeading.index + summaryHeading[0].length);
  }
  if (!bodyHeading) errors.push("摘要后必须另起正文，或以正文一级标题开始");
  if (summaryHeading && bodyHeading) {
    if (summaryHeading.index !== 0) {
      errors.push("范文必须从“摘要”标题开始，前面不能有额外文字");
    }
    if (bodyHeading.match.index <= summaryHeading.index) errors.push("正文必须位于摘要之后");
  }

  const sections =
    summaryHeading && bodyHeading && bodyHeading.match.index > summaryHeading.index
      ? [
          {
            title: "摘要",
            content: text
              .slice(summaryHeading.index + summaryHeading[0].length, bodyHeading.match.index)
              .trim(),
          },
          {
            title: "正文",
            content: text
              .slice(
                bodyHeading.match.index +
                  (bodyHeading.explicit ? bodyHeading.match[0].length : 0),
              )
              .trim(),
          },
        ].map((section) => ({
          ...section,
          charCount: countEssayCharacters(section.content),
        }))
      : [];
  const body = sections.find((section) => section.title === "正文")?.content || text;
  if (!projectNarration.test(body)) errors.push("正文缺少第一人称的项目角色与职责叙述");
  if (sections.length === template.sections.length) {
    for (const [index, section] of sections.entries()) {
      const requirement = template.sections[index];
      if (section.charCount < requirement.minChars || section.charCount > requirement.maxChars) {
        const message = `章节“${section.title}”字数为 ${section.charCount}，建议 ${requirement.minChars}-${requirement.maxChars}`;
        if (isWithinEssayCountTolerance(section.charCount, requirement.minChars, requirement.maxChars)) {
          warnings.push(message);
        } else errors.push(message);
      }
    }
  }
  const charCount =
    sections.length === template.sections.length
      ? sections.reduce((total, section) => total + section.charCount, 0)
      : countEssayCharacters(text);
  const minChars = template.sections.reduce((total, section) => total + section.minChars, 0);
  const maxChars = template.sections.reduce((total, section) => total + section.maxChars, 0);
  if (charCount < minChars || charCount > maxChars) {
    const message = `总字数为 ${charCount}，建议约 ${template.targetChars} 字（${minChars}-${maxChars}）`;
    if (isWithinEssayCountTolerance(charCount, minChars, maxChars)) warnings.push(message);
    else errors.push(message);
  }
  return { valid: errors.length === 0, text, template, sections, charCount, errors, warnings };
}

function findEssayHeadings(text, title) {
  const pattern = new RegExp(`^${escapeRegExp(title)}\\s*$`, "gm");
  return Array.from(text.matchAll(pattern));
}

function findEssayBodyHeading(text, start) {
  const pattern =
    /^(?:正文第[一二三四五六七八九十]+章[：:].*|[一二三四五六七八九十]+、.+|第[一二三四五六七八九十]+章[：:].*|\d+[.、].+)$/gm;
  const match = Array.from(text.matchAll(pattern)).find((item) => item.index > start);
  return match ? { match, explicit: false } : null;
}

function countEssayCharacters(text) {
  return Array.from(String(text || "").replace(/\s/g, "")).length;
}

function isWithinEssayCountTolerance(count, minChars, maxChars) {
  const tolerance = Math.max(8, Math.ceil(minChars * 0.1));
  return count >= Math.max(0, minChars - tolerance) && count <= maxChars + tolerance;
}

function normalizeEssayText(value) {
  return String(value || "")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll("\\n", "\n")
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
