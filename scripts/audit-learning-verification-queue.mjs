import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLearningUnitScope } from './learning-unit-scope.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function hasValidLocalPdfProvenanceWarning(unit) {
  return unit?.textbookCrossCheck?.sourceKind === 'local-pdf-page-cross-check'
    && /^[a-f0-9]{64}$/u.test(String(unit.textbookCrossCheck.localPdfSha256 ?? ''))
    && Array.isArray(unit.textbookCrossCheck.pdfPhysicalPages)
    && Array.isArray(unit.textbookCrossCheck.printedPages)
    && /尚未获得出版社独立认证/u.test(String(unit.textbookCrossCheck.provenanceCaveat ?? ''));
}

function validEvidenceRecords(unit) {
  return (Array.isArray(unit?.evidence) ? unit.evidence : []).filter(item => {
    const reviewedOn = String(item?.reviewedOn ?? '');
    const validDate = /^\d{4}-\d{2}-\d{2}$/u.test(reviewedOn)
      && !Number.isNaN(Date.parse(`${reviewedOn}T00:00:00Z`))
      && new Date(`${reviewedOn}T00:00:00Z`).toISOString().slice(0, 10) === reviewedOn;
    return item
      && /^https:\/\//u.test(String(item.url ?? ''))
      && String(item.supportedClaim ?? '').trim()
      && String(item.scope ?? '').trim()
      && validDate
      && String(item.reviewStatus ?? '').trim()
      && !/background-only|needs-textbook-verification|needs-review|candidate/iu.test(String(item.reviewStatus));
  });
}

export function buildVerificationQueue(content) {
  const { allUnits, chapterOverviewUnits, legacyCompatibilityUnits, excludedIds, units } = buildLearningUnitScope(content);

  const records = units.map(([id, unit]) => {
    const evidence = validEvidenceRecords(unit);
    const pendingClaims = Array.isArray(unit?.verificationPendingClaims)
      ? unit.verificationPendingClaims.map(value => String(value).trim()).filter(Boolean)
      : [];
    const provenanceWarning = hasValidLocalPdfProvenanceWarning(unit);
    const missing = [];
    if (!evidence.length) missing.push('no claim-level evidence record');
    const unresolvedClaims = pendingClaims.map(claim => `unresolved material claim: ${claim}`);
    if (unit?.status === 'verified' && !evidence.length) {
      missing.push('verified status without valid claim-level evidence');
    }

    // Claim-scoped evidence cannot certify every factual statement in a unit.
    // This is a metadata gate based on the declared status, not an independent
    // proof that every factual statement in the unit has been checked.
    const passesDeclaredWholeUnitVerificationGate = unit?.status === 'verified'
      && evidence.length > 0
      && pendingClaims.length === 0
      && !provenanceWarning;
    const reviewReasons = [];
    if (unit?.status !== 'verified') reviewReasons.push(`whole-unit status is ${unit?.status ?? '(missing)'}`);
    if (provenanceWarning) reviewReasons.push('local PDF publisher provenance has not been independently authenticated');
    if (missing.length) reviewReasons.push(...missing);
    if (unresolvedClaims.length) reviewReasons.push(...unresolvedClaims);
    if (unit?.verificationReview?.status === 'ai-source-cross-check-complete' && unit.verificationReview.humanReviewRequired === true) {
      reviewReasons.push('AI source cross-check completed; independent textbook/human review still required');
    }

    let nextAction;
    if (!evidence.length) {
      nextAction = 'retrieve an authoritative source and record the exact supported claim and scope';
    } else if (pendingClaims.length && unit?.verificationReview?.status === 'ai-source-cross-check-complete') {
      nextAction = 'human-review each listed claim against the specified textbook edition and confirm its exam wording; keep the unit partial until independently approved';
    } else if (pendingClaims.length) {
      nextAction = 'resolve each listed material claim against a direct source; keep the unit partial';
    } else if (provenanceWarning) {
      nextAction = 'authenticate the local PDF copy provenance independently; keep the unit partial until then';
    } else if (!passesDeclaredWholeUnitVerificationGate) {
      nextAction = 'human-review the unit claim by claim, confirm full factual coverage and source scope, then record the reviewer decision; keep partial meanwhile';
    } else {
      nextAction = 'no further verification action is currently queued';
    }

    return {
      id,
      status: unit?.status ?? '(missing)',
      chapter: String(id).split('.')[0],
      what: String(unit?.what ?? ''),
      evidenceCount: evidence.length,
      pendingClaims,
      verificationReview: unit?.verificationReview ?? null,
      missing,
      unresolvedClaims,
      provenanceWarning,
      passesDeclaredWholeUnitVerificationGate,
      reviewReasons,
      nextAction,
    };
  });

  const localPdfCrossChecks = units.filter(([, unit]) =>
    unit?.textbookCrossCheck?.sourceKind === 'local-pdf-page-cross-check'
    && /^[a-f0-9]{64}$/u.test(String(unit.textbookCrossCheck.localPdfSha256 ?? ''))
    && Array.isArray(unit.textbookCrossCheck.pdfPhysicalPages)
    && Array.isArray(unit.textbookCrossCheck.printedPages));
  const localPdfProvenanceUnverified = localPdfCrossChecks
    .filter(([, unit]) => hasValidLocalPdfProvenanceWarning(unit))
    .map(([id]) => id);
  const queue = records
    .filter(record => !record.passesDeclaredWholeUnitVerificationGate)
    .sort((a, b) => a.chapter.localeCompare(b.chapter, undefined, { numeric: true })
      || a.id.localeCompare(b.id, undefined, { numeric: true }));
  const statusDistribution = units.reduce((counts, [, unit]) => {
    const status = unit?.status ?? '(missing)';
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});

  return {
    reportVersion: 4,
    readOnly: true,
    wholeUnitCoverageStatus: 'not-established-by-automated-audit',
    sourceUnitCount: allUnits.length,
    unitCount: units.length,
    excludedUnitCount: excludedIds.size,
    excludedUnits: {
      chapterOverview: {
        count: chapterOverviewUnits.length,
        ids: chapterOverviewUnits.map(([id]) => id),
        reason: 'navigation-only chapter overview records are not leaf learning units',
      },
      legacyCompatibilityMappings: {
        count: legacyCompatibilityUnits.length,
        ids: legacyCompatibilityUnits.map(([id]) => id),
        reason: 'legacy/parent compatibility mappings require separate source-to-topic reconciliation and are not counted as independent leaf units',
      },
    },
    statusDistribution,
    unitsWithClaimLevelEvidence: records.filter(record => record.evidenceCount > 0).length,
    unitsPassingDeclaredWholeUnitVerificationGate: records.filter(record => record.passesDeclaredWholeUnitVerificationGate).length,
    unitsAwaitingVerification: queue.length,
    // Missing source evidence and unresolved claims are different review reasons.
    // A unit can have several valid bounded sources while still needing textbook/human review.
    unitsMissingEvidence: records.filter(record => record.evidenceCount === 0).length,
    unitsWithUnresolvedClaims: records.filter(record => record.unresolvedClaims.length > 0).length,
    unitsWithSourceCrossCheck: records.filter(record => record.verificationReview?.status === 'ai-source-cross-check-complete').length,
    unitsWithSourceCrossCheckAwaitingHumanReview: records.filter(record => record.verificationReview?.status === 'ai-source-cross-check-complete' && record.verificationReview.humanReviewRequired === true).length,
    verifiedWithoutEvidence: records.filter(record => record.status === 'verified' && record.evidenceCount === 0).map(record => record.id),
    unitsWithLocalPdfCrossCheck: localPdfCrossChecks.length,
    unitsWithUnverifiedLocalPdfProvenance: localPdfProvenanceUnverified,
    queue,
    note: 'A claim-level evidence record supports only its stated claim and scope. unitsPassingDeclaredWholeUnitVerificationGate counts records whose existing status is verified and whose declared evidence/pending-claim/provenance metadata passes this script; it does not independently prove that every factual statement was checked or that the underlying human review occurred. wholeUnitCoverageStatus is therefore not-established-by-automated-audit. Partial units remain in the human verification queue. A URL or local PDF page reference alone is not proof of source authenticity or whole-unit correctness.',
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = resolve(process.argv[2] ?? resolve(root, 'data/learning-content.json'));
  const content = JSON.parse(await readFile(file, 'utf8'));
  console.log(JSON.stringify({ sourcePath: file, ...buildVerificationQueue(content) }, null, 2));
}
