import fs from 'node:fs';

const mapFile = new URL('./architect.mm', import.meta.url);
const dataFile = new URL('./create_freeplane_chapters678.mjs', import.meta.url);
const source = fs.readFileSync(dataFile, 'utf8');
const start = source.indexOf('const chapter6=');
const end = source.indexOf('\n\nconst chapters=', start);
if (start < 0 || end < 0) throw new Error('Cannot locate chapters 6-8 data');
const chapters = Function(`${source.slice(start, end)}; return [chapter6, chapter7, chapter8];`)();

let xml = fs.readFileSync(mapFile, 'utf8');
for (const chapter of chapters) {
  if (xml.includes(`TEXT="${chapter.text}"`)) throw new Error(`${chapter.text} already exists`);
}
const usedIds = new Set([...xml.matchAll(/\bID="(ID_\d+)"/g)].map(match => match[1]));
let nextId = 1700000000;
function allocateId() {
  while (usedIds.has(`ID_${nextId}`)) nextId++;
  const id = `ID_${nextId++}`;
  usedIds.add(id);
  return id;
}
const escapeXml = (value, attribute = false) => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll(attribute ? '"' : '\0', attribute ? '&quot;' : '\0');
const detailsXml = details => details
  ? `<richcontent TYPE="DETAILS" CONTENT-TYPE="plain/auto"><html><head></head><body><p>${escapeXml(details)}</p></body></html></richcontent>`
  : '';
const timestamp = Date.now();
const counts = new Map();
function nodeXml(item, chapterName) {
  counts.set(chapterName, (counts.get(chapterName) || 0) + 1);
  const children = (item.children || []).map(child => nodeXml(child, chapterName)).join('');
  const folded = children ? ' FOLDED="false"' : '';
  return `<node TEXT="${escapeXml(item.text, true)}" ID="${allocateId()}" CREATED="${timestamp}" MODIFIED="${timestamp}" AI_EDITS="true"${folded}>${detailsXml(item.details)}${children}</node>`;
}
const chapterXml = chapters.map(chapter => nodeXml(chapter, chapter.text)).join('\n');
const chapter16Start = xml.indexOf('<node TEXT="第16章 嵌入式系统架构设计理论与实践"');
const rootClose = xml.lastIndexOf('\n</node>\n</map>');
const insertion = chapter16Start >= 0 ? chapter16Start : rootClose;
if (insertion < 0) throw new Error('Cannot locate insertion point');
fs.copyFileSync(mapFile, '/tmp/architect.mm.before-chapters678');
xml = xml.slice(0, insertion) + chapterXml + '\n' + xml.slice(insertion);
fs.writeFileSync(mapFile, xml);
console.log(JSON.stringify({
  mapFile: mapFile.pathname,
  added: Object.fromEntries(counts),
  totalAdded: [...counts.values()].reduce((sum, value) => sum + value, 0),
  bytes: Buffer.byteLength(xml),
}, null, 2));
