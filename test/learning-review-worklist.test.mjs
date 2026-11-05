import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildLearningReviewWorklist } from '../scripts/build-learning-review-worklist.mjs';

const content = JSON.parse(await readFile(new URL('../data/learning-content.json', import.meta.url), 'utf8'));

const evidence = (url, reviewedOn = '2026-10-10') => ({
  url,
  supportedClaim: 'A bounded claim supported by this source.',
  scope: 'This source supports only the stated claim.',
  reviewedOn,
  reviewStatus: 'source-supports-bounded-claim',
});

test('worklist separates pending-claim and local-PDF cases from the whole-unit C batch', () => {
  const report = buildLearningReviewWorklist({ units: {
    pending: { status: 'partial', verificationPendingClaims: ['a material claim'], evidence: [evidence('https://example.org/a')] },
    pdf: {
      status: 'partial',
      verificationPendingClaims: [],
      evidence: [evidence('https://example.org/b')],
      textbookCrossCheck: {
        sourceKind: 'local-pdf-page-cross-check',
        localPdfSha256: 'a'.repeat(64),
        pdfPhysicalPages: [326],
        printedPages: [311],
        provenanceCaveat: '尚未获得出版社独立认证',
      },
    },
    candidate: { status: 'partial', verificationPendingClaims: [], evidence: [evidence('https://example.org/c')] },
    verified: { status: 'verified', evidence: [evidence('https://example.org/d')] },
  } }, 10);

  assert.equal(report.scope.reviewCandidateCount, 1);
  assert.deepEqual(report.scope.excludedReviewCandidates, {
    notPartial: 1,
    explicitPendingClaims: 1,
    localPdfProvenance: 1,
  });
  assert.deepEqual(report.batches[0].unitIds, ['candidate']);
  assert.equal(report.wholeUnitCoverageStatus, 'not-established-by-automated-audit');
});

test('worklist ranks template signals, evidence count, evidence date, then stable numeric ID', () => {
  const template = {
    why: '理解「缓存」的价值，在于减少重复读取。',
    how: '围绕「缓存」学习时，先用一句话界定概念，再整理关键机制。',
    confusions: '辨析「缓存」时，选出最容易混淆的相邻概念。',
    examFocus: '复习重点：围绕“缓存”整理定义、关键机制和边界。',
    scenarios: '情境练习（非教材原例）：围绕“缓存”设定一个系统需求。',
  };
  const report = buildLearningReviewWorklist({ units: {
    '10.2': { status: 'partial', evidence: [evidence('https://one.example/a', '2026-10-10')], ...template },
    '2.10': { status: 'partial', evidence: [evidence('https://one.example/b', '2026-10-10')], ...template },
    '2.2': { status: 'partial', evidence: [evidence('https://one.example/c', '2026-10-10')], ...template },
    '2.1': { status: 'partial', evidence: [evidence('https://one.example/d', '2026-10-12')], ...template },
    '2.3': { status: 'partial', evidence: [evidence('https://one.example/e', '2026-10-09'), evidence('https://two.example/f', '2026-10-11')], ...template },
    '2.4': { status: 'partial', evidence: [evidence('https://one.example/g', '2026-10-09')], ...template },
    plain: { status: 'partial', evidence: [evidence('https://one.example/plain')] },
  } }, 10);

  assert.deepEqual(report.batches[0].unitIds.slice(0, 4), ['2.4', '2.2', '2.10', '10.2']);
  assert.equal(report.batches[0].units[0].templateLikeFields.length, 5);
  assert.equal(report.batches[0].units.at(-1).id, 'plain');
});

test('worklist enforces 10–20 items per batch and preserves all candidate IDs exactly once', () => {
  const units = {};
  for (let index = 1; index <= 21; index += 1) {
    units['2.' + index] = { status: 'partial', evidence: [evidence('https://example.org/' + index)] };
  }
  const report = buildLearningReviewWorklist({ units }, 10);
  const flattened = report.batches.flatMap(batch => batch.unitIds);
  assert.equal(report.batchCount, 3);
  assert.deepEqual(report.batches.map(batch => batch.unitCount), [10, 10, 1]);
  assert.equal(new Set(flattened).size, 21);
  assert.equal(flattened.length, 21);
  assert.throws(() => buildLearningReviewWorklist({ units }, 9), /between 10 and 20/);
  assert.throws(() => buildLearningReviewWorklist({ units }, 21), /between 10 and 20/);
});

test('current course yields a reproducible C-batch worklist without changing unit status', () => {
  const report = buildLearningReviewWorklist(content, 20);
  assert.equal(report.scope.sourceUnitCount, 348);
  assert.equal(report.scope.leafUnitCount, 325);
  assert.equal(report.scope.partialLeafUnitCount, 322);
  assert.equal(
    report.scope.reviewCandidateCount
      + report.scope.excludedReviewCandidates.explicitPendingClaims
      + report.scope.excludedReviewCandidates.localPdfProvenance,
    322,
  );
  assert.equal(report.batches.reduce((sum, batch) => sum + batch.unitCount, 0), report.scope.reviewCandidateCount);
  assert.ok(report.batches.every(batch => batch.unitCount <= 20));
  assert.ok(report.batches.flatMap(batch => batch.units).every(unit => unit.status === 'partial'));
  assert.equal(report.wholeUnitCoverageStatus, 'not-established-by-automated-audit');
});
