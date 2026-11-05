import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCalibration } from '../scripts/evaluate-scoring-calibration.mjs';

const metadata = {
  model: 'test-model',
  modelVersion: 'test-model-revision',
  promptVersion: 'prompt-v1',
  graderVersion: 'grader-v1',
  rubricVersion: 'rubric-v1',
  collectedAt: '2026-11-05',
};

function evaluate(samples) {
  return evaluateCalibration({ metadata, samples });
}

function essayDimensions(total) {
  const names = ['切合题意', '观点正确', '逻辑清晰', '论据充分', '语言流畅', '格式规范'];
  const maxima = [20, 20, 15, 20, 10, 15];
  const scores = maxima.slice(0, -1).map(max => Math.round(total * max / 100));
  scores.push(total - scores.reduce((sum, value) => sum + value, 0));
  return Object.fromEntries(names.map((name, index) => [name, {
    score: scores[index],
    max: maxima[index],
    comment: 'sample',
  }]));
}

function caseResults(total) {
  const first = Math.floor(total / 2);
  return [{ id: '1', score: first, max: 50 }, { id: '2', score: total - first, max: 50 }];
}

function sample(type, id, human = 80, ai = 80) {
  const run = type === 'case'
    ? { total_score: ai, max_score: 100, results: caseResults(ai) }
    : { total_score: ai, max_score: 100, dimensions: essayDimensions(ai) };
  const adjudicated = type === 'case'
    ? { total_score: human, max_score: 100, results: caseResults(human) }
    : { total_score: human, max_score: 100, dimensions: essayDimensions(human) };
  return {
    id,
    type,
    version: { rubric: 'r1', prompt: 'p1', grader: 'g1' },
    humanRatings: [
      { raterId: 'human-a', score: human, maxScore: 100 },
      { raterId: 'human-b', score: human, maxScore: 100 },
    ],
    adjudicated,
    aiRuns: [run],
  };
}

test('empty intake blocks calibration instead of inventing anchor scores', () => {
  const report = evaluate([]);
  assert.equal(report.status, 'blocked-or-insufficient-anchor-samples');
  assert.deepEqual(report.insufficient.map(item => item.type), ['case', 'essay']);
});

test('missing model identity and collection date block calibration even with scored samples', () => {
  const report = evaluateCalibration({
    metadata: { model: 'test-model' },
    samples: [sample('case', 'missing-metadata')],
  });
  assert.equal(report.status, 'blocked-or-insufficient-anchor-samples');
  assert.deepEqual(report.metadataErrors.sort(), [
    'metadata.collectedAt must be a valid YYYY-MM-DD date',
    'metadata.modelVersion is required',
  ]);
});

test('case and essay graders are evaluated independently after ten valid human-anchored samples', () => {
  const samples = [
    ...Array.from({ length: 10 }, (_, index) => sample('case', 'case-' + index, 70 + index, 70 + index)),
    ...Array.from({ length: 10 }, (_, index) => sample('essay', 'essay-' + index, 60 + index, 60 + index)),
  ];
  const report = evaluate(samples);
  assert.equal(report.status, 'exploratory-analysis-ready');
  assert.equal(report.sampleCounts.validCase, 10);
  assert.equal(report.sampleCounts.validEssay, 10);
  assert.equal(report.byType.case.pointAgreement.meanAbsoluteErrorPp, 0);
  assert.equal(report.byType.essay.pointAgreement.within5PercentagePoints, 10);
  assert.equal(report.byType.case.humanAgreement.iccA1, 1);
  assert.equal(report.byType.essay.componentMeanAbsoluteErrorPp['切合题意'], 0);
  assert.deepEqual(report.byType.case.componentMeanAbsoluteErrorPp, {}, 'per-case question IDs are not treated as shared rubric dimensions');
});

test('repeated AI runs and explicit thresholds are measured without assuming a paper pass mark', () => {
  const item = sample('case', 'repeat-case', 60, 55);
  item.passThresholdPct = 60;
  item.aiRuns.push({ total_score: 60, max_score: 100, results: caseResults(60) });
  const report = evaluate([item]);
  assert.equal(report.status, 'blocked-or-insufficient-anchor-samples');
  assert.equal(report.byType.case.passFail.thresholdedSampleCount, 1);
  assert.equal(report.byType.case.passFail.disagreementCount, 1);
  assert.ok(Math.abs(report.byType.case.repeatedAiRunVariability.meanRangePp - 5) < 1e-9);
  assert.equal(report.byType.essay.passFail.thresholdedSampleCount, 0);
});

test('invalid sample with duplicate rater identity is excluded and explained', () => {
  const item = sample('essay', 'bad-raters');
  item.humanRatings[1].raterId = item.humanRatings[0].raterId;
  const report = evaluate([item]);
  assert.equal(report.sampleCounts.rejected, 1);
  assert.match(report.rejected[0].errors.join(' '), /distinct/u);
  assert.equal(report.sampleCounts.validEssay, 0);
});

test('samples from different rubric or grader versions are not pooled', () => {
  const first = sample('essay', 'version-one');
  const second = sample('essay', 'version-two');
  second.version.rubric = 'r2';
  const report = evaluate([first, second]);
  assert.equal(report.status, 'blocked-or-insufficient-anchor-samples');
  assert.equal(report.byType.essay.analysisBlockedReason.includes('must be evaluated in separate runs'), true);
  assert.equal(report.byType.essay.versionCohorts.length, 2);
  assert.equal(report.byType.essay.pointAgreement, null);
});


test('ICC(A,1) is stable to rating entry order and matches a known absolute-agreement example', () => {
  const pairs = [[10, 20], [20, 30], [30, 40], [40, 50]];
  const samples = pairs.map(([first, second], index) => {
    const item = sample('case', 'icc-' + index, 0, 0);
    item.humanRatings = [
      { raterId: 'rater-a', score: first, maxScore: 100 },
      { raterId: 'rater-b', score: second, maxScore: 100 },
    ];
    if (index % 2) item.humanRatings.reverse();
    return item;
  });
  const report = evaluate(samples);
  const agreement = report.byType.case.humanAgreement;
  assert.equal(agreement.iccA1Status, 'computed');
  assert.ok(Math.abs(agreement.iccA1 - (10 / 13)) < 1e-12);
  assert.deepEqual(agreement.iccA1MeanSquares, { subjects: 333.3333333333333, raters: 200, residual: 0 });
});

test('ICC(A,1) is withheld when all ratings have zero variance', () => {
  const samples = Array.from({ length: 3 }, (_, index) => sample('case', 'zero-' + index, 80, 80));
  const report = evaluate(samples);
  assert.equal(report.byType.case.humanAgreement.iccA1, null);
  assert.equal(report.byType.case.humanAgreement.iccA1Status, 'undefined-zero-denominator');
});

test('ICC(A,1) is withheld when rater panel changes between samples', () => {
  const first = sample('case', 'panel-a');
  const second = sample('case', 'panel-b');
  second.humanRatings = [
    { raterId: 'rater-c', score: 80, maxScore: 100 },
    { raterId: 'rater-d', score: 80, maxScore: 100 },
  ];
  const report = evaluate([first, second]);
  assert.equal(report.byType.case.humanAgreement.iccA1, null);
  assert.equal(report.byType.case.humanAgreement.iccA1Status, 'inconsistent-rater-panel');
  assert.equal(report.byType.case.humanAgreement.raterPanelCohortCount, 2);
  assert.equal(report.byType.case.humanAgreement.meanAbsoluteRaterDifferencePp, 0);
});

test('duplicate sample IDs are rejected instead of double-counted', () => {
  const report = evaluate([sample('case', 'duplicate'), sample('case', 'duplicate')]);
  assert.equal(report.sampleCounts.validCase, 0);
  assert.equal(report.sampleCounts.rejected, 2);
  assert.ok(report.rejected.every(item => item.errors.some(error => error.includes('unique'))));
});

test('case subquestion scores and maximums must add up to their total and match across AI and adjudication', () => {
  const badTotal = sample('case', 'case-total-mismatch');
  badTotal.aiRuns[0].results[0].score += 1;
  const badMapping = sample('case', 'case-map-mismatch');
  badMapping.aiRuns[0].results[1].id = '3';
  const report = evaluate([badTotal, badMapping]);
  assert.equal(report.sampleCounts.validCase, 0);
  assert.match(report.rejected[0].errors.join(' '), /sum|total_score/u);
  assert.match(report.rejected[1].errors.join(' '), /ids\/maxima/u);
});

test('essay dimensions must be complete, use production maxima, and reconcile with total score', () => {
  const missingDimension = sample('essay', 'essay-missing-dimension');
  delete missingDimension.adjudicated.dimensions['格式规范'];
  const badSum = sample('essay', 'essay-bad-sum');
  badSum.aiRuns[0].dimensions['格式规范'].score -= 1;
  const report = evaluate([missingDimension, badSum]);
  assert.equal(report.sampleCounts.validEssay, 0);
  assert.match(report.rejected[0].errors.join(' '), /six production essay dimensions/u);
  assert.match(report.rejected[1].errors.join(' '), /sum|total_score/u);
});

test('component MAE weights samples equally rather than weighting samples by repeated AI run count', () => {
  const oneRun = sample('essay', 'one-run', 80, 80);
  oneRun.aiRuns[0].dimensions['切合题意'].score = 20;
  oneRun.aiRuns[0].dimensions['格式规范'].score = 8;
  const manyRuns = sample('essay', 'many-runs', 80, 80);
  manyRuns.aiRuns = [manyRuns.aiRuns[0], structuredClone(manyRuns.aiRuns[0]), structuredClone(manyRuns.aiRuns[0])];
  const report = evaluate([oneRun, manyRuns]);
  assert.equal(report.byType.essay.componentMeanAbsoluteErrorPp['切合题意'], 10);
  assert.equal(report.byType.essay.componentSampleCounts['切合题意'], 2);
});

test('pass/fail reports distinguish mean-score disagreement from individual AI-run disagreement', () => {
  const item = sample('case', 'threshold-runs', 60, 55);
  item.passThresholdPct = 60;
  item.aiRuns.push({ total_score: 60, max_score: 100, results: caseResults(60) });
  const report = evaluate([item]);
  assert.equal(report.byType.case.passFail.disagreementCount, 1);
  assert.equal(report.byType.case.passFail.aiRunCount, 2);
  assert.equal(report.byType.case.passFail.aiRunDisagreementCount, 1);
});

test('malformed intake container is reported and blocks calibration', () => {
  const report = evaluateCalibration({ metadata, samples: {} });
  assert.equal(report.status, 'blocked-or-insufficient-anchor-samples');
  assert.deepEqual(report.inputErrors, ['samples must be an array']);
});


test('negative ICC(A,1) is reported as a negative estimate rather than clipped to zero', () => {
  const pairs = [[100, 0], [0, 100], [100, 0], [0, 100]];
  const samples = pairs.map(([a, b], index) => {
    const item = sample('case', 'negative-' + index, 0, 0);
    item.humanRatings = [
      { raterId: 'rater-a', score: a, maxScore: 100 },
      { raterId: 'rater-b', score: b, maxScore: 100 },
    ];
    return item;
  });
  const icc = evaluate(samples).byType.case.humanAgreement.iccA1;
  assert.ok(icc < 0);
});
