import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditGeneratedQuestions,
  buildAnswerRiskPacket,
  buildLearningReviewBatches,
  classifyAuthority,
  classifyHttpStatus,
  collectEvidenceUrls,
  isRetryableSourceStatus,
} from '../scripts/run-local-review-job.mjs';

test('source authority classifier distinguishes primary publishers and public standards agencies', () => {
  assert.equal(classifyAuthority('https://www.tup.tsinghua.edu.cn/book.pdf'), 'publisher');
  assert.equal(classifyAuthority('https://csrc.nist.gov/glossary/term/hardware'), 'government-or-public-agency');
  assert.equal(classifyAuthority('https://www.w3.org/TR/REC-html40/'), 'standards-body');
  assert.equal(classifyAuthority('https://academic.oup.com/jrsssc/article/22/3/332/6882722'), 'academic-or-research');
  assert.equal(classifyAuthority('https://community.wvu.edu/~research/paper.pdf'), 'academic-or-research');
  assert.equal(classifyAuthority('https://cordis.europa.eu/project/id/213322'), 'government-or-public-agency');
  assert.equal(classifyAuthority('https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html'), 'vendor-or-project-documentation');
  assert.equal(classifyAuthority('https://aws.amazon.com/retail/advanced-data-insights/'), 'vendor-or-project-documentation');
  assert.equal(classifyAuthority('https://example.invalid/not-known'), 'unknown-authority');
  assert.equal(classifyAuthority('not a URL'), 'invalid-url');
});

test('HTTP 403 is access restriction, not proof of a missing source', () => {
  assert.equal(classifyHttpStatus(200), 'reachable');
  assert.equal(classifyHttpStatus(403), 'access-restricted');
  assert.equal(classifyHttpStatus(404), 'not-found');
  assert.equal(classifyHttpStatus(429), 'retry-or-rate-limited');
  assert.equal(classifyHttpStatus(503), 'server-error');
  assert.equal(isRetryableSourceStatus('network-error'), true);
  assert.equal(isRetryableSourceStatus('server-error'), true);
  assert.equal(isRetryableSourceStatus('not-found'), false);
  assert.equal(isRetryableSourceStatus('access-restricted'), false);
});

test('learning source URL collection deduplicates URLs while retaining unit provenance', () => {
  const urls = collectEvidenceUrls({ units: {
    '1.1': { evidence: [{ url: 'https://www.tup.tsinghua.edu.cn/a', sourceTitle: 'A', sourceAuthority: 'Publisher', reviewStatus: 'bounded' }] },
    '1.2': { evidence: [{ url: 'https://www.tup.tsinghua.edu.cn/a', sourceTitle: 'A2', sourceAuthority: 'Publisher', reviewStatus: 'core' }] },
    '1.3': { evidence: [{ url: 'http://example.org/b' }, { url: 'file:///private/book.pdf' }] },
  } });
  assert.equal(urls.length, 2);
  const shared = urls.find((item) => item.url === 'https://www.tup.tsinghua.edu.cn/a');
  assert.deepEqual(shared.unitIds, ['1.1', '1.2']);
  assert.deepEqual(shared.sourceTitles, ['A', 'A2']);
  assert.equal(shared.authorityClass, 'publisher');
});

test('learning review batching covers every queued unit exactly once and respects batch bounds', () => {
  const queue = Array.from({ length: 43 }, (_, index) => ({ id: String(index + 1), chapter: '1' }));
  const batches = buildLearningReviewBatches(queue, 20);
  assert.deepEqual(batches.map((batch) => batch.unitCount), [20, 20, 3]);
  assert.deepEqual(batches.flatMap((batch) => batch.units).map((unit) => unit.id), queue.map((unit) => unit.id));
  assert.throws(() => buildLearningReviewBatches(queue, 0), /batch size/u);
});

test('generated question structure audit creates candidates and never claims answer verification', () => {
  const rows = [
    { id: 'g1', sourceType: 'generated', question: 'stem', options: { A: 'a', B: 'b', C: 'c', D: 'd' }, correctAnswer: 'A', analysis: 'because', sourceNode: '第1章 › 1.1', section: '1.1', knowledgeDetail: 'detail', reviewStatus: 'pending' },
    { id: 'g2', sourceType: 'generated', question: 'stem', options: { A: 'a', B: 'b', C: 'c', D: 'd' }, correctAnswer: 'Z', analysis: '', sourceNode: '', knowledgeDetail: '' },
    { id: 'legacy', source: 'ruankao-agent/mindmap', status: 'active', reviewStatus: 'pending_review', question: 'legacy generated question', options: { A: 'a', B: 'b', C: 'c', D: 'd' }, correctAnswer: 'A', analysis: 'because', sourceNode: '第1章 › 1.2', section: '1.2', knowledgeDetail: 'detail' },
    { id: 'real', sourceType: 'real', question: 'untouched' },
  ];
  const report = auditGeneratedQuestions(rows);
  assert.equal(report.total, 3);
  assert.equal(report.statusDistribution.pending_review, 1);
  assert.equal(report.structureFlagged, 1);
  assert.deepEqual(report.flags[0].reasons, ['invalid-correct-answer', 'missing-analysis', 'missing-mindmap-source-node', 'missing-knowledge-detail']);
  assert.equal(report.duplicateGroups.length, 1);
  assert.match(report.note, /不批准/u);
});

test('answer risk packet maps review candidates to read-only records without changing them', () => {
  const report = buildAnswerRiskPacket({
    findings: [
      { item: { id: 'q1', kind: 'choice' }, rule: 'unsupported-quantified-claim', matchedText: '2倍' },
      { item: { id: 'case1:Q1', kind: 'case' }, rule: 'absolute-or-exam-trend-claim' },
      { item: { id: 'essay1', kind: 'essay' }, rule: 'unsupported-quantified-claim' },
    ],
  }, new Set(['q1']), new Set(['case1']), new Set());
  assert.equal(report.total, 3);
  assert.deepEqual(report.findings.map((item) => item.recordFoundInLocalReadOnlyApi), [true, true, false]);
  assert.match(report.note, /不修改答案/u);
});
