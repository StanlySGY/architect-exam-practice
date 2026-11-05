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

function sample(type, id, human = 80, ai = 80) {
  const run = type === 'case'
    ? { total_score: ai, max_score: 100, results: [{ id: '1', score: ai / 2, max: 50 }] }
    : { total_score: ai, max_score: 100, dimensions: essayDimensions(ai) };
  const adjudicated = type === 'case'
    ? { score: human, maxScore: 100, results: [{ id: '1', score: human / 2, max: 50 }] }
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
  item.aiRuns.push({ total_score: 60, max_score: 100, results: [{ id: '1', score: 30, max: 50 }] });
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
