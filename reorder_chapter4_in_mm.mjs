import fs from 'node:fs';

const mapFile = new URL('./ruankao.mm', import.meta.url);
let xml = fs.readFileSync(mapFile, 'utf8');
const chapter4Start = xml.lastIndexOf('<node TEXT="第4章 信息安全技术基础知识"');
const rootClose = xml.lastIndexOf('\n</node>\n</map>');
const chapter5Start = xml.indexOf('<node TEXT="第5章 软件工程基础知识"');
if (chapter4Start < 0 || rootClose < 0 || chapter5Start < 0) throw new Error('Cannot locate required chapter boundaries');
if (chapter4Start < chapter5Start) {
  console.log('Chapter 4 is already before chapter 5');
  process.exit(0);
}
const chapter4Xml = xml.slice(chapter4Start, rootClose);
xml = xml.slice(0, chapter4Start) + xml.slice(rootClose);
const newChapter5Start = xml.indexOf('<node TEXT="第5章 软件工程基础知识"');
xml = xml.slice(0, newChapter5Start) + chapter4Xml + '\n' + xml.slice(newChapter5Start);
fs.copyFileSync(mapFile, '/tmp/ruankao.mm.before-chapter4-reorder');
fs.writeFileSync(mapFile, xml);
console.log('Moved chapter 4 before chapter 5');
