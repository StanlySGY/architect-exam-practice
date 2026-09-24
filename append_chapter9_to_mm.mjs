import fs from 'node:fs';
const mapFile = new URL('./architect.mm', import.meta.url);
const source = fs.readFileSync(new URL('./create_freeplane_chapter9.mjs', import.meta.url), 'utf8');
const start = source.indexOf('const chapter9 = ');
const end = source.indexOf('\n\nconst selectionResult', start);
if (start < 0 || end < 0) throw new Error('Cannot locate chapter 9 data');
const chapter9 = Function(`${source.slice(start, end)}; return chapter9;`)();
let xml = fs.readFileSync(mapFile, 'utf8');
if (xml.includes('TEXT="第9章 软件可靠性基础知识"')) throw new Error('Chapter 9 already exists');
const ids = new Set([...xml.matchAll(/\bID="(ID_\d+)"/g)].map(m => m[1]));
let nextId = 1800000000;
function id() { while (ids.has(`ID_${nextId}`)) nextId++; const value=`ID_${nextId++}`; ids.add(value); return value; }
const esc = (value, attr=false) => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll(attr?'"':'\0',attr?'&quot;':'\0');
const details = value => value ? `<richcontent TYPE="DETAILS" CONTENT-TYPE="plain/auto"><html><head></head><body><p>${esc(value)}</p></body></html></richcontent>` : '';
const now = Date.now(); let count=0;
function node(item) { count++; const children=(item.children||[]).map(node).join(''); return `<node TEXT="${esc(item.text,true)}" ID="${id()}" CREATED="${now}" MODIFIED="${now}" AI_EDITS="true"${children?' FOLDED="false"':''}>${details(item.details)}${children}</node>`; }
const chapterXml=node(chapter9);
const chapter16=xml.indexOf('<node TEXT="第16章 嵌入式系统架构设计理论与实践"');
const close=xml.lastIndexOf('\n</node>\n</map>');
const insertion=chapter16>=0?chapter16:close;
if(insertion<0)throw new Error('Cannot locate insertion point');
fs.copyFileSync(mapFile,'/tmp/architect.mm.before-chapter9');
fs.writeFileSync(mapFile,xml.slice(0,insertion)+chapterXml+'\n'+xml.slice(insertion));
console.log(JSON.stringify({addedNodes:count,bytes:fs.statSync(mapFile).size}));
