import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED_DISPOSITIONS = new Set([
  'supported-with-scope',
  'overgeneralized',
  'internal-definition-conflict',
  'calculation-reproduced',
  'assumption-sensitive-calculation',
  'durability-bound-overstatement',
  'retired-technology-needs-context',
  'historical-case-supported-with-scope',
  'unsubstantiated-performance-claim',
  'unsupported-exam-frequency-prediction',
]);
const ALLOWED_VERIFICATIONS = new Set(['not-established', 'calculation-only']);
const COLLECTIONS = ['choices', 'cases', 'essays'];

function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(value ?? ''))) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function auditClaimEvidenceRegister(bank, register) {
  const itemsById = new Map();
  for (const collection of COLLECTIONS) {
    for (const item of bank?.[collection] ?? []) {
      if (item?.id != null) itemsById.set(String(item.id), item);
      if (collection === 'cases' && item?.id != null) {
        for (const sub of item.subQuestions ?? []) {
          itemsById.set(String(item.id) + ':' + String(sub.question_label ?? '?'), sub);
        }
      }
    }
  }

  const duplicateRecordIds = new Set();
  const seenRecordIds = new Set();
  for (const record of register?.records ?? []) {
    if (seenRecordIds.has(record.recordId)) duplicateRecordIds.add(record.recordId);
    seenRecordIds.add(record.recordId);
  }

  const recordChecks = (register?.records ?? []).map((record) => {
    const dispositionAllowed = ALLOWED_DISPOSITIONS.has(record.disposition);
    const answerVerification = record.answerVerification ?? 'not-declared';
    const answerVerificationAllowed = ALLOWED_VERIFICATIONS.has(answerVerification);
    const targetChecks = (record.targets ?? []).map((target) => {
      const item = itemsById.get(String(target.itemId));
      const fieldExists = Boolean(item && Object.hasOwn(item, target.field));
      const text = fieldExists ? String(item[target.field] ?? '') : '';
      const matched = Boolean(item && target.claimNeedle && text.includes(target.claimNeedle));
      return {
        itemId: target.itemId,
        field: target.field,
        claimNeedle: target.claimNeedle,
        targetExists: Boolean(item),
        fieldExists,
        exactTextStillPresent: matched,
      };
    });
    const sourceChecks = (record.sourceEvidence ?? []).map((source) => ({
      urlValid: /^https:\/\//u.test(String(source.url ?? '')),
      sourceMetadataComplete: Boolean(source.title && source.publisher && source.sourceKind && source.supports && source.limitations && isCalendarDate(source.checkedOn)),
      checkedOnValid: isCalendarDate(source.checkedOn),
    }));
    const targetsOk = targetChecks.length > 0 && targetChecks.every((target) => target.exactTextStillPresent);
    const sourcesOk = sourceChecks.every((source) => source.urlValid && source.sourceMetadataComplete);
    return {
      recordId: record.recordId,
      disposition: record.disposition,
      dispositionAllowed,
      targetCount: targetChecks.length,
      targetsOk,
      sourceCount: sourceChecks.length,
      sourceMetadataOk: sourcesOk,
      sourceChecks,
      targetChecks,
      answerVerification,
      answerVerificationAllowed,
    };
  });

  const allTargets = recordChecks.flatMap((record) => record.targetChecks);
  const byDisposition = {};
  for (const record of recordChecks) byDisposition[record.disposition] = (byDisposition[record.disposition] ?? 0) + 1;
  const invalidRecords = recordChecks.filter((record) => !record.dispositionAllowed || !record.answerVerificationAllowed || !record.targetsOk || !record.sourceMetadataOk || duplicateRecordIds.has(record.recordId));
  return {
    reportVersion: 1,
    readOnly: true,
    checkedOn: register?.reviewedOn ?? null,
    counts: {
      records: recordChecks.length,
      targetClaims: allTargets.length,
      exactTextTargetsMatched: allTargets.filter((target) => target.exactTextStillPresent).length,
      targetClaimsUnmatched: allTargets.filter((target) => !target.exactTextStillPresent).length,
      sourceEntries: recordChecks.reduce((sum, record) => sum + record.sourceCount, 0),
      recordsWithExternalSources: recordChecks.filter((record) => record.sourceCount > 0).length,
      recordsWithAllowedDisposition: recordChecks.filter((record) => record.dispositionAllowed).length,
      recordsWithAllowedVerification: recordChecks.filter((record) => record.answerVerificationAllowed).length,
      invalidRecords: invalidRecords.length,
      byDisposition,
    },
    note: '目标文本精确匹配只证明复核条目仍指向当前题库文本；来源元数据检查不发起网络请求，不验证 URL 可访问性、来源权威性或论断真伪。计算复算也不证明原题出处。此报告不批准、不核验整道答案，且不修改题库。',
    records: recordChecks,
  };
}

async function main() {
  const bankPath = resolve(process.argv[2] ?? '../architect-exam-bank/data/bank.json');
  const registerPath = resolve(process.argv[3] ?? 'docs/audits/bank-claim-evidence-register-2026-10-13.json');
  const outputPath = process.argv[4] ? resolve(process.argv[4]) : null;
  const [bank, register] = await Promise.all([
    readFile(bankPath, 'utf8').then(JSON.parse),
    readFile(registerPath, 'utf8').then(JSON.parse),
  ]);
  const report = { ...auditClaimEvidenceRegister(bank, register), sourcePath: relative(process.cwd(), bankPath), registerPath: relative(process.cwd(), registerPath) };
  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify({ ...report, outputPath: relative(process.cwd(), outputPath) }, null, 2) + '\n');
  }
  process.stdout.write(JSON.stringify({ ...report.counts, reportVersion: report.reportVersion, sourcePath: report.sourcePath, registerPath: report.registerPath, outputPath: outputPath ? relative(process.cwd(), outputPath) : null }, null, 2) + '\n');
  if (report.counts.invalidRecords > 0) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write('题库命题证据登记审计失败：' + error.message + '\n');
    process.exitCode = 1;
  });
}
