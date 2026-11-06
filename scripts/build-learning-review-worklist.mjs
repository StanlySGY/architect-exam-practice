import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectTemplateLikeFields } from './audit-learning-content.mjs';
import { buildVerificationQueue, validEvidenceRecords } from './audit-learning-verification-queue.mjs';
import { buildLearningUnitScope } from './learning-unit-scope.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEACHING_FIELDS = Object.freeze(['why', 'how', 'confusions', 'scenarios', 'examFocus', 'pitfalls']);
const TEMPLATE_FIELDS = Object.freeze(['why', 'how', 'confusions', 'examFocus', 'scenarios']);

function compareUnitIds(left, right) {
  return left.localeCompare(right, undefined, { numeric: true });
}

function getEvidenceMetadata(records) {
  const dates = records.map(record => record.reviewedOn).sort();
  const hosts = new Set();
  for (const record of records) {
    try {
      const url = new URL(record.url);
      if (url.protocol === 'https:') hosts.add(url.hostname.toLowerCase().replace(/^www\./u, ''));
    } catch {
      // validEvidenceRecords already filters malformed URLs.
    }
  }
  return {
    oldestEvidenceDate: dates[0] ?? null,
    newestEvidenceDate: dates.at(-1) ?? null,
    sourceHostCount: hosts.size,
  };
}

function countDistribution(values) {
  return Object.fromEntries(
    [...new Set(values)].sort((left, right) => left - right)
      .map(value => [String(value), values.filter(item => item === value).length]),
  );
}

export function buildLearningReviewWorklist(content, batchSize = 20) {
  if (!Number.isInteger(batchSize) || batchSize < 10 || batchSize > 20) {
    throw new RangeError('batchSize must be an integer between 10 and 20');
  }

  const scope = buildLearningUnitScope(content);
  const verification = buildVerificationQueue(content);
  const queueById = new Map(verification.queue.map(record => [record.id, record]));
  const candidates = [];
  const excluded = { notPartial: 0, explicitPendingClaims: 0, localPdfProvenance: 0 };

  for (const [id, unit] of scope.units) {
    if (unit?.status !== 'partial') {
      excluded.notPartial += 1;
      continue;
    }
    const queueRecord = queueById.get(id);
    if (queueRecord?.pendingClaims?.length) {
      excluded.explicitPendingClaims += 1;
      continue;
    }
    if (queueRecord?.provenanceWarning) {
      excluded.localPdfProvenance += 1;
      continue;
    }

    const evidence = validEvidenceRecords(unit);
    const templateLikeFields = detectTemplateLikeFields(unit).filter(field => TEMPLATE_FIELDS.includes(field));
    const evidenceMetadata = getEvidenceMetadata(evidence);
    const nonEmptyTeachingFieldCount = TEACHING_FIELDS
      .filter(field => String(unit?.[field] ?? '').trim()).length;
    const reviewSignals = [];
    if (templateLikeFields.length) reviewSignals.push('known template-like teaching scaffolds');
    if (evidence.length <= 1) reviewSignals.push('at most one valid claim-level evidence record');
    if (evidenceMetadata.sourceHostCount <= 1) reviewSignals.push('evidence recorded from at most one host');

    candidates.push({
      id,
      chapter: String(id).split('.')[0],
      status: unit.status,
      evidenceCount: evidence.length,
      sourceHostCount: evidenceMetadata.sourceHostCount,
      oldestEvidenceDate: evidenceMetadata.oldestEvidenceDate,
      newestEvidenceDate: evidenceMetadata.newestEvidenceDate,
      nonEmptyTeachingFieldCount,
      templateLikeFields,
      reviewSignals,
    });
  }

  candidates.sort((left, right) =>
    right.templateLikeFields.length - left.templateLikeFields.length
    || left.evidenceCount - right.evidenceCount
    || String(left.oldestEvidenceDate ?? '9999-12-31').localeCompare(String(right.oldestEvidenceDate ?? '9999-12-31'))
    || compareUnitIds(left.id, right.id));

  const batches = [];
  for (let offset = 0; offset < candidates.length; offset += batchSize) {
    const units = candidates.slice(offset, offset + batchSize);
    batches.push({
      batch: batches.length + 1,
      startRank: offset + 1,
      endRank: offset + units.length,
      unitCount: units.length,
      unitIds: units.map(unit => unit.id),
      units,
    });
  }

  return {
    reportVersion: 1,
    readOnly: true,
    wholeUnitCoverageStatus: 'not-established-by-automated-audit',
    scope: {
      sourceUnitCount: scope.sourceUnitCount,
      leafUnitCount: scope.unitCount,
      excludedUnitCount: scope.excludedUnitCount,
      partialLeafUnitCount: verification.statusDistribution.partial ?? 0,
      reviewCandidateCount: candidates.length,
      excludedReviewCandidates: excluded,
    },
    priorityOrder: [
      'template-like teaching field count descending',
      'valid claim-level evidence count ascending',
      'oldest recorded evidence review date ascending',
      'unit ID ascending (numeric-aware)',
    ],
    signals: {
      templateLikeFieldDistribution: countDistribution(candidates.map(unit => unit.templateLikeFields.length)),
      recordsWithAnyTemplateSignal: candidates.filter(unit => unit.templateLikeFields.length > 0).length,
      recordsWithFourOrMoreTemplateSignals: candidates.filter(unit => unit.templateLikeFields.length >= 4).length,
      singleEvidenceRecordCount: candidates.filter(unit => unit.evidenceCount === 1).length,
      noEvidenceRecordCount: candidates.filter(unit => unit.evidenceCount === 0).length,
      templateFieldCounts: Object.fromEntries(TEMPLATE_FIELDS.map(field => [
        field,
        candidates.filter(unit => unit.templateLikeFields.includes(field)).length,
      ])),
    },
    batchSize,
    batchCount: batches.length,
    batches,
    limitations: [
      'Template-like patterns are deterministic text heuristics; a match is a review signal, not a factual error or proof that the teaching field is unusable.',
      'Evidence counts and host counts describe recorded metadata only; they do not establish source authority, independence, correctness, or full-unit coverage.',
      'The order prioritizes a human review queue. It does not calculate a quality score, approve content, or change learning-unit status.',
      'Units with explicit pending claims or the known local-PDF provenance warning are excluded from this C-batch worklist and remain in their separate review batches.',
    ],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const batchArg = process.argv.slice(2).find(argument => argument.startsWith('--batch-size='));
  const batchSize = batchArg ? Number(batchArg.slice('--batch-size='.length)) : 20;
  const inputPath = resolve(root, 'data/learning-content.json');
  const content = JSON.parse(await readFile(inputPath, 'utf8'));
  console.log(JSON.stringify({ input: 'data/learning-content.json', ...buildLearningReviewWorklist(content, batchSize) }, null, 2));
}
