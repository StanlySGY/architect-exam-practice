import assert from 'node:assert/strict';
import test from 'node:test';
import { auditSourceMapping, renderSourceMappingMarkdown } from '../scripts/audit-bank-source-mapping.mjs';

test('来源映射按题型和年份生成候选，不把同名或文本匹配直接当成来源证明', () => {
  const root = '/tmp/source-root';
  const files = [
    '/tmp/source-root/02-历年真题/2020年下半年-系统架构设计师-案例分析.md',
    '/tmp/source-root/02-历年真题(补充)/2020年下半年-系统架构设计师-案例分析.md',
    '/tmp/source-root/02-历年真题/2020年下半年-系统架构设计师-论文.md',
  ];
  const contents = new Map(files.map((file) => [file, '# 试题一\n论模型驱动架构设计方法及其应用\n在某系统中设计架构']));
  const report = auditSourceMapping({
    choices: [{ id: 'choice-1', sourceType: 'real', term: '2020年下半年', stem: '在某系统中设计架构', sourceFile: '旧目录/综合知识.md' }],
    cases: [{ id: 'case-1', sourceType: 'real', term: '2020年下半年', title: '试题一', description: '在某系统中设计架构', sourceFile: '旧目录/案例分析.md' }],
    essays: [{ id: 'essay-1', sourceType: 'real', term: '2020年下半年', title: '论模型驱动架构设计方法及其应用', prompt: '论模型驱动架构设计方法及其应用', sourceFile: '旧目录/论文.md' }, { id: 'essay-remote', sourceType: 'real', title: '远程题目', sourceFile: 'https://example.com/exam' }, { id: 'essay-mock', sourceType: 'mock', term: '2026年5月 模拟卷1', title: '模拟题', sourceFile: '模拟题/论文.md' }],
  }, root, files, contents);
  assert.equal(report.readOnly, true);
  assert.equal(report.counts.records, 5);
  assert.equal(report.records.find((x) => x.id === 'case-1').status, 'ambiguous-candidates');
  assert.equal(report.records.find((x) => x.id === 'essay-1').status, 'candidate-text-match-needs-human-review');
  assert.equal(report.records.find((x) => x.id === 'essay-remote').status, 'remote-source-needs-review');
  assert.equal(report.records.find((x) => x.id === 'essay-mock').status, 'simulated-no-original-source');
  assert.match(renderSourceMappingMarkdown(report), /不判断答案对错/);
});

test('来源映射阻止 sourceFile 路径逃逸 source root', () => {
  const report = auditSourceMapping({ choices: [{ id: 'escape', sourceType: 'real', term: '2020年下半年', stem: 'x', sourceFile: '../../outside.md' }] }, '/tmp/source-root', []);
  assert.equal(report.records[0].status, 'unsafe-source-path');
  assert.deepEqual(report.records[0].candidates, []);
});

test('题源人工复核只确认本地内容对应，不会把题号错配或候选文本升级成官方来源', async () => {
  const { readFile } = await import('node:fs/promises');
  const reviewPath = new URL('../docs/audits/source-mapping-adjudication-2026-10-14.json', import.meta.url);
  const review = JSON.parse(await readFile(reviewPath, 'utf8'));
  assert.equal(review.readOnly, true);
  assert.equal(review.summary.bankMutated, false);
  assert.equal(review.summary.recordsReviewed, 4);
  assert.equal(review.summary.localContentMatchReproduced, 4);
  assert.equal(review.summary.localHeadingNumberDiffers, 4);
  assert.equal(review.summary.officialSourceProvenanceVerified, 0);
  assert.equal(review.summary.answerCorrectnessReviewed, 0);
  assert.equal(review.summary.remoteCaseThemeChecksReviewed, 5);
  assert.equal(review.summary.caseThemeLevelCorroborations, 5);
  assert.equal(review.summary.fullPromptMatchesConfirmed, 0);
  assert.equal(review.summary.lightsoftUrlsAttemptedThroughWebTool, 1);
  assert.equal(review.summary.lightsoftUrlsAccessibleThroughWebTool, 0);
  assert.equal(review.remoteCrossCheck.sourceRole, 'secondary-theme-level-corroboration');
  assert.equal(review.remoteCrossCheck.bankLightsoftUrlCheck.verificationToolResult, 'not-accessible-through-web-verification-tool');
  assert.match(review.remoteCrossCheck.bankLightsoftUrlCheck.bankUrl, /id=8d196ee9be0942eeafcc6bf7cdccff60/);
  assert.match(review.remoteCrossCheck.bankLightsoftUrlCheck.similarIndexedLightsoftUrl, /id=22702c1d5caf4d3b843415c82745b322/);
  assert.equal(review.remoteCaseThemeReviews.length, 5);
  for (const entry of review.remoteCaseThemeReviews) {
    assert.equal(entry.decision, 'theme-level-only');
    assert.equal(entry.officialSourceProvenanceVerified, false);
  }
  assert.equal(review.records.length, 4);
  assert.deepEqual(
    review.records.map(record => record.itemId),
    [
      'real-2021年下半年-010',
      'real-2021年下半年-012',
      'real-2021年下半年-014',
      'real-2021年下半年-015',
    ],
  );
  for (const record of review.records) {
    assert.equal(record.queueStatusAtReview, 'candidate-content-match-local-heading-number-differs');
    assert.notEqual(record.bankQuestionNo, record.candidateQuestionNo);
    assert.equal(record.matchedFlags.matchedTitle, true);
    assert.equal(record.matchedFlags.matchedStem, true);
    assert.equal(record.matchedFlags.matchedOptions, true);
    assert.equal(record.matchedFlags.matchedAnswer, true);
    assert.equal(record.matchedFlags.matchedExactQuestion, false);
    assert.equal(record.matchedFlags.questionNumberMismatch, true);
    assert.equal(record.adjudication, 'local-content-match-question-number-differs-origin-unverified');
  }
  assert.equal(review.summary.sameNumberExactContentReviews, 44);
  assert.equal(review.summary.sameNumberContentStemOptionAnswerMatches, 44);
  assert.equal(review.sameNumberExactContentReviews.length, 44);
  assert.equal(review.summary.sameNumberStrictStemOptionAnswerMatches, 44);
  assert.equal(review.summary.sameNumberSecondBatchReviewed, 10);
  assert.equal(review.summary.sameNumberThirdBatchReviewed, 4);
  assert.equal(review.summary.sameNumberFourthBatchReviewed, 8);
  assert.equal(review.summary.sameNumberFifthBatchReviewed, 14);
  assert.equal(review.summary.sharedStemPairReviews, 4);
  assert.equal(review.summary.sharedStemOptionAnswerMatches, 4);
  assert.equal(review.sharedStemPairReviews.length, 4);
  for (const record of review.sameNumberExactContentReviews) {
    assert.equal(record.queueStatusAtReview, 'candidate-question-content-match-needs-human-review');
    assert.equal(record.bankQuestionNo, record.candidateQuestionNo);
    assert.equal(record.reproducedChecks.candidateHeadingQuestionNo, record.questionNo);
    assert.equal(record.reproducedChecks.normalizedStemMatch, true);
    assert.equal(record.reproducedChecks.optionsAtoDMatch, true);
    assert.equal(record.reproducedChecks.answerKeyMatch, true);
    assert.equal(record.officialSourceProvenanceVerified, false);
    assert.equal(record.answerCorrectnessVerified, false);
    assert.equal(record.adjudication, 'local-question-stem-options-answer-match-origin-unverified');
  }
  for (const record of review.sharedStemPairReviews) {
    assert.equal(record.bankQuestionNo, record.candidateQuestionNo);
    assert.equal(record.reproducedChecks.candidateHeadingQuestionNo, record.questionNo);
    assert.equal(record.reproducedChecks.normalizedStemMatch, false);
    assert.equal(record.reproducedChecks.sharedStemPairMapping, true);
    assert.equal(record.reproducedChecks.optionsAtoDMatch, true);
    assert.equal(record.reproducedChecks.answerKeyMatch, true);
    assert.ok(record.pairedItemIds.includes(record.itemId));
    assert.equal(record.officialSourceProvenanceVerified, false);
    assert.equal(record.answerCorrectnessVerified, false);
    assert.equal(record.adjudication, 'paired-shared-stem-representation-variant-origin-unverified');
  }
});
