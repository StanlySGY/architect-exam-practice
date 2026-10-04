const blockStart = /^(?:#{1,6}\s|```|[-*+]\s+|\d+\.\s+|>\s?|---+$|\||<svg\b|<div\b)/i;
const safeSvgElements = new Set([
  "svg",
  "title",
  "desc",
  "defs",
  "pattern",
  "path",
  "g",
  "rect",
  "line",
  "text",
  "tspan",
  "use",
  "circle",
  "ellipse",
  "polygon",
  "polyline",
]);
const safeSvgAttributes = new Set([
  "xmlns",
  "xmlns:xlink",
  "viewbox",
  "width",
  "height",
  "id",
  "class",
  "role",
  "aria-labelledby",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "d",
  "points",
  "fill",
  "fill-rule",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "text-anchor",
  "font-family",
  "font-size",
  "font-weight",
  "dominant-baseline",
  "alignment-baseline",
  "transform",
  "preserveaspectratio",
  "patternunits",
  "patterncontentunits",
  "patterntransform",
  "clip-path",
  "clip-rule",
  "vector-effect",
  "href",
  "xlink:href",
]);

export function renderMarkdown(value, baseUrl = "") {
  const lines = String(value ?? "")
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const blocks = [];
  for (let index = 0; index < lines.length; ) {
    if (!lines[index].trim()) {
      index += 1;
      continue;
    }
    const block = readBlock(lines, index, baseUrl);
    blocks.push(block.html);
    index = block.next;
  }
  return blocks.join("");
}

function readBlock(lines, index, baseUrl) {
  const line = lines[index];
  if (/^```/.test(line)) return readCodeBlock(lines, index);
  if (isSvgBlockStart(lines, index)) return readSvgBlock(lines, index);
  if (/^\|/.test(line) && isTableSeparator(lines[index + 1]))
    return readTable(lines, index, baseUrl);
  if (/^(#{1,6})\s+/.test(line)) return readHeading(line, index, baseUrl);
  if (/^[-*+]\s+/.test(line)) return readList(lines, index, baseUrl, "ul");
  if (/^\d+\.\s+/.test(line)) return readList(lines, index, baseUrl, "ol");
  if (/^>\s?/.test(line)) return readQuote(lines, index, baseUrl);
  if (/^---+$/.test(line.trim())) return { html: "<hr />", next: index + 1 };
  return readParagraph(lines, index, baseUrl);
}

function isSvgBlockStart(lines, index) {
  const line = String(lines[index] || "").trim();
  if (/^<svg\b/i.test(line)) return true;
  return (
    /^<div\b[^>]*>\s*$/i.test(line) &&
    /^\s*<svg\b/i.test(String(lines[index + 1] || ""))
  );
}

function readSvgBlock(lines, index) {
  let next = index;
  const wrapper = /^<div\b[^>]*>\s*$/i.test(String(lines[next] || "").trim());
  if (wrapper) next += 1;
  const body = [];
  let closed = false;
  while (next < lines.length) {
    body.push(lines[next]);
    if (/<\/svg\s*>/i.test(lines[next])) {
      next += 1;
      closed = true;
      break;
    }
    next += 1;
  }
  if (wrapper && closed && /^\s*<\/div>\s*$/i.test(String(lines[next] || ""))) next += 1;
  const source = body.join("\n");
  const svg = closed ? sanitizeSvg(source) : "";
  if (!svg) {
    return {
      html: `<pre class="markdown-code-block"><code>${escapeHtml(source)}</code></pre>`,
      next,
    };
  }
  return {
    html: `<figure class="markdown-svg" role="img">${svg}</figure>`,
    next,
  };
}

// 教材 SVG 只保留绘图所需标签和属性，避免执行脚本或加载外部资源。
function sanitizeSvg(value) {
  let svg = String(value || "").trim();
  if (!/^<svg\b/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) return "";
  svg = svg
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, "")
    .replace(/<(?:animate|animateMotion|animateTransform|set)\b[^>]*>[\s\S]*?<\/(?:animate|animateMotion|animateTransform|set)\s*>/gi, "")
    .replace(/<\/?([a-z][\w:-]*)\b[^>]*>/gi, (tag, rawName) => {
      const name = rawName.toLowerCase();
      if (!safeSvgElements.has(name)) return "";
      if (tag.startsWith("</")) return `</${name}>`;
      const attributes = [];
      const attributePattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
      for (const match of tag.matchAll(attributePattern)) {
        const attribute = match[1].toLowerCase();
        const attributeValue = match[2] ?? match[3] ?? match[4] ?? "";
        if (!safeSvgAttributes.has(attribute)) continue;
        if (
          (attribute === "href" || attribute === "xlink:href") &&
          !attributeValue.trim().startsWith("#")
        ) continue;
        if (/url\(/i.test(attributeValue) && !/^url\(\s*['"]?#[-\w:.]+['"]?\s*\)$/i.test(attributeValue))
          continue;
        if (/javascript:|data:/i.test(attributeValue)) continue;
        attributes.push(`${match[1]}="${escapeHtml(attributeValue)}"`);
      }
      const selfClosing = /\/>$/.test(tag);
      return `<${name}${attributes.length ? ` ${attributes.join(" ")}` : ""}${selfClosing ? " />" : ">"}`;
    });
  return /<svg\b/i.test(svg) && /<\/svg>\s*$/i.test(svg) ? svg : "";
}

function readCodeBlock(lines, index) {
  const language = lines[index].slice(3).trim();
  const body = [];
  let next = index + 1;
  while (next < lines.length && !/^```/.test(lines[next])) body.push(lines[next++]);
  return {
    html: `<pre class="markdown-code-block"><code${language ? ` data-language="${escapeHtml(language)}"` : ""}>${escapeHtml(body.join("\n"))}</code></pre>`,
    next: next < lines.length ? next + 1 : next,
  };
}

function readTable(lines, index, baseUrl) {
  const rows = [splitTableRow(lines[index])];
  let next = index + 2;
  while (next < lines.length && /^\|/.test(lines[next])) rows.push(splitTableRow(lines[next++]));
  const header = rows
    .shift()
    .map((cell) => `<th>${renderInline(cell, baseUrl)}</th>`)
    .join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${renderInline(cell, baseUrl)}</td>`).join("")}</tr>`,
    )
    .join("");
  return {
    html: `<div class="table-wrap"><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>`,
    next,
  };
}

function readHeading(line, index, baseUrl) {
  const match = /^(#{1,6})\s+(.+)$/.exec(line);
  const level = match[1].length;
  return {
    html: `<h${level}>${renderInline(match[2], baseUrl)}</h${level}>`,
    next: index + 1,
  };
}

function readList(lines, index, baseUrl, tag) {
  const pattern = tag === "ul" ? /^[-*+]\s+(.+)$/ : /^\d+\.\s+(.+)$/;
  const items = [];
  let next = index;
  while (next < lines.length) {
    const match = pattern.exec(lines[next]);
    if (!match) break;
    items.push(`<li>${renderInline(match[1], baseUrl)}</li>`);
    next += 1;
  }
  return { html: `<${tag}>${items.join("")}</${tag}>`, next };
}

function readQuote(lines, index, baseUrl) {
  const body = [];
  let next = index;
  while (next < lines.length && /^>\s?/.test(lines[next]))
    body.push(lines[next++].replace(/^>\s?/, ""));
  return {
    html: `<blockquote>${body.map((line) => renderInline(line, baseUrl)).join("<br />")}</blockquote>`,
    next,
  };
}

function readParagraph(lines, index, baseUrl) {
  const body = [];
  let next = index;
  while (
    next < lines.length &&
    lines[next].trim() &&
    (next === index || !blockStart.test(lines[next]))
  ) {
    body.push(lines[next++]);
  }
  return {
    html: `<p>${body.map((line) => renderInline(line, baseUrl)).join("<br />")}</p>`,
    next,
  };
}

function isTableSeparator(line) {
  return /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/.test(String(line || ""));
}

function splitTableRow(line) {
  return line
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderInline(value, baseUrl) {
  let text = escapeHtml(value);
  text = text.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g,
    (_, alt, href) => {
      const url = safeUrl(href.replaceAll("&amp;", "&"), baseUrl);
      return url
        ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy" />`
        : alt;
    },
  );
  text = text.replace(
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g,
    (_, label, href) => {
      const url = safeUrl(href.replaceAll("&amp;", "&"), baseUrl);
      return url
        ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${label}</a>`
        : label;
    },
  );
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
}

function safeUrl(value, baseUrl) {
  try {
    const url = new URL(value, baseUrl || "https://example.invalid/");
    if (url.protocol === "https:") return url.href;
    const base = baseUrl ? new URL(baseUrl) : null;
    return url.protocol === "http:" && url.origin === base?.origin ? url.href : "";
  } catch {
    return "";
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
