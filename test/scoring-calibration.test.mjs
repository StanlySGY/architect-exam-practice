import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCalibration } from '../scripts/evaluate-scoring-calibration.mjs';

function sample(type, id, human = 80, ai = 80) {
  const run = type === 'case'
    ? { total_score: ai, max_score: 100, results: [{ name: 'analysis', score: ai / 2, max_score: 50 }] }
    : { total_score: ai, max_score: 100, dimensions: [{ name: 'technical-depth', score: ai / 2, max_score: 50 }] };
  return {
    id,
    type,
    version: { rubric: 'r1', prompt: 'p1', grader: 'g1' },
    humanRatings: [
      { raterId: 'human-a', score: human, maxScore: 100 },
      { raterId: 'human-b', score: human, maxScore: 100 },
    ],
    adjudicated: {
      score: human,
      maxScore: 100,
      components: [{ name: type === 'case' ? 'analysis' : 'technical-depth', score: human / 2, maxScore: 50 }],
    },
    aiRuns: [run],
  };
}

test('empty intake blocks calibration instead of inventing anchor scores', () => {
  const report = evaluateCalibration({ samples: [] });
  assert.equal(report.status, 'blocked-or-insufficient-anchor-samples');
  assert.deepEqual(report.insufficient.map(item => item.type), ['case', 'essay']);
});

test('case and essay graders are evaluated independently after ten valid human-anchored samples', () => {
  const samples = [
    ...Array.from({ length: 10 }, (_, index) => sample('case', 'case-' + index, 70 + index, 70 + index)),
    ...Array.from({ length: 10 }, (_, index) => sample('essay', 'essay-' + index, 60 + index, 60 + index)),
  ];
  const report = evaluateCalibration({ samples });
  assert.equal(report.status, 'exploratory-analysis-ready');
  assert.equal(report.sampleCounts.validCase, 10);
  assert.equal(report.sampleCounts.validEssay, 10);
  assert.equal(report.byType.case.pointAgreement.meanAbsoluteErrorPp, 0);
  assert.equal(report.byType.essay.pointAgreement.within5PercentagePoints, 10);
  assert.equal(report.byType.case.humanAgreement.iccA1, 1);
  assert.equal(report.byType.essay.componentMeanAbsoluteErrorPp['technical-depth'], 0);
});

test('repeated AI runs and explicit thresholds are measured without assuming a paper pass mark', () => {
  const item = sample('case', 'repeat-case', 60, 55);
  item.passThresholdPct = 60;
  item.aiRuns.push({ total_score: 60, max_score: 100, results: [{ name: 'analysis', score: 30, max_score: 50 }] });
  const report = evaluateCalibration({ samples: [item] });
  assert.equal(report.status, 'blocked-or-insufficient-anchor-samples');
  assert.equal(report.byType.case.passFail.thresholdedSampleCount, 1);
  assert.equal(report.byType.case.passFail.disagreementCount, 1);
  assert.ok(Math.abs(report.byType.case.repeatedAiRunVariability.meanRangePp - 5) < 1e-9);
  assert.equal(report.byType.essay.passFail.thresholdedSampleCount, 0);
});

test('invalid sample with duplicate rater identity is excluded and explained', () => {
  const item = sample('essay', 'bad-raters');
  item.humanRatings[1].raterId = item.humanRatings[0].raterId;
  const report = evaluateCalibration({ samples: [item] });
  assert.equal(report.sampleCounts.rejected, 1);
  assert.match(report.rejected[0].errors.join(' '), /distinct/u);
  assert.equal(report.sampleCounts.validEssay, 0);
});
