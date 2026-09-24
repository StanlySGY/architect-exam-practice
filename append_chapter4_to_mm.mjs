import fs from 'node:fs';

const mapFile = new URL('./architect.mm', import.meta.url);
const source = fs.readFileSync(new URL('./create_freeplane_chapter4.mjs', import.meta.url), 'utf8');
const start = source.indexOf('const branches = ');
const end = source.indexOf('\n\nconst selectionResult', start);
if (start < 0 || end < 0) throw new Error('Cannot locate chapter data in source script');
const branches = Function(`${source.slice(start, end)}; return branches;`)();
const xmlEscape = (value, attribute = false) => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll(attribute ? '"' : '\0', attribute ? '&quot;' : '\0');
const detailsXml = (details) => details ? `<richcontent TYPE="DETAILS" CONTENT-TYPE="plain/auto"><html><head></head><body><p>${xmlEscape(details)}</p></body></html></richcontent>` : '';
let nextId = 2100000000;
const now = Date.now();
let count = 0;
function nodeXml(item) {
  const id = `ID_${nextId++}`;
  count++;
  const children = (item.children || []).map(child => nodeXml(child)).join('');
  const folded = children ? ' FOLDED="false"' : '';
  return `<node TEXT="${xmlEscape(item.text, true)}" ID="${id}" CREATED="${now}" MODIFIED="${now}" AI_EDITS="true"${folded}>${detailsXml(item.details)}${children}</node>`;
}

const chapter = {
  text: '第4章 信息安全技术基础知识',
  details: '依据《系统架构设计师教程（第2版）》第4章（145-174页）整理：信息安全基础、保障框架、密码与密钥、访问控制、数字签名、抗攻击技术和风险评估。',
  children: branches,
};
const chapterXml = nodeXml(chapter);
let xml = fs.readFileSync(mapFile, 'utf8');
if (xml.includes('第4章 信息安全技术基础知识')) throw new Error('Chapter 4 already exists in map');
const close = '\n</node>\n</map>';
const insertion = xml.lastIndexOf(close);
if (insertion < 0) throw new Error('Cannot locate root closing tag');
fs.copyFileSync(mapFile, '/tmp/architect.mm.before-chapter4');
xml = xml.slice(0, insertion) + '\n' + chapterXml + xml.slice(insertion);
fs.writeFileSync(mapFile, xml);
console.log(JSON.stringify({ mapFile: mapFile.pathname, addedNodes: count, bytes: Buffer.byteLength(xml) }));
