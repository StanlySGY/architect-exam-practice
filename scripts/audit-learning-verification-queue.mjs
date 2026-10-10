import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function buildVerificationQueue(content) {
 const units = Object.entries(content?.units ?? {}).filter(([id, unit]) => unit?.source?.path !== "data/chapters.json" && !["4.4.2", "6.2.3", "17.2.3", "19.3.5", "19.4.4"].includes(id));
 const queue = units.map(([id, unit]) => {
  const evidence = Array.isArray(unit?.evidence) ? unit.evidence : [];
  const validEvidence = evidence.filter(item => {
   const reviewedOn = String(item?.reviewedOn ?? '');
   const validDate = /^\d{4}-\d{2}-\d{2}$/.test(reviewedOn) && !Number.isNaN(Date.parse(`${reviewedOn}T00:00:00Z`)) && new Date(`${reviewedOn}T00:00:00Z`).toISOString().slice(0, 10) === reviewedOn;
   return item && /^https:\/\//.test(String(item.url ?? '')) && String(item.supportedClaim ?? '').trim() && String(item.scope ?? '').trim() && validDate && String(item.reviewStatus ?? '').trim() && !/background-only|needs-textbook-verification|needs-review|candidate/iu.test(String(item.reviewStatus));
  });
  const pendingClaims = Array.isArray(unit?.verificationPendingClaims) ? unit.verificationPendingClaims.map(value => String(value).trim()).filter(Boolean) : [];
  const missing = [];
  if (!validEvidence.length) missing.push('no claim-level evidence record');
  for (const claim of pendingClaims) missing.push(`unresolved material claim: ${claim}`);
  if (unit?.status === 'verified' && !validEvidence.length) missing.push('verified status without valid claim-level evidence');
  const nextAction = missing.length
   ? (validEvidence.length ? 'resolve the listed material claim(s) against a direct source; keep the unit partial' : 'retrieve authoritative source and record the exact supported claim/scope')
   : 'review whether evidence covers every factual claim before upgrading status';
  return { id, status: unit?.status ?? '(missing)', chapter: String(id).split('.')[0], what: String(unit?.what ?? ''), evidenceCount: validEvidence.length, pendingClaims, missing, nextAction };
 });
 const fullyCovered = queue.filter(unit => unit.evidenceCount > 0 && unit.missing.length === 0).length;
 return {
  reportVersion: 2,
  readOnly: true,
  unitCount: units.length,
  statusDistribution: units.reduce((a, [, u]) => { const s = u?.status ?? '(missing)'; a[s] = (a[s] ?? 0) + 1; return a; }, {}),
  unitsWithClaimLevelEvidence: queue.filter(unit => unit.evidenceCount > 0).length,
  unitsWithCompleteClaimEvidence: fullyCovered,
  unitsMissingEvidence: queue.filter(unit => unit.missing.length > 0).length,
  verifiedWithoutEvidence: queue.filter(unit => unit.status === 'verified' && unit.evidenceCount === 0).map(unit => unit.id),
  queue: queue.filter(unit => unit.missing.length > 0).sort((a, b) => a.chapter.localeCompare(b.chapter, undefined, { numeric: true }) || a.id.localeCompare(b.id, undefined, { numeric: true })),
  note: 'A URL alone is not proof. A unit can have evidence for one bounded claim while other material claims remain unresolved; verificationPendingClaims keeps these units in the queue until those gaps are addressed. Partial units remain partial until all material claims are adequately reviewed.'
 };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 const file=resolve(process.argv[2] ?? resolve(root,'data/learning-content.json'));
 const content=JSON.parse(await readFile(file,'utf8'));
 console.log(JSON.stringify({sourcePath:file,...buildVerificationQueue(content)},null,2));
}
