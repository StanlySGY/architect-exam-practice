import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function buildVerificationQueue(content) {
 const units = Object.entries(content?.units ?? {}).filter(([id, unit]) => unit?.source?.path !== "data/chapters.json" && !["4.4.2", "6.2.3", "17.2.3", "19.3.5", "19.4.4"].includes(id));
 const queue = units.map(([id, unit]) => {
  const evidence = Array.isArray(unit?.evidence) ? unit.evidence : [];
  const validEvidence = evidence.filter(item => item && /^https:\/\//.test(String(item.url ?? '')) && String(item.supportedClaim ?? '').trim() && String(item.scope ?? '').trim() && String(item.reviewedOn ?? '').trim() && String(item.reviewStatus ?? '').trim() && !/background-only|needs-textbook-verification|needs-review|candidate/iu.test(String(item.reviewStatus)));
  const missing = [];
  if (!validEvidence.length) missing.push('no claim-level evidence record');
  if (!validEvidence.length && (!unit?.source?.path || !String(unit.source.path).startsWith('https://'))) missing.push('no directly clickable external source path');
  if (unit?.status === 'verified' && !validEvidence.length) missing.push('verified status without valid claim-level evidence');
  return { id, status: unit?.status ?? '(missing)', chapter: String(id).split('.')[0], what: String(unit?.what ?? ''), evidenceCount: validEvidence.length, missing, nextAction: missing.length ? 'retrieve authoritative source and record exact supported claim/scope' : 'review whether evidence covers every factual claim before upgrading status' };
 });
 return { reportVersion: 1, readOnly: true, unitCount: units.length, statusDistribution: units.reduce((a,[,u]) => { const s=u?.status ?? '(missing)'; a[s]=(a[s]??0)+1; return a; }, {}), unitsWithClaimLevelEvidence: queue.filter(x=>x.evidenceCount>0).length, unitsMissingEvidence: queue.filter(x=>x.missing.length>0).length, verifiedWithoutEvidence: queue.filter(x=>x.status==='verified'&&x.evidenceCount===0).map(x=>x.id), queue: queue.filter(x=>x.missing.length>0).sort((a,b)=>a.chapter.localeCompare(b.chapter,undefined,{numeric:true})||a.id.localeCompare(b.id,undefined,{numeric:true})), note: 'A URL alone is not proof; evidence must identify the exact supported claim and scope. Partial units remain partial until all material claims are adequately reviewed.' };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 const file=resolve(process.argv[2] ?? resolve(root,'data/learning-content.json'));
 const content=JSON.parse(await readFile(file,'utf8'));
 console.log(JSON.stringify({sourcePath:file,...buildVerificationQueue(content)},null,2));
}
