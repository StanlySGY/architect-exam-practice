import assert from 'node:assert/strict';
import test from 'node:test';
import { auditClaimEvidenceRegister } from '../scripts/audit-bank-claim-evidence-register.mjs';

test('证据登记审计精确定位原文，且不将来源记录升级为答案核验', () => {
  const report = auditClaimEvidenceRegister(
    { choices: [{ id: 'q1', analysis: '例如 AWS Lambda 普通函数的 timeout 上限为 15 分钟。' }] },
    {
      reviewedOn: '2026-10-13',
      records: [{
        recordId: 'r1',
        disposition: 'supported-with-scope',
        targets: [{ itemId: 'q1', field: 'analysis', claimNeedle: 'AWS Lambda 普通函数的 timeout 上限为 15 分钟' }],
        sourceEvidence: [{
          url: 'https://docs.example.com/limits',
          title: 'Limits',
          publisher: 'Example',
          sourceKind: 'vendor-documentation',
          checkedOn: '2026-10-13',
          supports: '限定条件下的限制。',
          limitations: '不证明所有产品。',
        }],
        answerVerification: 'not-established',
      }],
    },
  );
  assert.equal(report.counts.records, 1);
  assert.equal(report.counts.targetClaims, 1);
  assert.equal(report.counts.exactTextTargetsMatched, 1);
  assert.equal(report.counts.invalidRecords, 0);
  assert.equal(report.records[0].answerVerification, 'not-established');
  assert.match(report.note, /不发起网络请求/);
});

test('证据目标发生漂移、来源元数据不完整或 disposition 越界时报告失败', () => {
  const report = auditClaimEvidenceRegister(
    { choices: [{ id: 'q1', analysis: '新版本解析文本。' }] },
    {
      records: [{
        recordId: 'r2',
        disposition: 'verified',
        targets: [{ itemId: 'q1', field: 'analysis', claimNeedle: '旧版本解析文本' }],
        sourceEvidence: [{ url: 'http://not-https.example.com/source' }],
      }],
    },
  );
  assert.equal(report.counts.targetClaimsUnmatched, 1);
  assert.equal(report.counts.recordsWithAllowedDisposition, 0);
  assert.equal(report.counts.invalidRecords, 1);
  assert.equal(report.records[0].sourceMetadataOk, false);
});

test('案例子题 ID 可追溯，且登记不能把答案状态写为 verified 或 approved', () => {
  const bank = { cases: [{ id: 'case-1', subQuestions: [{ question_label: '问题1', reference_answer: '这是一段可定位的参考解析。' }] }] };
  const records = ['verified', 'approved'].map((answerVerification) => ({
    recordId: answerVerification,
    disposition: 'supported-with-scope',
    targets: [{ itemId: 'case-1:问题1', field: 'reference_answer', claimNeedle: '可定位的参考解析' }],
    sourceEvidence: [],
    answerVerification,
  }));
  const report = auditClaimEvidenceRegister(bank, { records });
  assert.equal(report.counts.exactTextTargetsMatched, 2);
  assert.equal(report.counts.targetClaimsUnmatched, 0);
  assert.equal(report.counts.recordsWithAllowedDisposition, 2);
  assert.equal(report.counts.recordsWithAllowedVerification, 0);
  assert.equal(report.counts.invalidRecords, 2);
  assert.ok(report.records.every((record) => record.answerVerificationAllowed === false));
});
