import assert from 'node:assert/strict';
import test from 'node:test';
import { auditSourceMapping, inspectQuestionAtNumber, renderSourceMappingMarkdown } from '../scripts/audit-bank-source-mapping.mjs';

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
  assert.equal(review.summary.sameNumberExactContentReviews, 173);
  assert.equal(review.summary.sameNumberContentStemOptionAnswerMatches, 173);
  assert.equal(review.sameNumberExactContentReviews.length, 173);
  assert.equal(review.summary.sameNumberStrictStemOptionAnswerMatches, 173);
  assert.equal(review.summary.sameNumberSecondBatchReviewed, 10);
  assert.equal(review.summary.sameNumberThirdBatchReviewed, 4);
  assert.equal(review.summary.sameNumberFourthBatchReviewed, 8);
  assert.equal(review.summary.sameNumberFifthBatchReviewed, 14);
  assert.equal(review.summary.sameNumberSixthBatchReviewed, 14);
  assert.equal(review.summary.sameNumberSeventhBatchReviewed, 12);
  assert.equal(review.summary.sameNumberEighthBatchReviewed, 12);
  assert.equal(review.summary.sameNumberNinthBatchReviewed, 8);
  assert.equal(review.summary.sameNumberTenthBatchReviewed, 9);
  assert.equal(review.summary.sameNumberEleventhBatchReviewed, 2);
  assert.equal(review.summary.sameNumberTwelfthBatchReviewed, 11);
  assert.equal(review.summary.sameNumberThirteenthBatchReviewed, 13);
  assert.equal(review.summary.sameNumberFourteenthBatchReviewed, 17);
  assert.equal(review.summary.sameNumberFifteenthBatchReviewed, 25);
  assert.equal(review.summary.sameNumber2016AdditionalBatchReviewed, 6);
  assert.equal(review.summary.contentExceptionFourthBatchReviewed, 2);
  assert.equal(review.summary.contentExceptionSixthBatchReviewed, 6);
  assert.equal(review.summary.contentException2019SourceAssetExceptionsReviewed, 6);
  assert.equal(review.summary.questionNumberShiftCrossChecksReviewed, 8);
  assert.equal(review.summary.questionNumberShiftStrictTextMatches, 6);
  assert.equal(review.summary.questionNumberShiftVisualExceptions, 2);
  assert.equal(review.summary.sharedBlankMappingGroupsReviewed, 5);
  assert.equal(review.summary.sharedBlankMappingItemsReviewed, 10);
  assert.equal(review.summary.sharedBlankMappingExactGroups, 3);
  assert.equal(review.summary.sharedBlankMappingExceptionGroups, 2);
  assert.equal(review.sharedBlankMappingReviews.length, 5);
  const matchedBlankGroups = review.sharedBlankMappingReviews.filter(group => group.expected === 'exact-shared-blank-pair');
  assert.equal(matchedBlankGroups.length, 3);
  for (const group of matchedBlankGroups) {
    assert.equal(group.items.length, 2);
    for (const item of group.items) {
      assert.equal(item.reproducedChecks.normalizedSharedStemMatch, true);
      assert.equal(item.reproducedChecks.optionsAtoDMatch, true);
      assert.equal(item.reproducedChecks.answerKeyMatch, true);
      assert.equal(item.officialSourceProvenanceVerified, false);
      assert.equal(item.answerCorrectnessVerified, false);
    }
  }
  const idlVariance = review.sharedBlankMappingReviews.find(group => group.groupId === '2017h2-idl-definition-blank-37-38');
  assert.equal(idlVariance.items.find(item => item.bankQuestionNo === 37).reproducedChecks.answerKeyMatch, false);
  const confirmationVariance = review.sharedBlankMappingReviews.find(group => group.groupId === '2017h2-confirmation-test-blank-42-43');
  assert.equal(confirmationVariance.items.find(item => item.bankQuestionNo === 42).reproducedChecks.optionsAtoDMatch, false);
  assert.equal(confirmationVariance.items.find(item => item.bankQuestionNo === 43).reproducedChecks.optionsAtoDMatch, true);
  assert.equal(review.summary.contentException2019ShiftedAssetExceptionsReviewed, 2);
  assert.equal(review.questionNumberShiftCrossChecks.length, 8);
  for (const record of review.questionNumberShiftCrossChecks) {
    assert.notEqual(record.bankQuestionNo, record.candidateQuestionNo);
    assert.equal(record.reproducedChecks.questionNumberMismatch, true);
    assert.equal(record.reproducedChecks.optionsAtoDMatch, true);
    assert.equal(record.reproducedChecks.answerKeyMatch, true);
    assert.equal(record.officialSourceProvenanceVerified, false);
    assert.equal(record.answerCorrectnessVerified, false);
  }
  assert.equal(review.summary.sharedStemFourthBatchReviewed, 2);
  assert.equal(review.summary.contentExceptionReviews, 11);
  assert.equal(review.contentExceptionReviews.length, 11);
  assert.equal(review.summary.sharedStemPairReviews, 6);
  assert.equal(review.summary.sharedStemOptionAnswerMatches, 6);
  assert.equal(review.sharedStemPairReviews.length, 6);
  for (const record of review.sameNumberExactContentReviews) {
    assert.ok(['candidate-question-content-match-needs-human-review', 'candidate-text-match-needs-human-review'].includes(record.queueStatusAtReview));
    assert.equal(record.bankQuestionNo, record.candidateQuestionNo);
    assert.equal(record.reproducedChecks.candidateHeadingQuestionNo, record.questionNo);
    assert.equal(record.reproducedChecks.normalizedStemMatch, true);
    assert.equal(record.reproducedChecks.optionsAtoDMatch, true);
    assert.equal(record.reproducedChecks.answerKeyMatch, true);
    assert.equal(record.officialSourceProvenanceVerified, false);
    assert.equal(record.answerCorrectnessVerified, false);
    assert.equal(record.adjudication, 'local-question-stem-options-answer-match-origin-unverified');
  }
  const arrowException = review.contentExceptionReviews.find(record => record.itemId === 'real-2023年下半年-054');
  assert.equal(arrowException.reproducedChecks.normalizedStemMatch, true);
  assert.equal(arrowException.reproducedChecks.optionsAtoCMatchAfterArrowNormalization, true);
  assert.equal(arrowException.reproducedChecks.optionDTextMatch, false);
  assert.equal(arrowException.reproducedChecks.answerKeyMatch, true);
  const diagramException = review.contentExceptionReviews.find(record => record.itemId === 'real-2017年下半年-006');
  assert.equal(diagramException.reproducedChecks.normalizedTextStemMatch, true);
  assert.equal(diagramException.reproducedChecks.optionsAtoDMatch, true);
  assert.equal(diagramException.reproducedChecks.candidateHasDiagramAsset, false);
  for (const id of [
    'real-2019年下半年-009','real-2019年下半年-010','real-2019年下半年-011',
    'real-2019年下半年-018','real-2019年下半年-019','real-2019年下半年-020',
  ]) {
    const missingAsset = review.contentExceptionReviews.find(record => record.itemId === id);
    assert.equal(missingAsset.reproducedChecks.textStemBeforeMissingAssetMatches, true);
    assert.equal(missingAsset.reproducedChecks.optionsAtoDMatch, true);
    assert.equal(missingAsset.reproducedChecks.answerKeyMatch, true);
    assert.equal(missingAsset.reproducedChecks.originalAssetPresentInCandidate, false);
  }
  const tableException = review.contentExceptionReviews.find(record => record.itemId === 'real-2024年上半年-068');
  assert.equal(tableException.reproducedChecks.questionSentenceMatches, true);
  assert.equal(tableException.reproducedChecks.bankTablePresent, true);
  assert.equal(tableException.reproducedChecks.candidateTablePresent, false);
  for (const exception of review.contentExceptionReviews) {
    assert.equal(exception.officialSourceProvenanceVerified, false);
    assert.equal(exception.answerCorrectnessVerified, false);
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

test('共享多空题把题号占位规范为源文本空白，但不泛化删除数值', () => {
  const sharedStem = '面向服务系统构建过程中，（ ）用于实现 Web 服务的远程调用，（ ）用来将分散的、功能单一的 Web 服务组织成一个复杂的有机应用。';
  const source = [
    '## 第39题', '', sharedStem, '',
    '- **A.** UDDI', '- **B.** WSDL', '- **C.** SOAP', '- **D.** BPEL', '', '**正确答案：C**', '',
    '## 第40题', '', sharedStem, '',
    '- **A.** UDDI', '- **B.** WSDL', '- **C.** SOAP', '- **D.** BPEL', '', '**正确答案：D**',
  ].join('\n');
  const options = { A: 'UDDI', B: 'WSDL', C: 'SOAP', D: 'BPEL' };
  const row39 = { questionNo: 39, stem: '面向服务系统构建过程中，（39）用于实现 Web 服务的远程调用，（40）用来将分散的、功能单一的 Web 服务组织成一个复杂的有机应用。', options, answer: 'C' };
  const row40 = { ...row39, questionNo: 40, answer: 'D' };
  for (const [questionNo, row] of [[39, row39], [40, row40]]) {
    const result = inspectQuestionAtNumber(source, questionNo, row);
    assert.equal(result.atNumber.matchedStem, true);
    assert.equal(result.atNumber.matchedOptions, true);
    assert.equal(result.atNumber.matchedAnswer, true);
    assert.equal(result.atNumber.matchedExactQuestion, true);
  }
  const numericSource = ['## 第8题', '', '某服务在 80% 负载时的延迟为 39 ms。', '', '- **A.** 39 ms', '- **B.** 40 ms', '- **C.** 41 ms', '- **D.** 42 ms', '', '**正确答案：A**'].join('\n');
  const numeric = inspectQuestionAtNumber(numericSource, 8, { questionNo: 8, stem: '某服务在 80% 负载时的延迟为 39 ms。', options: { A: '39 ms', B: '40 ms', C: '41 ms', D: '42 ms' }, answer: 'A' });
  assert.equal(numeric.atNumber.matchedStem, true);
  assert.equal(numeric.atNumber.matchedExactQuestion, true);
  const ambiguousNumericSource = [
    '## 第8题', '',
    '某服务处理第（ ）批数据，额外数据项已到达。', '',
    '- **A.** 10', '- **B.** 20', '- **C.** 30', '- **D.** 40', '',
    '**正确答案：A**',
  ].join('\n');
  const ambiguousNumeric = inspectQuestionAtNumber(ambiguousNumericSource, 8, {
    questionNo: 8,
    stem: '某服务处理第（8）批数据，额外数据项已到达。',
    options: { A: '10', B: '20', C: '30', D: '40' },
    answer: 'A',
  });
  assert.equal(ambiguousNumeric.atNumber.matchedStem, false);
  assert.equal(ambiguousNumeric.atNumber.matchedOptions, true);
  assert.equal(ambiguousNumeric.atNumber.matchedAnswer, true);
  assert.equal(ambiguousNumeric.atNumber.matchedExactQuestion, false);
});
